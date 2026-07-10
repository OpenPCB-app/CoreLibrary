# CoreLibrary — Current State (2026-07-10)

Snapshot at **227 components** on **`master`** — verified green (typecheck · `bun test` 47 pass · `validate --release --strict` 227 OK · `audit:3d` 136 ok / 0 errors / 0 warnings · pack builds, opclib carries 168 MPN + 150 datasheet URLs). For the roadmap + deferrals see [TODO.md](TODO.md); for how to continue see [HANDOFF.md](HANDOFF.md). **Active roadmap:** close 227 → 250–300 via external-sourced Wave C remainder, then P9 v1 release; plan at `~/.claude-personal/plans/act-as-pcb-engineer-drifting-jellyfish.md`.

**2026-07-10 (+58 → 227):** NPTH boundary crossed (shared kicad-import 0.1.2 `allowUnnumberedPads`) — mounting holes M2–M4 + plated, fiducials, screw terminals, barrel jack, trimmer, buzzer (new `audio`), DHT11. KiCad breadth: headers 1x05–2x20 (RPi HAT), NTC, MOV, film cap, SIP-9 network, IR LED, phototransistor, 7-seg, slide switch. General-EE Wave C: USB-C 16P (no3d), bridges, relays (new `relay`), AP63203/XL4015 bucks, TP4056/MCP73831 chargers, battery holders (new `battery`), INA219/ACS712, SG-8002 osc (no3d), 32.768 kHz crystal, microSD, fuse holder, DRV8833, W5500, RJ45 magjack, LM386, PAM8403, LM4040, AD620, ADuM1201, A1301, ESP32-C3/S3, ATmega32U4, STM32G030F6. Orientation gate recalibrated (0 warnings); `orientationHint`/`belowBoardBudgetMm`/manifest transforms/`existing:true` refs added; opclib-pack 0.3.0 metadata (subcategory/datasheet/keywords) wired through pack → app; MPN backfill on 168 function parts; `ams1117-3v3` moved ic→power (alias remap); subcategories normalized.

**Wave A+B (2026-07-07, +44 → 169):** TO-92 discretes (BC547/BC557/2N3904/2N3906/2N7000); diodes (1N4001/1N4004/SS16/SS24/SS26/BAT54C); op-amps (LM741/TL081/TL082/TL084/NE5534); LM35 + PC817; power discretes (TIP120/122/41C/42C, IRF3205, BD139/140); 78xx/79xx regs (L7812/09/15/7905/12); CD4000 (4011/4013/4017/4066); L293D + ULN2803A; CAN/RTC/ADC/DAC (MCP2515/2551, DS1307/DS3231, MCP3008/4725); 74HC244/245. New footprints: DIP-4, TO-126-3, DIP-18, SOIC-18W, SOIC-20W (DIP y-flips applied). **Stopped at NPTH boundary** — MountingHole/Fiducial/pot/barrel-jack/screw-terminals need the cross-repo `@openpcb/kicad-import` `validateFootprintPads` change (next step).

## Inventory — 227 components / 223 symbols / 146 footprints / 136 3D (STEP-backed; 10 footprints no3d) — was 169

Per-category (2026-07-10): ic 69 · connector 36 · transistor 32 · power 22 · diode 20 · passive 13 · mechanical 9 · opto 7 · sensor 6 · crystal 5 · switch 3 · relay 2 · battery 2 · audio 1. Older 169-snapshot table below.

P0/P0.9/P1 = 23; P2–P6 sweep +57 → 80; W1/W2 waves +45 → 125 (manifests `tools/manifests/p{2..6}-*.json`, `w1-*.json`, `w2-*.json`; high-pin pinMaps via `tools/gen-pinmap.ts`).

| Category (folder) | N   | Representative parts                                                                                                          |
| ----------------- | --- | --------------------------------------------------------------------------------------------------------------------------- |
| `ic`              | 40  | MCUs (ATmega328P ×2, ATtiny85, STM32F103C8, RP2040); op-amps (TL072/074, MCP6002/6004, NE5532, RC4558, LM324/358); comparators (LM339/393); logic (74HC00/02/04/14/74/86/138/165/595, CD4051, PCF8574); interface (CH340C/G, MAX485, SP3485, TXB0108, MAX3232); timers (NE555, TLC555); memory (24LC256, W25Q32); ULN2003A; ESP32-WROOM-32; AMS1117-3.3 |
| `connector`       | 23  | pin-header 1x02..1x12 / 2x03/05/08, pin-socket ×4, JST-PH ×3, JST-XH ×3, USB-A, USB-Micro-B, IDC 2x05                        |
| `transistor`      | 20  | BJT (BC817/847/807/857, MMBT2222A/3904/3906, SS8050/8550); MOSFET (2N7002, AO3400/3401, BSS138/84, Si2302, IRF540N, IRLZ44N); generics |
| `diode`           | 12  | Schottky (1N5819, SS14, SS34); rectifier (1N4007, 1N5408); 1N4148, BAV99, BZX84, TVS, USBLC6-2SC6, generics                 |
| `power`           | 11  | LDO (AMS1117-5.0/ADJ, AP2112K, ME6211, TLV1117); L7805, LM317; LM2596-ADJ; MT3608; TL431; DW01A                              |
| `passive`         | 7   | resistor, capacitor (MLCC), inductor, ferrite-bead, electrolytic, tantalum, PTC fuse (parametric multi-footprint)           |
| `crystal`         | 3   | crystal 2-pin, crystal 4-pad (GND), ceramic resonator                                                                        |
| `opto`            | 3   | LED-SMD, LED-THT, WS2812B                                                                                                    |
| `sensor`          | 3   | BME280, DS18B20, LDR                                                                                                         |
| `switch`          | 2   | tactile-SMD, tactile-THT                                                                                                     |
| `mechanical`      | 1   | testpoint                                                                                                                    |

Deferred parts + the no-STEP mechanical code path are tracked in [TODO.md](TODO.md) (Wave-2 + the long-lead-THT 3D-gate-calibration item).

## Gates — all green (re-verified 2026-07-10 @227)

| Check               | Command                                    | Result                          |
| ------------------- | ------------------------------------------ | ------------------------------- |
| Release validation  | `bun tools/validate.ts --release --strict` | OK (227 comp)                   |
| 3D orientation gate | `bun run audit:3d`                         | 136 ok / 0 errors / 0 warnings  |
| Datasheet links     | `bun tools/check-datasheet-links.ts`       | active (curated URLs exist)     |
| Tests               | `bun test`                                 | 47 pass                         |
| Typecheck           | `bun run typecheck`                        | clean                           |
| Pack                | `bun tools/pack.ts --version=0.0.0-dev`    | `.opclib` built (227 comp)      |

The former 8 audit:3d false-positive warnings are resolved — the gate was recalibrated (up-axis vs cross-section, body-behind-pads budget, thin-standing waiver) and per-footprint `orientationHint`/`belowBoardBudgetMm` overrides cover DHT11/PS1240/18650.

## What changed in P0/P1 (vs the spec's assumptions)

The expansion spec (`../Corelibrary expansion plan.md`) was written at an older commit / KiCad 9. Verified corrections now baked in:

- **Schema** (`schemas/component.schema.json`): only **4** fields were actually new — `datasheet`, `datasheetSource`, `keywords`, `subcategory`. `parameters` + `manufacturerParts` were already present.
- **Importer** (`tools/import-kicad-batch.ts`): now passes metadata through, auto-captures the KiCad `Datasheet` property (http-guarded) into `datasheetSource`, default `--kicad-root` fixed to `../references/kicad-libs`, stamps `upstreamCommit: c7e226a49`.
- **Validator** (`tools/validate.ts`): URI checks for datasheet fields (hard fail); **soft notes** (never fail under `--strict`) for empty `parameters`/`keywords` on `ic`/`power`/`sensor`.
- **KiCad libs**: vendored at `../references/kicad-libs`, **KiCad 10.0.4 @ `c7e226a49`**. Symbols are unpacked per-symbol files `<Lib>.kicad_symdir/<Name>.kicad_sym`. Transistors live in `Transistor_BJT`/`Transistor_FET` (NOT `Device`).
- **CI** already runs `--release --strict` → **every footprint must ship a STEP**; parts without an upstream STEP are deferred to Wave 2 (see TODO).
- **Datasheets = link-only** (decision): store a manufacturer URL in `datasheet`; no PDF hosting. Generics stay `datasheet: null`.

## Cross-repo status

- **App supports builtin id remap** via `aliases[]` — `OpenPCB/src/modules/library/backend/sync/opclib-importer.ts` → `migrateLegacyAliases()`. The 3 renamed ICs carry old ids in `aliases[]`; placed references migrate on import. No app change needed for the rename.
- **`@openpcb/opclib-pack` 0.3.0 (P7 DONE, 2026-07-10)** carries `subcategory`/`datasheet`/`keywords` + `maxEntries:8192`; pack.ts passes them through (curated `datasheet` wins, falls back to `datasheetSource`). App wired: migration `0010_component_metadata.sql`, importer maps metadata + seeds manufacturer/MPN from `manufacturerParts[0]`, DetailsCard shows the real datasheet link. **Shared tags `opclib-pack-v0.3.0` + `kicad-import-v0.1.2` are local-only until shared main+tags are pushed** — push shared before consumers.
- **Per-instance `Value` editing works** (`PartInspectorPanel.tsx` → `update_part_properties`) — parametric passives are fully usable.

## Gotchas (read before re-importing — expanded during the P2–P6 sweep)

- **`import-kicad-batch --allow-overwrite` regenerates 3D sidecars from KiCad defaults**, clobbering hand-tuned `scaleMm.y:-1` orientation fixes (DIP/connector Y-flip). After any such re-import, run `bun run audit:3d`; if a model errors, re-apply `scaleMm.y:-1` in its `3d/.../*.model.json`. **Avoid the dance entirely by using all-new asset ids for a phase** (then no `--allow-overwrite` needed) — only reuse a shared id when the asset is genuinely shared (e.g. `package.sot-23`, `package.to-92-inline`).
- **`audit:3d` is a HARD release gate (0 errors required).** Sweep findings: vertical pin headers/sockets, USB, THT switches need **`scaleMm.y:-1`** (pin row mirrored into +Y); SMD parts seated <−0.1 mm need a small **`offsetMm.z`** (e.g. USB Micro-B +0.25); **long-lead vertical THT (TO-220, DHT11, buzzer) currently TRIP the gate as false-positives** and are deferred pending an `orientation-gate.ts` calibration (see TODO Wave-2).
- **`--strict` requires an explicit `pinMap`** (it never auto-fills). For high-pin parts, generate identity maps from the footprint pad list — see the reusable generators `scratchpad/gen-p4.ts` / `gen-p5.ts` (read pads, emit `{pinNumber:n, padNumber:n}`; `padOverride` for non-electrical pads).
- **The importer follows `extends` recursively** for pins → point `symbol.path` at the named child (e.g. `MMBT3904`, `DS18B20`); pins resolve from the parent.
- **Duplicate footprint NAME across two asset ids fails validate** → reuse the existing shared footprint id (e.g. DS18B20 reuses `package.to-92-inline`) rather than minting a second asset for the same KiCad footprint.
- **Sharing a symbol id across components makes the importer name the shared symbol after the _last_ component (name bleed)** → give each part its own symbol id unless the symbol is genuinely shared.
- **Unnumbered/empty-number pads (DC barrel jack, potentiometer MP) are rejected by the strict importer** → defer (Wave-2) or add non-electrical-pad handling.
- Importer flags use **`--flag=value`** form, not space-separated.

## Git

All work is on **`master`** (Wave A+B merged; 2026-07-10 session adds ~10 commits: cross-repo unblocks, gate recalibration, w1/w2/w3/wc waves, MPN backfill, cleanups). **NOT pushed** — push order: shared main+tags → CoreLibrary master → OpenPCB master. Working tree clean (only `.graphifyignore` untracked, pre-existing).
