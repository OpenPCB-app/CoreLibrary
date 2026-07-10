/**
 * Geometric orientation gate for 3D models placed on footprints.
 *
 * Turns the previous metadata-only audit into real pass/fail checks against the
 * BAKED GLB bounding box (scene frame: Z-up, millimetres, origin = footprint
 * origin). Calibrated against known-good models (R_0603, identity LED) and the
 * historical bug (LED baked with rotationDeg.x=-90, which sinks the body below
 * the board) plus the connector pin-row alignment (footprint pads at +Y, model
 * pin row mirrored into +Y via scaleMm.y=-1).
 *
 * Pure module: no IO. `pack.ts`, `audit-3d-placement.ts` and the test suite all
 * feed it bounds + footprint preview geometry and render the findings.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ModelBounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type MountType = "smd" | "tht" | "other";

/** Normalize footprint `mountType` strings (KiCad uses "through_hole") to our 3 buckets. */
export function normalizeMountType(raw: string | undefined): MountType {
  const v = (raw ?? "").toLowerCase();
  if (v === "smd" || v === "surface_mount") return "smd";
  if (
    v === "tht" ||
    v === "through_hole" ||
    v === "thru_hole" ||
    v === "thruhole"
  )
    return "tht";
  return "other";
}

export interface FootprintPreview {
  pads?: Array<{
    centerMm?: { x: number; y: number };
    widthMm?: number;
    heightMm?: number;
  }>;
  graphics?: Array<{
    a?: { x: number; y: number };
    b?: { x: number; y: number };
    center?: { x: number; y: number };
    radiusMm?: number;
  }>;
}

export type Severity = "error" | "warning" | "review";

export interface Finding {
  check: string;
  severity: Severity;
  message: string;
}

export type OrientationHint = "vertical" | "horizontal" | "unknown";

export interface GateInput {
  mountType: MountType;
  bounds: ModelBounds;
  /** Union of pad + silk-graphic bounds — a courtyard-ish XY reference. */
  reference: Bounds2D | null;
  /**
   * Expected body posture. KiCad encodes it in the footprint name
   * (`_Vertical` / `_Horizontal`); used to decide whether a tall vertical body
   * is required. "unknown" skips the posture heuristic.
   */
  orientationHint?: OrientationHint;
}

/** Derive an {@link OrientationHint} from a KiCad-style footprint name. */
export function orientationHintFromName(
  name: string | undefined,
): OrientationHint {
  const v = (name ?? "").toLowerCase();
  if (v.includes("horizontal")) return "horizontal";
  if (v.includes("vertical")) return "vertical";
  return "unknown";
}

// --- tolerances (mm), calibrated on the core library ---------------------------
/** SMD body base must rest on the board plane (z≈0). Leads/feet may dip slightly. */
const SMD_BASE_BELOW_TOL = 0.1;
/** SMD base should not float far above the board either. */
const SMD_BASE_ABOVE_TOL = 0.3;
/** Min body height above board to count as "has vertical extent" (not lying flat). */
const MIN_BODY_HEIGHT = 0.1;
/**
 * THT lead-protrusion budget below the board, by posture.
 * Horizontal/axial/unknown parts seat close to the board, so a body dipping far
 * below is almost always a mis-orientation. Vertical parts (TO-220, TO-92,
 * DHT11) legitimately stand the body ABOVE the board while the full untrimmed
 * leads reach much further below — so they get a larger budget. The independent
 * "body must rise above board" check (max.z ≥ THT_MIN_BODY_HEIGHT) still catches
 * a body baked upside-down, so the larger vertical budget can't mask a flip.
 */
const THT_LEAD_BELOW_MAX = 6.0;
const THT_LEAD_BELOW_VERTICAL = 12.0;
/** Min THT body height above board. */
const THT_MIN_BODY_HEIGHT = 0.5;
/** Absolute floor / ceiling for plausible package size on any axis. */
const SIZE_MIN = 0.05;
const SIZE_MAX = 200;

function extent(b: Bounds2D): { x: number; y: number } {
  return { x: b.maxX - b.minX, y: b.maxY - b.minY };
}

function center2d(b: Bounds2D): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Per-axis centering tolerance: generous for large parts, firm for small ones. */
function centerTol(refExtentAxis: number): number {
  return Math.max(0.4, 0.3 * refExtentAxis);
}

/** Build the XY reference bounds (pads ∪ silk graphics) from a footprint preview. */
export function referenceBounds(
  preview: FootprintPreview | undefined,
): Bounds2D | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const pad of preview?.pads ?? []) {
    if (!pad.centerMm || pad.widthMm == null || pad.heightMm == null) continue;
    grow(pad.centerMm.x - pad.widthMm / 2, pad.centerMm.y - pad.heightMm / 2);
    grow(pad.centerMm.x + pad.widthMm / 2, pad.centerMm.y + pad.heightMm / 2);
  }
  for (const g of preview?.graphics ?? []) {
    if (g.a) grow(g.a.x, g.a.y);
    if (g.b) grow(g.b.x, g.b.y);
    if (g.center && g.radiusMm != null) {
      grow(g.center.x - g.radiusMm, g.center.y - g.radiusMm);
      grow(g.center.x + g.radiusMm, g.center.y + g.radiusMm);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function evaluateOrientation(input: GateInput): Finding[] {
  const { mountType, bounds, reference } = input;
  const findings: Finding[] = [];

  // --- scale sanity ----------------------------------------------------------
  for (const axis of ["x", "y", "z"] as const) {
    const s = bounds.size[axis];
    if (!Number.isFinite(s) || s <= 0) {
      findings.push({
        check: "scale",
        severity: "error",
        message: `degenerate extent on ${axis} (${s})`,
      });
    } else if (s < SIZE_MIN || s > SIZE_MAX) {
      findings.push({
        check: "scale",
        severity: "error",
        message: `implausible ${axis} extent ${s.toFixed(2)}mm (expected ${SIZE_MIN}–${SIZE_MAX}mm) — wrong STEP unit?`,
      });
    }
  }

  // --- on-board (z) ----------------------------------------------------------
  if (mountType === "tht") {
    const leadBudget =
      input.orientationHint === "vertical"
        ? THT_LEAD_BELOW_VERTICAL
        : THT_LEAD_BELOW_MAX;
    if (bounds.min.z < -leadBudget) {
      findings.push({
        check: "on-board",
        severity: "error",
        message: `THT body extends ${(-bounds.min.z).toFixed(2)}mm below board (> ${leadBudget}mm lead budget${input.orientationHint === "vertical" ? " for vertical posture" : ""}) — likely mis-oriented`,
      });
    }
    if (bounds.max.z < THT_MIN_BODY_HEIGHT) {
      findings.push({
        check: "on-board",
        severity: "error",
        message: `THT body barely rises above board (max.z=${bounds.max.z.toFixed(2)}mm) — likely lying down`,
      });
    }
  } else {
    if (bounds.min.z < -SMD_BASE_BELOW_TOL) {
      findings.push({
        check: "on-board",
        severity: "error",
        message: `body sinks ${(-bounds.min.z).toFixed(2)}mm below board plane (min.z<${-SMD_BASE_BELOW_TOL}) — classic mis-rotation (e.g. baked rotationDeg.x=±90)`,
      });
    } else if (bounds.min.z > SMD_BASE_ABOVE_TOL) {
      findings.push({
        check: "on-board",
        severity: "warning",
        message: `body floats ${bounds.min.z.toFixed(2)}mm above board (min.z>${SMD_BASE_ABOVE_TOL}) — missing offset or wrong origin`,
      });
    }
    if (bounds.max.z < MIN_BODY_HEIGHT) {
      findings.push({
        check: "up-axis",
        severity: "error",
        message: `no vertical extent above board (max.z=${bounds.max.z.toFixed(2)}mm) — model appears flat/lying down`,
      });
    }
  }

  // --- up-axis for tall THT: vertical must dominate the CROSS axis -----------
  // Only meaningful for parts that are SUPPOSED to stand vertical; horizontal
  // axial parts (and unknown postures) legitimately lie flat, so skip them.
  // Compare z against the SMALLER horizontal axis: long pin rows (1x12 header,
  // IDC shroud) are legitimately wider along the row than they are tall, but a
  // tipped part always lands with z collapsed to the small cross-section while
  // its former height becomes a horizontal axis — which this still catches.
  if (mountType === "tht" && input.orientationHint === "vertical") {
    const horizMin = Math.min(bounds.size.x, bounds.size.y);
    if (bounds.size.z < 0.8 * horizMin) {
      findings.push({
        check: "up-axis",
        severity: "warning",
        message: `vertical extent (${bounds.size.z.toFixed(2)}mm) is smaller than the horizontal cross-section (${horizMin.toFixed(2)}mm) — vertical THT part may be tipped`,
      });
    }
  }

  // --- XY centering + coverage vs footprint ----------------------------------
  if (!reference) {
    findings.push({
      check: "xy",
      severity: "warning",
      message: "footprint has no pad/silk bounds to verify XY placement",
    });
  } else {
    const ref = reference;
    const rc = center2d(ref);
    const re = extent(ref);
    const dx = Math.abs(bounds.center.x - rc.x);
    const dy = Math.abs(bounds.center.y - rc.y);
    const tx = centerTol(re.x);
    const ty = centerTol(re.y);
    const xOff = dx > tx;
    const yOff = dy > ty;
    if (xOff || yOff) {
      // A vertical THT body legitimately sits behind the pad row (the tab/body
      // is offset along the posture axis while the leads land on the pads), so a
      // drift along the *single* posture axis is expected geometry, not a fault —
      // as long as it stays within the body's own depth. Beyond that budget, or
      // drifting on both axes / on a non-vertical part, is still a hard error.
      const bodyBehindPads =
        mountType === "tht" &&
        input.orientationHint === "vertical" &&
        yOff &&
        !xOff;
      const behindPadsBudget = Math.max(ty, 0.6 * bounds.size.y);
      if (bodyBehindPads && dy <= behindPadsBudget) {
        // expected geometry — no finding
      } else {
        findings.push({
          check: "xy-center",
          severity: "error",
          message: `model XY centre (${bounds.center.x.toFixed(2)}, ${bounds.center.y.toFixed(2)}) off footprint centre (${rc.x.toFixed(2)}, ${rc.y.toFixed(2)}) by (${dx.toFixed(2)}, ${dy.toFixed(2)})mm (tol ${tx.toFixed(2)}, ${ty.toFixed(2)})${bodyBehindPads ? ` — beyond the vertical-body budget (${behindPadsBudget.toFixed(2)}mm)` : " — wrong offset / mirror / in-plane rotation"}`,
        });
      }
    }
    // Coverage: body XY extent should be in the same ballpark as the footprint.
    // A THT part that is thin on one axis but stands tall (test-point loop,
    // vertical film cap) legitimately under-covers that axis — waive LOW ratios
    // when the body height exceeds the footprint extent on the failing axis. A
    // global scale error shrinks z too, so it still trips the waived condition.
    const ratioX = re.x > 0 ? bounds.size.x / re.x : Infinity;
    const ratioY = re.y > 0 ? bounds.size.y / re.y : Infinity;
    const lo = 0.4;
    const hi = 3.0;
    const thinStanding = (refAxis: number): boolean =>
      mountType === "tht" && bounds.size.z >= refAxis;
    const lowX = ratioX < lo && !thinStanding(re.x);
    const lowY = ratioY < lo && !thinStanding(re.y);
    if (lowX || lowY || ratioX > hi || ratioY > hi) {
      findings.push({
        check: "xy-coverage",
        severity: "warning",
        message: `model XY size (${bounds.size.x.toFixed(2)}, ${bounds.size.y.toFixed(2)}) vs footprint (${re.x.toFixed(2)}, ${re.y.toFixed(2)}) ratio (${ratioX.toFixed(2)}, ${ratioY.toFixed(2)}) outside [${lo}, ${hi}] — possible scale/rotation error`,
      });
    }
  }

  return findings;
}

export function worstSeverity(findings: Finding[]): Severity | null {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "review")) return "review";
  return null;
}
