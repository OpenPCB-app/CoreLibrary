# Contributing to OpenPCB CoreLibrary

CoreLibrary is the canonical JSON source of the default component library shipped with OpenPCB.
Almost everything in it is KiCad-derived, carries strict provenance, and ships in a signed
`.opclib` release. That combination is why the validator is unusually opinionated: a bad component
here becomes a wrong schematic in someone else's design, and a licence slip here is a licence slip
in every downstream board.

This document is for someone adding or fixing content. If you are running a whole content wave, or
driving the repo as an agent, read [docs/AUTHORING.md](docs/AUTHORING.md) as well — it has the
manifest recipe and the KiCad ground truth.

## Quick start

```bash
git clone https://github.com/OpenPCB-app/CoreLibrary.git
cd CoreLibrary
bun install
bun run validate                             # validate the source tree
bun test                                     # boundary + import + pack tests
bun tools/pack.ts --version=0.0.0-dev        # sanity-build the artifact
```

Requirements: Bun ≥ 1.3.

One trap before you trust anything green. `bun run shared:link` symlinks all eight `@openpcb/*`
packages to a sibling working copy of `../shared`, and it prints "✔ All 8" unconditionally whether
or not it worked. If it has been left on, your local gates test unreleased shared code while CI
tests the pinned git tags — which is exactly how this repo ran a red CI for two months without
anyone noticing. **Run `bun run shared:status` before trusting a green local gate run.**

## ID convention

Every symbol, footprint, component and 3D model has a dotted, lowercase id. **Components carry no
kind segment; the three asset kinds do:**

```
openpcb.core.<category>.<slug>                 # component
openpcb.core.symbol.<category>.<slug>          # symbol
openpcb.core.footprint.<category>.<slug>       # footprint
openpcb.core.3d.<category>.<slug>              # 3D model
```

As they exist in the tree:

- `openpcb.core.passive.resistor`
- `openpcb.core.symbol.passive.resistor`
- `openpcb.core.footprint.passive.r-0603`
- `openpcb.core.3d.passive.r-0603`
- `openpcb.core.footprint.package.soic-14-3-9x8-7mm-p1-27mm`

`<category>` must equal the containing folder — `checkCategoryMatchesFile` in `tools/validate.ts`
enforces it. Shared package footprints live under the `package` category rather than a functional
one, which is why an SOIC-14 is `footprint.package.…` and not `footprint.ic.…`: the same land
pattern is reused by parts from half a dozen categories, and filing it under the first consumer's
category would be arbitrary.

Ids are validated against:

```
ID_REGEX = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/
```

Slugs are lowercase and **hyphenated**. Underscores are not merely discouraged — they fail
validation. Derive a footprint slug from the KiCad name by lowercasing and replacing `_` and `.`
with `-`:

```
SOIC-14_3.9x8.7mm_P1.27mm   →   soic-14-3-9x8-7mm-p1-27mm
```

That keeps the IPC-style dimensions, which are the part of the name people actually search for,
without the illegal characters.

## Adding a component from KiCad

```bash
bun tools/import-kicad.ts \
  --symbol-lib=path/to/Device.kicad_sym \
  --symbol-name=R \
  --footprint-lib=path/to/Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod \
  --category=passive \
  --slug=r0603
```

The importer writes symbol, footprint and component JSON with full provenance metadata. For more
than one or two parts, use a manifest and `tools/import-kicad-batch.ts` instead — see
[docs/AUTHORING.md](docs/AUTHORING.md).

## Provenance and licensing

KiCad-derived assets must declare:

- `source`, `license`, `attribution[]`
- `sourceFormat`, `sourceFileName`, `sourceLibrary`, `sourceItemName`
- `sourceHash` (SHA-256 of the upstream file)
- `upstreamUrl`, `upstreamCommit`
- `convertedAt`, `conversionTool`

The importer fills these in. If you are hand-editing, copy the shape from an existing file under
`symbols/` or `footprints/`.

**Licence denylist.** A KiCad-derived asset must carry
`CC-BY-SA-4.0+KiCad-Libraries-Exception` (or the exact agreed canonical equivalent). The validator
**fails** KiCad-derived assets that declare `CC-BY-4.0` or `CC0-1.0`. Those are weaker, non-canonical
licences that quietly drop the ShareAlike obligation the upstream data carries — accepting them
would let the library relicense KiCad content by accident. Assets that genuinely are ours use the
`openpcb-original` source; externally authored or manufacturer-supplied assets use
`openpcb-generated` / `manufacturer`, which the validator carves out separately.

`model3d.schema.json` allows optional provenance, deliberately, so that generated STEP sidecars can
carry the same KiCad-derived metadata as symbols, footprints and components rather than laundering
it away at the 3D layer.

Legal wording (NOTICE, attribution text) derives from `../docs/KiCADLibs_Reuse.md` in the workspace
docs repo. Consult that before rewording anything legal — see [NOTICE.md](NOTICE.md).

## 3D policy

Every footprint resolves **exactly one STEP-backed `.model.json` sidecar**, committed under
`3d/<category>/`. The canonical path policy is `3d/<category>/<footprint-or-model-slug>.step` plus
a matching `.model.json` sidecar beside it. The runtime `.glb` is generated at `bun pack` and is
gitignored, never committed.

**The one exemption is `no3d`.** A component may set `no3d: true` when it legitimately has no 3D
body — mounting holes, fiducials, test points, and a handful of parts where no STEP exists upstream
and none should be faked. When the owning component is `no3d`, the importer skips the model write
and the validator skips the "footprint requires exactly one STEP-backed model" check. Keep the
exemption tight: it exists so the STEP gate can stay hard for every electrical part, not as an
escape hatch for a part whose STEP is merely inconvenient to fetch. If a STEP is missing upstream
and the part does have a body, defer the part rather than shipping a hollow placeholder.

Placement, orientation and the sidecar transform rules are in
[docs/3d-placement-convention.md](docs/3d-placement-convention.md). Read it before setting any
non-identity transform.

## What `bun test` and the validator cover

`bun test` covers:

- Schema validation (Ajv against `schemas/*.json`)
- Cross-references: every component's symbol pins must match its footprint pads
- Uniqueness of ids and UUIDs
- Importer round-trips against inline temporary KiCad fixtures
- Pack compatibility — building a temporary `.opclib`, reading it back through shared
  `readOpclibFromPath()`, and confirming a tampered asset is rejected
- The shared-package boundary (below)

On top of that, `bun tools/validate.ts --release --strict` enforces a set of numbered gates. Each
one exists because something shipped green without it.

| Gate | Rule |
| --- | --- |
| **G1a** | `preview.pins.length === normalized.pins.length` |
| **G1b** | every `normalized.pins[].localPosition` equals its preview anchor |
| **G1c** | no two pins **of different units** share a coordinate — the short check |
| **G1d** | pins stacked within one unit must share a name |
| **G2** | `raw` must be a real parse (two OpenPCB-original generics are exempt by id) |
| **G3** | every footprint preview carries courtyard geometry |
| **G4** | no multi-unit symbol carries sub-1 mm preview text |
| **G5** | parameter keys must be in the category's dictionary |

### Why these are shaped the way they are

**The preview is cosmetic. The app wires from `normalized.pins`, not `preview.pins`.** This is the
single most important thing to understand before touching the symbol pipeline. Multi-unit symbols
once carried every unit's pins at the same local coordinates, because KiCad draws them that way and
the preview was built without composing units. The app's `deriveNetsAndJunctions` unions pins by
world coordinate, so placing an LM324 merged all four op-amp outputs into one net — a spurious
`OUTPUT_OUTPUT_SHORT`, with the stacked inputs reading as connected and masking
`UNCONNECTED_INPUT_PIN`. Composing the preview alone would have fixed the *picture* and left the
short. The fix re-derives `normalized.pins[].localPosition` from the composed preview anchors,
joined on the `u<unit>:<number>` key. G1a and G1b exist to keep those two views from diverging
again.

**G1c keys on unit deliberately.** A naive "no two pins share a coordinate" rule would be wrong.
Thirty-seven symbols have coincident pins, but only twenty-one were the defect. The other sixteen —
ESP32, RP2040, W5500, DS3231, ATmega328P — use the legitimate KiCad stacked-power-pin idiom, where
every GND or VDD pad is drawn at one point as a single `power_in` plus N `passive` duplicates.
Those genuinely *are* one net. If you find yourself "fixing" G1c to be stricter, you are about to
break those sixteen parts.

**G4 is scoped to multi-unit deliberately.** Sub-KLC text is not stale in itself — KiCad specifies
smaller per-pin fonts (the LM386 `GAIN` pin, the TL081 `NULL` pins) and the importer preserves them
faithfully. It only does damage on multi-unit symbols, where the app's
`rebuildPreviewModelsIfStale` treats small text as a staleness trigger and rebuilds with
`unitCount: 1`, collapsing the composition. No symbol overlaps both conditions today; the gate
keeps it that way.

**G3 exists because courtyard was silently dropped.** The footprint layer allowlist admitted only
silkscreen and fabrication, so no footprint carried a courtyard while the app already had full
support for it — layer enum, colours, render order, flip pairs, assembly-view preset, auto-placer
overlap gate. The geometry was in the shipped `raw` blob the whole time.

**G5 keys on the category dictionary** so that `parameters` is a queryable vocabulary rather than
free-form text. `tools/parameter-dictionary.ts` is the single source of truth for both the codemod
and the gate; [docs/PARAMETERS.md](docs/PARAMETERS.md) documents it. Keep the two in step.

## Repository boundaries

**Shared-package boundary.** Wrappers in `tools/` may *orchestrate* shared packages. Parser,
import, render and pack logic must **not** be copied into CoreLibrary. `tests/` enforces this, and
the rationale matters more than the test: CoreLibrary once carried its own `packages/kicad-parsers`
and `packages/core-import` copies, and they drifted from `../shared` until the two produced
different output for the same input. `tools/lib.ts` re-exports `canonicalize`, `sha256Bytes` and
`sha256File` from `@openpcb/opclib-pack` for the same reason — there is exactly one canonicalization
implementation and it does not live here.

CoreLibrary's `package.json` depends on **published, tagged** shared package refs so that standalone
CI works from a clean clone. The local `../shared` working copy is a development source only, wired
in via `shared:link` and unwired again before you trust a gate run.

TypeScript `paths` entries point at shared package *source* entrypoints. That looks like something
to clean up and is not: the installed GitHub package snapshots expose `dist` exports but contain
source-only package contents in this checkout, so without the `paths` mapping the types do not
resolve.

**Generated-file policy.** Commit source JSON and STEP. Never commit `.opclib`, generated GLB,
`.kicad_sym` / `.kicad_mod` import inputs, `node_modules`, or `.playwright-cli`. Conversely,
`.gitignore` must **not** exclude `3d/**/*.step` or `3d/**/*.model.json` — those are source, and a
broad `3d/` ignore rule has silently dropped them before.

## Before opening a PR

- [ ] `bun run shared:status` — confirm you are testing what CI will test
- [ ] `bun run typecheck` clean
- [ ] `bun tools/validate.ts --release --strict` → OK
- [ ] `bun run audit:3d` → N ok / **0 errors** (warnings are advisory)
- [ ] `bun tools/audit-components.ts --no-render` → 0 issues
- [ ] `bun tools/check-datasheet-links.ts` → passes (any curated `datasheet` URL is https, a direct
      PDF, and not a distributor mirror)
- [ ] `bun test` green
- [ ] `bun tools/pack.ts --version=0.0.0-dev` builds
- [ ] Component count grew as expected, and there are no orphan footprints — every new footprint
      needs a component that references it. `validate.ts` warns on unreferenced footprints and
      `--strict` makes that fatal.

The datasheet gate is structural and does no network I/O; see the README for why reachability
cannot gate a build.

## Releases

Maintainers only. Tags are `v<major>.<minor>.<patch>`. `release.yml` fires on any `v*` tag and
publishes a public GitHub Release, so **never tag without an explicit go-ahead**. The release path
runs the same gates as the PR path plus signing; signing is fail-closed. See the README's
"Packing and releasing" section and [keys/README.md](keys/README.md).

## License

CoreLibrary contents are licensed under **CC-BY-SA-4.0 with the OpenPCB Library Exception**,
mirroring KiCad library licensing. See [LICENSE.md](LICENSE.md) and [NOTICE.md](NOTICE.md).
