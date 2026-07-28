# Contributing to OpenPCB Core Library

CoreLibrary is the canonical JSON source of the default component library shipped with OpenPCB. Components are KiCad-derived with strict provenance and signed `.opclib` releases.

## Quick start

```bash
git clone https://github.com/OpenPCB-app/CoreLibrary.git
cd CoreLibrary
bun install
bun validate            # validate the source tree
bun test                # run boundary + import + pack tests
bun pack --version 0.0.0-dev
```

Requirements: Bun ≥1.3.

## ID convention

Every symbol, footprint, component, and 3D model has a dotted ID. **Components carry no kind
segment; the three asset kinds do:**

```
openpcb.core.<category>.<slug>                 # component
openpcb.core.symbol.<category>.<slug>          # symbol
openpcb.core.footprint.<category>.<slug>       # footprint
openpcb.core.3d.<category>.<slug>              # 3D model
```

Examples, as they actually exist in the tree:

- `openpcb.core.passive.resistor`
- `openpcb.core.symbol.passive.resistor`
- `openpcb.core.footprint.passive.r-0603`
- `openpcb.core.3d.passive.r-0603`
- `openpcb.core.footprint.package.soic-14-3-9x8-7mm-p1-27mm`

`<category>` must equal the containing folder — `checkCategoryMatchesFile` in `tools/validate.ts`
enforces it. Shared package footprints live under the `package` category rather than a functional
one, which is why an SOIC-14 is `footprint.package.…` and not `footprint.ic.…`.

Slugs are lowercase and **hyphenated**. Underscores are not merely discouraged, they fail
validation — `ID_REGEX` is `/^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/`. Derive footprint slugs
from the KiCad name by lowercasing and replacing `_` and `.` with `-`
(`SOIC-14_3.9x8.7mm_P1.27mm` → `soic-14-3-9x8-7mm-p1-27mm`), which keeps the IPC-style dimensions
without the illegal characters.

## Adding a component from KiCad

```bash
bun tools/import-kicad.ts \
  --symbol-lib path/to/Device.kicad_sym \
  --symbol-name R \
  --footprint-lib path/to/Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod \
  --category passive \
  --slug r0603
```

The importer produces symbol, footprint, and component JSON files with full provenance metadata (`source`, `upstreamUrl`, `upstreamCommit`, `convertedAt`, etc.). Always commit a passing `bun validate --release --strict` before opening a PR.

## Required provenance fields (strict mode)

KiCad-derived assets must declare:

- `source`, `license`, `attribution[]`
- `sourceFormat`, `sourceFileName`, `sourceLibrary`, `sourceItemName`
- `sourceHash` (SHA-256 of upstream)
- `upstreamUrl`, `upstreamCommit`
- `convertedAt`, `conversionTool`

See existing files under `symbols/`, `footprints/` for reference.

## 3D models

Each footprint references one STEP-backed `.model.json` sidecar; the `.step` source is committed under `3d/<category>/`. The runtime `.glb` is **generated at `bun pack`** (and is gitignored, not committed). If a STEP is unavailable upstream, leave the entry out and defer the part to Wave 2 — do not ship a hollow placeholder (`validate --release` requires exactly one STEP-backed 3D model per footprint).

## Tests

`bun test` covers:

- Schema validation (Ajv against `schemas/*.json`)
- Cross-references: every component's symbol pins must match its footprint pads
- Uniqueness of IDs and UUIDs
- shared-package boundary (no in-repo duplicates of `@openpcb/*` packages)

## Release

Maintainers only — see `README.md` "Releasing" section. Tag pattern is `v<major>.<minor>.<patch>` (aligned with OpenPCB app: `v0.1.0-beta.N` during beta).

## License

CoreLibrary contents are licensed under **CC-BY-SA-4.0 with the OpenPCB Library Exception** (mirrors KiCad library licensing). See [LICENSE.md](LICENSE.md), [ATTRIBUTION.md](ATTRIBUTION.md), and [NOTICE.md](NOTICE.md).
