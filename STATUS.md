# CoreLibrary status

**Last updated: 2026-09-05.**

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

241 components · 237 symbols · 168 footprints · 158 3D models. Ten footprints are `no3d`.

By category: ic 75 · connector 42 · transistor 32 · power 23 · diode 20 · passive 13 ·
mechanical 9 · opto 7 · sensor 7 · crystal 5 · switch 3 · relay 2 · battery 2 · audio 1.

Work in flight is on branch **`feat/corelib-hardening`**, uncommitted (the hardening pass, see
below). `master` is unchanged since the docs consolidation.

## Last verified gate run

Verified green on `feat/corelib-hardening` with `bun run shared:status` reporting all eight
packages **linked** to `../shared` — deliberately, because the pass depends on shared changes that
are not yet tagged (see "The held release"). CI, which resolves the pinned tags, stays red until
those tags exist.

| Gate | Result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun test` | 186 pass |
| `bun tools/validate.ts --release --strict` | OK, 241 components (G1–G12) |
| `bun tools/audit-3d-placement.ts --release` | 158 ok / 0 errors / 0 warnings |
| `bun tools/audit-components.ts --no-render` | 241 / 0 issues |
| `bun tools/check-datasheet-links.ts` | structural, 180/180 OK |
| `bun tools/pack.ts --version=0.0.0-dev` | builds (full pack) |
| `… --no-step --out=dist/glb-only` | builds (GLB-only core + STEP companion) |
| `../shared` kicad-parsers, kicad-import `bun test` | 51 + 52 pass |

## The hardening pass, in one paragraph

Every component was audited as if it were going into a product: symbol pin order against the
manufacturer datasheet of the stated MPN in the stated package, package against footprint,
datasheet against manufacturer, and sourcing. The per-part record, including what could not be
verified and why, is [docs/audit/2026-09-hardening-findings.md](docs/audit/2026-09-hardening-findings.md).
Defects fixed: SS8050/SS8550 base–emitter swap in TO-92 (per-footprint pin map, SOT-23 variant
added), BAV99 pin names, RP2040 on the wrong QFN-56 exposed-pad variant, DS3231 and PCF8574 on the
narrow SOIC-16 instead of the 7.5 mm body, ATtiny85 on the JEDEC instead of the EIAJ SOIC-8,
ESP32-WROOM-32E flash pins exposed as signals, LM741 identity, 1N4148/1N5819/SS24/SS34 package
mismatches, slotted drills and thermal-pad paste dropped by the importer, and ~40 datasheets that
belonged to another manufacturer. Every function part now carries `parameters`, a verified primary
MPN with LCSC code where stocked, alternates in the same package, and an official datasheet. Seven
gates (G6–G12) enforce all of that from now on; CONTRIBUTING.md explains each.

## The held release

The release is still **deliberately held**, pending an explicit go-ahead. The desktop app bundles a
seventeen-component pack built on 2026-06-02; none of the content grind has reached a user.

The unblock sequence, in order:

1. **Commit the uncommitted `../shared` change** on `main`: `kicad-parsers` parses `(drill oval …)`
   into `drillSlot`; `kicad-import` emits `drillSlotMm`, keeps paste-only sub-pads as
   `role: "paste"`, and counts only numbered pads in `padCount` (a semantic change consumers of
   `InspectFootprintItem.padCount` will see). Tests are in both packages.
2. Cut **four** tags in `shared`: `step-to-glb-v0.1.5`, `kicad-import-v0.2.0` (now also carrying
   step 1), `rendering-core-v0.1.4`, `contracts-v0.3.1`. The commits for all four are already on
   `main`; none of the tags exist.
3. Re-pin `CoreLibrary/package.json` (`kicad-import` → 0.2.0, `step-to-glb` → 0.1.5) and
   `OpenPCB/package.json`. Push. **Confirm CI green.**
4. Only then tag `v0.2.0`, and re-pin the app bundle.

### Signing prerequisites, still outstanding

`release.yml` fails closed, so `v0.2.0` will not build until both of these exist:

```bash
gh secret set OPCLIB_SIGNING_KEY < keys/openpcb-core.priv.pem
gh variable set OPCLIB_KEY_ID --body openpcb-core-2026
```

Then delete the local `.priv.pem`. See [keys/README.md](keys/README.md).

### Release checklist residue

- Verify the signature and `SHA256SUMS` on the published artifacts.
- Bump the app's bundled library via `OpenPCB/scripts/fetch-core-library.ts` and verify the boot
  import in a **packaged** build, not a dev run.
- App smoke test once the pack lands: place an LM324 (four separate op-amps, no
  `OUTPUT_OUTPUT_SHORT`); place SS8050 and check the TO-92 variant lands E/B/C on pads 1/2/3; place
  the barrel jack and confirm the pads have holes; enable the assembly-view preset and confirm
  courtyards render.

## What is still not verified

Recorded here so nobody re-derives it; details and what was tried are in the audit record.

- **Pin order behind a WAF:** the six STM32 LQFP parts (st.com unreachable), AD620, ADUM1201,
  DS1307, DS3231 (analog.com), ULN2803A, the Molex USB-A / micro-B receptacles, the C&K slide
  switch, the Panasonic tactile switch, the TDK buzzer, both Keystone holders, the Phoenix screw
  terminals. Pin counts, packages and KiCad provenance all match; nothing suggests a defect.
- **Bridge rectifier ABS:** neither Diotec nor Diodes numbers the terminals, so which pad is `+`
  rests on KiCad's convention.
- **RJ45 jack LED polarity** (LED1A/LED1K…) and the **Sanyou SRD relay pin map** were derived from
  KiCad symbol wiring, not a numbered manufacturer table.
- **CH340C pin 8** (NC vs an output) is disputed between WCH's page and vendor symbols.
- **AMS1117 `vin_max`** is 15 V (Advanced Monolithic absolute maximum) while the new UMW primary
  specifies 12 V.

Known, accepted exceptions: MT3608's datasheet is hosted by Olimex (Aerosemi publishes none);
ME6211 has no manufacturer PDF (an AP2112K alternate carries one); the DB107 bridge datasheet sits
on the primary entry because MDD's host is not in the G8 table.

## Content backlog, in value order

Target for v1 stays a jellybean set of roughly **250–300 components**. Delivered this round: six
shielded power-inductor packages on the generic inductor, six Hirose FH12 FFC/FPC sizes, VSON-10,
WSON-8 (two bodies), SSOP-20/28 and MSOP-8 with real consumers (TPS63001, TMP1075, W25Q32,
ENC28J60, MCP2200, MCP6002). Still open:

1. **0201, 1812, 2010 passive sizes.**
2. **1.27 mm and 2.00 mm headers.**
3. **Power electronics:** DPAK / D²PAK / TO-247, gate drivers, Kelvin shunts.
4. **QFN and BGA.**
5. **FT232RL and TMP117** were dropped from the DFN/SSOP wave because their KiCad symbols carry no
   pin for datasheet-NC pads and `--strict` cannot express "intentionally unmapped". See the tools
   follow-up below.

Constraint on all of it: every new footprint needs a component that references it, and every new
function part must pass G6–G12 before it lands.

## Wave-2 blockers — still genuinely open

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

## Tools follow-ups

- **`unmappedPads` in manifests:** a way to declare datasheet-NC footprint pads as intentionally
  unmapped, with a reason, so `--strict` stops forcing NC pads onto live pins (blocked FT232RL,
  TMP117; the W25Q32 WSON EP is grounded per its datasheet instead).
- **Provenance refresh:** 12 symbols and 14 components carry a `sourceHash` from an older KiCad
  checkout and no `upstreamCommit`. Re-importing them against the pinned 10.0.4 tree changes only
  the stamps, but do it deliberately and diff the geometry.
- **`topology` vs `type` on power parts:** twelve manifests still emit `topology`; the key is now
  redundant with G6's `type`. Change manifest and content together.
- **`check-datasheet-links` does not walk entry-level datasheets** (`manufacturerParts[].datasheet`).
- **ACS712** uses the plain SOIC-8 land; Allegro recommends widened pads for the current path.

## Data model

**Typed parameter values** — `{value, unit, min, typ, max}` — remain the next data-model step, for
real parametric filtering. They require a `component.schema.json` change plus work in `opclib-pack`
and the app. `parameters` is now populated and vocabulary-checked (G5, G6) on every function part,
so the app can start reading it.

**Sourcing fields do not reach the pack.** `manufacturerParts[]` entries carry `lcsc`,
`jlcpcbAssemblyType`, `package` and `role` in source; `@openpcb/opclib-pack`'s packed-manifest
schema admits only `{manufacturer, mpn}`, so `tools/pack.ts` strips the rest. Relaxing that schema
(and reading `lcsc` into the app's existing `lcscPartNumber` column) is the follow-up that makes the
sourcing data useful in a BOM.

## App-side follow-ups

Tracked here because CoreLibrary work created them, though the work itself is in OpenPCB:

- Render `drillSlotMm` as a slot (today a 1 × 3 mm slot draws as a 1 mm round hole) and treat
  `role: "paste"` pads as paste, not copper (`r3f-eda-canvas` `footprint-render-layer.tsx`).
- Read `manufacturerParts[].lcsc` into `lcscPartNumber` / `supplier`; surface alternates in BOM
  export; show and search `keywords`, `subcategory`, `parameters`.
- Per-unit placement UX — `U1A` / `U1B` plus physical-part grouping for ERC, PCB and BOM.
- The `courtyardPolygon` producer in `board-snapshot.ts`.
- `opclib-importer.ts`: assert there is no render-ref when `transformBaked` is set.

## Deferred decisions

- Ratify the connector sidecars' `scaleMm: {y: -1}` (pin headers, JST XH, IDC, and now Hirose
  FH12) via a contact sheet.
- `shared/step-to-glb`: return a post-bake bounding box and an orientation-mismatch warning so the
  gate can compare against what was actually baked.
- Whether `npn-sot-23-ebc` / `pnp-sot-23-ebc` should stay: they encode a pin order no SOT-23 BJT in
  the library uses; every real SOT-23 BJT here is B-E-C.

## Git

`feat/corelib-hardening` carries the whole pass uncommitted. `../shared` has an uncommitted parser
and importer change on `main` (step 1 of the release sequence). The 2026-07-12 branch
`feat/corelib-npth-pending` is archived as tag `archive/corelib-npth-pending`; `release/v0.1.0-beta`
is a stale, unrelated branch that predates the content grind and is not the vehicle for `v0.2.0`.
