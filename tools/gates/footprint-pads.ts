/**
 * Pad model shared by the footprint gates: decoding one
 * `normalized.preview.pads[]` entry into the copper/drill facts the DRC rules
 * and the summary reporter both need.
 *
 * Kept separate from the rules themselves so `footprint-drc.ts` stays a list of
 * checks rather than a mix of checks and parsing.
 */
import {
  rotatedRectBounds,
  type Bounds2D,
  type PreviewGraphic,
} from "./geometry";

export interface DrcPad {
  id?: string;
  number?: string;
  shape?: string;
  centerMm?: { x: number; y: number };
  widthMm?: number;
  heightMm?: number;
  rotationDeg?: number;
  roundrectRatio?: number;
  drillDiameterMm?: number | null;
  drillSlotMm?: { widthMm: number; heightMm: number } | null;
  layer?: string;
  layers?: string[];
  /** Paste-only sub-pad (stencil aperture) — carries no copper. */
  role?: string;
}

export interface DrcFootprint {
  id: string;
  name?: string;
  mountType?: string;
  normalized?: { preview?: { pads?: DrcPad[]; graphics?: PreviewGraphic[] } };
}

export type Side = "F" | "B";

export type Drill =
  | { kind: "round"; diameterMm: number }
  | { kind: "slot"; widthMm: number; heightMm: number };

export interface CopperPad {
  index: number;
  pad: DrcPad;
  /** Human label for messages: the pad number, else a stable ordinal. */
  label: string;
  /** Net identity. Unnumbered pads get a private key so they never "match". */
  netKey: string;
  numbered: boolean;
  through: boolean;
  /** Unplated hole: the drill eats the whole land, so there is no ring to check. */
  npth: boolean;
  sides: Side[];
  bounds: Bounds2D;
  drill: Drill | null;
}

function padLayers(pad: DrcPad): string[] {
  if (pad.layers && pad.layers.length > 0) return pad.layers;
  return pad.layer ? [pad.layer] : [];
}

function copperSides(pad: DrcPad): Side[] {
  const sides = new Set<Side>();
  for (const layer of padLayers(pad)) {
    if (layer === "*.Cu") {
      sides.add("F");
      sides.add("B");
    } else if (layer === "F.Cu") sides.add("F");
    else if (layer === "B.Cu") sides.add("B");
  }
  return [...sides];
}

function padDrill(pad: DrcPad): Drill | null {
  const slot = pad.drillSlotMm;
  if (slot && slot.widthMm > 0 && slot.heightMm > 0) {
    return { kind: "slot", widthMm: slot.widthMm, heightMm: slot.heightMm };
  }
  const d = pad.drillDiameterMm;
  if (typeof d === "number" && Number.isFinite(d) && d > 0) {
    return { kind: "round", diameterMm: d };
  }
  return null;
}

/**
 * KiCad `np_thru_hole` pads survive normalisation as an unnumbered pad whose
 * land is exactly its own hole (`MountingHole_4.3mm`: 4.3mm pad, 4.3mm drill).
 * They carry no net and no copper ring by design, so the annular rule has to
 * skip them — flagging them would fail every mounting hole in the library. A
 * *numbered* pad with no ring is still a hard fail: it has a net to connect.
 */
function isUnplated(
  pad: DrcPad,
  drill: Drill | null,
  numbered: boolean,
): boolean {
  if (!drill || numbered) return false;
  const w = pad.widthMm ?? 0;
  const h = pad.heightMm ?? 0;
  const eps = 1e-6;
  return drill.kind === "round"
    ? drill.diameterMm >= Math.min(w, h) - eps
    : drill.widthMm >= w - eps && drill.heightMm >= h - eps;
}

/**
 * Copper pads only. Paste-only sub-pads (`role: "paste"`) and pads on no copper
 * layer are dropped up front, so every copper rule downstream is automatically
 * blind to them.
 */
export function collectCopperPads(fp: DrcFootprint): CopperPad[] {
  const out: CopperPad[] = [];
  const pads = fp.normalized?.preview?.pads ?? [];
  for (let i = 0; i < pads.length; i += 1) {
    const pad = pads[i];
    if (!pad || pad.role === "paste") continue;
    const sides = copperSides(pad);
    if (sides.length === 0) continue;
    const center = pad.centerMm;
    const w = pad.widthMm;
    const h = pad.heightMm;
    if (!center || typeof w !== "number" || typeof h !== "number") continue;
    const number = (pad.number ?? "").trim();
    const drill = padDrill(pad);
    out.push({
      index: i,
      pad,
      label: number || `unnumbered#${i + 1}`,
      // " " cannot occur in a real pad number, so unnumbered pads are each
      // their own net — an unnumbered copper pad still shorts to its neighbour.
      netKey: number || ` ${i}`,
      numbered: number.length > 0,
      through: padLayers(pad).includes("*.Cu"),
      npth: isUnplated(pad, drill, number.length > 0),
      sides,
      bounds: rotatedRectBounds(center, w, h, pad.rotationDeg ?? 0),
      drill,
    });
  }
  return out;
}

/** Two pads can short only if they carry copper on the same side. */
export function sharesSide(a: CopperPad, b: CopperPad): boolean {
  return a.sides.some((s) => b.sides.includes(s));
}

/** The dimension a fab quotes for a hole: the diameter, or a slot's narrow axis. */
export function drillSizeMm(drill: Drill): number {
  return drill.kind === "round"
    ? drill.diameterMm
    : Math.min(drill.widthMm, drill.heightMm);
}

/**
 * Copper ring left around the hole, on the tightest side. `null` when the pad
 * has no drill.
 *
 * Round drills ignore rotation. For slots the brief's convention applies: a
 * 90/270 pad's slot is compared against the swapped pad axis. NOTE: every slot
 * pad in the library today sits at `rotationDeg: 0` with world-oriented slot
 * dimensions, so this branch is unexercised by real data — revisit if the
 * importer ever emits a rotated slot.
 */
export function annularRingMm(pad: CopperPad): number | null {
  const { drill } = pad;
  const w = pad.pad.widthMm ?? 0;
  const h = pad.pad.heightMm ?? 0;
  if (!drill) return null;
  if (drill.kind === "round") return (Math.min(w, h) - drill.diameterMm) / 2;
  const norm = (((pad.pad.rotationDeg ?? 0) % 360) + 360) % 360;
  const swap = Math.abs(norm - 90) < 1e-9 || Math.abs(norm - 270) < 1e-9;
  const sw = swap ? drill.heightMm : drill.widthMm;
  const sh = swap ? drill.widthMm : drill.heightMm;
  return Math.min((w - sw) / 2, (h - sh) / 2);
}
