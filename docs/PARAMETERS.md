# Component parameters dictionary

`component.parameters` is an optional, per-category key→value map of **headline electrical specs**.
Values are SI-suffixed strings (e.g. `"40V"`, `"100nF"`, `"16MHz"`).

**Parameters are not instance values.** The per-instance `Value` (the actual resistance or
capacitance) is set by the user on each placed part in the OpenPCB designer (PartInspectorPanel →
`update_part_properties`). `parameters` carries the _applicable spec keys_ for a generic part and the
_headline specs_ for a function-standard part.

## This dictionary is enforced

`tools/parameter-dictionary.ts` is the single source of truth, consumed by both
`tools/normalize-parameters.ts` (the codemod) and the **G5** gate in `tools/validate.ts`. A key
outside its category's list is a hard validation failure — keep this file and the module in step.

To add a key: extend `PARAMETER_KEYS` in the module, then document it here. To rename one: add the
old spelling to `PARAMETER_ALIASES` and run `bun tools/normalize-parameters.ts`.

Empty `parameters` or `keywords` on a function-standard component used to be a single advisory note
for `ic`/`power`/`sensor` only. That note is gone — the **G6** and **G7** gates below (and in
[CONTRIBUTING.md](../CONTRIBUTING.md)) replace it for every function-standard category. Both stay
`warn`, not `fail` — a real datasheet gap is worth flagging, not blocking a release over — but
`warn` is fatal under `--strict`/`--release`.

## Naming convention

Short **datasheet-native snake_case** — `vrrm`, `if`, `vce`, `ic`, `rds_on`, `gbw`. These are the
symbols printed on the datasheets the specs are transcribed from, and they stay compact in UI
columns. Prefer the plain symbol over a `_max` suffix (`vds`, not `vds_max`).

## Dictionary (by category)

| Category      | Keys                                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio`       | `type`, `diameter`, `frequency`, `impedance`, `spl`                                                                                                                                                                                                                                                             |
| `battery`     | `type`, `voltage`, `capacity`, `chemistry`                                                                                                                                                                                                                                                                      |
| `connector`   | `type`, `pitch`, `positions`, `mount`, `rated_current`, `wire_gauge`, `orientation`, `shielded`                                                                                                                                                                                                                 |
| `crystal`     | `type`, `frequency`, `load_capacitance`, `tolerance`, `integrated_caps`, `pads`                                                                                                                                                                                                                                 |
| `diode`       | `type` (signal/rectifier/schottky/zener/tvs), `vrrm`, `if`, `vf`, `trr`, `vz`, `capacitance`                                                                                                                                                                                                                    |
| `ic`          | `type`, `function`, `family`, `channels`, `supply`, `supply_min`, `supply_max`, `interface`, `bus`, `bus_voltage`, `core`, `clock`, `flash`, `ram`, `io`, `gbw`, `vos`, `gain`, `rail_to_rail`, `iout`, `iout_per_bridge`, `vout`, `vm`, `pout`, `resolution`, `bits`, `rate`, `data_rate`, `freq_max`, `gates`, `size`, `range`, `output`, `radio`, `phy`, `usb`, `isolation` |
| `mechanical`  | `type`, `size`, `mount`                                                                                                                                                                                                                                                                                         |
| `opto`        | `type`, `color`, `wavelength`, `voltage`, `channels`, `interface`, `data_rate`, `isolation`, `digits`, `polarity`, `ctr`                                                                                                                                                                                        |
| `passive`     | `type`, `dielectric` (X7R/X5R/C0G), `polarized`, `topology`, `resistors`, `turns`, `adjust`, `tolerance`                                                                                                                                                                                                        |
| `power`       | `type` (ldo/buck/boost), `topology`, `vin`, `vin_max`, `vout`, `iout`, `dropout`, `vref`, `vbat`, `ichg`, `cell`, `vka`, `switching_freq`                                                                                                                                                                       |
| `relay`       | `type`, `contacts`, `contact_rating`, `coil_voltage`                                                                                                                                                                                                                                                            |
| `sensor`      | `type`, `measures`, `interface` (i2c/spi/1-wire), `supply`, `range`, `output`, `sensitivity`, `accuracy`, `temp_range`, `humidity_range`                                                                                                                                                                        |
| `switch`      | `type`, `contacts`, `rated_current`, `travel`                                                                                                                                                                                                                                                                   |
| `transistor`  | `type`, `channel`, BJT: `vce`, `ic`, `hfe`, `pd` · MOSFET: `vds`, `id`, `rds_on`, `vgs_th`, `logic_level`                                                                                                                                                                                                       |

## Required headline keys (G6)

Beyond the allow-list (G5), a function-standard, non-generic component (see `tools/gates/generic-ids.ts` —
category in `ic`/`power`/`transistor`/`diode`/`sensor`/`opto`/`crystal`/`relay`/`switch`/`audio`/`battery`, and
not one of the bare generic templates such as `openpcb.core.diode.zener` or `openpcb.core.transistor.npn-sot-23-ebc`)
should carry a minimum set of headline `parameters`. `tools/parameter-dictionary.ts` (`REQUIRED_PARAMETER_KEYS`,
`PARAMETER_TYPE_VALUES`) is the source of truth for the **G6** gate in `tools/gates/parameters-required.ts`.
This is advisory (`warn`, never `fail`) — a real datasheet gap is worth flagging, not blocking a release over.

| Category      | Always required                       | Also required, by `type`                                                                                     |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `transistor`  | `type`                                 | `npn`/`pnp`/`npn-darlington`/`pnp-darlington` → `vce`, `ic` · `nmos`/`pmos` → `vds`, `id`, `rds_on`               |
| `diode`       | `type`                                 | `signal`/`rectifier`/`schottky`/`bridge` → `vrrm`, `if` · `zener` → `vz` · `tvs` → (none)                        |
| `power`       | `type`                                 | `ldo`/`linear`/`buck`/`boost`/`buck-boost` → `vin_max`, `vout`, `iout` · `charger` → `vbat`, `ichg` · `reference` → `vref` · `protection` → (none) |
| `ic`          | `type`                                 | —                                                                                                                 |
| `sensor`      | `type`, `measures`, `interface`, `supply` | —                                                                                                              |
| `crystal`     | `type`, `frequency`                    | —                                                                                                                 |
| `relay`       | `type`, `coil_voltage`, `contacts`     | —                                                                                                                 |
| `switch`      | `type`, `contacts`                     | —                                                                                                                 |
| `opto`        | `type`                                 | —                                                                                                                 |
| `audio`       | `type`                                 | —                                                                                                                 |
| `battery`     | `type`                                 | —                                                                                                                 |

`PARAMETER_TYPE_VALUES` additionally constrains `parameters.type` itself for four categories (a
`type` outside the list is also a `warn`) — the three with a `byType` table above, plus `ic`, whose
`type` is checked the same way even though it doesn't gate any extra required keys:

- `transistor`: `npn`, `pnp`, `nmos`, `pmos`, `npn-darlington`, `pnp-darlington`, `jfet-n`, `jfet-p`
- `diode`: `signal`, `rectifier`, `schottky`, `zener`, `tvs`, `bridge`
- `power`: `ldo`, `linear`, `buck`, `boost`, `buck-boost`, `charger`, `reference`, `protection`, `supervisor`, `shunt`
- `ic`: `opamp`, `comparator`, `logic`, `mcu`, `memory`, `interface`, `transceiver`, `usb-bridge`, `driver`, `motor-driver`, `adc`, `dac`, `timer`, `rtc`, `isolator`, `audio-amp`, `wireless`, `level-shifter`, `io-expander`, `current-sensor`, `power-monitor`, `ethernet`, `can`

`channel` is a dictionary key, not a required one: once `type` is `nmos`/`pmos` it already says which
channel the part is, so `channel` would only restate it.

## Standard value ladders (defaults; the actual value is per-instance)

- **Resistor (E24, 0402/0603/0805):** 0Ω, 10, 22, 33, 47, 100, 150, 220, 330, 470, 1k, 2.2k, 3.3k, 4.7k, 10k, 22k, 33k, 47k, 100k, 1M.
- **MLCC:** 10pF, 22pF, 47pF, 100pF, 1nF, 10nF, **100nF**, 1µF, 4.7µF, 10µF, 47µF (X7R/X5R; C0G for small).
- **Electrolytic (THT radial):** 10µF/25V, 47µF/25V, 100µF/16V, 220µF/25V, 470µF/16V, 1000µF/10V.
- **Inductor (0805/1210):** 1µH, 4.7µH, 10µH, 22µH, 47µH, 100µH. **Ferrite (0603):** 100Ω@100MHz, 600Ω@100MHz.
- **Crystal:** 8/12/16/20 MHz + 32.768 kHz (load 12/18/20 pF).
