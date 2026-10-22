'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTheme } from 'next-themes'
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
import 'plyr/dist/plyr.css'
import type Plyr from 'plyr'
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
import {
  useTorrentClient,
  type Torrent,
  type TorrentFile,
  getExt,
  isVideo,
  isAudio,
  isImage,
  isSubtitle,
  isStreamable,
} from '@/components/torrent-client'

/* ============================================================
 * DESIGN.md reference
 * Identity: instrument-panel aesthetic. Data dominates, decoration recedes.
 * Palette: warm stone neutrals + single amber accent (R-29).
 * Typography: Geist Sans for prose, Geist Mono for all data (R-06 reason:
 * tabular alignment is functional, signals "machine output").
 * Dials: ENERGY 1 / RHYTHM 2 / MOTION 1.
 *
 * Architecture change: the UI is now 100% client-side. WebTorrent
 * (https://github.com/webtorrent/webtorrent) runs in the browser via
 * WebRTC. No Go backend, no server, works on GitHub Pages.
 * ============================================================ */

// ============ Constants ============

// Sample torrents (free / public domain Blender open movies).
// These have wss:// WebTorrent trackers so they work peer-to-peer in the
// browser. For arbitrary magnets without wss:// trackers, we auto-append
// public WebTorrent trackers in torrent-client.tsx.
const SAMPLE_TORRENTS: { name: string; magnet: string }[] = [
  {
    name: 'Sintel',
    magnet:
      'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d811df5ee1ae3579e3da&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com',
  },
  {
    name: 'Big Buck Bunny',
    magnet:
      'magnet:?xt=urn:btih:dd8255ecdc7ca1fb9914cc6a2783a1522b9eee7a&dn=BigBuckBunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com',
  },
  {
    name: 'Tears of Steel',
    magnet:
      'magnet:?xt=urn:btih:209c8a6f6f5e8f3a0cb5f1d5f2f1d0b5e1f3a3cb&dn=TearsOfSteel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969',
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
function fileLetter(f: TorrentFile): string {
  if (f.isVideo) return 'V'
  if (f.isAudio) return 'A'
  if (f.isImage) return 'I'
  if (f.isSubtitle) return 'S'
  return 'T'
}

// ============ Theme toggle (R-21: working light/dark) ============
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
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
    done: 'bg-emerald-500',
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
  const { torrents, ready: clientReady, addTorrent, removeTorrent, pauseTorrent, resumeTorrent } = useTorrentClient()
  const [magnetInput, setMagnetInput] = useState('')
  const [streamingFile, setStreamingFile] = useState<{ wtFile: any; file: TorrentFile; torrentName: string } | null>(null)

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
    if (!clientReady) {
      toast({ title: 'WebTorrent not ready', description: 'The client is still initializing. Try again in a moment.', variant: 'destructive' })
      return
    }
    const id = addTorrent(m)
    if (id) {
      toast({ title: 'Torrent added' })
      setMagnetInput('')
    } else {
      toast({ title: 'Failed to add', description: 'Could not parse the magnet link.', variant: 'destructive' })
    }
  }, [magnetInput, clientReady, addTorrent, toast])

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (!f || !clientReady) {
        if (!clientReady) {
          toast({ title: 'WebTorrent not ready', variant: 'destructive' })
        }
        e.target.value = ''
        return
      }
      try {
        const buf = new Uint8Array(await f.arrayBuffer())
        const id = addTorrent(buf, f.name.replace(/\.torrent$/i, ''))
        if (id) {
          toast({ title: 'Torrent file added' })
        } else {
          toast({ title: 'Invalid .torrent file', variant: 'destructive' })
        }
      } catch (err: any) {
        toast({ title: 'Upload failed', description: err.message, variant: 'destructive' })
      }
      e.target.value = ''
    },
    [clientReady, addTorrent, toast]
  )

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

  const handlePauseResume = (t: Torrent) => {
    if (t.paused) resumeTorrent(t.id)
    else pauseTorrent(t.id)
  }

  const handleDelete = (t: Torrent, _keepFiles: boolean) => {
    if (!confirm(`Remove "${t.name}"?`)) return
    removeTorrent(t.id, _keepFiles)
    toast({ title: 'Torrent removed' })
  }

  const handleDownload = useCallback(
    (wtFile: any, name: string) => {
      toast({ title: 'Preparing download', description: 'Fetching file from peers…' })
      wtFile.getBlobURL((err: any, url: string | null) => {
        if (err || !url) {
          toast({ title: 'Download failed', description: err?.message || 'No blob URL', variant: 'destructive' })
          return
        }
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        // Revoke the blob URL after the browser starts the download.
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      })
    },
    [toast]
  )

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ===== Header ===== */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight">TorrentStream</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular">browser</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusDot state={clientReady ? 'online' : 'offline'} />
              <span className="tabular">{clientReady ? 'webtorrent ready' : 'starting…'}</span>
            </span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular">
              {torrents.length} active
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ===== Main ===== */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 space-y-8">
        {/* ---- Input section ---- */}
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
                className="h-10 border-border"
              >
                Paste
              </Button>
              <Button
                size="sm"
                onClick={handleAddMagnet}
                disabled={!clientReady}
                className="h-10 bg-amber-500 hover:bg-amber-600 text-amber-950 font-medium"
              >
                Add torrent
              </Button>
            </div>
          </div>

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

        {/* ---- Torrent list ---- */}
        <section className="hairline pt-6">
          {!clientReady ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Starting WebTorrent client
            </div>
          ) : torrents.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">No torrents yet.</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Paste a magnet link above, or upload a .torrent file.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {torrents.map((t) => (
                <TorrentCard
                  key={t.id}
                  torrent={t}
                  onStream={(file) => setStreamingFile({ wtFile: file.wtFile, file, torrentName: t.name })}
                  onDownload={(file) => handleDownload(file.wtFile, file.name)}
                  onPauseResume={() => handlePauseResume(t)}
                  onDelete={(keep) => handleDelete(t, keep)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ===== Footer ===== */}
      <footer className="hairline mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-10 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Client-side WebTorrent · no server required</span>
          <span className="tabular hidden sm:inline">{torrents.length} torrents</span>
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
function TorrentCard({
  torrent,
  onStream,
  onDownload,
  onPauseResume,
  onDelete,
}: {
  torrent: Torrent
  onStream: (file: TorrentFile) => void
  onDownload: (file: TorrentFile) => void
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
            <p className="text-[11px] text-muted-foreground font-mono truncate">
              {torrent.infoHash ? `${torrent.infoHash.slice(0, 16)}…` : '—'}
              {hasMeta && (
                <span className="text-muted-foreground">
                  {'  '}· {torrent.files.length} files · {formatBytes(torrent.length)}
                </span>
              )}
            </p>
            {hasError && (
              <p className="text-[11px] text-red-500 mt-1.5 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="font-mono">{torrent.error}</span>
              </p>
            )}
          </div>

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
                  Remove
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(false)}
                  className="text-popover-foreground hover:bg-muted cursor-pointer"
                >
                  Remove (force)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Progress + live stats */}
        {hasMeta && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Progress
                value={torrent.progress * 100}
                className={cn(
                  'h-1 flex-1 bg-muted',
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
                <span className="text-emerald-600 dark:text-emerald-500">complete</span>
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
                    onDownload={() => onDownload(f)}
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
  onDownload,
}: {
  file: TorrentFile
  onStream: () => void
  onDownload: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 px-1 hover:bg-muted/40 transition-colors group">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onDownload}
          className="h-11 w-11 sm:h-6 sm:w-6 p-0 text-muted-foreground hover:text-foreground"
          aria-label={`Download ${file.name}`}
          title={`Download ${file.name}`}
        >
          <Download className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

// ============ Plyr + WebTorrent player ============
// WebTorrent's file.appendTo() creates a media element inside a container and
// streams the file to it (MediaSource for streamable formats, blob URL
// fallback for others). We then wrap that element with Plyr for custom
// controls. This avoids any HTTP URL - the data flows peer-to-peer to the
// element directly.

interface PlyrTorrentPlayerProps {
  wtFile: any
  mediaType: 'video' | 'audio'
  onWaiting?: () => void
  onPlaying?: () => void
  onCanPlay?: () => void
  onError?: (msg: string) => void
}

function PlyrTorrentPlayer({
  wtFile,
  mediaType,
  onWaiting,
  onPlaying,
  onCanPlay,
  onError,
}: PlyrTorrentPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null)
  const plyrRef = useRef<Plyr | null>(null)
  const cbRef = useRef({ onWaiting, onPlaying, onCanPlay, onError })

  useEffect(() => {
    cbRef.current = { onWaiting, onPlaying, onCanPlay, onError }
  })

  // Ask WebTorrent to append a media element to the container and stream to it.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !wtFile) return

    let cancelled = false
    // Clear any previous content
    container.innerHTML = ''

    wtFile.appendTo(
      container,
      { autoplay: true, controls: false },
      (err: any, elem: any) => {
        if (cancelled) return
        if (err) {
          cbRef.current.onError?.(err.message || 'Failed to stream file')
          return
        }
        if (elem) {
          setMediaEl(elem)
          // Initial state: waiting for data
          cbRef.current.onWaiting?.()
        }
      }
    )

    return () => {
      cancelled = true
      if (container) container.innerHTML = ''
      try { plyrRef.current?.destroy() } catch {}
      plyrRef.current = null
      setMediaEl(null)
    }
  }, [wtFile])

  // Initialize Plyr once the media element exists.
  useEffect(() => {
    if (!mediaEl) return

    let cancelled = false
    const handleWaiting = () => cbRef.current.onWaiting?.()
    const handlePlaying = () => cbRef.current.onPlaying?.()
    const handleCanPlay = () => cbRef.current.onCanPlay?.()
    const handleError = () => cbRef.current.onError?.('Stream failed')

    mediaEl.addEventListener('waiting', handleWaiting)
    mediaEl.addEventListener('playing', handlePlaying)
    mediaEl.addEventListener('canplay', handleCanPlay)
    mediaEl.addEventListener('error', handleError)

    import('plyr').then(({ default: Plyr }) => {
      if (cancelled || !mediaEl) return
      plyrRef.current = new Plyr(mediaEl, {
        controls:
          mediaType === 'video'
            ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen']
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
      mediaEl.removeEventListener('waiting', handleWaiting)
      mediaEl.removeEventListener('playing', handlePlaying)
      mediaEl.removeEventListener('canplay', handleCanPlay)
      mediaEl.removeEventListener('error', handleError)
      try { plyrRef.current?.destroy() } catch {}
      plyrRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaEl, mediaType])

  return <div ref={containerRef} className="w-full h-full" />
}

// ============ Video player modal ============
function VideoPlayerModal({
  data,
  onClose,
}: {
  data: { wtFile: any; file: TorrentFile; torrentName: string }
  onClose: () => void
}) {
  const { file, wtFile, torrentName } = data
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
  }, [retryKey])

  // Close on Escape (R-32).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
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

        <div className="relative bg-black aspect-video">
          {loading && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-400">
              <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
              <p className="text-xs">Buffering…</p>
              <p className="text-[10px] text-stone-600">fetching pieces from peers</p>
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
          {/* The key=retryKey forces PlyrTorrentPlayer to remount on retry,
              which re-runs file.appendTo() and re-inits Plyr. */}
          <PlyrTorrentPlayer
            key={retryKey}
            wtFile={wtFile}
            mediaType={file.isVideo ? 'video' : 'audio'}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onError={(msg) => { setError(msg); setLoading(false) }}
          />
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-mono tabular">
            {file.ext.toUpperCase()} · {formatBytes(file.length)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Download via blob URL (full file fetch)
              wtFile.getBlobURL((err: any, url: string | null) => {
                if (err || !url) return
                const a = document.createElement('a')
                a.href = url
                a.download = file.name
                document.body.appendChild(a)
                a.click()
                a.remove()
                setTimeout(() => URL.revokeObjectURL(url), 2000)
              })
            }}
            className="h-7 border-border"
          >
            <Download className="h-3 w-3 mr-1.5" /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
