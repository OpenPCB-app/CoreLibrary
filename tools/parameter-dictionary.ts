/**
 * Canonical `parameters` vocabulary for library components.
 *
 * Single source of truth for both `tools/normalize-parameters.ts` (the codemod)
 * and the G5 gate in `tools/validate.ts`, so the two cannot drift.
 *
 * Style is short datasheet-native snake_case — `vrrm`, `ic`, `vce`, `rds_on` —
 * because that is how the values are printed on the datasheets these specs are
 * transcribed from, and it stays compact in UI columns.
 *
 * Values remain SI-suffixed strings ("40V", "100nF", "16MHz"). Typed numeric
 * values are a separate, larger change.
 */

/** Deprecated key -> canonical key. Applied before the allow-list check. */
export const PARAMETER_ALIASES: Readonly<Record<string, string>> = {
  // Diode: prefer the datasheet symbols.
  reverse_voltage: "vrrm",
  forward_current: "if",
  // Transistor: "_max" suffixes duplicated the plain symbol.
  vds_max: "vds",
  id_max: "id",
  vce_max: "vce",
  // Power: long-form duplicates.
  output_voltage: "vout",
  output_current: "iout",
  cells: "cell",
  // Supply naming.
  vcc: "supply",
  vmax: "supply_max",
  // camelCase strays.
  busVoltage: "bus_voltage",
  ioutPerBridge: "iout_per_bridge",
  ratedCurrent: "rated_current",
  wireGauge: "wire_gauge",
  contactRating: "contact_rating",
  loadCapacitance: "load_capacitance",
  tempRange: "temp_range",
  humidityRange: "humidity_range",
};

/**
 * Keys that duplicate data already carried by a structured field. `package`
 * restates the footprint, so it is dropped rather than renamed.
 */
export const PARAMETER_DROPS: ReadonlySet<string> = new Set(["package"]);

/** Allowed canonical keys per component category. */
export const PARAMETER_KEYS: Readonly<Record<string, readonly string[]>> = {
  audio: ["type", "diameter", "frequency", "impedance", "spl"],
  battery: ["type", "voltage", "capacity", "chemistry"],
  connector: [
    "type",
    "pitch",
    "positions",
    "mount",
    "rated_current",
    "wire_gauge",
    "orientation",
    "shielded",
  ],
  crystal: [
    "type",
    "frequency",
    "load_capacitance",
    "tolerance",
    "integrated_caps",
    "pads",
  ],
  diode: ["type", "vrrm", "if", "vf", "trr", "vz", "capacitance"],
  ic: [
    "type",
    "function",
    "family",
    "channels",
    "supply",
    "supply_min",
    "supply_max",
    "interface",
    "bus",
    "bus_voltage",
    "core",
    "clock",
    "flash",
    "ram",
    "io",
    "gbw",
    "vos",
    "gain",
    "rail_to_rail",
    "iout",
    "iout_per_bridge",
    "vout",
    "vm",
    "pout",
    "resolution",
    "bits",
    "rate",
    "data_rate",
    "freq_max",
    "gates",
    "size",
    "range",
    "output",
    "radio",
    "phy",
    "usb",
    "isolation",
  ],
  mechanical: ["type", "size", "mount"],
  opto: [
    "type",
    "color",
    "wavelength",
    "voltage",
    "channels",
    "interface",
    "data_rate",
    "isolation",
    "digits",
    "polarity",
    "ctr",
  ],
  passive: [
    "type",
    "dielectric",
    "polarized",
    "topology",
    "resistors",
    "turns",
    "adjust",
    "tolerance",
  ],
  power: [
    "type",
    "topology",
    "vin",
    "vin_max",
    "vout",
    "iout",
    "dropout",
    "vref",
    "vbat",
    "ichg",
    "cell",
    "vka",
    "switching_freq",
  ],
  relay: ["type", "contacts", "contact_rating", "coil_voltage"],
  sensor: [
    "type",
    "measures",
    "interface",
    "supply",
    "range",
    "output",
    "sensitivity",
    "accuracy",
    "temp_range",
    "humidity_range",
  ],
  switch: ["type", "contacts", "rated_current", "travel"],
  transistor: [
    "type",
    "channel",
    "vce",
    "ic",
    "hfe",
    "pd",
    "vds",
    "id",
    "rds_on",
    "vgs_th",
    "logic_level",
  ],
};

export interface NormalizedParameters {
  parameters: Record<string, unknown>;
  renamed: Array<{ from: string; to: string }>;
  dropped: string[];
}

/** Apply aliases + drops. Does not validate against the allow-list. */
export function normalizeParameters(
  parameters: Record<string, unknown>,
): NormalizedParameters {
  const out: Record<string, unknown> = {};
  const renamed: Array<{ from: string; to: string }> = [];
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(parameters)) {
    if (PARAMETER_DROPS.has(key)) {
      dropped.push(key);
      continue;
    }
    const canonical = PARAMETER_ALIASES[key] ?? key;
    if (canonical !== key) renamed.push({ from: key, to: canonical });
    // An alias colliding with an existing canonical key keeps the canonical
    // value — the explicit one wins over the deprecated spelling.
    if (!(canonical in out)) out[canonical] = value;
  }
  return { parameters: out, renamed, dropped };
}

/** Keys not permitted for `category`. Unknown categories are unconstrained. */
export function unknownParameterKeys(
  category: string,
  parameters: Record<string, unknown>,
): string[] {
  const allowed = PARAMETER_KEYS[category];
  if (!allowed) return [];
  const allowedSet = new Set(allowed);
  return Object.keys(parameters)
    .filter((key) => !allowedSet.has(key))
    .sort();
}

/**
 * Headline keys a function-standard component's `parameters` should carry —
 * consumed by the G6 gate (`tools/gates/parameters-required.ts`). `always` is
 * required regardless of `type`; `byType` adds keys once `type` narrows the
 * part (e.g. an NMOS needs `rds_on`, a BJT doesn't). `anyOf` is reserved for a
 * future "one of these keys" rule — no category needs it yet.
 */
export interface RequiredSpec {
  always: string[];
  byType?: Record<string, string[]>;
  anyOf?: string[][];
}

/** Per-category required headline keys. Categories absent here are unconstrained by G6. */
export const REQUIRED_PARAMETER_KEYS: Readonly<Record<string, RequiredSpec>> = {
  transistor: {
    always: ["type"],
    byType: {
      npn: ["vce", "ic"],
      pnp: ["vce", "ic"],
      "npn-darlington": ["vce", "ic"],
      "pnp-darlington": ["vce", "ic"],
      nmos: ["vds", "id", "rds_on"],
      pmos: ["vds", "id", "rds_on"],
    },
  },
  diode: {
    always: ["type"],
    byType: {
      signal: ["vrrm", "if"],
      rectifier: ["vrrm", "if"],
      schottky: ["vrrm", "if"],
      zener: ["vz"],
      tvs: [],
      bridge: ["vrrm", "if"],
    },
  },
  power: {
    always: ["type"],
    byType: {
      ldo: ["vin_max", "vout", "iout"],
      linear: ["vin_max", "vout", "iout"],
      buck: ["vin_max", "vout", "iout"],
      boost: ["vin_max", "vout", "iout"],
      "buck-boost": ["vin_max", "vout", "iout"],
      charger: ["vbat", "ichg"],
      reference: ["vref"],
      protection: [],
    },
  },
  ic: { always: ["type"] },
  sensor: { always: ["type", "measures", "interface", "supply"] },
  crystal: { always: ["type", "frequency"] },
  relay: { always: ["type", "coil_voltage", "contacts"] },
  switch: { always: ["type", "contacts"] },
  opto: { always: ["type"] },
  audio: { always: ["type"] },
  battery: { always: ["type"] },
};

/**
 * Allowed `parameters.type` values per category, for the categories where G6
 * also validates `type` itself (the ones with a `byType` table above). Values
 * are the union of what the 231-component tree actually uses (derived via
 * `jq -r '.parameters.type' components/<cat>/*.component.json`, 2026-09) and
 * the documented part-family vocabulary, normalised lowercase-hyphen.
 */
export const PARAMETER_TYPE_VALUES: Readonly<Record<string, readonly string[]>> = {
  transistor: [
    "npn",
    "pnp",
    "nmos",
    "pmos",
    "npn-darlington",
    "pnp-darlington",
    "jfet-n",
    "jfet-p",
  ],
  diode: ["signal", "rectifier", "schottky", "zener", "tvs", "bridge"],
  power: [
    "ldo",
    "linear",
    "buck",
    "boost",
    "buck-boost",
    "charger",
    "reference",
    "protection",
    "supervisor",
    "shunt",
  ],
  ic: [
    "opamp",
    "comparator",
    "logic",
    "mcu",
    "memory",
    "interface",
    "transceiver",
    "usb-bridge",
    "driver",
    "motor-driver",
    "adc",
    "dac",
    "timer",
    "rtc",
    "isolator",
    "audio-amp",
    "wireless",
    "level-shifter",
    "io-expander",
    "current-sensor",
    "power-monitor",
    "ethernet",
    "can",
  ],
};
