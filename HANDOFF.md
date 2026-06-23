# CoreLibrary Expansion — Session Handoff

How to continue growing CoreLibrary in a fresh session. Pair with [CURRENT_STATE.md](CURRENT_STATE.md) (what's done) and [TODO.md](TODO.md) (what's next).

## Orientation (read first, in order)

1. `CURRENT_STATE.md` — inventory, gates, what changed vs the spec, gotchas.
2. `TODO.md` — phase roadmap (P2→P9) + Wave-2 blockers.
3. Spec `../Corelibrary expansion plan.md` — §7.4 master parts table, §9 per-part playbook, Appendix B (parameters), Appendix D (checklist). **Treat its symbol-library names + manifest paths as KiCad-9 era — correct them per the rules below.**
4. Corrected plan `~/.claude/plans/act-as-senior-software-snazzy-lantern.md` — the verified deltas.

## Ground truth (do not re-derive)

- KiCad libs vendored at **`../references/kicad-libs`**, **KiCad 10.0.4 @ `c7e226a49`** (`bun run fetch:kicad-libs` to verify).
- Symbols are **unpacked per-symbol files**: `kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym` (no packed `<Lib>.kicad_sym#Name`).
- **Transistors are in `Transistor_BJT`/`Transistor_FET`**, not `Device`. Verify any symbol name exists before adding: `ls ../references/kicad-libs/kicad-symbols/<Lib>.kicad_symdir/ | grep <Name>`.
- CI runs `validate --release --strict` → **every footprint needs a STEP** in `kicad-packages3D/<Lib>.3dshapes/`. No STEP → defer to Wave 2.
- Datasheets are **link-only**: set `datasheet` to a manufacturer URL for function-parts, `null` for generics. `datasheetSource` is auto-captured from the KiCad symbol.

## Per-phase workflow

```bash
cd /Users/andrejvysny/workspace/openpcb/CoreLibrary
git checkout -b feat/corelib-p2        # one branch per phase
# 1. author tools/manifests/p2-discrete.json  (template: tools/manifests/TEMPLATE.jsonc; example: tools/core-v1-import.manifest.json)
# 2. dry-run, then real import (NOTE: --flag=value form):
bun tools/import-kicad-batch.ts --manifest=tools/manifests/p2-discrete.json --kicad-root=../references/kicad-libs --strict --dry-run
bun tools/import-kicad-batch.ts --manifest=tools/manifests/p2-discrete.json --kicad-root=../references/kicad-libs --strict   # add --allow-overwrite only when re-importing existing ids
# 3. gates:
bun tools/validate.ts --release --strict
bun run audit:3d                       # 3D orientation gate — must be N ok / 0 errors
bun test
bun tools/pack.ts --version=0.0.0-dev  # bakes GLBs; sanity only (.opclib is gitignored)
```

## Manifest authoring recipe

For each component (copy a verified entry from `tools/core-v1-import.manifest.json` or `tools/manifests/p1-passives.json`):

- `id`: `openpcb.core.<category>.<slug>` (slugs hyphenated, e.g. `schottky-ss14`). New category = new folder, automatic.
- `symbol.path`: `kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym`; reuse one symbol id across components where valid (importer dedupes).
- Each `footprints[]`: `path` = `kicad-footprints/<Lib>.pretty/<FP>.kicad_mod`, `model.path` = `kicad-packages3D/<Lib>.3dshapes/<FP>.step` (confirm the `.step` exists).
- `pinMap`: must cover **every symbol pin**, and under `--strict` **every footprint pad** must be mapped. Map a non-electrical/tab pad to its electrical pin (e.g. SOT-223 pad 4 → pin 2). **Omit `pinName`** unless it exactly matches the symbol pin name (mismatch fails `--strict`).
- `parameters`/`keywords`/`subcategory`: fill for `ic`/`power`/`sensor` (empty → soft note, not a failure). Generics may carry a light `type` (see existing passives).
- `datasheet`: manufacturer URL for function-parts (link-only), else omit/`null`.

Recon a family quickly:

```bash
ls ../references/kicad-libs/kicad-footprints/<Lib>.pretty/ | grep <pattern>
ls ../references/kicad-libs/kicad-packages3D/<Lib>.3dshapes/<FP>.step   # STEP present?
grep -oE '\(pad "[^"]+"' ../references/kicad-libs/kicad-footprints/<Lib>.pretty/<FP>.kicad_mod | sort -u   # pad numbers
grep -oE '\(number "[^"]+"' ../references/kicad-libs/kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym     # symbol pins
```

## Gotchas (cost real time if forgotten)

- **`--allow-overwrite` clobbers hand-tuned 3D fixes.** Re-importing a footprint regenerates its `3d/.../*.model.json` from KiCad defaults, wiping `scaleMm.y:-1` (DIP/connector Y-flip). After any re-import run `audit:3d`; re-apply `scaleMm.y:-1` to failing models. (See memory `project_corelibrary_import_3d_clobber`.)
- **`--flag=value` form only** — `--manifest=x`, `--version=x`. Space-separated parses as an unknown flag.
- **Multi-unit / multi-pin parts** (MCUs, logic): let the importer's pin↔pad check drive the pinMap; don't hand-guess. `validate` fails if any symbol pin is unmapped.
- **Don't duplicate R/C/L** — they're already extensive; extend `footprints[]` only.
- The formatter (prettier hook) reflows files after each edit — re-read a region before a follow-up Edit if an anchor moves.

## Verification checklist (before opening a PR)

- [ ] `bun run typecheck` clean
- [ ] `bun tools/validate.ts --release --strict` → OK
- [ ] `bun run audit:3d` → N ok / **0 errors**
- [ ] `bun tools/check-datasheet-links.ts` → passes (any curated `datasheet` URL resolves to a PDF)
- [ ] `bun test` green
- [ ] `bun tools/pack.ts --version=0.0.0-dev` builds
- [ ] component count grew as expected; no orphan footprints (validate warns→fails under strict)

## Cross-repo touchpoints (only when reaching P7/P9)

- App import path: `OpenPCB/src/modules/library/backend/sync/{opclib-importer,opclib-reader,bootstrap}.ts`; component table `OpenPCB/src/modules/library/backend/schema.ts`; detail UI `OpenPCB/src/modules/library/frontend/{ComponentDetailPage,components/DetailsCard}.tsx`.
- `@openpcb/opclib-pack` lives in `../shared`; bump its `component.schema.json` + version to carry `datasheet`/`keywords`/`subcategory`, then update the pin in both `CoreLibrary/package.json` and `OpenPCB/package.json`.

## Git

Work is on `master` (`dc42a69`), **not pushed** (`origin/master` is 4 behind). New phases: branch off `master`, PR per phase (CI `validate.yml` must pass). Commit-message trailer: `Co-Authored-By: Claude …` + `Claude-Session: …` per the harness convention.
