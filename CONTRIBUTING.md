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

Every symbol, footprint, component, and 3D model has a dotted ID:

```
openpcb.core.<kind>.<category>.<slug>
```

Examples:

- `openpcb.core.symbol.passive.resistor_iec`
- `openpcb.core.footprint.passive.R_0603_1608Metric`
- `openpcb.core.component.passive.resistor.r0603`
- `openpcb.core.3d.passive.r0603`

Slugs are lowercase, words separated by `_`. Use IPC-7351B names for footprints (`R_0603_1608Metric`, not `0603`).

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

Pre-generated `.glb` files are committed alongside `.model.json` metadata; do not skip the GLB. If a STEP is unavailable, leave the entry out — do not ship a hollow placeholder.

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
