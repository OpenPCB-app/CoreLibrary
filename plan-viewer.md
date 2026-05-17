# Library Admin Viewer — Plan

## Hard constraint — DO NOT MODIFY OpenPCB

**`OpenPCB/` is strictly read-only for this work.** No edits, no refactors, no extracted shared imports, no version bumps, no test changes inside `OpenPCB/`. We **copy** files from `OpenPCB/src/modules/library/` into the new `OpenPCB_CoreLibrary/packages/core/` and `OpenPCB_CoreLibrary/apps/admin/` trees and adapt them there. The desktop app stays exactly as it is and continues to use its in-tree library module unchanged. If implementation ever requires touching `OpenPCB/`, stop and ask first.

## Context

`OpenPCB_CoreLibrary/` is a file-based JSON repo (symbols/footprints/components/3d + JSON Schemas + `tools/{validate,pack}.ts` emitting `.opclib`). All authoring today is manual JSON editing — error-prone, no previews, no KiCad import path. The desktop app (`OpenPCB/src/modules/library/`) already has a full implementation (parsers, schema, render-builders, R3F preview, KiCad import wizard, STEP→GLB) but it is locked inside the module system (Drizzle DB, Bun route registry, `ModuleDefinition` contract).

**Goal:** Bring the reusable pieces of the desktop library module into `OpenPCB_CoreLibrary/` as a **shared package** + add a **simple local-only web admin** that reads/writes the file tree directly. Desktop app continues unchanged; consumes the result via the existing `.opclib` flow.

## Decisions (from Q&A)

- Location: `OpenPCB_CoreLibrary/`
- Source of truth: JSON files on disk
- Capabilities: browse/search + edit metadata/delete + KiCad import + 3D upload + validate/pack
- Stack: Bun + React 19 + Vite 7 + Tailwind 4
- Desktop: unchanged; keeps DB-backed module, keeps consuming `.opclib`
- 3D: reuse R3F + `occt-import-js` (parity with desktop)
- Auth: none, bind `127.0.0.1`
- Git: write files only; user commits manually; show uncommitted-file count
- Drawn-footprint editor: **deferred** (KiCad import + IPC-7351B templates cover initial scope)
- STEP files: **outside repo** in `.step-cache/` (gitignored); GLB committed
- Sources/releases model: **ignored** — the repo itself is the implicit single source; version comes from root `package.json`
- Categories: **free-form** kebab-case subfolders; no enum
- E2E tests: **manual verification only**; Bun unit tests for parsers/import/repo
- Versioning: pack reads `package.json` version; user bumps + tags manually
- FS watching: `fs.watch` over content dirs; SSE-pushed refresh to UI
- Symbol/footprint source: **JSON only** on disk; original `.kicad_sym/.kicad_mod` discarded after import

## Target structure

```
OpenPCB_CoreLibrary/
├── packages/
│   └── core/                              # NEW shared lib (publishable later)
│       ├── src/
│       │   ├── parsers/kicad/             # ← copy from OpenPCB/.../infrastructure/parsers/kicad
│       │   │   ├── sexpr-parser.ts
│       │   │   ├── kicad-symbol-parser.ts
│       │   │   ├── kicad-footprint-parser.ts
│       │   │   ├── kicad-model-linker.ts
│       │   │   ├── heuristics.ts
│       │   │   └── __fixtures__/          # ← copy 12 KiCad fixtures
│       │   ├── render/                    # ← copy build-preview-models.ts + render-models.ts
│       │   ├── import/                    # ← copy inspect-kicad/commit-* (strip DB calls; return plain objects)
│       │   │   ├── inspect-kicad.ts
│       │   │   ├── commit-kicad.ts        # → returns {symbol,footprint,component} JSON, no DB
│       │   │   ├── commit-generated.ts
│       │   │   ├── commit-drawn.ts
│       │   │   ├── validate-pads.ts
│       │   │   ├── pinmap.ts
│       │   │   └── archive/extract-zip.ts
│       │   ├── templates/                 # ← IPC-7351B preset generator (if used by /imports/generated)
│       │   ├── types.ts                   # public types: ParsedKicadSymbol, ParsedKicadFootprint, LibraryComponent, etc.
│       │   └── index.ts                   # barrel
│       ├── tests/                         # port Bun tests for parsers + validators
│       ├── package.json                   # name: @openpcb/core
│       └── tsconfig.json
├── apps/
│   └── admin/                             # NEW web app
│       ├── server/
│       │   ├── main.ts                    # Bun.serve on 127.0.0.1:7173
│       │   ├── routes/
│       │   │   ├── components.ts          # GET list, GET :id, PATCH :id, DELETE :id
│       │   │   ├── symbols.ts             # GET :id (raw JSON)
│       │   │   ├── footprints.ts          # GET :id
│       │   │   ├── models.ts              # GET :sha.glb, POST upload (multipart), DELETE :sha
│       │   │   ├── tags.ts                # GET aggregated tag stats
│       │   │   ├── import-kicad.ts        # POST /imports/kicad/inspect, /imports/kicad
│       │   │   ├── templates.ts           # GET /templates, POST /templates/:id/materialize
│       │   │   ├── validate.ts            # POST → runs tools/validate.ts
│       │   │   ├── pack.ts                # POST → runs tools/pack.ts → streams .opclib
│       │   │   └── git-status.ts          # GET → uncommitted file count (spawn `git status --porcelain`)
│       │   ├── repo/                      # file-backed DAO replacing Drizzle queries
│       │   │   ├── index-cache.ts         # in-memory index built from walking ../../ tree on boot + fs.watch
│       │   │   ├── components.ts          # read/write components/<cat>/<slug>.component.json
│       │   │   ├── symbols.ts             # read/write symbols/<cat>/<slug>.symbol.json
│       │   │   ├── footprints.ts          # read/write footprints/<cat>/<slug>.fp.json
│       │   │   └── models.ts              # read/write 3d/<cat>/<slug>.{glb,model.json}
│       │   └── safety.ts                  # referenced-by checks before delete
│       ├── web/                           # Vite React app
│       │   ├── src/
│       │   │   ├── main.tsx
│       │   │   ├── App.tsx                # router shell, sidebar
│       │   │   ├── pages/
│       │   │   │   ├── BrowsePage.tsx     # grid + search + tag filter  (port LibraryCard.tsx + Space.tsx core)
│       │   │   │   ├── DetailPage.tsx     # ← port ComponentDetailPage.tsx (strip module-specific glue)
│       │   │   │   ├── ImportPage.tsx     # ← port import-wizard/
│       │   │   │   └── PackPage.tsx       # validate / pack / git status
│       │   │   ├── three-d/               # ← copy three-d/ verbatim (R3F + occt-import-js)
│       │   │   ├── components/            # ← copy TagFilterChips, TagChip, TagTokenInput
│       │   │   ├── hooks/useLibraryTags.ts
│       │   │   └── api.ts                 # fetch wrappers (no SDK token machinery)
│       │   ├── index.html
│       │   ├── vite.config.ts             # proxy /api → 127.0.0.1:7173
│       │   └── tailwind.config.ts
│       ├── package.json                   # scripts: dev, build, start
│       └── tsconfig.json
├── symbols/  footprints/  components/  3d/  schemas/  tools/   ← unchanged
├── bun.lock
└── package.json                           # add workspaces: ["packages/*","apps/*"]
```

## What we copy vs adapt

| Source (OpenPCB)                                                                                                                                                                                               | Destination                               | Adaptation                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/infrastructure/parsers/kicad/**`                                                                                                                                                                      | `packages/core/src/parsers/kicad/`        | **Verbatim.** No deps on module ctx.                                                                                                 |
| `backend/import/{inspect-kicad,commit-kicad,commit-generated,commit-drawn,validate-pads,pinmap,archive,build-preview-models}.ts`                                                                               | `packages/core/src/import/`               | Strip `ctx.db` writes; return plain `{symbol, footprint, component}` JSON objects. Callers in `apps/admin/server/` persist to files. |
| `backend/builtins/render-models.ts`                                                                                                                                                                            | `packages/core/src/render/`               | **Verbatim.** Pure functions.                                                                                                        |
| `backend/builtins/placeholder-footprint.ts`                                                                                                                                                                    | `packages/core/src/render/`               | Verbatim.                                                                                                                            |
| `frontend/Space.tsx`                                                                                                                                                                                           | `apps/admin/web/src/pages/BrowsePage.tsx` | Strip Zustand module store, navigation store, ModuleSpaceHost props. Keep search/filter/grid layout.                                 |
| `frontend/ComponentDetailPage.tsx`                                                                                                                                                                             | `apps/admin/web/src/pages/DetailPage.tsx` | Replace SDK calls with `fetch('/api/...')`. Keep symbol/footprint/3D preview panels.                                                 |
| `frontend/LibraryCard.tsx`, `components/`, `hooks/`, `three-d/`, `import-wizard/`, `tag-grouping.ts`, `utils.ts`, `types.ts`                                                                                   | `apps/admin/web/src/...`                  | Verbatim with import-path rewrites.                                                                                                  |
| `backend/schema.ts`, `backend/queries.ts`, `backend/index.ts`, `backend/migrations/`, `backend/builtins/seed.ts`, `backend/services/footprint-model-store.ts`, `backend/sync/`, `backend/legacy-id-aliases.ts` | **Not copied**                            | DB-specific, module-system-specific. Replaced by `apps/admin/server/repo/`.                                                          |

## File layout on disk for new artifacts

- **Components:** `components/<category>/<slug>.component.json` — already the convention.
- **Symbols:** `symbols/<category>/<slug>.symbol.json`
- **Footprints:** `footprints/<category>/<slug>.fp.json`
- **3D models:** `3d/<category>/<slug>.glb` + sibling `<slug>.model.json` (tessellation params, source step hash). STEP source files (if uploaded) go to `3d/<category>/<slug>.step` and are listed in `.gitattributes` as LFS-tracked (note in README; don't auto-configure LFS).
- IDs in JSON keep the existing `openpcb.core.<category>.<slug>` convention.

Validate against `schemas/*.json` on every write (reuse `tools/lib.ts` Ajv setup).

## API surface (minimal port of routes.ts)

`apps/admin/server/` exposes only what the UI needs:

- `GET /api/components?q=&tags=` — list (in-memory index)
- `GET /api/components/:id/detail` — component + symbol + footprint + variants + 3d-meta
- `PATCH /api/components/:id` — name/description/tags → write file + revalidate
- `POST /api/components/delete` — batch; refuses if symbol/footprint referenced elsewhere (`safety.ts`)
- `GET /api/symbols/:id`, `GET /api/footprints/:id`
- `GET /api/footprints/:id/model/meta`, `GET /api/footprints/:id/model` (serve GLB), `POST /api/footprints/:id/model` (multipart upload GLB + optional STEP), `DELETE /api/footprints/:id/model`
- `GET /api/tags`
- `POST /api/imports/kicad/inspect`, `POST /api/imports/kicad` (.kicad_sym/.kicad_mod/.zip)
- `GET /api/templates`, `POST /api/templates/:id/materialize` (IPC-7351B)
- `POST /api/validate` → spawn `bun tools/validate.ts`, stream output
- `POST /api/pack` → spawn `bun tools/pack.ts`, stream `.opclib` bytes
- `GET /api/git/status` → `git status --porcelain | wc -l` count + recent diff

All success responses: `{ ok: true, data }`. Errors: RFC 7807 problem-details (copy `core/contracts/AppError` minimal subset).

## Critical files to read while implementing

- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/backend/schema.ts` — for field names/types when writing JSON
- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/backend/queries.ts` — to know the exact data shape every route returns
- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/backend/routes.ts` — reference for request validation and error semantics
- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/backend/import/commit-kicad.ts` — DB calls to strip
- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/frontend/Space.tsx` — UI behavior to preserve
- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/frontend/ComponentDetailPage.tsx`
- `/Users/andrejvysny/workspace/openpcb/OpenPCB/src/modules/library/frontend/three-d/` — keep intact
- `/Users/andrejvysny/workspace/openpcb/OpenPCB_CoreLibrary/schemas/*.schema.json` — must validate every write
- `/Users/andrejvysny/workspace/openpcb/OpenPCB_CoreLibrary/tools/lib.ts`, `tools/validate.ts`, `tools/pack.ts` — reuse Ajv loader; `apps/admin/server/routes/validate.ts` should spawn `tools/validate.ts`

## Reuse — do not reimplement

- KiCad S-expr parser (`sexpr-parser.ts`) — already battle-tested with 12 fixtures
- IPC-7351B generator (in `templates/`) — pure math
- `extract-zip.ts` — pure-deflate impl, no native deps
- `step-to-glb` WASM worker in `frontend/three-d/` — keep as-is
- `tools/lib.ts` Ajv loader — call from admin server validators

## Implementation phases (TODO.md inside `apps/admin/`)

1. **Workspaces + package skeleton** — root `package.json` workspaces, `packages/core/` + `apps/admin/` boilerplate; nothing copied yet.
2. **Port parsers** — copy `parsers/kicad/`, port Bun tests, run `bun test` green.
3. **Port render + import (pure)** — copy `render-models`, `build-preview-models`, `import/*` minus DB writes; types compile.
4. **Admin server repo layer** — `apps/admin/server/repo/` reads file tree, builds in-mem index, fs.watch for change events; unit tests with fixtures.
5. **Admin server routes** — implement read endpoints first, then mutations (with Ajv validate on write).
6. **Admin web shell** — Vite + Tailwind 4 + router; BrowsePage list/search working against API.
7. **DetailPage + previews** — port `ComponentDetailPage` + R3F + symbol/footprint SVG preview builders.
8. **ImportPage** — port `import-wizard/` calling `/api/imports/kicad/*`.
9. **Pack page** — `/api/validate` + `/api/pack` + git status panel.
10. **README in apps/admin/** — how to run; STEP-LFS note.

## Verification

Run from `OpenPCB_CoreLibrary/`:

- `bun install` (root workspaces install) — succeeds, no peer warnings.
- `bun --filter @openpcb/core test` — all ported parser/import tests pass (must include the 12 KiCad fixtures).
- `bun --filter @openpcb/core typecheck` — clean.
- `bun --filter admin run dev` — backend at `127.0.0.1:7173`, Vite at `127.0.0.1:5173`, proxy works.
- In browser:
  - **Browse:** see existing `components/passive/*` listed; tag filter narrows; search returns hits.
  - **Detail:** open the resistor component → symbol preview renders, footprint variants visible, 3D viewer loads any present GLB.
  - **Edit:** rename a component → file on disk changes → `git status` in shell shows that file modified.
  - **Delete:** delete a test component → referenced-by guard refuses if footprint shared; otherwise file removed.
  - **Import:** drop a KiCad `.zip` (use one of the desktop fixtures) → inspect preview → commit → new files appear in `symbols/`, `footprints/`, `components/` and Ajv-validate.
  - **3D upload:** upload a `.glb` (use any builtin) → file appears in `3d/<cat>/<slug>.glb`; reload Detail page → model renders.
  - **Pack:** click Pack → server spawns `tools/pack.ts` → browser downloads `openpcb-core-library-<version>.opclib`. Import that bundle into a desktop dev instance (`bootstrapCoreLibrary`) and confirm components appear.
- `bun tools/validate.ts` (raw, no admin) — passes after all admin-driven edits.
- `git status` — only intended files dirty.

## Out of scope

- **Any change inside `OpenPCB/` whatsoever** — copy-only, never edit.
- Drawn-footprint editor (deferred).
- STEP storage in git (use `.step-cache/`, gitignored).
- Multi-source/release management UI.
- Cloud sync, auth, public-catalog submission.
- Playwright E2E (manual verification only).
- Cloud sync, multi-user auth, public catalog submission (`OpenPCB_backend/`).
- Designer integration / placement APIs (no SDK token machinery in the admin).
- Drawn-footprint editor (port to `apps/admin/web/` later if requested; not in initial scope despite KiCad import being included — confirm if you want it now).

## Unresolved questions

None — all decisions captured above.
