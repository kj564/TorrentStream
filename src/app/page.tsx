'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Magnet,
  Upload,
  Download,
  Play,
  Pause,
  Trash2,
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  File,
  Users,
  Gauge,
  Loader2,
  X,
  RefreshCw,
  HardDriveDownload,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Server,
  Clock
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ============ Types ============
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

// Sample torrents (free / public domain)
const SAMPLE_TORRENTS: { name: string; magnet: string; desc: string }[] = [
  {
    name: 'Sintel (Blender)',
    desc: 'Open movie by Blender, 1080p',
    magnet: 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d811df5ee1ae3579e3da&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com'
  },
  {
    name: 'Big Buck Bunny',
    desc: 'Open movie by Blender',
    magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca1fb9914cc6a2783a1522b9eee7a&dn=BigBuckBunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com'
  },
  {
    name: 'Tears of Steel',
    desc: 'Open sci-fi movie by Blender',
    magnet: 'magnet:?xt=urn:btih:209c8a6f6f5e8f3a0cb5f1d5f2f1d0b5e1f3a3cb&dn=TearsOfSteel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969'
  }
]

// ============ Utility functions ============
function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s'
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function getFileIcon(file: TorrentFile) {
  if (file.isVideo) return <Film className="h-4 w-4 text-purple-400" />
  if (file.isAudio) return <Music className="h-4 w-4 text-blue-400" />
  if (file.isImage) return <ImageIcon className="h-4 w-4 text-green-400" />
  if (file.isSubtitle) return <FileText className="h-4 w-4 text-yellow-400" />
  return <File className="h-4 w-4 text-zinc-400" />
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
    refetchInterval: 1500, // Poll every 1.5s for progress
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

// ============ Main Page ============
export default function Home() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: torrents, isLoading } = useTorrents()
  const { data: health } = useServiceHealth()
  const [magnetInput, setMagnetInput] = useState('')
  const [streamingFile, setStreamingFile] = useState<{ torrentId: string; file: TorrentFile; torrentName: string } | null>(null)

  // Add magnet torrent
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
      toast({ title: 'Torrent added', description: data.existing ? 'Already in list' : 'Started downloading' })
      setMagnetInput('')
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to add', description: err.message, variant: 'destructive' })
    }
  })

  // Upload .torrent file
  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('torrent', file)
      const res = await apiCall('/api/torrents', { method: 'POST', body: fd })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['torrents'] })
      toast({ title: 'Torrent file added', description: 'Started downloading' })
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

  const handleAddMagnet = () => {
    const m = magnetInput.trim()
    if (!m) {
      toast({ title: 'Empty', description: 'Please enter a magnet link', variant: 'destructive' })
      return
    }
    if (!m.startsWith('magnet:')) {
      toast({ title: 'Invalid', description: 'Please enter a valid magnet link', variant: 'destructive' })
      return
    }
    addMagnet.mutate(m)
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
    if (!confirm(`Delete "${t.name}"?${keepFiles ? ' Files will be kept on disk.' : ' Files will also be deleted.'}`)) return
    try {
      await apiCall(`/api/torrents/${t.id}?${keepFiles ? 'keepFiles=1' : ''}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: ['torrents'] })
      toast({ title: 'Torrent removed' })
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' })
    }
  }

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

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <HardDriveDownload className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">TorrentStream</h1>
              <p className="text-[11px] text-zinc-500 -mt-0.5">Stream & download torrents directly in your browser</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={cn(
              "border-zinc-700 text-[11px] gap-1.5",
              health?.ok ? "text-emerald-400" : "text-red-400"
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", health?.ok ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
              {health?.ok ? 'Service Online' : 'Offline'}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-[11px] text-zinc-400">
              <Server className="h-3 w-3 mr-1" />
              {torrents?.length || 0} active
            </Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 space-y-6">
        {/* Input Card */}
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Magnet className="h-4 w-4 text-emerald-400" />
              Add Torrent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={magnetInput}
                onChange={(e) => setMagnetInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddMagnet() }}
                placeholder="Paste magnet link here (magnet:?xt=urn:btih:...)"
                className="flex-1 bg-zinc-950 border-zinc-800 font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePasteFromClipboard} className="border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100">
                  Paste
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddMagnet}
                  disabled={addMagnet.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {addMagnet.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="cursor-pointer">
                <input type="file" accept=".torrent,application/x-bittorrent" onChange={handleFileUpload} className="hidden" />
                <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-950 hover:bg-zinc-800 hover:text-zinc-100 transition">
                  <Upload className="h-3.5 w-3.5" /> Upload .torrent file
                </span>
              </label>
              {uploadFile.isPending && (
                <span className="text-xs text-zinc-500 inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
                </span>
              )}
              <span className="text-xs text-zinc-600 ml-auto">Or try a sample:</span>
              {SAMPLE_TORRENTS.map((s) => (
                <Button
                  key={s.name}
                  variant="ghost"
                  size="sm"
                  onClick={() => setMagnetInput(s.magnet)}
                  className="h-7 text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                >
                  {s.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Torrents List */}
        {isLoading && torrents === undefined ? (
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardContent className="py-8 flex items-center justify-center text-zinc-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading torrents...
            </CardContent>
          </Card>
        ) : !torrents || torrents.length === 0 ? (
          <Card className="bg-zinc-900/40 border-dashed border-zinc-800">
            <CardContent className="py-12 flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full bg-zinc-800/60 flex items-center justify-center mb-3">
                <Magnet className="h-6 w-6 text-zinc-600" />
              </div>
              <p className="text-sm font-medium text-zinc-300">No torrents yet</p>
              <p className="text-xs text-zinc-600 mt-1 max-w-sm">
                Paste a magnet link above or upload a .torrent file to start streaming or downloading.
              </p>
            </CardContent>
          </Card>
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
      </main>

      {/* Video Player Modal */}
      {streamingFile && (
        <VideoPlayerModal
          data={streamingFile}
          onClose={() => setStreamingFile(null)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-900/40 mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-zinc-500">
          <p className="flex items-center gap-1.5">
            <HardDriveDownload className="h-3 w-3" />
            TorrentStream · Next.js frontend + Go (anacrolix/torrent) backend
          </p>
          <p className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />Real-time streaming</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />P2P powered</span>
          </p>
        </div>
      </footer>
    </div>
  )
}

// ============ Torrent Card ============
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

  const isDone = torrent.progress >= 1
  const hasMeta = !!torrent.ready && torrent.length > 0
  const visibleFiles = showAllFiles ? torrent.files : torrent.files.slice(0, 5)

  return (
    <Card className={cn(
      "bg-zinc-900/60 border-zinc-800 overflow-hidden",
      torrent.error && "border-red-900/60"
    )}>
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-semibold text-sm truncate" title={torrent.name}>
                {torrent.name}
              </h3>
              {isDone ? (
                <Badge variant="outline" className="border-emerald-700 text-emerald-400 text-[10px] py-0 px-1.5">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Complete
                </Badge>
              ) : torrent.paused ? (
                <Badge variant="outline" className="border-amber-700 text-amber-400 text-[10px] py-0 px-1.5">Paused</Badge>
              ) : hasMeta ? (
                <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px] py-0 px-1.5">
                  <Clock className="h-2.5 w-2.5 mr-0.5" /> {(torrent.length - torrent.downloaded) > 0 && torrent.downloadSpeed > 0
                    ? `${formatTime((torrent.length - torrent.downloaded) / torrent.downloadSpeed * 1000)} left`
                    : 'Streaming'}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px] py-0 px-1.5">
                  <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" /> Fetching metadata
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 font-mono truncate" title={torrent.infoHash}>
              {torrent.infoHash ? `${torrent.infoHash.slice(0, 16)}...` : '...'}
            </p>
            {torrent.error && (
              <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {torrent.error}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onPauseResume} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" disabled={!hasMeta}>
              {torrent.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
                <DropdownMenuItem onClick={() => onDelete(true)} className="text-zinc-300 hover:bg-zinc-800 cursor-pointer">
                  Remove (keep files)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(false)} className="text-red-400 hover:bg-zinc-800 cursor-pointer">
                  Remove & delete files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Progress + stats */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <Progress value={torrent.progress * 100} className="h-1.5 flex-1 bg-zinc-800 [&>div]:bg-emerald-500" />
            <span className="font-mono text-zinc-400 tabular-nums w-10 text-right">
              {(torrent.progress * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-mono">{formatSpeed(torrent.downloadSpeed)}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Upload className="h-3 w-3 text-sky-400" />
              <span className="text-sky-400 font-mono">{formatSpeed(torrent.uploadSpeed)}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3 text-zinc-400" />
              <span className="font-mono">{torrent.numPeers} peers</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <File className="h-3 w-3 text-zinc-400" />
              <span className="font-mono">{formatBytes(torrent.downloaded)} / {formatBytes(torrent.length)}</span>
            </span>
            {torrent.files.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3 text-zinc-400" />
                <span className="font-mono">{torrent.files.length} files</span>
              </span>
            )}
          </div>
        </div>

        {/* Files */}
        {torrent.files.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1 mb-2"
            >
              {expanded ? '▾' : '▸'} Files ({torrent.files.length})
            </button>
            {expanded && (
              <div className="space-y-1.5 rounded-md bg-zinc-950/60 border border-zinc-800/60 p-2">
                {visibleFiles.map((f) => (
                  <FileRow key={f.index} file={f} onStream={() => onStream(f)} torrentId={torrent.id} />
                ))}
                {torrent.files.length > 5 && (
                  <button
                    onClick={() => setShowAllFiles(!showAllFiles)}
                    className="w-full text-center text-[11px] text-zinc-500 hover:text-zinc-300 py-1"
                  >
                    {showAllFiles ? 'Show less' : `Show all ${torrent.files.length} files`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============ File Row ============
function FileRow({ file, onStream, torrentId }: { file: TorrentFile; onStream: () => void; torrentId: string }) {
  const downloadUrl = `/api/torrents/${torrentId}/download/${file.index}?XTransformPort=${TORRENT_PORT}`

  return (
    <div className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-900/60 transition group">
      <div className="shrink-0">{getFileIcon(file)}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs truncate font-medium text-zinc-300" title={file.name}>{file.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-zinc-500 font-mono">{formatBytes(file.length)}</span>
          {file.progress > 0 && file.progress < 1 && (
            <>
              <span className="text-[10px] text-zinc-600">·</span>
              <div className="h-1 flex-1 max-w-[100px] bg-zinc-800 rounded overflow-hidden">
                <div className="h-full bg-emerald-500/70" style={{ width: `${file.progress * 100}%` }} />
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">{(file.progress * 100).toFixed(0)}%</span>
            </>
          )}
          {file.done && (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
        {file.streamable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onStream}
            className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30"
            title="Stream / Preview"
          >
            <Play className="h-3 w-3 mr-0.5" /> Stream
          </Button>
        ) : null}
        <a href={downloadUrl} download={file.name}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            title="Download file"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </a>
      </div>
    </div>
  )
}

// ============ Video Player Modal ============
function VideoPlayerModal({
  data,
  onClose,
}: {
  data: { torrentId: string; file: TorrentFile; torrentName: string }
  onClose: () => void
}) {
  const { file, torrentId, torrentName } = data
  const streamUrl = `/api/torrents/${torrentId}/stream/${file.index}?XTransformPort=${TORRENT_PORT}`
  const videoRef = useRef<HTMLVideoElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  // Reset on retry
  useEffect(() => {
    setLoading(true)
    setError(null)
  }, [retryKey])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-4xl bg-zinc-950 border-zinc-800 p-0 overflow-hidden gap-0">
        <DialogHeader className="px-4 py-3 border-b border-zinc-800 flex-row items-center justify-between space-y-0">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-medium truncate">{file.name}</DialogTitle>
            <DialogDescription className="text-[11px] text-zinc-500 truncate">
              from {torrentName} · {formatBytes(file.length)}
            </DialogDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <div className="relative bg-black aspect-video">
          {loading && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              <p className="text-xs">Buffering... <span className="text-zinc-600">(torrent pieces loading)</span></p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <p className="text-sm">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetryKey((k) => k + 1)}
                className="border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          )}
          {file.isVideo ? (
            <video
              key={retryKey}
              ref={videoRef}
              src={streamUrl}
              controls
              autoPlay
              className="w-full h-full"
              onWaiting={() => setLoading(true)}
              onPlaying={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
              onError={() => {
                setError('Stream failed. The torrent may not have enough peers yet, or the file format is not supported by the browser.')
                setLoading(false)
              }}
            />
          ) : file.isAudio ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-2xl shadow-emerald-500/30">
                <Music className="h-10 w-10 text-white" />
              </div>
              <p className="text-sm text-zinc-300 text-center">{file.name}</p>
              <audio
                key={retryKey}
                src={streamUrl}
                controls
                autoPlay
                className="w-full max-w-md"
                onWaiting={() => setLoading(true)}
                onPlaying={() => setLoading(false)}
                onError={() => {
                  setError('Audio stream failed. Please retry or check peers.')
                  setLoading(false)
                }}
              />
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
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500">
          <span className="font-mono truncate">{file.ext.toUpperCase()} · {formatBytes(file.length)}</span>
          <a href={`/api/torrents/${torrentId}/download/${file.index}?XTransformPort=${TORRENT_PORT}`} download={file.name}>
            <Button variant="outline" size="sm" className="h-7 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100">
              <Download className="h-3 w-3 mr-1" /> Download
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
