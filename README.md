# TorrentStream

Stream and download torrents in the browser. Paste a magnet link or upload a `.torrent` file, then stream video, audio, and images, or download any file directly. No rate limits, no ads, no server-side bottleneck for the stream itself.

Built with Next.js 16 frontend + Go backend (anacrolix/torrent).

## Architecture

- **Frontend** (`src/`): Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + TanStack Query + Plyr video player. Static-exported for GitHub Pages.
- **Backend** (`mini-services/torrent-service/`): Go + Gin + anacrolix/torrent. Full BitTorrent peer support (TCP, uTP, DHT, PEX, trackers). Serves files with HTTP Range support for video seeking.

The frontend talks to the backend over HTTP. Both can run on different hosts because the Go service has CORS enabled (`AllowOrigins: ["*"]`).

## Live demo

Hosted on GitHub Pages: **https://kj564.github.io/TorentStream/**

The static frontend loads. To actually stream torrents, you need to run the Go backend yourself (see below) and point the frontend at it via the settings icon in the header.

## Run locally

### 1. Backend (Go torrent service)

Requires Go 1.21+ and [air](https://github.com/air-verse/air) for hot reload.

```bash
cd mini-services/torrent-service
go install github.com/air-verse/air@latest
air
```

The service listens on port 3003. It stores downloaded torrent data in `/home/z/my-project/download` (configurable in `main.go`).

### 2. Frontend (Next.js)

Requires Node 18+ or Bun.

```bash
bun install
bun run dev
```

Open http://localhost:3000. The frontend uses the gateway pattern (`?XTransformPort=3003`) for local dev. On GitHub Pages, configure the backend URL via the settings icon.

## Deploy to GitHub Pages

The repo includes a GitHub Action (`.github/workflows/deploy.yml`) that auto-deploys on push to `main`:

1. Builds the Next.js static export with `GITHUB_PAGES=true` (sets `basePath: /TorentStream`).
2. Uploads the `out/` directory as a Pages artifact.
3. Deploys to GitHub Pages.

To enable Pages for the first time, the Action needs the `id-token: write` and `pages: write` permissions (already set in the workflow). The first push triggers the build; Pages goes live once the Action completes.

## Configuration

The backend URL is resolved in this order:

1. `localStorage.torrentApiUrl` (set via the settings icon in the header, runtime configurable)
2. `NEXT_PUBLIC_TORRENT_API_URL` env var (build time)
3. Fallback to gateway pattern (`?XTransformPort=3003`) for sandbox dev

For GitHub Pages, option 1 is what you want. Click the gear icon in the header, enter your backend URL (e.g. `http://localhost:3003`), and save.

## Design

See [`DESIGN.md`](./DESIGN.md) for the art direction (instrument-panel aesthetic, warm stone palette + amber accent, Geist Sans/Mono typography, ENERGY 1 / RHYTHM 2 / MOTION 1 dials).

See [`antislop-gate-report.md`](./antislop-gate-report.md) for the formal PASS/FAIL audit against the anti-slop ruleset (Hard Gate, Purpose-Gate, Liveliness, Craftsmanship).

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, static export) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| State | TanStack Query (server), useState (local) |
| Theme | next-themes (light/dark toggle) |
| Video player | [Plyr](https://github.com/sampotts/plyr) v3.8.5 |
| Backend | Go 1.24 + Gin v1.12 + anacrolix/torrent v1.61 |

## License

MIT
