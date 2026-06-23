# Component parameters dictionary

`component.parameters` is an optional, per-category key→value map of **headline electrical specs**.
Values are SI-suffixed strings (e.g. `"40V"`, `"100nF"`, `"16MHz"`) unless a number is more natural.

**Parameters are not instance values.** The per-instance `Value` (e.g. the actual resistance or
capacitance) is set by the user on each placed part in the OpenPCB designer (PartInspectorPanel →
`update_part_properties`). `parameters` carries the _applicable spec keys_ for a generic part
(e.g. a resistor's `tolerance`/`power_rating`) and the _headline specs_ for a function-standard part.

Keys are advisory — the validator only **soft-warns** (never fails) when an `ic`/`power`/`sensor`
component ships empty `parameters` or `keywords`.

## Dictionary (by category)

| Category                 | Keys                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `passive` → resistor     | `tolerance`, `power_rating`, `temp_coeff`                                                    |
| `passive` → capacitor    | `voltage_rating`, `dielectric` (X7R/X5R/C0G), `tolerance`                                    |
| `passive` → inductor     | `current_rating`, `dcr`, `saturation_current`                                                |
| `passive` → ferrite bead | `impedance_at_freq`, `rated_current`, `dcr`                                                  |
| `passive` → fuse         | `hold_current`, `rating`                                                                     |
| `crystal`                | `frequency`, `load_capacitance`, `frequency_tolerance`                                       |
| `diode`                  | `reverse_voltage`, `forward_current`, `vf_typ`, `type` (signal/rectifier/schottky/zener/tvs) |
| `transistor` (bjt)       | `vce_max`, `ic_max`, `hfe_typ`, `polarity`                                                   |
| `transistor` (mosfet)    | `vds_max`, `id_max`, `rds_on`, `vgs_th`, `channel`                                           |
| `opto` → led             | `color`, `vf_typ`, `if_typ`, `wavelength`                                                    |
| `power` (regulator)      | `output_voltage`, `input_voltage_max`, `output_current`, `type` (ldo/buck/boost), `dropout`  |
| `ic` (opamp/comparator)  | `gbw`, `supply_min`, `supply_max`, `rail_to_rail`, `channels`                                |
| `ic` (mcu)               | `core`, `flash`, `ram`, `max_freq`, `vcc_min`, `vcc_max`, `io_count`                         |
| `connector`              | `pitch`, `positions`, `current_per_contact`, `gender`, `mount`                               |
| `sensor`                 | `interface` (i2c/spi/1-wire), `supply`, plus sensor-specific (`range`, `accuracy`)           |

## Standard value ladders (defaults; the actual value is per-instance)

- **Resistor (E24, 0402/0603/0805):** 0Ω, 10, 22, 33, 47, 100, 150, 220, 330, 470, 1k, 2.2k, 3.3k, 4.7k, 10k, 22k, 33k, 47k, 100k, 1M.
- **MLCC:** 10pF, 22pF, 47pF, 100pF, 1nF, 10nF, **100nF**, 1µF, 4.7µF, 10µF, 47µF (X7R/X5R; C0G for small).
- **Electrolytic (THT radial):** 10µF/25V, 47µF/25V, 100µF/16V, 220µF/25V, 470µF/16V, 1000µF/10V.
- **Inductor (0805/1210):** 1µH, 4.7µH, 10µH, 22µH, 47µH, 100µH. **Ferrite (0603):** 100Ω@100MHz, 600Ω@100MHz.
- **Crystal:** 8/12/16/20 MHz + 32.768 kHz (load 12/18/20 pF).
