# 3D Placement Hardening — TODO

Plan: `~/.claude/plans/do-thorough-analysis-of-fizzy-clover.md`

## Phase 1 — Convention doc

- [ ] `docs/3d-placement-convention.md` (Z-up/mm/origin, KLC identity rule, bake policy, mountType body-axis)

## Phase 3 — Bounds + geometric gate (CoreLibrary, self-contained)

- [ ] `tools/glb-bounds.ts` — compute baked-GLB bbox (min/max/size) in bun ← spike first
- [ ] `tools/orientation-gate.ts` — pure gate: on-board / up-axis / XY-coverage / scale
- [ ] `schemas/model3d.schema.json` — add optional `boundsMinMm`/`boundsMaxMm`
- [ ] `tools/pack.ts` — compute bounds; `--write-bounds` patches sidecars
- [ ] rewrite `tools/audit-3d-placement.ts` → real gate (`--release` exits nonzero), HTML report
- [ ] `tools/validate.ts` — run gate in `--release`

## Phase 2 — Fix data

- [ ] remove `scaleMm:{y:-1}` from 4 connector sidecars (ratify via contact sheet)
- [ ] populate `boundsMm`/min/max on all sidecars (`pack --write-bounds`)
- [ ] `tools/import-kicad{,-batch}.ts` — enforce KLC identity, warn on non-identity

## Phase 4 — Visual contact sheet

- [ ] `tools/render-3d-contact-sheet.ts` — playwright-cli overlay PNGs + HTML grid

## Phase 5 — Tests

- [ ] `tests/model3d-orientation.test.ts` — gate + golden bounds (`tests/fixtures/model3d-bounds.json`)
- [ ] extend `tests/validate-integrity.test.ts` — inject 90° → gate rejects

## Phase 6 — shared/step-to-glb

- [ ] worker+node return post-bake bbox + orientation-mismatch warning (release later)

## Phase 7 — OpenPCB

- [ ] `opclib-importer.ts` — assert no render-ref when `transformBaked`
- [ ] `three-d/transform-helpers.ts` — back-layer + ordering unit tests

---

# Symbol import/render hardening (NEW — 2026-06-02)

Bugs (screenshots): overlapping pin name/number text; left/right pin names
collide at body centre (connectors); multi-unit parts (74HC00, LM358) draw all
units + both DeMorgan body styles stacked at origin.

Root causes (confirmed via code+JSON):

- **Convert/DeMorgan collapsed into unit.** `kicad-symbol-parser.ts` matches
  `_(\d+)_(\d+)$` but keeps only group 1 (unit), drops group 2 (convert) → body
  style 1 AND 2 graphics/pins get the same unit and render overlapped.
- **Preview stacks units at origin.** `build-preview-models.ts` calls
  `buildSymbolRenderModel({composeAllUnits:true, preserveOrigin:true})` → shiftX=0
  for every unit → all gates overlap.
- **Pin name placement** (`rendering-core/symbol-preview-builder.ts:61-113`): name
  at `bodyEnd`, number at `anchor`, equal 0.508 gaps, no perpendicular number
  offset; left/right names read inward and collide on narrow bodies.
- **Mirror/rotate anchor not flipped** (`r3f-eda-canvas/symbol-render-layer.tsx`):
  counter-scale `[-1,1,1]` applied but `anchorX` not inverted.
- **Lost KiCad data**: `pin_names (offset N)`, per-pin `justify`, `pin_names hide`
  / `pin_numbers hide`, convert — none parsed/normalized.

## Symbol phases

- [x] S0 symbol-render harness `tools/render-symbol-contact-sheet.ts` (re-parse
      rawSource → model → 2D canvas PNG + text-overlap gate). Baseline: 5/13 overlap.
- [x] S1 parser: capture convert (skip DeMorgan ≥2), pin_names offset, name/number
      hide (symbol + per-pin). `kicad-symbol-parser.ts`.
- [x] S2 import: thread hide → empty name / null number. `build-preview-models.ts`.
- [x] S3 rendering-core: preview = unit 1 only (`composeAllUnits:false`); pin
      number perpendicular to wire, name inside, skip `~`. `symbol-preview-builder.ts`.
- [x] S3b power-pin name⨯number: vertical number pushed toward tip (t=0.92).
      AMS1117 cleared. NE555 CONT (4-char name on short pin) = a pin's OWN
      name/number adjacency → gate now ignores same-pin pairs (`symbol-gate.ts`,
      shared by symbol + component audits). Flags only cross-pin collisions.
- [x] DIP-8 3D Y-flip: same KiCad footprint-Y-down vs STEP-Y-up issue as the
      connectors → `scaleMm.y=-1` (`3d/package/dip-8-w7-62mm.model.json`). 3D
      release gate now 36 ok / 0 errors. Fixes LM358's DIP-8 variant.
- [x] S4 r3f-eda-canvas: flip anchorX when mirrored (`symbol-render-layer.tsx`,
      builds clean). Needs in-app visual check with a mirrored part.
- [x] S5 regen symbols-only (temp dir → copy symbols/ back; 3d/ untouched);
      validate OK. Harness now renders stored extends-resolved `raw`.

Result: 74HC00, LM358, AMS1117 single-body clean; diode/LED/connector name-hide
correct; transistors clean. Symbol harness `dist/audit-symbols/symbol-sheet.png`.

## Remaining (needs OpenPCB infra / release)

- [ ] OpenPCB: transform-helpers back-layer + ordering unit tests (Bun)
- [ ] In-app verify mirrored-symbol anchor + 3D placement after shared release
- [ ] shared per-package release (kicad-parsers, kicad-import, rendering-core,
      r3f-eda-canvas) + repack opclib so app consumes fixes
