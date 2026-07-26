# CoreLibrary — Current State (2026-07-26)

Snapshot at **231 components** on **`master`** — verified green (typecheck · `bun test` 60 pass ·
`validate --release --strict` 231 OK · `audit:3d` 139 ok / 0 errors / 0 warnings · `audit-components`
231 / **0 issues** · pack builds full + GLB-only + STEP companion). For the roadmap see
[TODO.md](TODO.md); for the per-phase workflow and gotchas see [HANDOFF.md](HANDOFF.md).

## 2026-07-26 — hardening round (multi-unit shorts, courtyard, enforced gates)

This round fixed two correctness defects that had shipped **green** — the gates simply did not exist
to catch them — then added the gates so they cannot recur.

### 1. Multi-unit symbols were shorting themselves

21 components (every quad/hex logic gate and multi-channel op-amp/comparator) carried pins at
**overlapping coordinates**. KiCad draws each unit of a multi-unit symbol at the same local
coordinates, and the preview was built with `composeAllUnits: false`, so only unit 1 was spread.

`lm324` had 14 pins on **5 distinct coordinates** — all four op-amp *outputs* on `(7.62, 0)`. The
app's `deriveNetsAndJunctions` unions pins by world coordinate, so placing an LM324 merged those
outputs into one net: a spurious `OUTPUT_OUTPUT_SHORT`, with the four stacked inputs reading as
connected and masking `UNCONNECTED_INPUT_PIN`.

> **The preview is cosmetic.** The app wires from `normalized.pins`, not `preview.pins`. Composing
> the preview alone would have fixed the picture and left the short. `normalized.pins[].localPosition`
> is now re-derived from the composed preview anchors, joined on the `u<unit>:<number>` key.

Result: cross-unit collisions **67 → 0**; LM324 14 pins on 14 coordinates.

### 2. Courtyard geometry was discarded

The footprint layer allowlist admitted only silkscreen and fabrication, so **0 of 146** footprints
carried a courtyard — while the app already had full support (layer enum, colors, render order, flip
pairs, assembly view preset, auto-placer overlap gate). The geometry was present in the shipped
`raw` blob all along, so this was a re-normalize, not a re-import.

Result: courtyard **0 → 149/149**. Pads also expose full `layers[]` (mask/paste apertures) instead of
collapsing to `layers[0]`.

### Also landed

- **19 seed-imported assets repaired.** 17 passive footprints (R/C 0402–2512, disc caps, axial
  resistors — the most-placed parts in the library) carried a 2-key placeholder `raw` and so were
  excluded from every preview rebuild. `tools/backfill-raw.ts` restores a real parse, verifying the
  seeded sha1 against the vendored source first so a drifted checkout fails loudly.
- **`parameters` normalized.** 95 free-form key spellings across 155 components (with
  `vrrm`/`reverse_voltage` and `vds`/`vds_max` both live) collapsed onto a canonical
  datasheet-native vocabulary. `tools/parameter-dictionary.ts` is the single source of truth for
  both the codemod and the gate.
- **`packageCode` populated.** The importer dropped `pkg.code` entirely, so `package.code` was
  undefined library-wide and `pack.ts`'s `code ?? imperial ?? metric` chain never resolved. Now 21
  footprints carry a real code — and only a real one; the fallback echoes the footprint name, which
  would just duplicate `name`.
- **LQFP wave (+4 → 231).** LQFP-64/100/144 with STM32F103RCT6 / F405RGT6 / F407VGT6 / F429ZIT6 —
  the package family gap that blocked any modern 32-bit MCU design.
- **Pack split.** `--no-step` yields a 4.04 MB core pack (from 10.74 MB, −62%) plus a 6.69 MB STEP
  companion zip. STEP is still read as the GLB source; it is only excluded from the archive.

### Latent bugs surfaced by the above

- `orientation-gate.referenceBounds` was documented as "pads ∪ silk graphics" but summed **every**
  graphic regardless of layer. Harmless only while courtyard was absent — with it present, an ESP32
  module's antenna keep-out (48.00 × 41.20 vs an 18 × 25.5 body) drove xy-coverage to 0.38 and
  failed a correct model.
- `audit-components` **always exited 0** — a report, not a check — and carried 15 false positives
  (`no3d` parts reported as missing a 3D model; stacked-power-pin label overlaps; and a width
  estimator that counted KiCad subscript markup `V_{IN}` as 6 glyphs instead of 3).
- 3 transistor symbols had stale label geometry from an earlier builder change that was never
  propagated.

## Inventory — 231 components / 227 symbols / 149 footprints / 139 3D (10 footprints `no3d`)

ic 73 · connector 36 · transistor 32 · power 22 · diode 20 · passive 13 · mechanical 9 · opto 7 ·
sensor 6 · crystal 5 · switch 3 · relay 2 · battery 2 · audio 1

## Gates — all green, all enforced in CI

| Check                | Command                                       | Result                         |
| -------------------- | --------------------------------------------- | ------------------------------ |
| Release validation   | `bun tools/validate.ts --release --strict`     | OK (231 comp)                  |
| 3D orientation gate  | `bun tools/audit-3d-placement.ts --release`    | 139 ok / 0 err / 0 warn        |
| Component audit      | `bun tools/audit-components.ts --no-render`    | 231 / 0 issues                 |
| Datasheet links      | `bun tools/check-datasheet-links.ts`           | active                         |
| Tests                | `bun test`                                     | 60 pass                        |
| Typecheck            | `bun run typecheck`                            | clean                          |
| Pack (full)          | `bun tools/pack.ts --version=0.0.0-dev`        | 10.74 MB                       |
| Pack (GLB-only)      | `… --no-step --out=dist/glb-only`              | 4.04 MB + 6.69 MB STEP zip     |

`audit:3d` and `audit-components` are **new to CI** — both existed but neither ran, and
`audit-components` could not fail. The Playwright contact sheet stays a local command
(`bun tools/audit-components.ts`); CI uses `--no-render`.

### Validator gates added this round

| Gate    | Rule                                                                              |
| ------- | --------------------------------------------------------------------------------- |
| **G1a** | `preview.pins.length === normalized.pins.length`                                    |
| **G1b** | every `normalized.pins[].localPosition` equals its preview anchor                   |
| **G1c** | no two pins **of different units** share a coordinate — the short check              |
| **G1d** | pins stacked within one unit must share a name                                      |
| **G2**  | `raw` must be a real parse (2 OpenPCB-original generics exempt by id)               |
| **G3**  | every footprint preview carries courtyard geometry                                  |
| **G4**  | no multi-unit symbol carries sub-1 mm preview text                                  |
| **G5**  | parameter keys must be in the category's dictionary                                 |

**G1c keys on unit deliberately.** A naive "no two pins share a coordinate" rule would be wrong: 37
symbols have coincident pins, but only 21 were the defect. The other 16 (ESP32, RP2040, W5500,
DS3231, ATmega328P) use the legitimate KiCad stacked-power-pin idiom — every GND/VDD pad drawn at
one point as a single `power_in` plus N `passive` duplicates. Those genuinely *are* one net.

**G4 is scoped to multi-unit deliberately.** Sub-KLC text is not stale in itself — KiCad specifies
smaller per-pin fonts (LM386 `GAIN`, TL081 `NULL`) and the importer preserves them faithfully. It
only does damage on multi-unit symbols, where the app's `rebuildPreviewModelsIfStale` treats it as a
staleness trigger and rebuilds with `unitCount: 1`, collapsing the composition. Zero symbols overlap
both conditions today; the gate keeps it that way.

## Cross-repo status

**`shared` main is committed but NOT pushed.** CoreLibrary `package.json` still pins the old tags, so
local work runs on symlinked packages. Push order and the reason it matters:

1. `shared` main, then tags `rendering-core-v0.1.4` → `kicad-import-v0.2.0` → `contracts-v0.3.1`
2. re-pin `CoreLibrary/package.json`, `npm install`
3. push CoreLibrary `master`

Until step 1 lands, CI cannot resolve the new tags. `npm run shared:link` is unreliable here — it
prints "✔ All 8" unconditionally while npm re-resolves earlier links back to tag installs; verify
with `shared:status` and fall back to direct symlinks.

`@openpcb/kicad-import` 0.2.0 is a **breaking** change: multi-unit previews now contain every unit,
footprint previews contain courtyard/mask/paste, and model bounds grow to the true component extent.
Consumers must re-import to pick up corrected pin coordinates.

## Deferred (unchanged by this round)

Per-unit placement UX (`U1A`/`U1B`, physical-part grouping for ERC/PCB/BOM), the `courtyardPolygon`
producer in the app's `board-snapshot.ts`, typed numeric parameter values, and the remaining package
breadth (QFN/DFN/SON/BGA, 0201/1812/2010, FFC/FPC). See [TODO.md](TODO.md).

## Git

All work on **`master`**. The 2026-07-12 `feat/corelib-npth-pending` branch was verified fully
superseded (its content, importer change and 4 components are all on master; its `mountType:
"unknown"` schema change was abandoned in favour of `deriveMountType`), archived as tag
`archive/corelib-npth-pending`, and deleted.
