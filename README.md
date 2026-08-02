# OpenPCB CoreLibrary

Readable JSON source for the OpenPCB Core Library — the default set of symbols, footprints, 3D
models and components shipped with the OpenPCB desktop app.

Everything here is source, not build output. Symbols, footprints and components are hand-reviewable
JSON validated against JSON Schema; 3D geometry is committed as STEP with a small JSON sidecar
describing its placement. The runtime `.glb` and the `.opclib` release archive are both generated at
pack time and are never committed.

Most content is converted from the KiCad official libraries under CC-BY-SA-4.0 with the KiCad
Libraries Exception, with per-asset provenance recorded in the JSON itself. See
[NOTICE.md](NOTICE.md) for the licensing obligations that follow from that.

Two identifiers are a cross-repo contract and must not be changed without coordinating with OpenPCB
and `@openpcb/opclib-pack`: the library id `openpcb.core`, and the `.opclib` `schemaVersion`
`"1.0.0"`.

## Layout

```
components/<category>/<name>.component.json   assembled components
symbols/<category>/<name>.symbol.json         schematic symbols
footprints/<category>/<name>.fp.json          physical footprints
3d/<category>/<name>.step                     source 3D geometry
3d/<category>/<name>.model.json               placement sidecar; pack generates the GLB
schemas/                                      JSON Schema (draft 2020-12)
scripts/                                      maintenance scripts behind the `bun run` aliases
tests/                                        Bun test suite
tools/                                        validator, packer, importers, audits
tools/manifests/                              per-wave KiCad import manifests + TEMPLATE.jsonc
keys/                                         committed Ed25519 public key + signing docs
docs/                                         authoring, parameters, 3D placement convention
```

`library.json` is written by `bun pack`. `dist/*.opclib` is a generated release artifact and is
gitignored.

## Commands

| Command | What it does |
| --- | --- |
| `bun install` | install dependencies (Bun ≥ 1.3) |
| `bun run typecheck` | type-check `tools/` and the content loaders |
| `bun test` | schema, cross-reference, uniqueness, import and pack tests |
| `bun run validate` | validate the source tree (non-release mode) |
| `bun tools/validate.ts --release --strict` | **the release gate** — see below |
| `bun run audit:3d` | 3D orientation gate against the baked GLB bounds |
| `bun tools/pack.ts --version=X.Y.Z` | build the `.opclib` release artifact |
| `bun tools/import-kicad.ts` | single-part KiCad import wrapper |
| `bun tools/import-kicad-batch.ts --manifest=…` | manifest-driven wave import |
| `bun tools/gen-pinmap.ts --footprint=<path>` | emit an identity pinMap for a manifest entry |
| `bun tools/rebuild-previews.ts` | re-normalize every preview from `raw` after a builder change |
| `bun tools/backfill-raw.ts` | restore a real parse on sidecars with a placeholder `raw` |
| `bun tools/normalize-parameters.ts` | rewrite `parameters` onto the canonical dictionary |
| `bun run fetch:kicad-libs` | verify the vendored KiCad checkout |
| `bun run shared:status` | report which `@openpcb/*` packages are symlinked vs pinned |

Tool flags use the `--flag=value` form. A space-separated flag parses as an unknown flag and the
run aborts.

## CI gates

Every gate below runs on pull requests (`validate.yml`) **and** on the release path
(`release.yml`). Keeping the two paths identical is deliberate: a release must never be validated
more weakly than the change that went into it.

| Gate | Command | Why it exists |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | tools and content loaders share types with the shared packages; a drifted signature fails here rather than mid-pack |
| Tests | `bun test` | schema, pin/pad cross-reference, id and UUID uniqueness, importer round-trips, pack compatibility and the shared-package boundary |
| Release validation | `bun tools/validate.ts --release --strict` | the content contract — schema, provenance and licence, id form, pin/pad coverage, courtyard, parameters; strict mode makes orphan footprints fatal |
| 3D orientation | `bun tools/audit-3d-placement.ts --release` (alias `bun run audit:3d`) | catches models that render through the board, mirrored or at the wrong scale, by checking baked GLB bounds against the footprint |
| Component audit | `bun tools/audit-components.ts --no-render` | symbol overlap, label geometry and cross-reference sanity that the schema cannot express; `--no-render` keeps it headless |
| Datasheet links | `bun tools/check-datasheet-links.ts` | structural check that curated datasheet URLs are https, direct PDFs and not distributor mirrors |
| Pack | `bun tools/pack.ts --version=…` | proves the tree actually packs, including STEP → GLB conversion for every model |

The datasheet gate does **no network I/O by default**, and that is not an oversight. Manufacturer
WAFs block automated probes — st.com and analog.com time out entirely, while onsemi, microchip,
tdk, irf, phoenixcontact and littelfuse answer 403 to anything that is not a real browser — so
reachability would fail the build on correct URLs. Run the probe by hand to hunt link rot:

```sh
bun tools/check-datasheet-links.ts --network                   # advisory; WAF hosts report `blocked`
bun tools/check-datasheet-links.ts --network --strict-network  # 404/410 on a probeable host is fatal
```

The full Playwright contact sheet (`bun tools/audit-components.ts`, without `--no-render`) stays a
local command; CI uses the headless form.

One packing note worth carrying: `step-to-glb` must memoise its OCCT WASM module. A per-file
`initOcctImportJs()` leaks one Emscripten runtime per conversion and dies somewhere past the
120th model with `RuntimeError: access to a null reference` — which reads like corrupt geometry
and lands on whichever file happens to be next, not on a faulty one. Set `OPCLIB_PACK_VERBOSE` to
trace each conversion if a pack dies: a WASM abort cannot be caught, so the last traced model is
the only clue.

## Packing and releasing

`bun tools/pack.ts` produces three artifacts:

- the full `.opclib` (GLB + STEP),
- a `--no-step` GLB-only core pack, roughly 60% smaller, which is what the app actually renders,
- a `-step.zip` STEP companion for MCAD export.

STEP is still read as the GLB source in the `--no-step` build; it is only excluded from the archive.

To release:

1. Run the gate list above locally, then `bun tools/validate.ts --release --strict`.
2. Tag: `git tag v1.2.3 && git push origin v1.2.3`. Tags are `v<major>.<minor>.<patch>`.
3. `release.yml` runs typecheck → test → validate → the three audits → pack → sign → `SHA256SUMS`
   → publish a public GitHub Release. It verifies both published packs, including the Ed25519
   signature, against the committed `keys/openpcb-core.pub`, so a CI key that drifts from the
   published public key fails before release rather than on every user's install.

**Signing is fail-closed.** Without both the `OPCLIB_SIGNING_KEY` secret and the `OPCLIB_KEY_ID`
variable the release job fails; it does not fall back to publishing an unsigned pack. Setting those
up is a one-time maintainer task — see [keys/README.md](keys/README.md), which also records the two
traps that made signing silently impossible once already.

`release.yml` fires on any `v*` tag and publishes publicly. Never tag without an explicit
go-ahead.

## ID convention

Every asset has a dotted, lowercase id. **Components carry no kind segment; the three asset kinds
do.**

| Kind | Form | Example |
| --- | --- | --- |
| Component | `openpcb.core.<category>.<slug>` | `openpcb.core.passive.resistor` |
| Symbol | `openpcb.core.symbol.<category>.<slug>` | `openpcb.core.symbol.passive.resistor` |
| Footprint | `openpcb.core.footprint.<category>.<slug>` | `openpcb.core.footprint.passive.r-0603` |
| 3D model | `openpcb.core.3d.<category>.<slug>` | `openpcb.core.3d.passive.r-0603` |

Ids are checked against:

```
ID_REGEX = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/
```

Slugs are hyphenated; underscores fail validation. `<category>` must equal the containing folder.
[CONTRIBUTING.md](CONTRIBUTING.md) has the slug-derivation rule and the reason shared package
footprints live under `package` rather than a functional category.

## KiCad ground truth

The KiCad source libraries are vendored at `../references/kicad-libs`, pinned to **KiCad 10.0.4**
(`https://gitlab.com/kicad/libraries` @ `c7e226a49`). Verify the checkout with
`bun run fetch:kicad-libs`. Import manifests resolve their `kicad-symbols/…`,
`kicad-footprints/…` and `kicad-packages3D/…` paths against this tree
(`--kicad-root=../references/kicad-libs`, the importer default). In KiCad 10, symbols are unpacked
per-symbol files: `<Lib>.kicad_symdir/<Name>.kicad_sym`.

[docs/AUTHORING.md](docs/AUTHORING.md) covers the rest — the per-wave workflow, the manifest
recipe, and the gotchas that cost real time.

## Where to go next

| You want | Read |
| --- | --- |
| To contribute a component | [CONTRIBUTING.md](CONTRIBUTING.md) |
| To run a content wave, or drive this repo as an agent | [docs/AUTHORING.md](docs/AUTHORING.md) |
| Current inventory, the held release, the backlog | [STATUS.md](STATUS.md) |
| The `parameters` vocabulary that gate G5 enforces | [docs/PARAMETERS.md](docs/PARAMETERS.md) |
| How 3D models are oriented and placed | [docs/3d-placement-convention.md](docs/3d-placement-convention.md) |
| Signing, key rotation, the trust-store contract | [keys/README.md](keys/README.md) |
| Licensing and attribution obligations | [NOTICE.md](NOTICE.md) · [LICENSE.md](LICENSE.md) |
| To report a vulnerability | [SECURITY.md](SECURITY.md) |

## License

CoreLibrary contents are licensed under **CC-BY-SA-4.0 with the OpenPCB Library Exception**,
mirroring KiCad library licensing. See [LICENSE.md](LICENSE.md) and [NOTICE.md](NOTICE.md).
