# CoreLibrary v1 Target List (reconstructed 2026-07-07)

The original master spec (`Corelibrary expansion plan.md` §7.4) was lost. This list is reconstructed from the existing 125-component inventory (gap analysis) + `TODO.md` Wave-2/deferred + jellybean conventions, **verified against the vendored KiCad 10.0.4 clone** (`../references/kicad-libs`). Goal this round: KiCad-vendored parts only → **~180–210** components (external Wave C parked).

**Per-wave ritual (unchanged):** branch `feat/corelib-<phase>` → author `tools/manifests/<phase>.json` → sparse-checkout the wave's `.3dshapes` dirs (`git -C ../references/kicad-libs/kicad-packages3D sparse-checkout add <Lib>.3dshapes`) → `import-kicad-batch --strict` → `validate --release --strict` → `audit:3d` (0 err) → `bun test` → `pack --version=0.0.0-dev` → merge. Every footprint MUST resolve a STEP under `kicad-packages3D/<Lib>.3dshapes/` — verify before adding; any part lacking an upstream STEP drops to Wave C. Prefer all-new asset ids over `--allow-overwrite`.

> **Clone corrections to TODO.md Wave-2** (older/incomplete checkout): **PC817** (`Isolator`), **screw terminals** (`TerminalBlock_*.pretty`), **MountingHole** (symbol+fp) ARE present in KiCad 10.0.4 → moved out of "external". Re-verify STEP per footprint.

---

## Wave A — highest-demand jellybeans, KiCad-symbol-verified (~30)

All symbols confirmed in the clone. Footprint families all present; STEP-verify each before import.

| Part | KiCad symbol (`<Lib>.kicad_symdir/`) | Footprint family | Category |
| --- | --- | --- | --- |
| BC547 / BC557 (TO-92) | `Transistor_BJT/BC547`,`BC557` | `Package_TO_SOT_THT`:TO-92 | transistor |
| 2N3904 / 2N3906 (TO-92) | `Transistor_BJT/2N3904`,`2N3906` | TO-92 | transistor |
| 2N2222A (TO-92) | `Transistor_BJT/2N2222` (verify) | TO-92 | transistor |
| BD139 / BD140 (TO-126) | `Transistor_BJT/BD139`,`BD140` | `Package_TO_SOT_THT`:TO-126 | transistor |
| TIP120 / TIP122 (Darlington TO-220) | `Transistor_BJT/TIP120`,`TIP122` | TO-220 | transistor |
| TIP41C / TIP42C (TO-220) | `Transistor_BJT/TIP41C`,`TIP42C` | TO-220 | transistor |
| 2N7000 (TO-92 N-MOSFET) | `Transistor_FET/2N7000` | TO-92 | transistor |
| IRF3205 (TO-220 N-MOSFET) | `Transistor_FET/IRF3205` | TO-220 | transistor |
| 1N4001 / 1N4004 (rectifier) | `Diode/1N4001`,`1N4004` | `Diode_THT`:DO-41 | diode |
| BAT54 / BAT54C (Schottky) | `Diode/BAT54`,`BAT54C` | SOT-23 | diode |
| SS16 / SS24 / SS26 (Schottky) | `Diode/SS16`,`SS24`,`SS26` | `Diode_SMD`:SMA/SMB | diode |
| LM741 (op-amp) | `Amplifier_Operational/LM741` | SOIC-8/DIP-8 | ic |
| TL081 / TL082 / TL084 | `Amplifier_Operational/TL081`,`TL082`,`TL084` | SOIC-8/14, DIP | ic |
| NE5534 (low-noise op-amp) | `Amplifier_Operational/NE5534` | SOIC-8/DIP-8 | ic |
| 74HC244 / 74HC245 (bus buffer/xcvr) | `74xx/74HC244`,`74HC245` | SOIC-20/TSSOP | ic |
| PC817 (optocoupler) | `Isolator/PC817` | DIP-4 | opto |
| RGB LED (common 4-pin) | `LED/SMLVN6RGB` (or THT) | LED_SMD/THT | opto |
| LM35 / TMP36 (analog temp) | `Sensor_Temperature/LM35-LP`,`TMP36xS` | TO-92 / SOT-23 | sensor |

## Wave B — breadth (KiCad-symbol-verified unless noted) (~40)

| Group | Parts (KiCad lib) | Notes |
| --- | --- | --- |
| Regulators (`power`) | 78xx: L7812, L7809, L7815; 79xx: L7905, L7912 (`Regulator_Linear`) | TO-220; STEP present |
| Motor/driver (`ic`) | L293D, ULN2803A (`Driver_Motor` / `Transistor_Array`) | DIP-16/18 |
| CAN (`ic`) | MCP2515, MCP2551 (`Interface_CAN_LIN`) | SOIC |
| RTC (`ic`) | DS1307, DS3231M (`Timer_RTC`) | DIP-8/SOIC |
| ADC/DAC (`ic`) | MCP3008, MCP4725 (`Analog_ADC`/`Analog_DAC`) | DIP/SOIC/SOT |
| Logic (`ic`) | 74HC08, 74HC32, 74HC157, 74HC373, 74HC393, CD4017, CD4013, CD4066, CD4511 | **verify exact symbol names in `74xx`/`4xxx` at authoring** |
| Interface (`ic`) | FT232RL, PCA9685, MCP23017 (`Interface_*`) | verify STEP |
| Screw terminals (`connector`) | 2/3-pos 5.08mm/3.5mm (`TerminalBlock_Phoenix`/`_WAGO`) | STEP-verify per vendor; may hit MP-pad → needs Phase-1 NPTH unblock |
| Header sizes (`connector`) | 1x05, 1x07, 1x16, 1x40; 2x04, 2x06, 2x10, 2x20 (`Connector_PinHeader_2.54mm`) | cheap variants of existing header pattern |
| Mechanical (`mechanical`) | MountingHole M2/M2.5/M3, Fiducial, Solder Jumper | **needs Phase-1 `no3d`/NPTH unblock**; `w1-mechanical.json` already authored |
| Passive variants (`passive`) | `_HandSolder` R (0603+), film cap, more L sizes, resistor network, MOV varistor | **extend existing R/C/L footprints[], don't mint new component ids** |
| Potentiometer (`passive`) | `R_Potentiometer` 9mm / trimmer 3296W | **needs Phase-1 NPTH unblock (MP pad)** |

## Wave C — PARKED (external-sourced; not this round)

Absent from vendored KiCad 10 OR needs non-KiCad assets / special 3D handling: **MPU-6050** (no STEP), **HC-SR04** (no dedicated symbol), **DHT11/DHT22** (body-below-board rotation; DHT22 no symbol), **ESP-12F** (only ESP-12E fp), **microSD** (`Connector_Card` absent), **USB-C** (complex pinMap), **74HC125** (only LS/LVC/AHCT), **MP1584/MP2307** (no symbol), **EC11 encoder**, **buzzer** (TDK STEP bakes 15mm below board), **relay**, **JST-XH 3D** (no STEP). Revisit to close ~200 → 250–300.

## Cross-cutting cleanups (opportunistic, low-risk)

- **Category fix:** `ic.ams1117-3v3` → belongs in `power/` (all other AMS1117/LDOs are there). Needs `aliases[]` for id remap (app `migrateLegacyAliases` handles it).
- **Subcategory normalization:** unify `opamp`/`op-amp`/`amplifier`/`audio-amp` and `regulator_linear`/`regulator-linear-ldo` to a single convention.
