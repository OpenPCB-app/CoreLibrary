# CoreLibrary — Current State (2026-07-28)

## 2026-07-28 — CI had been red for two months; the tree only looked green locally

**Every gate has passed locally since May while CI failed on every single run.** The last green
CI run is `26517250902`, 2026-05-27 — the same day `v0.1.0-beta.1` shipped. **46 commits have
landed on a red master since**, and the two beta packs the desktop app ships (17 components,
built 2026-06-02) predate all of it. The 125 → 231 content grind has never reached a user.

**Why nobody noticed.** `npm run shared:link` symlinks all 8 `@openpcb/*` packages to the sibling
working copy, and it had been left on. Local runs therefore tested unreleased `shared` code, while
CI installs the pinned git tags. `shared:status` is the only way to tell — and `shared:link`
itself is unreliable, printing "✔ All 8" unconditionally. **Run `bun run shared:status` before
trusting a green local gate run.**

### Root cause: STEP→GLB leaked one WASM runtime per file

`convertStepToGlbNode` called `initOcctImportJs()` on every invocation, standing up a fresh
Emscripten module with its own heap and never releasing it. Converting a directory therefore
leaked one OCCT runtime per model. Past roughly 120 conversions the process cannot instantiate
another, and embind starts returning null function pointers:

```
RuntimeError: access to a null reference (evaluating 'invoker(fn,arg0Wired,arg1Wired)')
```

It reads like corrupt geometry — and it lands on whichever file happens to be next, not on a
faulty one. At 36 models (May) the leak fit in a runner. At 139 it does not, while a dev machine
has enough headroom to finish either way.

Fixed in `shared` by memoising the module (`step-to-glb` 0.1.5). `ReadStepFile` is a synchronous
WASM call, so one shared instance is safe for sequential and concurrent callers alike — no `await`
splits a conversion. **Packing 139 models: 36s → 16s, and peak memory no longer scales with the
model count.** Output is unchanged: the manifest minus `integrity` hashes identically before and
after (`integrity.packageSha256` differs between *any* two runs — it covers `library.generatedAt`).

Two wrong diagnoses on the way, both killed by evidence: it is not concurrency-driven OOM
(bounding to 4 changed nothing), and it is not one bad STEP file (the first pack in a job
succeeded on the very input the second died on — same input, different outcome). The bounded
concurrency and the raised test budgets below are kept as genuine improvements, but neither was
the fix.

### Also repaired this round

| Defect | Detail |
|---|---|
| **Signing could never run** | `release.yml` gated the key-restore step on `if: env.OPCLIB_SIGNING_KEY != ''`. A step cannot read its own `env:` block in its own `if:`, and the `secrets` context is unavailable there — so the condition was always false and both pack steps silently took their unsigned branch. Signing material now lives in job-level `env` and a missing key/keyId **fails the job**. |
| **No key chain existed** | No `OPCLIB_SIGNING_KEY` secret, no `OPCLIB_KEY_ID` variable, no private key anywhere. The app trusted `resources/keys/test-2026.pub` (`trusted-keys.ts` derives the keyId from the filename) while this repo published its public half as `openpcb-core.pub` — the two could never line up. Minted `openpcb-core-2026`; `keys/*.priv.pem` is now gitignored. |
| **Release path weaker than PR path** | `release.yml` ran neither the 3D orientation gate, the component audit, nor the datasheet check. All three now run, and both published packs are verified — including the Ed25519 signature against the committed `keys/openpcb-core.pub`, so a CI key that drifts from the published public key fails before release rather than on every user's install. |
| **`packageCode.code` dropped** | `kicad-import`'s `normalizeFootprint` resolved `pkg.code` but forwarded only `imperial`/`metric`. 21 footprints carry a populated `package.code` today only because the hardening round ran through `shared:link`; tagging `kicad-import` v0.2.0 from committed HEAD would have silently regressed them. |
| **Pack test budgets** | The four `pack-shared-compat` tests each drive a full pack, so their cost scales with `3d/`, not with what they assert. The 120s/240s budgets were sized at ~36 models. Now one `PACK_TEST_TIMEOUT_MS` of 600s. |

`OPCLIB_PACK_VERBOSE` traces each conversion to stderr (set in `validate.yml`): a WASM abort kills
the process outright and cannot be caught, so the last traced model is the only clue to where it
died.

### Held — no tags cut

Tagging and the release are **deliberately deferred**. When resumed, the batch is four tags, not
three: `step-to-glb-v0.1.5`, `kicad-import-v0.2.0`, `rendering-core-v0.1.4`, `contracts-v0.3.1` →
re-pin `CoreLibrary` (kicad-import 0.2.0, step-to-glb 0.1.5) and `OpenPCB` → **confirm CI green**
→ only then `v0.2.0`. Three CI failures remain and all three clear with that re-pin: two importer
tests fail because the pinned `kicad-import v0.1.2` discards the courtyard geometry G3 now
requires, and the pack test fails because the pinned `step-to-glb v0.1.4` lacks the module reuse.

`release.yml` now fails closed, so `v0.2.0` will not build until
`gh secret set OPCLIB_SIGNING_KEY < keys/openpcb-core.priv.pem` and
`gh variable set OPCLIB_KEY_ID --body openpcb-core-2026`. Verified locally: a signed
231-component pack verifies under `openpcb-core-2026` through both this repo's committed key and
the app's trust store, and fails under the retired placeholder key.

## 2026-07-26 — datasheet round (curated links, link-rot sweep, structural gate)

Sourced official manufacturer datasheets for every non-generic part via the pcbparts MCP
(DigiKey's `datasheet_url` is the manufacturer's own URL; Mouser serves `mouser.com` mirrors and
the JLC DB carries no datasheet field at all), then swept the links already in the tree.

**Curated `datasheet` 13 → 151.** Packed coverage 150/227 → **167/231** (151 curated + 16 still
resolving through the `datasheetSource` fallback).

**The existing links were in worse shape than the count suggested.** Probing all 154 found only 92
live PDFs. 27 were genuinely rotten — `datasheets.maximintegrated.com` (5, retired to analog.com),
`intersil.com` (2, now Renesas HTML), six ST `/internet/com/` + `/content/ccc/` legacy paths,
`lcsc.com` product pages (3), plus `wizwiki.net`, `icbase.com`, `datasheet5.com`, `xlsemi.net`,
`akizukidenshi.com`, `hirose.com`, `kingbright.com`, a `usb.org` **zip**, and an Epson
`doc_check.php` HTML gate. Several more pointed at the **wrong part or vendor**:
`transistor.2n3904` linked 2N3903; `mmbt3904`/`mmbt3906` linked the SOT-223 PZT parts; `lm339`
(TI) pointed at st.com; `cd4013` (TI) at onsemi. Microchip's legacy `DeviceDoc` names have been
renamed upstream, so the ATmega328P and MCP600x links were dead too.

**Reachability cannot be a CI gate.** The other 35 "failures" are live URLs behind vendor WAFs:
st.com and analog.com time out entirely from CLI/CI, and onsemi, microchip, tdk, irf,
phoenixcontact and littelfuse answer 403 to anything that is not a real browser. DigiKey
independently confirmed the captured URL was already correct for AD620, ADuM1201, PCF8574 and the
onsemi 2N-series — they simply cannot be probed. `check-datasheet-links.ts` was therefore rebuilt:

| | before | after |
| --- | --- | --- |
| default check | HTTP 200 + PDF content-type | structural: https, direct-PDF shape, no mirror/dead host |
| network I/O in CI | yes, serial | none (`--network` is opt-in, concurrent, 15 s timeout) |
| timeout | **none — hung forever on st.com** | 15 s per URL |
| WAF 403/timeout | hard failure | reported `blocked`, never fatal |

The old gate had no fetch timeout at all: with only 13 links it already hung indefinitely on
st.com, so the CI step could never have completed once ST links landed.

**Deliberately left uncurated (22 parts with an MPN).** `advanced-monolithic.com` (AMS1117 ×3)
serves no working https. WCH (CH340C/G), TP4056, ME6211, XL4015 and SS8550 publish no stable
official PDF — only HTML pages or distributor mirrors, and a mirror is not a datasheet. TI no
longer hosts a ULN2803A document under any `lit/` path. The rest (Keystone holders, Kingbright
seven-segment, Aosong DHT11, Hirose DM3AT, Epson SG-8002/FC-135, Schurter fuseholder, DB107,
USB-C receptacle) need a lookup DigiKey's daily quota cut short. Their `datasheetSource`
provenance is untouched, so the pack still falls back to it where one exists.


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
| Datasheet links      | `bun tools/check-datasheet-links.ts`           | structural, 151/151 OK         |
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
