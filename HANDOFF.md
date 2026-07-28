# CoreLibrary Expansion — Session Handoff

How to continue growing CoreLibrary in a fresh session. Pair with [CURRENT_STATE.md](CURRENT_STATE.md) (what's done) and [TODO.md](TODO.md) (what's next).

> **Status (2026-07-28):** **231 components on `master`, pushed.** The P2–P6 sweep, the deferred-part
> recovery, the `orientation-gate.ts` calibration and the no-STEP mechanical path (MountingHole /
> Fiducial / TestPoint) are all long since done — this file's old resume point described the tree
> as it stood at 80 components.
>
> **The live blocker is not content, it is the release.** CI has been red since 2026-05-27 and the
> desktop app still bundles a 17-component pack from 2026-06-02. Read
> [CURRENT_STATE.md](CURRENT_STATE.md) 2026-07-28 first — it has the root cause and the exact
> unblock sequence. **Before trusting any green local gate run, check `bun run shared:status`**:
> `shared:link` leaves every `@openpcb/*` package symlinked to the sibling working copy, which is
> precisely how a red CI went unnoticed for two months.

## Orientation (read first, in order)

1. `CURRENT_STATE.md` — inventory, gates, what changed, gotchas. **Start with the newest section.**
2. `TODO.md` — the held release sequence, then the content roadmap.
3. `TARGETS.md` — the v1 parts target, reconstructed 2026-07-07.
4. `docs/PARAMETERS.md` — the canonical `parameters` vocabulary that gate G5 enforces.

> The original spec `../Corelibrary expansion plan.md` and the plan
> `~/.claude/plans/act-as-senior-software-snazzy-lantern.md` are **both gone from disk**;
> `TARGETS.md` is the surviving reconstruction. Don't go looking for them.

## Ground truth (do not re-derive)

- KiCad libs vendored at **`../references/kicad-libs`**, **KiCad 10.0.4 @ `c7e226a49`** (`bun run fetch:kicad-libs` to verify).
- Symbols are **unpacked per-symbol files**: `kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym` (no packed `<Lib>.kicad_sym#Name`).
- **Transistors are in `Transistor_BJT`/`Transistor_FET`**, not `Device`. Verify any symbol name exists before adding: `ls ../references/kicad-libs/kicad-symbols/<Lib>.kicad_symdir/ | grep <Name>`.
- CI runs `validate --release --strict` → **every footprint needs a STEP** in `kicad-packages3D/<Lib>.3dshapes/`. No STEP → defer to Wave 2.
- Datasheets are **link-only**: set `datasheet` to a manufacturer URL for function-parts, `null` for generics. `datasheetSource` is auto-captured from the KiCad symbol.

## Per-phase workflow

```bash
cd /Users/andrejvysny/workspace/openpcb/CoreLibrary
git checkout -b feat/corelib-<phase>   # one branch per phase
# 1. author tools/manifests/<phase>.json  (template: tools/manifests/TEMPLATE.jsonc;
#    examples: the shipped p2..p6 manifests; for many/high-pin parts COPY a generator —
#    scratchpad/gen-p4.ts (ICs) / gen-p5.ts (connectors) read pad lists + emit identity pinMaps).
# 2. dry-run, then real import (NOTE: --flag=value form):
bun tools/import-kicad-batch.ts --manifest=tools/manifests/<phase>.json --kicad-root=../references/kicad-libs --strict --dry-run
bun tools/import-kicad-batch.ts --manifest=tools/manifests/<phase>.json --kicad-root=../references/kicad-libs --strict   # add --allow-overwrite ONLY when reusing existing asset ids
# 3. RE-APPLY any clobbered/needed 3D Y-flips (DIP + vertical connectors/USB/switch):
#    set scaleMm.y:-1 in the affected 3d/<cat>/<slug>.model.json, then re-run audit:3d.
# 4. gates (ALL must pass):
bun tools/validate.ts --release --strict
bun run audit:3d                       # 3D orientation gate — must be N ok / 0 errors (warnings OK)
bun run typecheck
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
- **`--strict` requires an EXPLICIT pinMap** (it never auto-fills). For standard parts where symbol pin numbers == pad numbers, the map is pure identity (`{pinNumber:n, padNumber:n}` per pad) — **generate it from the footprint's pad list** rather than hand-typing (see `scratchpad/gen-p4.ts`/`gen-p5.ts`; `padOverride` maps a non-electrical pad like SOT-223 tab or barrel-jack `MP` to its electrical pin). The importer follows `extends` recursively, so point `symbol.path` at the named child.
- **Prefer all-new asset ids per phase** → import without `--allow-overwrite` (no clobber, no re-flip). Reuse a shared id ONLY when the asset is genuinely the same KiCad footprint already in the library (e.g. `package.sot-23`, `package.to-92-inline`); a **second asset with the same KiCad footprint NAME fails `validate`** (duplicate-name) — reuse the existing id instead.
- **3D orientation gate (`audit:3d`) is hard.** Vertical pin headers/sockets, USB, THT switches need `scaleMm.y:-1`; SMD parts seated <−0.1 mm need a small `offsetMm.z`. **Long-lead vertical THT (TO-220, DHT11, buzzer) trip the gate as false-positives** → currently deferred (see TODO Wave-2 calibration item) — don't "fix" them by faking offsets.
- **Don't reuse a generic symbol id across components** (e.g. `Q_NMOS_GSD`, `LED`, `Conn_01x04`) — the importer names the shared symbol after the _last_ component (name bleed). Give each part its own symbol id.
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

## Resume here (next clean session)

Content is **not** the bottleneck. Order (full detail in [TODO.md](TODO.md)):

1. **Unblock the release — everything else is downstream of this.** Four tags in `shared`
   (`step-to-glb-v0.1.5`, `kicad-import-v0.2.0`, `rendering-core-v0.1.4`, `contracts-v0.3.1`),
   then re-pin `CoreLibrary` + `OpenPCB`, then **confirm CI green**, then `v0.2.0`. Three CI
   failures remain and all three clear with that re-pin. `release.yml` now fails closed without
   `OPCLIB_SIGNING_KEY` / `OPCLIB_KEY_ID`. **Tagging is gated on an explicit go-ahead.**
2. **Re-pin the app bundle** — `OpenPCB/resources/core-library/` still holds the 17-component
   beta packs; `OpenPCB/scripts/fetch-core-library.ts` verifies SHA256SUMS + Ed25519 and installs.
3. **Content breadth** — the gaps that block real designs, roughly in value order: SMD power
   inductors (the five buck/boost regulators have nowhere to put one), FFC/FPC connectors (none
   exist, so no display or camera design is possible), DFN/SON + SOP/SSOP, 0201/1812/2010,
   1.27/2.00 mm headers. Then the power-electronics set: DPAK/D²PAK/TO-247, gate drivers,
   magnetics, Kelvin shunts.
4. **Data model** — typed parameter values, lifecycle, distributor part numbers. Wire the app up
   to read `parameters` *first*: it is packed today but has no consumer, so enriching it before
   that just produces more data nothing displays.

**Reusable assets:** per-phase manifests `tools/manifests/*.json` (29 of them; `TEMPLATE.jsonc`
documents the shape). Recon helper pattern: `grep -oE '\(pad "[^"]+"'` for pads, follow `extends`
for pins. Sparse-checkout each wave's `.3dshapes` before importing — `kicad-packages3D` is a
partial clone, so a missing STEP usually means "not fetched yet", not "not upstream".

## Cross-repo touchpoints (only when reaching P7/P9)

- App import path: `OpenPCB/src/modules/library/backend/sync/{opclib-importer,opclib-reader,bootstrap}.ts`; component table `OpenPCB/src/modules/library/backend/schema.ts`; detail UI `OpenPCB/src/modules/library/frontend/{ComponentDetailPage,components/DetailsCard}.tsx`.
- `@openpcb/opclib-pack` lives in `../shared`; bump its `component.schema.json` + version to carry `datasheet`/`keywords`/`subcategory`, then update the pin in both `CoreLibrary/package.json` and `OpenPCB/package.json`.

## Git

`master` is pushed and level with `origin/master`. New phases: branch off `master`, one PR per
phase (CI `validate.yml` must pass). Commit-message trailer: `Co-Authored-By: Claude …`.

**Never tag or publish a release without an explicit go-ahead** — `release.yml` fires on `v*` and
publishes a public GitHub release.
