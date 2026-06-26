# CoreLibrary Expansion — Session Handoff

How to continue growing CoreLibrary in a fresh session. Pair with [CURRENT_STATE.md](CURRENT_STATE.md) (what's done) and [TODO.md](TODO.md) (what's next).

> **Status (resume point):** the **P2–P6 content sweep is DONE and on `master` (`6b114e4`)** — **80 components**, all gates green. What remains: recover the deferred parts (needs an `orientation-gate.ts` calibration), build the no-STEP mechanical path (MountingHole/Fiducial), and the cross-repo P7 + release P9. **Start at the [Resume here](#resume-here-next-clean-session) section below.**

## Orientation (read first, in order)

1. `CURRENT_STATE.md` — inventory, gates, what changed vs the spec, gotchas.
2. `TODO.md` — phase roadmap (**P2–P6 done**; remaining = deferred recoveries + P7/P8/P9) + Wave-2 blockers.
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

The sweep is on `master` (`6b114e4`), gates green, **not pushed**. Suggested order (full detail in [TODO.md](TODO.md)):

1. **(optional) Push** — `git push origin master` (5 commits ahead of `origin`; CI `validate.yml` runs `--release --strict`).
2. **Recover deferred parts — highest value.** Calibrate `tools/orientation-gate.ts` for vertical / long-lead THT (raise the >6 mm `THT_LEAD_BELOW_MAX` budget for `orientationHint === "vertical"`, and skip/relax the `xy-center` check when the body legitimately sits behind the pad row). Re-validate the whole set, then re-add **LM7805 / LM317 / LM2596** (TO-220) + **DHT11** (and **buzzer** with a rotation, verified visually). Manifest entries + footprint names are in TODO.md.
3. **No-STEP mechanical path** — add the `no3d` exemption (importer `import-kicad-batch.ts` ~L880/898-904/929 + validator `validate.ts` L352/358/447 + `schemas/component.schema.json`; exact sketch in TODO.md) to ship **MountingHole + Fiducial**.
4. **More content** (Wave-2 in TODO.md) — `_HandSolder` variants, RGB/WS2812 LEDs, bridge rectifier, power MOSFETs (TO-220/263); USB-C/IDC once their 3D/pad issues resolve; externally sourced symbol/STEP for MP1584/MP2307/MPU-6050/74HC125.
5. **P7 cross-repo + P9 release** — see below + TODO.md.

**Reusable assets from this sweep:** the per-phase manifests `tools/manifests/p{2..6}-*.json` and the generators `scratchpad/gen-p4.ts` / `gen-p5.ts` (copy them for new high-pin/connector phases). Recon helper pattern: `grep -oE '\(pad "[^"]+"'` for pads, follow `extends` for pins.

## Cross-repo touchpoints (only when reaching P7/P9)

- App import path: `OpenPCB/src/modules/library/backend/sync/{opclib-importer,opclib-reader,bootstrap}.ts`; component table `OpenPCB/src/modules/library/backend/schema.ts`; detail UI `OpenPCB/src/modules/library/frontend/{ComponentDetailPage,components/DetailsCard}.tsx`.
- `@openpcb/opclib-pack` lives in `../shared`; bump its `component.schema.json` + version to carry `datasheet`/`keywords`/`subcategory`, then update the pin in both `CoreLibrary/package.json` and `OpenPCB/package.json`.

## Git

P2–P6 sweep is committed to `master` as **`6b114e4`** (`feat(lib): P2–P6 content sweep — 23→80 components`). **`master` is 5 commits ahead of `origin/master` — NOT pushed.** Working tree clean. New phases: branch off `master`, PR per phase (CI `validate.yml` must pass). Commit-message trailer: `Co-Authored-By: Claude …` + `Claude-Session: …` per the harness convention.
