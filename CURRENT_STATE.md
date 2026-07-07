# CoreLibrary — Current State (2026-07-07)

Snapshot at the **125-component milestone** on **`master` (`447f2f7`)** — re-verified green today (typecheck · `bun test` 41 pass · `validate --release --strict` 125 OK · `audit:3d` 0 errors · pack builds). For the roadmap + deferrals see [TODO.md](TODO.md); for how to continue see [HANDOFF.md](HANDOFF.md). **Active roadmap:** content grind to v1 (250–300), KiCad-vendored parts only this round → ~180–210; plan at `~/.claude/plans/do-thorough-analysis-of-cozy-shamir.md`.

## Inventory — 125 components / 122 symbols / 97 footprints / 97 3D (all STEP-backed)

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

## Gates — all green (re-verified 2026-07-07)

| Check               | Command                                    | Result                        |
| ------------------- | ------------------------------------------ | ----------------------------- |
| Release validation  | `bun tools/validate.ts --release --strict` | OK (125 comp)                 |
| 3D orientation gate | `bun run audit:3d`                         | 89 ok / 0 errors / 8 warnings |
| Datasheet links     | `bun tools/check-datasheet-links.ts`       | no-op (no curated URLs yet)   |
| Tests               | `bun test`                                 | 41 pass                       |
| Typecheck           | `bun run typecheck`                        | clean                         |
| Pack                | `bun tools/pack.ts --version=0.0.0-dev`    | `.opclib` built (125 comp)    |

The 8 audit:3d warnings are the known false-positives (long pin-header rows, testpoint loop, vertical TO-220) pending the `orientation-gate.ts` vertical-THT calibration — see [TODO.md](TODO.md).

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
- **`@openpcb/opclib-pack`** already carries `parameters`/`manufacturerParts`, but **NOT** `datasheet`/`keywords`/`subcategory`. Surfacing those top-level fields in the app needs an opclib-pack schema bump (shared) + app importer/UI wiring + a drizzle migration — **deferred to P7** (not needed for generic passives).
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

125-component milestone committed to **`master`** (`447f2f7` docs / `314948b` W1/W2→125). **`master` is 9 commits ahead of `origin/master` — NOT pushed.** Working tree: `graphify-out/` (graphify skill output) now gitignored; docs (`CURRENT_STATE.md`, `.gitignore`) refreshed this session.
