/**
 * G12 — mount-type vs pad-drill consistency. `mountType` tells the BOM,
 * placement, and assembly-cost pipeline how a part is soldered; the pad
 * geometry should actually back that up. The recurring import defect is a
 * `through_hole` footprint with no drilled pad at all (a barrel jack whose
 * KiCad source used slotted/oval pads the importer didn't carry a drill for).
 *
 * Pure module — the caller (tools/validate.ts, wired later) supplies the
 * loaded footprint and renders the findings.
 */
import { finding, type GateFinding } from "./types";

export interface MountTypePad {
  number?: string;
  drillDiameterMm?: number;
  drillSlotMm?: { widthMm: number; heightMm: number };
}

export interface MountTypeInput {
  id: string;
  mountType?: string;
  normalized?: { preview?: { pads?: MountTypePad[] } };
}

function isDrilled(pad: MountTypePad): boolean {
  return (pad.drillDiameterMm ?? 0) > 0 || pad.drillSlotMm !== undefined;
}

function isElectrical(pad: MountTypePad): boolean {
  return (pad.number ?? "").trim() !== "";
}

/** KiCad's `tht` spelling is this library's `through_hole`. */
function normalizeMountType(raw: string | undefined): string {
  return raw === "tht" ? "through_hole" : (raw ?? "");
}

export function checkMountType(footprint: MountTypeInput): GateFinding[] {
  const { id } = footprint;
  const mountType = normalizeMountType(footprint.mountType);
  const pads = footprint.normalized?.preview?.pads ?? [];

  const drilledElectrical = pads.some((p) => isDrilled(p) && isElectrical(p));
  const drilledAny = pads.some((p) => isDrilled(p));
  const drilledNonElectrical = pads.some((p) => isDrilled(p) && !isElectrical(p));
  const undrilledElectrical = pads.some((p) => !isDrilled(p) && isElectrical(p));

  switch (mountType) {
    case "through_hole":
      if (!drilledAny)
        return [finding("G12", "fail", `${id} is through_hole but has no drilled pads`)];
      return [];
    case "smd":
      if (drilledElectrical) {
        // Thermal vias inside an EP share the EP's number: legitimate on an
        // smd module. Any other drilled numbered pad means the part is really
        // `mixed` (THT shield tabs on an otherwise SMD connector).
        const undrilledNumbers = new Set(
          pads.filter((p) => !isDrilled(p)).map((p) => (p.number ?? "").trim()),
        );
        const stray = pads
          .filter((p) => isDrilled(p) && isElectrical(p))
          .map((p) => (p.number ?? "").trim())
          .filter((n) => !undrilledNumbers.has(n));
        if (stray.length === 0)
          return [finding("G12", "note", `${id} is smd with thermal-via pads inside its EP`)];
        return [
          finding(
            "G12",
            "warn",
            `${id} is smd but pad(s) ${[...new Set(stray)].join(", ")} are drilled — set mountType to mixed`,
          ),
        ];
      }
      if (drilledNonElectrical)
        return [
          finding(
            "G12",
            "note",
            `${id} is smd with drilled non-electrical pad(s) (mechanical slot/NPTH)`,
          ),
        ];
      return [];
    case "mixed":
      if (!drilledElectrical || !undrilledElectrical)
        return [
          finding(
            "G12",
            "warn",
            `${id} is mixed but lacks both a drilled and an undrilled electrical pad`,
          ),
        ];
      return [];
    case "press_fit":
      return [
        finding("G12", "note", `${id} is press_fit — pad/drill geometry is not modelled by this gate`),
      ];
    default:
      return [];
  }
}
