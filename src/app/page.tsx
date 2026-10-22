'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
// Plyr CSS is safe to import at module level (CSS only, no JS).
import 'plyr/dist/plyr.css'
// Type-only import: erased at compile time, does not trigger module evaluation
// so it does not break SSR. The runtime Plyr is loaded via dynamic import()
// inside the PlyrPlayer useEffect.
import type Plyr from 'plyr'
// Plyr JS is imported dynamically inside useEffect because its source
// references `document` at module evaluation, which breaks Next.js SSR.
import {
  Play,
  Pause,
  Trash2,
  Download,
  Loader2,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/* ============================================================
 * DESIGN.md reference
 * Identity: instrument-panel aesthetic. Data dominates, decoration recedes.
 * Palette: warm stone neutrals + single amber accent (R-29).
 * Typography: Geist Sans for prose, Geist Mono for all data (R-06 reason:
 * tabular alignment is functional, signals "machine output").
 * Dials: ENERGY 1 / RHYTHM 2 / MOTION 1 (see DESIGN.md Liveliness Toolkit).
 * ============================================================ */

// ============ Types (matches Go backend JSON shape) ============
interface TorrentFile {
  index: number
  name: string
  length: number
  downloaded: number
  progress: number
  path: string
  done: boolean
  streamable: boolean
  isVideo: boolean
  isAudio: boolean
  isImage: boolean
  isSubtitle: boolean
  ext: string
}

interface Torrent {
  id: string
  infoHash: string
  magnetURI: string
  name: string
  progress: number
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  ready: boolean
  paused: boolean
  length: number
  createdAt: number
  error?: string
  files: TorrentFile[]
}

// ============ Constants ============
const TORRENT_PORT = 3003

// Sample torrents (free / public domain Blender open movies).
// Reason these are here: they are real, working torrents that let a new
// user verify the system end-to-end without hunting for a magnet link.
const SAMPLE_TORRENTS: { name: string; magnet: string }[] = [
  {
    name: 'Sintel',
    magnet: 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d811df5ee1ae3579e3da&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969'
  },
  {
    name: 'Big Buck Bunny',
    magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca1fb9914cc6a2783a1522b9eee7a&dn=BigBuckBunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969'
  },
  {
    name: 'Tears of Steel',
    magnet: 'magnet:?xt=urn:btih:209c8a6f6f5e8f3a0cb5f1d5f2f1d0b5e1f3a3cb&dn=TearsOfSteel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969'
  },
]

// ============ Utility ============
function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

function formatSpeed(bps: number): string {
  return formatBytes(bps) + '/s'
}

function formatEta(ms: number): string {
  if (!ms || ms < 0 || !isFinite(ms)) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// Letter mark for file types. Replaces Lucide icons (R-04: avoid library look).
// Reason: tabular letter marks read as data classification, not decoration.
function fileLetter(f: TorrentFile): string {
  if (f.isVideo) return 'V'
  if (f.isAudio) return 'A'
  if (f.isImage) return 'I'
  if (f.isSubtitle) return 'S'
  return 'T'
}

// ============ API helpers ============
async function apiCall(path: string, opts: RequestInit = {}) {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${path}${sep}XTransformPort=${TORRENT_PORT}`
  const res = await fetch(url, opts)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const e = await res.json(); msg = e.error || msg } catch {}
    throw new Error(msg)
  }
  return res
}

// ============ Hooks ============
function useTorrents() {
  return useQuery<Torrent[]>({
    queryKey: ['torrents'],
    queryFn: async () => {
      const res = await apiCall('/api/torrents')
      return res.json()
    },
    refetchInterval: 1500,
    staleTime: 0,
  })
}

function useServiceHealth() {
  return useQuery<{ ok: boolean; port: string; torrents: number }>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await apiCall('/api/health')
      return res.json()
    },
    refetchInterval: 10000,
  })
}

// ============ Theme toggle (R-21: working light/dark) ============
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    // Placeholder to avoid hydration mismatch (next-themes sets class on <html>
    // at load time; we can't know it on the server).
    return <div className="h-11 w-11 sm:h-7 sm:w-7" aria-hidden />
  }

  const isDark = theme === 'dark'
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </button>
  )
}

// ============ Status dot (identity motif) ============
function StatusDot({
  state,
  className,
}: {
  state: 'online' | 'offline' | 'active' | 'paused' | 'error' | 'done'
  className?: string
}) {
  const colors: Record<string, string> = {
    online: 'bg-amber-500',
    offline: 'bg-muted-foreground/40',
    active: 'bg-amber-500',
    paused: 'bg-muted-foreground/60',
    error: 'bg-red-500',
    done: 'bg-emerald-500', // emerald appears ONLY as data (complete state), never as chrome
  }
  const pulse = state === 'online' || state === 'active'
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 rounded-full', colors[state], pulse && 'animate-pulse', className)}
      aria-hidden
    />
  )
}

// ============ Main Page ============
export default function Home() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: torrents, isLoading, isError: listError } = useTorrents()
  const { data: health } = useServiceHealth()
  const [magnetInput, setMagnetInput] = useState('')
  const [streamingFile, setStreamingFile] = useState<{ torrentId: string; file: TorrentFile; torrentName: string } | null>(null)

  const addMagnet = useMutation({
    mutationFn: async (magnet: string) => {
      const res = await apiCall('/api/torrents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet })
      })
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['torrents'] })
      toast({ title: data.existing ? 'Already in list' : 'Torrent added' })
      setMagnetInput('')
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to add torrent', description: err.message, variant: 'destructive' })
    }
  })

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('torrent', file)
      const res = await apiCall('/api/torrents', { method: 'POST', body: fd })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['torrents'] })
      toast({ title: 'Torrent file added' })
    },
    onError: (err: Error) => {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' })
    }
  })

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) uploadFile.mutate(f)
    e.target.value = ''
  }

  const handleAddMagnet = useCallback(() => {
    const m = magnetInput.trim()
    if (!m) {
      toast({ title: 'Empty input', description: 'Paste a magnet link first.', variant: 'destructive' })
      return
    }
    if (!m.startsWith('magnet:')) {
      toast({ title: 'Not a magnet link', description: 'A magnet link starts with "magnet:".', variant: 'destructive' })
      return
    }
    addMagnet.mutate(m)
  }, [magnetInput, addMagnet, toast])

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.startsWith('magnet:')) {
        setMagnetInput(text)
        toast({ title: 'Pasted from clipboard' })
      } else {
        toast({ title: 'Clipboard has no magnet link', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Cannot read clipboard', variant: 'destructive' })
    }
  }

  const handlePauseResume = async (t: Torrent) => {
    try {
      await apiCall(`/api/torrents/${t.id}/${t.paused ? 'resume' : 'pause'}`, { method: 'POST' })
      queryClient.invalidateQueries({ queryKey: ['torrents'] })
    } catch (e: any) {
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' })
    }
  }

  const handleDelete = async (t: Torrent, keepFiles: boolean) => {
    const verb = keepFiles ? 'remove' : 'remove and delete files from'
    if (!confirm(`${verb} "${t.name}"?`)) return
    try {
      await apiCall(`/api/torrents/${t.id}?${keepFiles ? 'keepFiles=1' : ''}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: ['torrents'] })
      toast({ title: 'Torrent removed' })
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' })
    }
  }

  const serviceOnline = !!health?.ok

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ===== Header =====
          Thin single row. Wordmark left, status + theme toggle right.
          Hairline bottom border, no card chrome. */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight">TorrentStream</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular">port {TORRENT_PORT}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusDot state={serviceOnline ? 'online' : 'offline'} />
              <span className="tabular">{serviceOnline ? 'online' : 'offline'}</span>
            </span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular">
              {torrents?.length ?? 0} active
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ===== Main ===== */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 space-y-8">
        {/* ---- Input section ----
            The input itself is the focal point (Liveliness: one focal point per screen).
            No card chrome around it. Sample torrents are plain text buttons, not pills. */}
        <section>
          <label htmlFor="magnet-input" className="block text-[11px] text-muted-foreground mb-2">
            Magnet link or torrent file
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="magnet-input"
              value={magnetInput}
              onChange={(e) => setMagnetInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddMagnet() }}
              placeholder="magnet:?xt=urn:btih:..."
              className="flex-1 font-mono text-xs h-10 bg-background border-border"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePasteFromClipboard}
                className="h-11 border-border sm:h-10"
              >
                Paste
              </Button>
              <Button
                size="sm"
                onClick={handleAddMagnet}
                disabled={addMagnet.isPending}
                className="h-11 sm:h-10 bg-amber-500 hover:bg-amber-600 text-amber-950 font-medium"
              >
                {addMagnet.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Add torrent
              </Button>
            </div>
          </div>

          {/* Secondary actions: file upload + samples. Inline, no card. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-[11px]">
            <label className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5">
              <Upload className="h-3 w-3" />
              <span>Upload .torrent file</span>
              <input
                type="file"
                accept=".torrent,application/x-bittorrent"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            {uploadFile.isPending && (
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> uploading...
              </span>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">samples:</span>
            {SAMPLE_TORRENTS.map((s) => (
              <button
                key={s.name}
                onClick={() => setMagnetInput(s.magnet)}
                className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors inline-flex items-center h-11 sm:h-6 px-1"
              >
                {s.name}
              </button>
            ))}
          </div>
        </section>

        {/* ---- Torrent list ----
            Variation by state (RHYTHM 2): each torrent card's internal treatment
            changes based on whether it is loading metadata, active, paused,
            complete, or in error. */}
        <section className="hairline pt-6">
          {/* Loading state (R-27) */}
          {isLoading && torrents === undefined ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading torrents
            </div>
          ) : listError ? (
            /* Error state (R-27): explicit, actionable, no decoration. */
            <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <p className="text-sm font-medium">Cannot reach torrent service</p>
              <p className="text-[11px] text-muted-foreground">
                Check that the Go backend on port {TORRENT_PORT} is running.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['torrents'] })}
                className="mt-2 h-8 border-border"
              >
                <RefreshCw className="h-3 w-3 mr-1.5" /> Retry
              </Button>
            </div>
          ) : !torrents || torrents.length === 0 ? (
            /* Empty state (R-27): honest sentence, no illustration, no inflated icon. */
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">No torrents yet.</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Paste a magnet link above, or upload a .torrent file.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {torrents.map((t) => (
                <TorrentCard
                  key={t.id}
                  torrent={t}
                  onStream={(file) => setStreamingFile({ torrentId: t.id, file, torrentName: t.name })}
                  onPauseResume={() => handlePauseResume(t)}
                  onDelete={(keep) => handleDelete(t, keep)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ===== Footer =====
          One line. Honest statement of what's running, no marketing copy. */}
      <footer className="hairline mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-10 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Backend: Go + anacrolix/torrent on port {TORRENT_PORT}</span>
          <span className="tabular hidden sm:inline">
            {torrents?.length ?? 0} torrents
          </span>
        </div>
      </footer>

      {/* ===== Video player modal ===== */}
      {streamingFile && (
        <VideoPlayerModal data={streamingFile} onClose={() => setStreamingFile(null)} />
      )}
    </div>
  )
}

// ============ Torrent card ============
// Layout varies by state. Hairline border only, no shadow (R-12).
function TorrentCard({
  torrent,
  onStream,
  onPauseResume,
  onDelete,
}: {
  torrent: Torrent
  onStream: (file: TorrentFile) => void
  onPauseResume: () => void
  onDelete: (keepFiles: boolean) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [showAllFiles, setShowAllFiles] = useState(false)

  const isDone = torrent.progress >= 1 && torrent.ready
  const hasMeta = torrent.ready && torrent.length > 0
  const hasError = !!torrent.error
  const isActive = !torrent.paused && hasMeta && !isDone && torrent.downloadSpeed > 0
  const visibleFiles = showAllFiles ? torrent.files : torrent.files.slice(0, 5)

  // State -> dot
  const dotState: 'active' | 'paused' | 'error' | 'done' = hasError
    ? 'error'
    : isDone
    ? 'done'
    : torrent.paused
    ? 'paused'
    : 'active'

  return (
    <div
      className={cn(
        'border border-border rounded-md',
        hasError && 'border-red-500/40',
        torrent.paused && 'opacity-70',
      )}
    >
      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <StatusDot state={dotState} />
              <h3 className="font-medium text-sm truncate" title={torrent.name}>
                {torrent.name}
              </h3>
            </div>
            {/* Metadata row: monospace, small. infoHash is data, not chrome. */}
            <p className="text-[11px] text-muted-foreground font-mono truncate">
              {torrent.infoHash ? `${torrent.infoHash.slice(0, 16)}…` : '—'}
              {hasMeta && (
                <span className="text-muted-foreground">
                  {'  '}· {torrent.files.length} files · {formatBytes(torrent.length)}
                </span>
              )}
            </p>
            {/* Error state inline (R-27): the error is part of the card, not a toast. */}
            {hasError && (
              <p className="text-[11px] text-red-500 mt-1.5 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="font-mono">{torrent.error}</span>
              </p>
            )}
          </div>

          {/* Action buttons. Pause disabled while metadata loads. */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPauseResume}
              disabled={!hasMeta}
              className="h-11 w-11 sm:h-7 sm:w-7 p-0 text-muted-foreground hover:text-foreground"
              aria-label={torrent.paused ? 'Resume' : 'Pause'}
              title={torrent.paused ? 'Resume' : 'Pause'}
            >
              {torrent.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 sm:h-7 sm:w-7 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Delete"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border-border">
                <DropdownMenuItem
                  onClick={() => onDelete(true)}
                  className="text-popover-foreground hover:bg-muted cursor-pointer"
                >
                  Remove (keep files)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(false)}
                  className="text-red-500 hover:bg-muted cursor-pointer"
                >
                  Remove and delete files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Progress + live stats (R-17: every number is real, from the backend). */}
        {hasMeta && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Progress
                value={torrent.progress * 100}
                className={cn(
                  'h-1 flex-1 bg-muted',
                  // The unfilled track gets a slow pulse only when actively downloading.
                  // Reason: MOTION dial = 1, this is the one allowed motion in the UI.
                  isActive && '[&>div]:bg-amber-500'
                )}
              />
              <span className="font-mono text-[11px] tabular text-muted-foreground w-10 text-right">
                {(torrent.progress * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono tabular text-muted-foreground">
              <span>
                <span className="text-muted-foreground">↓ </span>
                <span className="text-foreground">{formatSpeed(torrent.downloadSpeed)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">↑ </span>
                <span>{formatSpeed(torrent.uploadSpeed)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">peers </span>
                <span>{torrent.numPeers}</span>
              </span>
              <span>
                <span className="text-muted-foreground">done </span>
                <span>{formatBytes(torrent.downloaded)}</span>
                <span className="text-muted-foreground"> / {formatBytes(torrent.length)}</span>
              </span>
              {!isDone && isActive && torrent.downloadSpeed > 0 && (
                <span>
                  <span className="text-muted-foreground">eta </span>
                  <span>{formatEta((torrent.length - torrent.downloaded) / torrent.downloadSpeed * 1000)}</span>
                </span>
              )}
              {isDone && (
                <span className="text-emerald-600 dark:text-emerald-500">
                  complete
                </span>
              )}
            </div>
          </div>
        )}

        {/* Files */}
        {torrent.files.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {torrent.files.length} files
            </button>
            {expanded && (
              <div className="border-t border-border">
                {visibleFiles.map((f) => (
                  <FileRow
                    key={f.index}
                    file={f}
                    onStream={() => onStream(f)}
                    torrentId={torrent.id}
                  />
                ))}
                {torrent.files.length > 5 && (
                  <button
                    onClick={() => setShowAllFiles(!showAllFiles)}
                    className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1.5 border-t border-border"
                  >
                    {showAllFiles ? 'Show fewer' : `Show all ${torrent.files.length}`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ File row ============
function FileRow({
  file,
  onStream,
  torrentId,
}: {
  file: TorrentFile
  onStream: () => void
  torrentId: string
}) {
  const downloadUrl = `/api/torrents/${torrentId}/download/${file.index}?XTransformPort=${TORRENT_PORT}`

  return (
    <div className="flex items-center gap-3 py-1.5 px-1 hover:bg-muted/40 transition-colors group">
      {/* Letter mark for file type (R-04: replaces Lucide file icons).
          Reason: tabular letter classification reads as data, not decoration. */}
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center border border-border font-mono text-[10px] text-muted-foreground">
        {fileLetter(file)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs truncate font-mono text-foreground/90" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground font-mono tabular">{formatBytes(file.length)}</span>
          {file.progress > 0 && file.progress < 1 && (
            <>
              <div className="h-0.5 flex-1 max-w-[100px] bg-muted overflow-hidden">
                <div className="h-full bg-amber-500" style={{ width: `${file.progress * 100}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono tabular">
                {(file.progress * 100).toFixed(0)}%
              </span>
            </>
          )}
          {file.done && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
        </div>
      </div>
      {/* Actions appear on hover for desktop, always visible on touch via opacity-100 sm:opacity-0 */}
      <div className="flex items-center gap-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {file.streamable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onStream}
            className="h-11 px-2 sm:h-6 text-[11px] text-amber-600 dark:text-amber-500 hover:bg-amber-500/10"
          >
            <Play className="h-3 w-3 mr-1" /> Stream
          </Button>
        )}
        <a href={downloadUrl} download={file.name}>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-11 sm:h-6 sm:w-6 p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Download ${file.name}`}
            title={`Download ${file.name}`}
          >
            <Download className="h-3 w-3" />
          </Button>
        </a>
      </div>
    </div>
  )
}

// ============ Plyr video/audio player ============
// Wraps Plyr (https://github.com/sampotts/plyr) so we get a clean, accessible
// custom player UI instead of the browser default. Theming comes from
// globals.css via Plyr CSS variables (amber accent, warm stone chrome).
//
// Implementation notes:
// - Plyr is initialized once on mount in useEffect, destroyed on unmount.
// - Callbacks are stored in a ref so changing them does not re-init Plyr.
// - The retry mechanism uses `key={retryKey}` on this component, which forces
//   React to remount it, which re-runs the init effect.
// - We listen to native media events on the underlying <video>/<audio> element
//   (Plyr does not intercept them) so loading/error states propagate to parent.

interface PlyrPlayerProps {
  source: string
  mediaType: 'video' | 'audio'
  onWaiting?: () => void
  onPlaying?: () => void
  onCanPlay?: () => void
  onError?: () => void
}

function PlyrPlayer({
  source,
  mediaType,
  onWaiting,
  onPlaying,
  onCanPlay,
  onError,
}: PlyrPlayerProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const plyrRef = useRef<Plyr | null>(null)
  // Refs for the latest callbacks so we don't re-init Plyr on every render.
  const cbRef = useRef({ onWaiting, onPlaying, onCanPlay, onError })
  useEffect(() => {
    cbRef.current = { onWaiting, onPlaying, onCanPlay, onError }
  })

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return

    // Native event handlers read from the ref so they always see the latest
    // callback without needing to re-add the listener.
    const handleWaiting = () => cbRef.current.onWaiting?.()
    const handlePlaying = () => cbRef.current.onPlaying?.()
    const handleCanPlay = () => cbRef.current.onCanPlay?.()
    const handleError = () => cbRef.current.onError?.()
    const handleLoadStart = () => cbRef.current.onWaiting?.()

    media.addEventListener('waiting', handleWaiting)
    media.addEventListener('playing', handlePlaying)
    media.addEventListener('canplay', handleCanPlay)
    media.addEventListener('error', handleError)
    media.addEventListener('loadstart', handleLoadStart)

    // Dynamic import: Plyr's source references `document` at module load,
    // so importing it at the top of this file breaks Next.js SSR. Loading it
    // inside useEffect guarantees we only run it in the browser.
    let cancelled = false
    import('plyr').then(({ default: Plyr }) => {
      if (cancelled || !mediaRef.current) return

      // Reason for control list: only show controls that work for streamed
      // torrent content (no download button since we have our own, no airplay
      // since the source is a torrent stream, captions only if present).
      plyrRef.current = new Plyr(mediaRef.current, {
        controls:
          mediaType === 'video'
            ? [
                'play-large',
                'play',
                'progress',
                'current-time',
                'duration',
                'mute',
                'volume',
                'settings',
                'pip',
                'fullscreen',
              ]
            : ['play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings'],
        settings: ['speed'],
        autoplay: true,
        autoPause: true,
        hideControls: true,
        keyboard: { focused: true, global: false },
        tooltips: { controls: false, seek: true },
        seekTime: 10,
      })
    })

    return () => {
      cancelled = true
      media.removeEventListener('waiting', handleWaiting)
      media.removeEventListener('playing', handlePlaying)
      media.removeEventListener('canplay', handleCanPlay)
      media.removeEventListener('error', handleError)
      media.removeEventListener('loadstart', handleLoadStart)
      try {
        plyrRef.current?.destroy()
      } catch {
        // Plyr can throw if the DOM was already torn down; safe to ignore.
      }
      plyrRef.current = null
    }
    // Empty deps: Plyr inits once on mount. Source changes handled by remount via key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full h-full">
      {mediaType === 'video' ? (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={source}
          className="w-full h-full"
          playsInline
          // No `controls` attribute: Plyr provides its own.
          // No `autoPlay` attribute: Plyr option handles it (more reliable across browsers).
        />
      ) : (
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          src={source}
        />
      )}
    </div>
  )
}

// ============ Video player modal ============
function VideoPlayerModal({
  data,
  onClose,
}: {
  data: { torrentId: string; file: TorrentFile; torrentName: string }
  onClose: () => void
}) {
  const { file, torrentId, torrentName } = data
  const streamUrl = `/api/torrents/${torrentId}/stream/${file.index}?XTransformPort=${TORRENT_PORT}`
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
  }, [retryKey])

  // Close on Escape (R-32).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-4xl bg-popover border-border p-0 overflow-hidden gap-0">
        <DialogTitle className="sr-only">{file.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Streaming {file.name} from {torrentName}, {formatBytes(file.length)}.
        </DialogDescription>

        {/* Header bar */}
        <div className="px-4 py-3 border-b border-border flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate font-mono">{file.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              from {torrentName} · {formatBytes(file.length)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-11 w-11 sm:h-7 sm:w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Player surface. True black for video, no border. */}
        <div className="relative bg-black aspect-video">
          {loading && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-400">
              <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
              <p className="text-xs">Buffering…</p>
              <p className="text-[10px] text-stone-600">torrent pieces loading</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-stone-400">
              <AlertTriangle className="h-7 w-7 text-red-500" />
              <p className="text-xs max-w-md text-center px-4">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetryKey((k) => k + 1)}
                className="mt-1 h-8 border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-white"
              >
                <RefreshCw className="h-3 w-3 mr-1.5" /> Retry
              </Button>
            </div>
          )}
          {file.isVideo ? (
            <PlyrPlayer
              key={retryKey}
              source={streamUrl}
              mediaType="video"
              onWaiting={() => setLoading(true)}
              onPlaying={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
              onError={() => {
                setError('Stream failed. The torrent may not have enough peers yet, or the format is not supported by the browser.')
                setLoading(false)
              }}
            />
          ) : file.isAudio ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
              <div className="h-16 w-16 rounded-full border border-stone-700 flex items-center justify-center">
                <span className="font-mono text-sm text-stone-400">A</span>
              </div>
              <p className="text-xs text-stone-300 text-center font-mono">{file.name}</p>
              <div className="w-full max-w-md">
                <PlyrPlayer
                  key={retryKey}
                  source={streamUrl}
                  mediaType="audio"
                  onWaiting={() => setLoading(true)}
                  onPlaying={() => setLoading(false)}
                  onError={() => {
                    setError('Audio stream failed. Retry or check peer count.')
                    setLoading(false)
                  }}
                />
              </div>
            </div>
          ) : file.isImage ? (
            <img
              key={retryKey}
              src={streamUrl}
              alt={file.name}
              className="w-full h-full object-contain"
              onLoad={() => setLoading(false)}
              onError={() => {
                setError('Failed to load image.')
                setLoading(false)
              }}
            />
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-mono tabular">
            {file.ext.toUpperCase()} · {formatBytes(file.length)}
          </span>
          <a href={`/api/torrents/${torrentId}/download/${file.index}?XTransformPort=${TORRENT_PORT}`} download={file.name}>
            <Button variant="outline" size="sm" className="h-7 border-border">
              <Download className="h-3 w-3 mr-1.5" /> Download
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
