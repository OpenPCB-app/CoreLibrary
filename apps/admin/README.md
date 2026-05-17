# OpenPCB Core Library — Admin

Local-only web admin for browsing, editing, and packaging the Core Library.

## Run

From the repo root:

```bash
bun install            # installs workspace deps (first time)
bun run admin          # starts Bun server (127.0.0.1:7173) + Vite (127.0.0.1:5173)
```

Open <http://127.0.0.1:5173>.

Server-only (no UI dev server):

```bash
cd apps/admin && bun run dev:server
```

## What it does

| Page            | Capability                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| Browse          | Grid of components, search box, tag filter. Click to open detail.               |
| Detail          | Symbol SVG preview, footprint variants, 3D viewer (GLB), pin-map, edit, delete. |
| Validate & Pack | Runs `tools/validate.ts` and `tools/pack.ts`; downloads the `.opclib` bundle.   |

## Data flow

- **Reads** the file tree directly: `symbols/`, `footprints/`, `components/`, `3d/`.
- **Writes** JSON files in place with pretty 2-space indent + trailing newline.
- An in-memory index is rebuilt on every write and on every `fs.watch` event under those directories.
- **No database.** No auth. Binds to `127.0.0.1` only.

## Git

The admin **writes files only**. It never commits, stages, or branches. The Pack page shows a live `git status --porcelain` so you can see what's dirty. Commit yourself.

## 3D models

- Committed format: `.glb` under `3d/<category>/<slug>.glb`.
- Optional STEP source goes to `.step-cache/<category>/<slug>.step` — **outside the repo**, gitignored. Re-tessellation is your responsibility.
- Upload `.glb` from the Detail page; magic-byte check rejects anything that isn't a glTF binary.

## Versioning / packing

- `package.json` `version` is the source of truth. Bump it manually before running Pack.
- Pack output lands in `dist/<name>-<version>.opclib`. The Pack page offers a download link.

## What isn't here yet (deferred)

- KiCad import wizard (`.kicad_sym` / `.kicad_mod` / `.zip`) — the parsers package is already in place at `packages/kicad-parsers/`; wiring it into a wizard is the next slice.
- Drawn-footprint editor.
- Multi-source / release-channel management.
- STEP → GLB conversion in-browser.

## Architecture

```
apps/admin/
├── server/        Bun HTTP server (no framework)
│   ├── main.ts
│   ├── http.ts          tiny router
│   ├── repo/            file-backed index + safety + writes
│   └── routes/
└── web/           Vite + React 19 + Tailwind 4
    └── src/
        ├── App.tsx       hash-routed shell
        ├── api.ts        typed fetch helpers
        ├── components/   SymbolPreviewSVG, FootprintPreviewSVG, Model3DViewer (R3F)
        └── pages/        Browse, Detail, Pack
```

The `packages/kicad-parsers/` workspace contains the KiCad S-expression / symbol / footprint parsers (copied from the desktop app, unmodified). They will be wired into the future import wizard.
