# CoreLibrary status

**Last updated: 2026-07-28.**

This is the only dated file in the repository. It is **rewritten, never appended** — there are no
`## 2026-xx-xx update` sections here and none should be added. If you want to know what changed and
when, that is what `git log` is for. Everything durable — how to author content, what the gates
mean, how to release — lives in [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/AUTHORING.md](docs/AUTHORING.md) and [docs/3d-placement-convention.md](docs/3d-placement-convention.md),
and none of those carry dates.

Negative knowledge, recorded once so nobody spends an afternoon on it: the original CoreLibrary
expansion spec and the `~/.claude/plans/*` files that several older documents cited as "source of
truth" are **gone from disk**. They are not recoverable and they are not in git. Don't go looking
for them.

## Inventory

231 components · 227 symbols · 149 footprints · 139 3D models. Ten footprints are `no3d`.

By category: ic 73 · connector 36 · transistor 32 · power 22 · diode 20 · passive 13 ·
mechanical 9 · opto 7 · sensor 6 · crystal 5 · switch 3 · relay 2 · battery 2 · audio 1.

All work is on `master`.

## Last verified gate run

Verified green on `master`:

| Gate | Result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun test` | 60 pass |
| `bun tools/validate.ts --release --strict` | OK, 231 components |
| `bun tools/audit-3d-placement.ts --release` | 139 ok / 0 errors / 0 warnings |
| `bun tools/audit-components.ts --no-render` | 231 / 0 issues |
| `bun tools/check-datasheet-links.ts` | structural, 151/151 OK |
| `bun tools/pack.ts --version=0.0.0-dev` | 10.74 MB full pack |
| `… --no-step --out=dist/glb-only` | 4.04 MB core pack + 6.69 MB STEP companion zip |

A green local run only means what `bun run shared:status` says it means. See
[CONTRIBUTING.md](CONTRIBUTING.md#quick-start).

## The held release

The release is **deliberately held**, pending an explicit go-ahead. It is the top of the queue —
content work is not the bottleneck, and everything below this section is downstream of it. The
desktop app currently bundles a seventeen-component pack built on 2026-06-02, so none of the
content grind has reached a user.

The unblock sequence, in order:

1. Cut **four** tags in `shared`:
   - `step-to-glb-v0.1.5` — carries the OCCT WASM module reuse; new to this batch
   - `kicad-import-v0.2.0`
   - `rendering-core-v0.1.4`
   - `contracts-v0.3.1`
2. Re-pin `CoreLibrary/package.json` (`kicad-import` → 0.2.0, `step-to-glb` → 0.1.5) and
   `OpenPCB/package.json`. Push.
3. **Confirm CI green.** Three failures remain today and all three clear with that re-pin: two
   importer tests fail because the pinned `kicad-import v0.1.2` discards the courtyard geometry G3
   now requires, and one `pack-shared-compat` test fails because the pinned `step-to-glb v0.1.4`
   lacks the module reuse.
4. **Only then** tag `v0.2.0`, and re-pin the app bundle.

`@openpcb/kicad-import` 0.2.0 is a breaking change: multi-unit previews now contain every unit,
footprint previews contain courtyard/mask/paste, and model bounds grow to the true component
extent. Consumers must re-import to pick up corrected pin coordinates.

### Signing prerequisites, still outstanding

`release.yml` fails closed, so `v0.2.0` will not build until both of these exist:

```bash
gh secret set OPCLIB_SIGNING_KEY < keys/openpcb-core.priv.pem
gh variable set OPCLIB_KEY_ID --body openpcb-core-2026
```

Then delete the local `.priv.pem`. Verified locally: a signed 231-component pack verifies under
`openpcb-core-2026` through both this repo's committed key and the app's trust store, and fails
under the retired placeholder key. See [keys/README.md](keys/README.md).

### Release checklist residue

- Verify the signature and `SHA256SUMS` on the published artifacts.
- Bump the app's bundled library via `OpenPCB/scripts/fetch-core-library.ts` and verify the boot
  import in a **packaged** build, not a dev run.
- Route the `component_request` issue template to manifest authoring.
- App smoke test once the pack lands: import the dev pack, place an LM324, confirm four separate
  op-amps with distinct pins and **no** `OUTPUT_OUTPUT_SHORT`; enable the assembly-view preset and
  confirm courtyards render.

## Datasheet follow-ups

Twenty-two parts that have an MPN still lack a curated `datasheet` link. The principle that governs
all of them: **a mirror is not a datasheet.** Their `datasheetSource` provenance is untouched, so
the pack still falls back to it where one exists.

**Seven need a sourcing decision, not a lookup:**

| Part | Problem |
| --- | --- |
| AMS1117 | `advanced-monolithic.com` serves no working https |
| CH340C / CH340G | WCH publishes HTML only, no official PDF |
| TP4056 | no stable official PDF |
| ME6211 | no stable official PDF |
| XL4015 | no stable official PDF |
| SS8550 | HTML only, no official PDF |
| ULN2803A | gone from TI's `lit/` paths entirely |

**The rest just need a retry** — DigiKey's daily quota cut the lookup short: Keystone 1042 and
3034, Kingbright KCSC02-105, Aosong DHT11, Hirose DM3AT, Epson SG-8002 and FC-135, Schurter
0031.8201, DB107, USB-C receptacle.

Also open: a **scheduled** (not per-push) `--network --strict-network` link-rot job. It must stay
non-blocking for WAF hosts, which is precisely why it is not in `validate.yml`.

## Content backlog, in value order

Target for v1 is a jellybean set of roughly **250–300 components**. The order below is by how much
each gap blocks a real design, which is not the same as by size.

1. **SMD power inductors.** The five buck/boost regulators in the library have nowhere to put one.
   This is the single most blocking gap.
2. **FFC/FPC connectors.** None exist, so no display or camera design is possible at all.
3. **DFN/SON and SOP/SSOP packages.**
4. **0201, 1812, 2010 passive sizes.**
5. **1.27 mm and 2.00 mm headers.**
6. **Power electronics:** DPAK / D²PAK / TO-247, gate drivers, magnetics, Kelvin shunts.
7. **QFN and BGA.**

Constraint on all of it: every new footprint needs a component that references it. `validate.ts`
flags unreferenced footprints and `--strict` makes that fatal.

## Wave-2 blockers — still genuinely open

These parts need external or authored assets under the tagged-provenance policy, because the
vendored KiCad 10.0.4 tree does not have what they need:

| Part | Missing |
| --- | --- |
| DHT22 | no symbol in KiCad 10 |
| 74HC125 | only `74LS125` / `74LVC125` / `74AHCT125` exist |
| ESP-12F | only the ESP-12E footprint exists |
| Solder Jumper | `Jumper.pretty` has footprints but no schematic symbol |
| JST-XH 3D | footprints present, no STEP in `Connector_JST.3dshapes` |
| MPU-6050 | `InvenSense_QFN-24` has no STEP |
| HC-SR04 | no dedicated symbol; generic 4-pin header only |
| MP1584 / MP2307 | no symbol in KiCad 10 stock libraries |
| EC11 encoder | needs external/authored assets |

## Data model

**Typed parameter values** — `{value, unit, min, typ, max}` — are the next data-model step, for real
parametric filtering. They require a `component.schema.json` change (it is
`additionalProperties: false`), plus work in `opclib-pack` and the app.

The sequencing insight matters more than the schema change: **wire the app to read `parameters`
first.** `parameters` is packed today and has no consumer, so enriching it before the app displays
it just produces more data nothing shows. Lifecycle status and distributor part numbers sit behind
the same reasoning.

## App-side follow-ups

Tracked here because CoreLibrary work created them, though the work itself is in OpenPCB:

- Per-unit placement UX — `U1A` / `U1B` plus physical-part grouping for ERC, PCB and BOM. The
  multi-unit compose fix makes the twenty-one affected parts correct and usable; it does not make
  them full-EDA.
- The `courtyardPolygon` producer in `board-snapshot.ts`, now that footprints carry courtyard.
- The stale data-model section in `OpenPCB/src/modules/library/AGENTS.md`.
- `opclib-importer.ts`: assert there is no render-ref when `transformBaked` is set.
- `three-d/transform-helpers.ts`: back-layer and ordering unit tests.

## Deferred decisions

- Ratify the four connector sidecars' `scaleMm: {y: -1}` via a contact sheet, for consistency with
  the DIP fix.
- `shared/step-to-glb`: have the worker and node paths return a post-bake bounding box and an
  orientation-mismatch warning, so the gate can compare against what was actually baked.

## Git

The 2026-07-12 branch `feat/corelib-npth-pending` was verified fully superseded — its content, its
importer change and its four components are all on `master`, and its `mountType: "unknown"` schema
change was abandoned in favour of `deriveMountType`. It is archived as tag
`archive/corelib-npth-pending` and the branch is deleted. Recorded here so nobody re-derives it.
