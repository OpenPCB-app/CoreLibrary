# CoreLibrary Expansion — TODO

> **~~Unmerged local branch~~ RESOLVED (2026-07-26):** `feat/corelib-npth-pending` held 2 commits, not
> 1. All 14 content files, the 4 mechanical components and the `allowUnnumberedPads` importer change
> were already on master via the 2026-07-10 NPTH landing; its `mountType: "unknown"` schema change was
> abandoned (master resolves `through_hole`/`smd` via `deriveMountType`, and no footprint uses
> `unknown`). Only `docs/NPTH-SHARED-CHANGES.md` was unique, and it is stale — its shared change
> shipped as `kicad-import-v0.1.2`. Archived as tag `archive/corelib-npth-pending`, branch deleted.

## 2026-07-26 — hardening round (see [CURRENT_STATE.md](CURRENT_STATE.md) for the full record)

Fixed two correctness defects that shipped green, and added the gates that catch them:
**multi-unit pin collisions** (21 symbols; LM324's four op-amp outputs shared one coordinate and
shorted) and **missing courtyard** (0/146 footprints). Plus: 19 seed-imported assets repaired,
`parameters` normalized onto an enforced dictionary, `packageCode` populated, LQFP-64/100/144 +
4 STM32 MCUs (+4 → 231), a GLB-only pack (−62%) with STEP companion, and `audit:3d` +
`audit-components` finally running in CI.

## 2026-07-26 — datasheet round

Curated `datasheet` 13 → 151 (packed coverage 150/227 → 167/231) via pcbparts MCP. Fixed 27 rotten
links plus several wrong-part/wrong-vendor ones; rebuilt `check-datasheet-links.ts` as a structural
gate (the old one had no fetch timeout and hung on st.com). See [CURRENT_STATE.md](CURRENT_STATE.md).

**Datasheet follow-ups:**

- 22 parts with an MPN still have no curated link. Seven need a sourcing decision rather than a
  lookup: AMS1117 (host has no working https), CH340C/G, TP4056, ME6211, XL4015, SS8550 (vendors
  publish HTML only, no official PDF), and ULN2803A (gone from TI's `lit/` entirely). The rest —
  Keystone 1042/3034, Kingbright KCSC02-105, DHT11, Hirose DM3AT, Epson SG-8002 + FC-135, Schurter
  0031.8201, DB107, USB-C receptacle — were cut short by DigiKey's daily quota; just retry.
- Consider a **scheduled** (not per-push) `--network --strict-network` job for link rot. It must
  stay non-blocking for WAF hosts, which is why it is not in `validate.yml`.

**Next:**

1. **Push, in order** — `shared` main → tags (`rendering-core-v0.1.4`, `kicad-import-v0.2.0`,
   `contracts-v0.3.1`) → re-pin `CoreLibrary/package.json` → push CoreLibrary `master`. CI cannot
   resolve the new tags until the shared tags exist. Note `shared` also has unrelated `nav-shell`
   WIP uncommitted and 2 pre-existing unpushed commits on main.
2. **App smoke test** — import the dev pack, place an LM324, confirm four separate op-amps with
   distinct pins and **no** `OUTPUT_OUTPUT_SHORT`; enable the assembly view preset and confirm
   courtyards render.
3. **App follow-ups (out of scope this round):** per-unit placement UX (`U1A`/`U1B` + physical-part
   grouping for ERC/PCB/BOM — the compose fix makes the 21 parts correct and usable, not
   full-EDA); the `courtyardPolygon` producer in `board-snapshot.ts`, now that footprints carry
   courtyard; and the stale data-model section in `OpenPCB/src/modules/library/AGENTS.md`.
4. **Breadth** — QFN/DFN/SON/BGA, 0201/1812/2010, FFC/FPC, 1.27/2.00 mm headers. Every new footprint
   needs a component: `validate.ts` flags unreferenced footprints and `--strict` makes that fatal.
5. **Typed parameter values** (`{value, unit, min, typ, max}`) for real parametric filtering — needs
   a `component.schema.json` change (it is `additionalProperties: false`) plus opclib-pack and app work.
6. **P9 release** — tag `vX.Y.Z`; `release.yml` now publishes the full pack, the GLB-only pack and
   the STEP companion.

Roadmap to the v1 jellybean set (~250–300 components). See [CURRENT_STATE.md](CURRENT_STATE.md) for what's done and [HANDOFF.md](HANDOFF.md) for the per-phase workflow + gotchas.

**Source docs:** spec `../Corelibrary expansion plan.md` (§7.4 master parts table, Appendix D checklist); corrected plan `~/.claude/plans/act-as-senior-software-snazzy-lantern.md`.

**Invariant for every content phase:** branch `feat/corelib-<phase>` → author `tools/manifests/<phase>.json` (symdir paths; **every footprint has a STEP**) → `import --strict` → `validate --release --strict` → `audit:3d` → `bun test` → `pack` spot-check → PR. CI runs `--release --strict`, so no-STEP parts go to Wave 2.

## 2026-07-10 update — NPTH unblocked, Wave C landed → 227 (plan: `~/.claude-personal/plans/act-as-pcb-engineer-drifting-jellyfish.md`)

**Phase 0 cross-repo DONE:** shared `kicad-import` 0.1.2 `allowUnnumberedPads` (NPTH relax); shared `opclib-pack` 0.3.0 = `maxEntries:8192` committed + component `subcategory`/`datasheet`/`keywords` (P7 schema); OpenPCB app wired (migration 0010, importer maps metadata + MPN, DetailsCard shows real datasheet URL); pins bumped both consumers. **Local tags `kicad-import-v0.1.2` / `opclib-pack-v0.3.0` exist — push shared main + tags BEFORE pushing consumers** (their `package.json` pins reference the tags).
**Orientation gate recalibrated to 0 warnings:** up-axis vs min horizontal axis (long pin rows), body-behind-pads within 0.6×depth passes, thin-standing coverage waiver; `orientationHint` + `belowBoardBudgetMm` sidecar overrides (DHT11 posture, PS1240 uncut leads, 18650 locating posts); manifests may declare model transforms (y-mirror survives `--allow-overwrite`); manifest `existing:true` footprint refs (share package assets without uuid churn).
**Content (+58 → 227, all gates green):** `w1-mechanical` + `w2-mechanical-tht` (mounting holes M2–M4 + plated, fiducials, screw terminals, barrel jack, 3296W trimmer, PS1240 buzzer→new `audio`, DHT11); `w3-kicad-breadth` (headers 1x05–2x20 incl. RPi HAT, NTC, MOV, film cap, SIP-9 R-network, IR LED, phototransistor, 7-seg, slide switch); `wc-general-ee` (USB-C 16P no3d, ABS+DIP-4 bridges, SRD+G5V-1 relays→new `relay`, AP63203/XL4015 bucks, TP4056/MCP73831 chargers, CR2032/18650 holders→new `battery`, INA219/ACS712, SG-8002 osc no3d, 32.768kHz crystal, microSD DM3AT, 5×20 fuse holder, DRV8833, W5500, RJ45 magjack, LM386, PAM8403, LM4040, AD620, ADuM1201, A1301, ESP32-C3/S3, ATmega32U4, STM32G030F6).
**P7 metadata DONE:** `manufacturerParts` on 168 function parts (package-matched MPNs); packed opclib carries 150/227 datasheet URLs (curated ∪ KiCad fallback). Cleanups: `ams1117-3v3` ic→power (alias remap), subcategories normalized (opamp, capacitor-electrolytic/-tantalum, regulator-buck/-boost, reference, mosfet-n/p, crystal/crystal-gnd).

**Next:**
1. Push: shared main+tags → CoreLibrary master → OpenPCB (order matters, see above).
2. Close 227 → 250–300: remaining Wave C external-sourced (MP1584, MPU-6050 STEP, HC-SR04, DHT22, ESP-12F, EC11 encoder, JST-XH STEP, 74HC125) — needs external/authored STEPs per sourcing policy.
3. App smoke test: import dev pack, verify metadata columns + alias remap + no3d parts render.
4. P9: tag v1 release once the target is met (release.yml signs + publishes).

## 2026-07-07 update — content-grind round resumed (plan: `~/.claude/plans/do-thorough-analysis-of-cozy-shamir.md`)

**Decisions:** KiCad-vendored parts only this round → ~180–210 (external Wave C parked); **release held** until v1; MPN sourcing deferred. Reconstructed target list → **[TARGETS.md](TARGETS.md)** (master spec `Corelibrary expansion plan.md` is lost).

**Phase 0 DONE:** baseline re-verified green (125); `CURRENT_STATE.md`/`.gitignore` refreshed; **`../references/kicad-libs` restored** (symbols+footprints full @10.0.4; packages3D **blobless+sparse** — `sparse-checkout add <Lib>.3dshapes` per wave; disk was 98% full). Provenance: 10.0.4 tag = byte-identical to pinned `c7e226a49` (footprint+STEP sha256 exact match) → keep the stamp, no importer change.

**Corrections to Wave-2 below (verified against the KiCad 10.0.4 clone — older checkout was incomplete):** **PC817** (`Isolator`), **screw terminals** (`TerminalBlock_*.pretty`), **MountingHole** (symbol+fp) ARE present → not external. Orientation-gate already calibrated (B1) — TO-220 family (L7805/LM317/LM2596-adj/IRF540N/IRLZ44N) already shipped; the 8 audit:3d warnings are the known benign false-positives.

**Phase 2 Wave A+B DONE (+44 → 169, branch `feat/corelib-wave-ab`, 11 commits, all gates green).** Added: TO-92 discretes, diodes (1N400x/SSxx/BAT54C), op-amps (LM741/TL08x/NE5534), LM35+PC817, TO-220/TO-126 power discretes, 78xx/79xx regs, CD4000, L293D/ULN2803A, CAN/RTC/ADC/DAC, 74HC244/245. New footprints DIP-4/TO-126-3/DIP-18/SOIC-18W/SOIC-20W (DIP y-flips applied). Generators: `scratchpad/genman.py` + `runbatch.sh` (reuse-churn auto-restore).

**Next (stopped at NPTH boundary):**
1. **Cross-repo NPTH relax** (approved) — `../shared` `@openpcb/kicad-import` `validateFootprintPads` via `shared:link`, unblocks **MountingHole/Fiducial (`no3d`), potentiometer, DC barrel jack, screw terminals** (`w1-mechanical.json` waiting).
2. Remaining KiCad-only content → v1 approach: header-size variants (1x05/07/16, 2x04/06/10), passive footprint variants (HandSolder R / film cap / MOV / R-network — extend existing R/C ids), more sensors/opto (phototransistor, IR LED, NTC, 7-seg).
3. Wave C external-sourced (parked) to close ~180 → 250–300.
4. Merge `feat/corelib-wave-ab` → master (never auto-pushed).

## 2026-06-26 update — 125-component milestone reached (committed to master)

**80 → 125 components**, all gates green, committed (`5df616c` foundations+W1, `dbc6af6` W2-clean→105, `314948b` W1/W2→125). Added since 86: opamps/comparators/timers (TL072/TL074/MCP6002/MCP6004/LM339/RC4558/NE5532/TLC555/LM386), LDOs/protection (AP2112K/ME6211/TLV1117/DW01A), interface/logic (MAX3232/PCF8574/ULN2003A/74HC02/74HC74/74HC86/74HC138/74HC165/CD4051), connectors (pin-header 1x10/1x12/2x08, JST-XH 2/3/4, IDC 2x05), SOT-23 BJTs (BC817/807/847/857/MMBT2222A/BSS84), diodes (SS34/1N5819/1N5408), ceramic resonator.

**Method:** reuse existing `package.*`/`diode.*` footprints via `--allow-overwrite` (SOIC/SOT clean; DIP/connectors need `scaleMm.y:-1` re-flip — patched post-import). Generators in `scratchpad/gen-w2a.py`. **Don't duplicate parametric R/C/L/crystal** — adding L_0805/Crystal_3215 again triggers duplicate-name failures (they're already footprint variants of `inductor`/`crystal`).

**⚠ NEW cross-repo blocker:** at 125 components the packed `.opclib` = **539 zip entries > the shared reader's `maxEntries:500` cap** → `@openpcb/opclib-pack` would reject the library (and so would the app at boot). Raised to **8192** in the shared SOURCE (`shared/packages/opclib-pack/src/validate/constants.ts`) + local `node_modules` to pass `pack-shared-compat`; **the shared repo still needs its own commit + version bump + app re-pin** (Phase R). Byte limits (50 MB / 200 MB) remain the real zip-bomb guard.

**Still deferred:** MountingHole/Fiducial (need `@openpcb/kicad-import` `validateFootprintPads` NPTH-pad relaxation — shared change); USB-C (complex non-identity pinMap); EC11/relay/buzzer/PC817; W3 external-sourced; R release.

## 2026-06-25 session update — Foundations + W1 started → 86 components

**Decisions (maintainer):** full v1 grind (~250–300) · STEP gate relaxed (`no3d` for asm-only electrical too) · external+generated assets allowed under tagged provenance · datasheets data-only until release. Full record: `~/.claude/plans/act-as-senior-software-refactored-cray.md`.

**Done this session (all gates green: validate --release --strict 86 OK, audit:3d 83 ok/0 err, bun test 41/41, typecheck clean):**

- **Phase F tooling:** B1 orientation-gate calibration (`THT_LEAD_BELOW_VERTICAL=12` + body-behind-pads xy downgrade; +3 tests — **validated on real TO-220**, imports as a warning not error); B3 `no3d` flag end-to-end (schema+importer+validator, with a coverage note); provenance carve-out (`openpcb-generated`/`manufacturer` sources in `validate.ts`); new `tools/gen-pinmap.ts` (committed replacement for the lost scratchpad generators). Plus: `isElectricalPadNumber` (empty NPTH pads skip strict pad-coverage) and a `symbol.pinless` manifest flag (0-pin graphic symbols).
- **W1 content (+6):** `w1-power-tht.json` = L7805, LM317, LM2596-adj, IRLZ44N, IRF540N; `w1-discrete.json` = WS2812B.

**Blocked / deferred:** **MountingHole + Fiducial** (`w1-mechanical.json` authored, ready) — blocked by `@openpcb/kicad-import` `validateFootprintPads` rejecting the unnumbered NPTH pad; needs a **shared-package change** (bundle with Phase-R cross-repo). B2 named-`MP` pads (barrel jack/pot) still deferred.

**Next (priority):** 1) W1 no3d/reuse ICs (TL072/LM339/MCP6002 reuse SOIC/DIP via `--allow-overwrite`+reflip; TP4056/CP2102 as `no3d`). 2) W1 connectors (USB-C/IDC/JST-XH/screw-term — `scaleMm.y:-1` flips + per-variant STEP). 3) W2 demand categories (power inductor, AP2112K, buck IC, PC817, ULN2003, EC11, relay, buzzer, 32.768 kHz xtal). 4) Shared `kicad-import` relax → import mechanical. 5) W3 external sourcing (MP1584/MPU-6050/ESP-12F/microSD/74HC125/DHT22/HC-SR04). 6) R release (opclib-pack 0.3.0 + app wiring + sign/tag). Per-part recipe in the plan file.

### Earlier (pre-session) suggested steps

1. **(optional) `git push origin master`** (now 5 commits ahead of `origin` + this session's uncommitted work).
2. ~~Calibrate the 3D orientation gate~~ — **DONE** (B1).
3. ~~Build the no-STEP mechanical path~~ — `no3d` **DONE**; MountingHole/Fiducial blocked on the shared `validateFootprintPads` change (see above).
4. **More content** from _Wave 2_ (HandSolder/film/networks, RGB, bridge rectifier, externally-sourced MP1584/MP2307/MPU-6050/74HC125/USB-C/IDC).
5. **P7 cross-repo** (opclib-pack schema bump + app wiring + datasheet URL curation), then **P9 release**.

## Done

- [x] **P0** Foundations (schema fields, importer passthrough + KiCad-Datasheet capture, validator checks, fetch-kicad-libs, check-datasheet-links, PARAMETERS.md, manifest TEMPLATE, CI, docs).
- [x] **P0.9** IC convention migration: `74hc00`(+DIP-14), `ne555`(+DIP-8), `ams1117-3v3`, `lm358` metadata; aliases for remap.
- [x] **P1** Passives: ferrite-bead, capacitor-electrolytic, capacitor-tantalum, fuse-resettable, crystal, crystal-gnd.
- [x] **P2** Discrete semis (`tools/manifests/p2-discrete.json`, branch `feat/corelib-p2`, +17 comp → 40 total, gates green): diodes 1N4148/1N4007(+M7 SMA)/SS14/BAV99/BZX84/TVS/USBLC6-2SC6, LED-THT (3/5mm), BJT MMBT3904/3906 + SS8050/8550, FET 2N7002/AO3400/AO3401/BSS138/Si2302. (M7→1N4007 sym, Si2302→generic Q_NMOS_GSD.)
- [x] **P3** Power/analog (`tools/manifests/p3-power.json`, +6 comp → 46 total, gates green): AMS1117-5.0/ADJ (SOT-223), MT3608 (SOT-23-6), TL431 (SOT-23) → `power`; LM324 (SOIC-14/DIP-14), LM393 (SOIC-8/DIP-8) → `ic`.
  - **Deferred (3D orientation-gate calibration needed for vertical TO-220 — long leads >6mm below board + body-behind-pads offset trip the hard gate):** LM7805, LM317, LM2596. Re-import them once `orientation-gate.ts` is calibrated for vertical-THT.
- [x] **P4** Digital ICs (`tools/manifests/p4-digital.json`, +16 comp → 62 total, gates green; pinMaps generated identity-from-pads incl. RP2040 QFN-56 EP + ESP32 39-pad): ATmega328P (DIP-28 + TQFP-32), ATtiny85, STM32F103C8 (LQFP-48), RP2040 (QFN-56), ESP32-WROOM-32, 74HC595/04/14, 24LC256, W25Q32, CH340G/C, MAX485, SP3485, TXB0108. DIP models re-flipped (`scaleMm.y:-1`). **Wave-2: 74HC125, ESP-12F.**
- [x] **P5** Connectors/electromech/mech (`tools/manifests/p5-connectors.json`, +15 comp → 77 total, gates green): USB-A, USB Micro-B, JST-PH 1x02/03/04, pin headers 1x03/04/06/08 + 2x05, pin sockets 1x04 + 2x05, tactile switch THT/SMD, TestPoint. Connector/USB/switch 3D Y-flipped; USB Micro-B z-seat offset.
  - **Deferred:** DC barrel jack (only STEP-backed fp has an unnumbered pad — strict-reject), buzzer (TDK PS1240 STEP bakes 15mm below board — needs rotation, not flip), **MountingHole + Fiducial** (the no-STEP mechanical code-path — see below), USB-C 2.0 + IDC 2x05 (no STEP). Power symbols dropped per decision.
- [x] **P6** Sensors (`tools/manifests/p6-sensors.json`, +3 comp → 80 total, gates green): BME280 (LGA-8), DS18B20 (TO-92, reuses shared `package.to-92-inline`), LDR (`R_Photo`).
  - **Deferred:** DHT11 (body 8mm below board — same long-lead-THT gate issue as TO-220), MPU-6050/HC-SR04/DHT22 (Wave-2 below).
- **Full sweep result: 23 → 80 components**, all gates green (`validate --release --strict` OK, `audit:3d` 81 ok / 0 errors / 3 warnings, `bun test` 38 pass, pack builds). Manifests + the P4/P5 generators (`scratchpad/gen-p4.ts`, `gen-p5.ts`) capture the build.

### Deferred code path — no-STEP mechanical parts (gates MountingHole + Fiducial; decision #1 wanted them kept)

The strict importer + validator both require a STEP-backed model per footprint. MountingHole/Fiducial have a footprint but legitimately no 3D model. To ship them, add a narrow exemption (e.g. a `no3d: true` component flag, default false):

- **importer** (`tools/import-kicad-batch.ts` ~L880/898-904/929): make `manifestFootprint.model` optional — `models3d: []`, skip the `stepSource`/`validateStrictModelRef`/model-write when `no3d`.
- **validator** (`tools/validate.ts` L352/358/447): skip the "footprint requires exactly one STEP-backed model" checks when the owning component is `no3d`.
- **schema** (`schemas/component.schema.json`): add `no3d` boolean.
  Keep the exemption tight so the STEP gate stays hard for every electrical part.

## Next — content phases (KiCad 10 lib names; verify each symbol/footprint/STEP before adding)

### P2 — Discrete semiconductors (~45) · categories `diode`, `transistor`, `opto`

- [ ] Diodes: 1N4148 (`Device:D` → `Diode_SMD`:SOD-123/323, `Diode_THT`:DO-35), 1N4007/M7 (SMA/DO-41), SS14 Schottky (`D_Schottky`:SMA), **BAV99** dual (`D_Dual_Series_ACK` → `Package_TO_SOT_SMD`:SOT-23 — verify pin order), BZX84 Zener (`D_Zener`), TVS (`D_TVS`:SMA/SMB), USBLC6-2SC6 (SOT-23-6).
- [ ] LEDs: chip (`LED`:`LED_SMD` 0603/0805/1206), THT (`LED_THT` 3mm/5mm).
- [ ] BJT/MOSFET: **symbols are in `Transistor_BJT`/`Transistor_FET`, NOT `Device`** — MMBT3904/3906 (`Q_NPN_BCE`/`Q_PNP_BCE` SOT-23), SS8050/8550, TO-92 (`Q_*_CBE`), 2N7002/AO3400/SI2302 (`Q_NMOS_GSD`), AO3401 (`Q_PMOS_GSD`), BSS138.

### P3 — Power & Analog ICs (~35) · **new `power` folder** + `ic`

- [ ] Regulators → `power`: AMS1117-5.0/ADJ, LM7805 (`Regulator_Linear` TO-220/TO-252), LM317, MP1584/MP2307 (`Regulator_Switching` SOIC-8-EP), LM2596 (TO-263-5), MT3608 (SOT-23-6), TL431 (`Reference_Voltage`).
- [ ] Op-amps/comparators/timer → `ic` (+`subcategory`): LM324 (`Amplifier_Operational` SOIC-14/DIP-14), LM393 (`Comparator`). (LM358, NE555 already done.)
- [ ] Populate `parameters` (vout/iout/gbw…) + `keywords`; capture `datasheetSource`.

### P4 — Digital: MCUs / logic / memory / interface (~45) · `ic`

- [ ] MCUs: ATmega328P (`MCU_Microchip_ATmega` TQFP-32/DIP-28), ATtiny85, STM32F103C8 (`MCU_ST_STM32F1` LQFP-48), RP2040 (`MCU_RaspberryPi` QFN-56). Rely on importer pin↔pad check; verify symbol exists in the pinned checkout.
- [ ] Modules: ESP32-WROOM-32, ESP-12F (`RF_Module` → `RF_Module` footprints, castellated).
- [ ] Logic/mem/interface: 74HC595/04/14/125, 24Cxx EEPROM, W25Q32 flash, CH340G/C (`Interface_USB`), MAX485/SP3485 (`Interface_UART`), TXB0108 (`Interface_Expansion`).

### P5 — Connectors / electromechanical / mechanical / power symbols (~55)

- [ ] 2.54mm headers/sockets 1×N & 2×N (`Connector_Generic` — generate sizes in manifest), USB-A/Micro-B/Type-C(2.0), JST-XH/PH, DC barrel jack, IDC 2×5, tactile switches (`Switch:SW_Push`), buzzer.
- [ ] Mechanical: MountingHole M2/M2.5/M3, TestPoint, Fiducial, solder jumper.
- [ ] **Power symbols** (GND/+3V3/+5V/+12V/VBUS/VCC/PWR_FLAG) — schematic-only; confirm importer/validator handle footprint-less + 0-pin parts (may need a small `power_symbol` code path).

### P6 — Jellybean sensors (~20) · **new `sensor` folder**

- [ ] MPU-6050 (`Sensor_Motion` QFN-24), BME280 (`Sensor` LGA-8), DS18B20 (`Sensor_Temperature` TO-92/SOIC-8), DHT11 (`Sensor` SIP-4), HC-SR04 (4-pin header), LDR (`Device:R_Photo`).

### P7 — Datasheets (link-only) + cross-repo wiring

- [ ] Curate representative `datasheet` URLs for function-parts (seed from captured `datasheetSource`); keep generics `null`.
- [ ] **Cross-repo (shared + app):** bump `@openpcb/opclib-pack` schema to carry `datasheet`/`keywords`/`subcategory`; drizzle migration on `OpenPCB` `components` table; `opclib-importer.ts` persist + `ComponentDetailPage.tsx` feed `DetailsCard` the real URL (currently `datasheetUrl={null}`).

### P8 — 3D release-grade

- Mostly done (bounds/orientation infra exists; each phase ships STEP). Final pass: confirm `validate --release` + `audit:3d` green across the full set; spot-check sample categories in `dist/audit-3d-placement/report.html`.

### P9 — Release v1.0

- [ ] `pack --version=X.Y.Z` with `OPCLIB_SIGNING_KEY`; verify signature + `SHA256SUMS`; tag `vX.Y.Z` → `release.yml` publishes.
- [ ] Bump app's bundled lib (`OpenPCB/scripts/fetch-core-library.ts`); verify boot import in a packaged build.
- [ ] Update README/CONTRIBUTING coverage table; route `component_request` issue template to manifest authoring.

## Wave 2 (verified blockers — missing from vendored KiCad 10 libs)

- [ ] Potentiometer (Alps/trim footprints lack STEP + carry an `MP` mounting pad — needs pinMap handling for the non-electrical pad).
- [ ] Screw terminals (`Connector_TerminalBlock` .pretty absent).
- [ ] microSD (`Connector_Card` symbols absent).
- [ ] DHT22 (only DHT11 present).
- [ ] **MP1584, MP2307** (P3 switching regulators — no symbol in KiCad 10 stock libs).
- [ ] **74HC125** (P4 — only `74LS125`/`74LVC125`/`74AHCT125` in `74xx`, no HC variant), **ESP-12F footprint** (P4 — only ESP-12E present), **Solder Jumper** (P5 — `Jumper.pretty` has footprints but no schematic symbol), **JST-XH 3D** (P5 — footprints present, no STEP in `Connector_JST.3dshapes`), **MPU-6050** (P6 — `InvenSense_QFN-24` has no STEP), **HC-SR04** (P6 — no dedicated symbol; generic 4-pin header only).
- [ ] **DC barrel jack** (P5 — only STEP-backed footprint `BarrelJack_CUI_PJ-063AH_Horizontal` has an unnumbered pad the strict importer rejects; needs the same non-electrical-pad handling as the potentiometer MP pad).
- [ ] **Buzzer** (P5 — `Buzzer_TDK_PS1240P02BT` STEP bakes the body 15 mm BELOW the board; needs a rotation fix verified visually, not a simple flip) and **DHT11** (P6 — body 8 mm below board; same long-lead-THT class as the TO-220 item below).
- [ ] **Vertical TO-220 / long-lead-THT 3D-gate calibration** (unblocks LM7805/LM317/LM2596 from P3 + DHT11 from P6): `tools/orientation-gate.ts` hard-errors on long leads (>6 mm below board) and body-behind-pads Y-offset, which are physically correct for vertical/long-lead THT. Calibrate (per-posture lead budget + skip/relax xy-center for `vertical` THT) so these import gate-green without falsifying geometry.
- [ ] Incremental: `_HandSolder` resistor variants, more inductor sizes, film caps, resistor networks, RGB/WS2812 LEDs, bridge rectifier, power MOSFETs (TO-220/263).

## Carried over — 3D / symbol hardening (cross-repo, not blocking content)

From the prior effort (`~/.claude/plans/do-thorough-analysis-of-fizzy-clover.md`). CoreLibrary-side gate + bounds + symbol fixes are **done**; these remain:

- [ ] Decide on the 4 connector sidecars' `scaleMm:{y:-1}` (ratify orientation via contact sheet; consistency with DIP fix).
- [ ] `shared/step-to-glb`: worker+node return post-bake bbox + orientation-mismatch warning; per-package release so the app consumes parser/import/rendering fixes.
- [ ] `OpenPCB`: `opclib-importer.ts` assert no render-ref when `transformBaked`; `three-d/transform-helpers.ts` back-layer + ordering unit tests; in-app verify mirrored-symbol anchor + 3D placement.
