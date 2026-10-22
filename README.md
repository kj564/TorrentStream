# TorrentStream

Stream and download torrents in the browser. Paste a magnet link or upload a `.torrent` file, then stream video, audio, and images, or download any file directly. **No server required** - the torrent client runs entirely in your browser via [WebTorrent](https://github.com/webtorrent/webtorrent).

## How it works

The app is 100% client-side. The WebTorrent library runs in the browser, using WebRTC for peer-to-peer connections. There is no backend to deploy, no server to run, no rate limits.

- **Frontend**: Next.js 16 (static export) + TypeScript + Tailwind CSS 4 + shadcn/ui + Plyr video player
- **Torrent engine**: [WebTorrent](https://github.com/webtorrent/webtorrent) v3 (browser build, loaded via dynamic ESM import)
- **Hosting**: GitHub Pages (static files, no server runtime)

### Browser WebTorrent limitations

WebTorrent in the browser uses WebRTC, which means it can only connect to peers that also support WebRTC (browser peers, or desktop peers running [webtorrent-hybrid](https://github.com/webtorrent/webtorrent-hybrid)). It cannot connect to traditional BitTorrent peers over TCP/uTP.

For torrents with only UDP trackers, the app auto-appends public WebRTC trackers (`wss://tracker.btorrent.xyz`, `wss://tracker.openwebtorrent.com`) to maximize peer discovery. The sample torrents (Sintel, Big Buck Bunny, Tears of Steel - all public domain Blender open movies) already include WebRTC trackers and work out of the box.

For a full BitTorrent client with TCP/uTP/DHT support, see the alternative Go backend in `mini-services/torrent-service/` (requires a server).

## Live demo

Hosted on GitHub Pages: **https://kj564.github.io/TorrentStream/**

## Run locally

Requires Bun (or Node 18+).

```bash
bun install
bun run dev
```

Open http://localhost:3000. The WebTorrent script loads from `/public/webtorrent.min.js` and runs in the browser. No backend, no env vars, no configuration.

## Deploy to GitHub Pages

The repo includes a GitHub Action (`.github/workflows/deploy.yml`) that auto-deploys on push to `main`:

1. Builds the Next.js static export with `GITHUB_PAGES=true` (sets `basePath: /TorrentStream`).
2. Uploads the `out/` directory as a Pages artifact.
3. Deploys to GitHub Pages.

Pages must be enabled in the repo settings (Settings > Pages > Source: GitHub Actions). The workflow already requests the required `pages: write` and `id-token: write` permissions.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, static export) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| State | React hooks + Context |
| Theme | next-themes (light/dark toggle) |
| Video player | [Plyr](https://github.com/sampotts/plyr) v3.8.5 |
| Torrent engine | [WebTorrent](https://github.com/webtorrent/webtorrent) v3 (browser build) |

## Design

See [`DESIGN.md`](./DESIGN.md) for the art direction (instrument-panel aesthetic, warm stone palette + amber accent, Geist Sans/Mono typography, ENERGY 1 / RHYTHM 2 / MOTION 1 dials).

See [`antislop-gate-report.md`](./antislop-gate-report.md) for the formal PASS/FAIL audit against the anti-slop ruleset.

## Alternative: Go backend

For full BitTorrent peer support (TCP/uTP/DHT/PEX, all traditional peers, not just WebRTC), the repo includes a Go backend in `mini-services/torrent-service/` built with [anacrolix/torrent](https://github.com/anacrolix/torrent). This requires running a server - see the backend's own README for setup. The main UI on GitHub Pages does not use it.

## License

MIT
