# CLAUDE.md

## Project overview

Clipped is a shared, link-based file system for pictures and videos with a built-in video clip editor. No auth — anyone with the URL can browse and upload.

## Tech stack

- **Frontend**: Vite 8 + React 19 + TypeScript 7 + react-router-dom 7
- **Database**: Supabase (Postgres), accessed exclusively through RPC functions (security definer, `set search_path = ''`)
- **Storage**: Cloudflare R2 via a Cloudflare Worker proxy (`worker/src/index.ts`). Files never go through Supabase Storage.
- **Realtime**: Supabase Realtime broadcast on `fs:<name>` channels for live folder updates
- **Fonts**: Geist and Geist Mono from Google Fonts (loaded in `index.html`)
- **Design theme**: "Darkroom" — black/white/silver, brushed chrome accents, viewfinder crop marks, monospace readouts

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build to `dist/`
- `npx tsc --noEmit` — type-check without emitting
- `cd worker && npx wrangler deploy` — deploy the R2 worker

## Project structure

```
src/
  main.tsx              — app entry, router setup
  styles.css            — all CSS (single file, no modules)
  lib/
    supabase.ts         — types (FileEntry, Folder, ContentItem, TreeNode), RPC wrappers, URL helpers
    upload.ts           — R2 upload (single PUT or multipart), file classification
    debug.ts            — namespaced debug logger with console API (clippedDebug.*)
    util.ts             — formatBytes, formatDate, shortId
  pages/
    Home.tsx            — landing / file-system picker
    Explorer.tsx        — main file browser (sidebar, toolbar, file list/grid, lightbox, uploads)
  components/
    Lightbox.tsx        — full-screen image/video preview with clip editor integration
    ClipControls.tsx    — video clip editor (timeline, in/out handles, preview loop, captureStream export)
    FileView.tsx        — list and grid views for folder contents
    Sidebar.tsx         — folder tree navigation
    UploadTray.tsx      — upload progress indicator
    Icons.tsx           — SVG icon components
worker/
  src/index.ts          — Cloudflare Worker: R2 upload proxy + file serving
supabase/
  migrations/           — SQL migrations (run in filename order)
```

## Key patterns

- **RPC-only database access**: All database operations go through Postgres RPC functions. Tables have RLS enabled with no policies — direct table access is blocked.
- **Content as JSONB array**: Folder contents are stored as `[{folder: {id, name}}, {file: {id, name, path, cloudflare, created}}]`. The `get_folder` RPC resolves references with correlated subqueries.
- **ContentItem discriminated union**: Use `'folder' in item` or `'file' in item` type guards when iterating content.
- **fileKind()**: Derives `'picture' | 'video'` from the `cloudflare` key prefix. No `kind` column in the database.
- **IDs**: Root folder IDs are the file-system name (plain text like `lagos-trip`). Sub-folder and file IDs are `gen_random_uuid()::text`.
- **Upload flow**: File → Cloudflare Worker (R2 PUT/multipart) → `add_file` RPC to register in database. The RPC appends to the folder's `content` array atomically.

## Environment variables

All prefixed with `VITE_` for Vite:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase publishable anon key
- `VITE_R2_WORKER_URL` — Cloudflare Worker URL for R2 operations
- `VITE_DEBUG` — set to `true` to enable debug logs in production builds

## Style conventions

- Single CSS file (`src/styles.css`) with CSS custom properties for theming
- No CSS modules, no Tailwind
- All component styles use flat class selectors
- Dark mode via `prefers-color-scheme` media query with `[data-theme]` override support
