/**
 * Shared "generic component" classification for the content gates (G6, G7,
 * G8, G12). A generic component is a bare functional template — Q_NMOS_GSD,
 * a plain LED, a zener/TVS placeholder — meant to be swapped for a specific
 * manufacturer part at design time. It is not held to the headline-parameter
 * (G6) or sourcing (G7) bars a function-standard part is.
 *
 * `tools/gates/symbol-erc.ts` (G9) carries its own local FUNCTION_CATEGORIES
 * for the same reason — each gate module stays self-contained — but the
 * category set itself must match; keep the two lists in sync if it changes.
 */

export const FUNCTION_CATEGORIES: ReadonlySet<string> = new Set([
  "ic",
  "power",
  "transistor",
  "diode",
  "sensor",
  "opto",
  "crystal",
  "relay",
  "switch",
  "audio",
  "battery",
]);

/**
 * Every component in a FUNCTION_CATEGORY with no `manufacturerParts` today.
 * Derived (2026-09, 231-component tree) via, for each category above:
 *   jq -r 'select((.manufacturerParts // []) | length == 0) | .id' \
 *     components/<cat>/*.component.json
 * Re-derive and update this list once a generic gains a real manufacturer
 * part (drop the id) — do not hand-add ids that still lack one.
 */
export const GENERIC_COMPONENT_IDS: ReadonlySet<string> = new Set([
  "openpcb.core.transistor.npn-sot-23-ebc",
  "openpcb.core.transistor.pnp-sot-23-ebc",
  "openpcb.core.transistor.nmos-sot-23-gsd",
  "openpcb.core.diode.generic",
  "openpcb.core.diode.zener",
  "openpcb.core.diode.tvs",
  "openpcb.core.sensor.ldr",
  "openpcb.core.opto.led",
  "openpcb.core.opto.led-tht",
  "openpcb.core.opto.phototransistor-5mm",
  "openpcb.core.crystal.crystal",
  "openpcb.core.crystal.crystal-gnd",
  "openpcb.core.crystal.resonator-ceramic",
  "openpcb.core.switch.tactile-switch-smd",
]);

/** A component is generic when its category isn't function-standard, or its id is a known generic template. */
export function isGenericComponent(
  id: string,
  category: string | undefined,
): boolean {
  return (
    !FUNCTION_CATEGORIES.has(category ?? "") || GENERIC_COMPONENT_IDS.has(id)
  );
}
