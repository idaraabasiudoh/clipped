# Clipped

A shared, link-based file system for pictures and videos with a built-in clip editor. Go to `/<name>` (e.g. `/lagos-trip`) — it's created on first visit — and browse it like a desktop file manager. Anyone with the link can add to it. No accounts.

## Features

- **File system** — folders, list/grid views, drag-and-drop uploads, right-click context menus, keyboard navigation, breadcrumb path bar, sidebar tree
- **Lightbox** — full-screen preview for images and videos with arrow-key browsing and neighbour preloading
- **Clip editor** — set in/out points on any video, preview the clip in a loop, then record and download it as WebM — no server round-trip, no re-upload
- **Live sync** — everyone viewing a folder sees new uploads appear in real time (Supabase Realtime broadcast)
- **Original quality** — files are uploaded byte-for-byte (single PUT or multipart for large files) with no re-encoding, resizing, or compression
- **Debug console** — `clippedDebug.enable()` / `.dump()` / `.copy()` in the browser console for RPC traces, upload lifecycle, and realtime events

## Architecture

```
Browser (Vite + React 19 + TypeScript 7)
  │
  ├── Supabase (Postgres)
  │     ├── files table   — id, name, path, cloudflare key, created
  │     ├── folders table — id, name, path, content (JSONB array), created
  │     └── RPC functions — open_filesystem, get_folder, get_tree,
  │                         create_folder, add_file, notify_folder_change
  │
  └── Cloudflare Worker (R2 binding)
        ├── PUT  /upload/<key>             — single-object upload
        ├── POST /multipart/{create,complete,abort} — multipart upload
        ├── PUT  /multipart/part           — upload one part
        └── GET  /file/<key>               — serve files (cache-forever)
```

### Database schema

**`files`** — one row per uploaded picture or video.

| Column | Type | Description |
|--------|------|-------------|
| id | text (UUID) | Primary key |
| name | text | Original file name |
| path | text | Ancestor folder-ID path (e.g. `/rootId/parentId`) |
| cloudflare | text | R2 object key (e.g. `pictures/folderId/abc123.jpg`) |
| created | timestamptz | Upload timestamp |

**`folders`** — one row per folder. The root folder's `id` is the file-system name (e.g. `lagos-trip`).

| Column | Type | Description |
|--------|------|-------------|
| id | text (UUID or name) | Primary key |
| name | text | Folder name |
| path | text | Ancestor folder-ID path |
| content | jsonb | Array of `{folder: {id, name}}` and `{file: {id, name, path, cloudflare, created}}` |
| created | timestamptz | Creation timestamp |

Content is a heterogeneous array — each element is either `{ folder: FolderRef }` or `{ file: FileEntry }`. The `get_folder` RPC resolves references into full objects with correlated subqueries.

### Clip editor

The clip editor appears automatically below any video in the lightbox. It uses `captureStream()` + `MediaRecorder` to record the selected region client-side and download it as WebM. Keyboard shortcuts: `I`/`O` set in/out, `P` toggles preview loop, `Space` plays/pauses, arrows seek (±1s, ±5s with Shift), `R` resets.

## Setup

### 1. Environment

Create `.env.local` (git-ignored):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_R2_WORKER_URL=https://<worker>.<account>.workers.dev
```

### 2. Database

Run the migrations in `supabase/migrations/` in order — either with `supabase db push` (CLI, linked project) or by pasting them into the Supabase SQL editor.

### 3. Cloudflare Worker

The worker in `worker/` needs an R2 bucket bound as `MEDIA`. Deploy with:

```bash
cd worker
npx wrangler deploy
```

### 4. Run

```bash
npm install
npm run dev
```

## Deployment

The frontend is a static SPA. The `vercel.json` rewrites all paths to `index.html` for client-side routing. Build with `npm run build`, deploy the `dist/` folder.

## Tech stack

- **Frontend**: React 19, TypeScript 7, Vite 8, react-router-dom 7
- **Backend**: Supabase (Postgres + Realtime), Cloudflare Workers + R2
- **Design**: "Darkroom" theme — black/white/silver palette, brushed chrome accents, viewfinder crop marks, monospace readouts, Geist + Geist Mono fonts
