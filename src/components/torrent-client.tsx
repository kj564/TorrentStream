'use client'

/**
 * Client-side WebTorrent context provider.
 *
 * Uses the official WebTorrent library (https://github.com/webtorrent/webtorrent)
 * loaded from the pre-built browser bundle in /public/webtorrent.min.js.
 *
 * Why script tag instead of `import`? WebTorrent v3's npm package has native
 * dependencies (node-datachannel, webrtc-polyfill) for Node.js WebRTC support.
 * Next.js's Turbopack tries to resolve these during SSR, which fails. The
 * pre-built browser bundle has all browser polyfills inlined and uses native
 * browser WebRTC (RTCPeerConnection), so it loads cleanly via a script tag
 * with zero bundler involvement.
 *
 * The script is loaded once when the provider mounts. `window.WebTorrent`
 * becomes available and we instantiate a client. The client uses WebRTC for
 * peer connections and FSA chunk store (or in-memory) for piece storage.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react'

type WTClient = any
type WTTorrent = any
type WTFile = any

// ============ Public types ============

export interface TorrentFile {
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
  /** The underlying WebTorrent file object. Stable for the torrent's lifetime.
   *  Used by the player to call file.appendTo(). */
  wtFile: WTFile
}

export interface Torrent {
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

export interface TorrentClientValue {
  torrents: Torrent[]
  ready: boolean
  addTorrent: (input: string | Uint8Array, displayName?: string) => string | null
  removeTorrent: (id: string, keepFiles?: boolean) => void
  pauseTorrent: (id: string) => void
  resumeTorrent: (id: string) => void
}

// ============ Script loader ============
// Loads /webtorrent.min.js exactly once across all provider instances.
// The bundle is an ESM module (uses `export default`), so we load it via
// dynamic import() with a URL string. Next.js/Turbopack does not try to
// bundle URL-based imports, so the native Node.js deps in the npm package
// never reach the SSR build.
// Resolves to the WebTorrent constructor once available.
let webTorrentPromise: Promise<any> | null = null

function loadWebTorrent(): Promise<any> {
  if (webTorrentPromise) return webTorrentPromise
  webTorrentPromise = (async () => {
    if (typeof window === 'undefined') {
      throw new Error('window not available')
    }
    // Build the URL relative to the current page so the basePath (e.g.
    // /TorrentStream on GitHub Pages) is respected. Using new URL() with
    // window.location.href as the base handles both production (subpath)
    // and local dev (root) correctly.
    const url = new URL('webtorrent.min.js', window.location.href).href
    // The import() argument is a runtime variable, so the bundler cannot
    // statically resolve it. This keeps the native Node deps in the
    // webtorrent npm package out of the SSR build.
    const mod = await import(/* @vite-ignore */ url as any)
    const WT = mod.default || mod.WebTorrent || mod
    if (!WT) throw new Error('WebTorrent constructor not found in module')
    return WT
  })()
  return webTorrentPromise
}

// ============ Context ============

const TorrentContext = createContext<TorrentClientValue | null>(null)

export function TorrentClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<WTClient | null>(null)
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const torrentMap = useRef(new Map<string, { torrent: WTTorrent; magnet: string; createdAt: number }>())

  useEffect(() => {
    let cancelled = false
    loadWebTorrent()
      .then((WT) => {
        if (cancelled) return
        const c = new WT({
          tracker: { wrtc: true },
          dht: false,
        })
        setClient(c)
        // eslint-disable-next-line no-console
        console.log('[webtorrent] client ready')
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[webtorrent] failed to load:', err)
      })
    return () => { cancelled = true }
  }, [])

  const serialize = useCallback(
    (id: string, t: WTTorrent, magnet: string, createdAt: number): Torrent => {
      const infoHash = t.infoHash || ''
      const name = t.name || (infoHash ? infoHash.slice(0, 16) + '...' : 'Loading metadata...')

      const files: TorrentFile[] = (t.files || []).map((f: WTFile, i: number) => {
        const fname = f.name
        return {
          index: i,
          name: fname,
          length: f.length,
          downloaded: f.downloaded || 0,
          progress: f.progress || 0,
          path: f.path,
          done: !!f.done,
          streamable: isStreamable(fname),
          isVideo: isVideo(fname),
          isAudio: isAudio(fname),
          isImage: isImage(fname),
          isSubtitle: isSubtitle(fname),
          ext: getExt(fname),
          wtFile: f,
        }
      })

      return {
        id,
        infoHash,
        magnetURI: magnet,
        name,
        progress: t.progress || 0,
        downloaded: t.downloaded || 0,
        uploaded: t.uploaded || 0,
        downloadSpeed: t.downloadSpeed || 0,
        uploadSpeed: t.uploadSpeed || 0,
        numPeers: t.numPeers || 0,
        ready: !!t.ready,
        paused: !!t.paused,
        length: t.length || 0,
        createdAt,
        files,
      }
    },
    []
  )

  const updateOne = useCallback((id: string) => {
    const entry = torrentMap.current.get(id)
    if (!entry) return
    setTorrents((prev) =>
      prev.map((t) =>
        t.id === id ? serialize(id, entry.torrent, entry.magnet, entry.createdAt) : t
      )
    )
  }, [serialize])

  const addTorrent = useCallback(
    (input: string | Uint8Array, displayName?: string): string | null => {
      if (!client) return null

      let infoHashForDedup = ''
      let magnet = ''
      if (typeof input === 'string') {
        magnet = input
        const m = input.match(/xt=urn:btih:([a-f0-9]{40}|[A-Z2-7]{32})/i)
        if (m) infoHashForDedup = m[1].toLowerCase()
      }

      if (infoHashForDedup) {
        for (const [existingId, entry] of torrentMap.current) {
          if (entry.torrent.infoHash && entry.torrent.infoHash.toLowerCase() === infoHashForDedup) {
            return existingId
          }
        }
      }

      const id = Math.random().toString(36).slice(2, 12)
      const createdAt = Date.now()

      // Always append WebRTC trackers so browser peer discovery works even
      // for magnets that only list UDP trackers.
      const extraTrackers = [
        'wss://tracker.btorrent.xyz',
        'wss://tracker.openwebtorrent.com',
      ]

      try {
        let t: WTTorrent
        if (typeof input === 'string') {
          let m = input
          for (const tr of extraTrackers) {
            if (!m.includes(encodeURIComponent(tr))) {
              m += `&tr=${encodeURIComponent(tr)}`
            }
          }
          t = client.add(m)
        } else {
          t = client.add(input, { name: displayName })
        }

        torrentMap.current.set(id, { torrent: t, magnet: magnet || (displayName || 'torrent'), createdAt })

        t.on('metadata', () => updateOne(id))
        t.on('download', () => updateOne(id))
        t.on('upload', () => updateOne(id))
        t.on('done', () => updateOne(id))
        t.on('warning', (err: any) => {
          // eslint-disable-next-line no-console
          console.warn(`[webtorrent] warning for ${id}:`, err.message)
        })
        t.on('error', (err: any) => {
          // eslint-disable-next-line no-console
          console.error(`[webtorrent] error for ${id}:`, err.message)
          setTorrents((prev) =>
            prev.map((tt) => (tt.id === id ? { ...tt, error: err.message } : tt))
          )
        })

        setTorrents((prev) => [...prev, serialize(id, t, magnet, createdAt)])
        return id
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('[webtorrent] addTorrent failed:', err)
        return null
      }
    },
    [client, serialize, updateOne]
  )

  const removeTorrent = useCallback((id: string, _keepFiles?: boolean) => {
    const entry = torrentMap.current.get(id)
    if (!entry) return
    try {
      entry.torrent.destroy({ destroyStore: false }, () => {
        torrentMap.current.delete(id)
        setTorrents((prev) => prev.filter((t) => t.id !== id))
      })
    } catch {
      torrentMap.current.delete(id)
      setTorrents((prev) => prev.filter((t) => t.id !== id))
    }
  }, [])

  const pauseTorrent = useCallback((id: string) => {
    const entry = torrentMap.current.get(id)
    if (!entry) return
    try {
      entry.torrent.pause()
      updateOne(id)
    } catch { /* ignore */ }
  }, [updateOne])

  const resumeTorrent = useCallback((id: string) => {
    const entry = torrentMap.current.get(id)
    if (!entry) return
    try {
      entry.torrent.resume()
      updateOne(id)
    } catch { /* ignore */ }
  }, [updateOne])

  const value: TorrentClientValue = {
    torrents,
    ready: !!client,
    addTorrent,
    removeTorrent,
    pauseTorrent,
    resumeTorrent,
  }

  return <TorrentContext.Provider value={value}>{children}</TorrentContext.Provider>
}

export function useTorrentClient() {
  const ctx = useContext(TorrentContext)
  if (!ctx) {
    throw new Error('useTorrentClient must be used within a TorrentClientProvider')
  }
  return ctx
}

// ============ File-type helpers ============

export function getExt(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

export function isVideo(name: string): boolean {
  switch (getExt(name)) {
    case 'mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'flv', 'ts', 'mpeg', 'mpg':
      return true
    default:
      return false
  }
}

export function isAudio(name: string): boolean {
  switch (getExt(name)) {
    case 'mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga', 'aac', 'opus':
      return true
    default:
      return false
  }
}

export function isImage(name: string): boolean {
  switch (getExt(name)) {
    case 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg':
      return true
    default:
      return false
  }
}

export function isSubtitle(name: string): boolean {
  switch (getExt(name)) {
    case 'srt', 'vtt', 'ass', 'ssa', 'sub':
      return true
    default:
      return false
  }
}

export function isStreamable(name: string): boolean {
  return isVideo(name) || isAudio(name) || isImage(name) || isSubtitle(name)
}
