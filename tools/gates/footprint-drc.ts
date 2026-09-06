/**
 * G10 (manufacturability DRC) + G11 (duplicate pad numbers) for footprints.
 *
 * Pure module: no IO, no process exit. `tools/validate.ts` wires it up and maps
 * severities to the exit code; the tests drive it with inline fixtures and with
 * the real `footprints/**` tree.
 *
 * Thresholds are JLCPCB 2-layer minima, exported so they can be tuned in one
 * place. They are deliberately the *fab* floor, not a house style: anything
 * under them cannot be built, anything over is a judgement call for the
 * librarian.
 */
import { finding, type GateFinding } from "./types";
import {
  boundsContains,
  boundsGap,
  boundsIntersect,
  escapeDistance,
  expandBounds,
  graphicBounds,
  graphicSegments,
  segmentIntersectsBounds,
  unionBounds,
  type Bounds2D,
  type PreviewGraphic,
} from "./geometry";
import {
  annularRingMm,
  collectCopperPads,
  drillSizeMm,
  sharesSide,
  type CopperPad,
  type DrcFootprint,
  type DrcPad,
  type Side,
} from "./footprint-pads";

export type { DrcFootprint, DrcPad } from "./footprint-pads";

export const DRC_LIMITS = {
  /** Smallest finished hole a 2-layer fab will drill. */
  minDrillMm: 0.3,
  /** Copper ring left around a hole after drill tolerance. */
  minAnnularMm: 0.13,
  /** Copper-to-copper spacing between different nets. */
  minCopperGapMm: 0.127,
  /** Silkscreen-to-pad clearance before the ink is clipped in production. */
  silkClearanceMm: 0.15,
  /** How close a pin-1 marker graphic has to sit to pad 1 to count. */
  pin1MarkerRadiusMm: 1.0,
} as const;

/** A broken footprint can produce O(n^2) gap findings; keep the report readable. */
const MAX_GAP_FINDINGS = 12;

const COURTYARD_LAYER = /(?:CrtYd|Courtyard)/i;
const SILK_LAYER = /^([FB])\.SilkS$/;
const MARKER_LAYER = /^[FB]\.(?:SilkS|Fab)$/;

// --- rules 1-3: drill + annular ring -----------------------------------------

function checkDrills(pads: readonly CopperPad[]): GateFinding[] {
  const out: GateFinding[] = [];
  for (const p of pads) {
    if (p.through && !p.drill) {
      out.push(
        finding("G10", "fail", `through-hole pad ${p.label} has no drill`),
      );
      continue;
    }
    if (!p.drill) continue;
    const size = drillSizeMm(p.drill);
    // Advisory only: 0.2 mm thermal vias inside module EPs are upstream
    // geometry a designer may keep on a 4-layer order. Never strict-fatal.
    if (size < DRC_LIMITS.minDrillMm) {
      out.push(
        finding(
          "G10",
          "note",
          `pad ${p.label} drill ${size.toFixed(3)}mm is below the ${DRC_LIMITS.minDrillMm}mm 2-layer minimum`,
        ),
      );
    }
    if (p.npth) continue;
    const ring = annularRingMm(p);
    if (ring === null) continue;
    if (ring <= 0) {
      out.push(
        finding(
          "G10",
          "fail",
          `pad ${p.label} annular ring ${ring.toFixed(3)}mm — the drill reaches or exceeds the pad edge`,
        ),
      );
    } else if (ring < DRC_LIMITS.minAnnularMm) {
      out.push(
        finding(
          "G10",
          "warn",
          `pad ${p.label} annular ring ${ring.toFixed(3)}mm is below the ${DRC_LIMITS.minAnnularMm}mm minimum`,
        ),
      );
    }
  }
  return out;
}

// --- rule 4: copper-to-copper gap --------------------------------------------

/**
 * Pads are compared as AABBs. That is conservative for circle/oval/roundrect —
 * the box is larger than the copper, so the reported gap is a lower bound and a
 * near-miss on two round pads may read tighter than it really is. Under-reporting
 * the gap is the safe direction for a fab-floor gate.
 */
function checkCopperGap(pads: readonly CopperPad[]): GateFinding[] {
  const hits: Array<{ gap: number; message: string }> = [];
  const coincident: string[] = [];
  for (let i = 0; i < pads.length; i += 1) {
    const a = pads[i];
    if (!a) continue;
    for (let j = i + 1; j < pads.length; j += 1) {
      const b = pads[j];
      if (!b || a.netKey === b.netKey || !sharesSide(a, b)) continue;
      // Two numbers on one identical land is KiCad's idiom for a contact the
      // part bridges internally (USB-C A1/B12 GND, A4/B9 VBUS). Not a short.
      if (sameBounds(a.bounds, b.bounds)) {
        coincident.push(`${a.label}/${b.label}`);
        continue;
      }
      const gap = boundsGap(a.bounds, b.bounds);
      if (gap >= DRC_LIMITS.minCopperGapMm) continue;
      hits.push({
        gap,
        message:
          gap < 0
            ? `pads ${a.label} and ${b.label} overlap by ${(-gap).toFixed(3)}mm on shared copper`
            : `copper gap ${gap.toFixed(3)}mm between pads ${a.label} and ${b.label} is below the ${DRC_LIMITS.minCopperGapMm}mm minimum`,
      });
    }
  }
  hits.sort((x, y) => x.gap - y.gap);
  const out = hits
    .slice(0, MAX_GAP_FINDINGS)
    .map((h) => finding("G10", "fail", h.message));
  if (hits.length > MAX_GAP_FINDINGS) {
    out.push(
      finding(
        "G10",
        "fail",
        `${hits.length - MAX_GAP_FINDINGS} further copper-gap violations not listed`,
      ),
    );
  }
  if (coincident.length > 0) {
    out.push(
      finding(
        "G10",
        "note",
        `coincident pads share one land (internal bridge): ${coincident.join(", ")}`,
      ),
    );
  }
  return out;
}

function sameBounds(a: Bounds2D, b: Bounds2D): boolean {
  const eps = 1e-6;
  return (
    Math.abs(a.minX - b.minX) < eps &&
    Math.abs(a.minY - b.minY) < eps &&
    Math.abs(a.maxX - b.maxX) < eps &&
    Math.abs(a.maxY - b.maxY) < eps
  );
}

// --- rule 5: courtyard encloses copper ---------------------------------------

function courtyardBounds(graphics: readonly PreviewGraphic[]): Bounds2D | null {
  const boxes: Bounds2D[] = [];
  for (const g of graphics) {
    if (!COURTYARD_LAYER.test(g.layer ?? "")) continue;
    const b = graphicBounds(g);
    if (b) boxes.push(b);
  }
  return unionBounds(boxes);
}

/** Courtyard geometry is a stroke centreline, so allow a hair of slop. */
const COURTYARD_TOL_MM = 0.01;

function checkCourtyardCoverage(
  pads: readonly CopperPad[],
  graphics: readonly PreviewGraphic[],
): GateFinding[] {
  const court = courtyardBounds(graphics);
  // A missing courtyard is G3's finding, not ours.
  if (!court) return [];
  const escaped = pads
    .filter((p) => !boundsContains(court, p.bounds, COURTYARD_TOL_MM))
    .map((p) => `${p.label} (+${escapeDistance(court, p.bounds).toFixed(3)}mm)`);
  if (escaped.length === 0) return [];
  return [
    finding(
      "G10",
      "fail",
      `courtyard does not enclose copper pad${escaped.length > 1 ? "s" : ""} ${escaped.join(", ")}`,
    ),
  ];
}

// --- rule 6: silkscreen over copper ------------------------------------------

/**
 * Straight geometry (`line`, `polyline`, `rect`) is tested as real segments so a
 * long diagonal outline is only flagged where it actually crosses the pad;
 * curved geometry (`circle`, `arc3`) falls back to its AABB, which over-reports
 * slightly. Stroke width is ignored — the clearance is measured to the
 * centreline, per {@link DRC_LIMITS.silkClearanceMm}.
 */
function silkHitsPad(g: PreviewGraphic, keepout: Bounds2D): boolean {
  const segs = graphicSegments(g);
  if (segs.length > 0) {
    return segs.some(([a, b]) => segmentIntersectsBounds(a, b, keepout));
  }
  const box = graphicBounds(g);
  return box !== null && boundsIntersect(box, keepout);
}

function checkSilkClearance(
  pads: readonly CopperPad[],
  graphics: readonly PreviewGraphic[],
): GateFinding[] {
  const hit = new Set<string>();
  for (const g of graphics) {
    const m = SILK_LAYER.exec(g.layer ?? "");
    if (!m) continue;
    const side = m[1] as Side;
    for (const p of pads) {
      if (!p.sides.includes(side) || hit.has(p.label)) continue;
      const keepout = expandBounds(p.bounds, DRC_LIMITS.silkClearanceMm);
      if (silkHitsPad(g, keepout)) hit.add(p.label);
    }
  }
  if (hit.size === 0) return [];
  // Advisory: upstream KiCad geometry (0402 silk, radial-cap outlines) trips
  // this legitimately; the fab clips silk over mask. Never strict-fatal.
  return [
    finding(
      "G10",
      "note",
      `silkscreen sits within ${DRC_LIMITS.silkClearanceMm}mm of pad${hit.size > 1 ? "s" : ""} ${[...hit].join(", ")}`,
    ),
  ];
}

// --- rule 7: pin-1 marker -----------------------------------------------------

function majorityShape(pads: readonly CopperPad[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pads) {
    const s = p.pad.shape ?? "";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [shape, n] of counts) {
    if (n > bestN) {
      best = shape;
      bestN = n;
    }
  }
  return bestN * 2 > pads.length ? best : null;
}

function checkPin1Marker(
  pads: readonly CopperPad[],
  graphics: readonly PreviewGraphic[],
): GateFinding[] {
  const numbered = pads.filter((p) => p.numbered);
  if (numbered.length <= 2) return [];
  const pin1 = numbered.find((p) => p.netKey === "1");
  if (!pin1) return [];
  const others = numbered.filter((p) => p.netKey !== "1");
  const majority = majorityShape(others);
  if (majority !== null && (pin1.pad.shape ?? "") !== majority) return [];
  const marked = graphics.some((g) => {
    if (!MARKER_LAYER.test(g.layer ?? "")) return false;
    const box = graphicBounds(g);
    return box !== null && boundsGap(box, pin1.bounds) <= DRC_LIMITS.pin1MarkerRadiusMm;
  });
  if (marked) return [];
  return [
    finding(
      "G10",
      "warn",
      `no pin-1 indicator: pad 1 has the same shape as the other pads and no silk/fab graphic sits within ${DRC_LIMITS.pin1MarkerRadiusMm}mm of it`,
    ),
  ];
}

// --- rule 8 (G11): duplicate pad numbers -------------------------------------

function checkDuplicateNumbers(pads: readonly CopperPad[]): GateFinding[] {
  const groups = new Map<string, CopperPad[]>();
  for (const p of pads) {
    if (!p.numbered) continue;
    const list = groups.get(p.netKey);
    if (list) list.push(p);
    else groups.set(p.netKey, [p]);
  }
  const dupes = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (dupes.length === 0) return [];
  const detail = dupes
    .map(([number, list]) => `"${number}" x${list.length}`)
    .join(", ");
  return [
    finding(
      "G11",
      "note",
      `duplicate copper pad numbers: ${detail} — legitimate for exposed-pad sub-pads and stacked pads, verify against the datasheet`,
    ),
  ];
}

// --- entry point --------------------------------------------------------------

/**
 * Collapse identical findings. Pads that share a number (EP sub-pads, the 22
 * stitching vias on ESP32-WROOM-32) are indistinguishable in a message, so the
 * same defect would otherwise be reported once per pad.
 */
function dedupe(findings: readonly GateFinding[]): GateFinding[] {
  const counts = new Map<string, { f: GateFinding; n: number }>();
  for (const f of findings) {
    const key = `${f.gate}${f.severity}${f.message}`;
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { f, n: 1 });
  }
  return [...counts.values()].map(({ f, n }) =>
    n === 1 ? f : finding(f.gate, f.severity, `${f.message} (x${n})`),
  );
}

export function checkFootprintDrc(fp: DrcFootprint): GateFinding[] {
  const graphics = fp.normalized?.preview?.graphics ?? [];
  const pads = collectCopperPads(fp);
  if (pads.length === 0) return [];
  return dedupe([
    ...checkDrills(pads),
    ...checkCopperGap(pads),
    ...checkCourtyardCoverage(pads, graphics),
    ...checkSilkClearance(pads, graphics),
    ...checkPin1Marker(pads, graphics),
    ...checkDuplicateNumbers(pads),
  ]);
}

// --- reporting ----------------------------------------------------------------

export interface DrcExtreme {
  valueMm: number;
  footprintId: string;
  padLabel: string;
}

export interface DrcSummary {
  footprints: number;
  copperPads: number;
  minAnnular: DrcExtreme | null;
  minDrill: DrcExtreme | null;
  minGap: DrcExtreme | null;
}

function keepMin(
  current: DrcExtreme | null,
  candidate: DrcExtreme,
): DrcExtreme {
  return current === null || candidate.valueMm < current.valueMm
    ? candidate
    : current;
}

/**
 * Library-wide extremes, for tests and reporting only — no findings, no
 * thresholds. Lets a release note quote the real floor the library sits at.
 */
export function summarizeDrc(fps: readonly DrcFootprint[]): DrcSummary {
  const summary: DrcSummary = {
    footprints: fps.length,
    copperPads: 0,
    minAnnular: null,
    minDrill: null,
    minGap: null,
  };
  for (const fp of fps) {
    const pads = collectCopperPads(fp);
    summary.copperPads += pads.length;
    for (const p of pads) {
      if (!p.drill) continue;
      const at = { footprintId: fp.id, padLabel: p.label };
      summary.minDrill = keepMin(summary.minDrill, {
        valueMm: drillSizeMm(p.drill),
        ...at,
      });
      // NPTH holes have no ring by construction; including them would peg the
      // library minimum at 0 and hide the real plated-hole floor.
      const ring = p.npth ? null : annularRingMm(p);
      if (ring !== null) {
        summary.minAnnular = keepMin(summary.minAnnular, {
          valueMm: ring,
          ...at,
        });
      }
    }
    for (let i = 0; i < pads.length; i += 1) {
      const a = pads[i];
      if (!a) continue;
      for (let j = i + 1; j < pads.length; j += 1) {
        const b = pads[j];
        if (!b || a.netKey === b.netKey || !sharesSide(a, b)) continue;
        if (sameBounds(a.bounds, b.bounds)) continue;
        summary.minGap = keepMin(summary.minGap, {
          valueMm: boundsGap(a.bounds, b.bounds),
          footprintId: fp.id,
          padLabel: `${a.label}/${b.label}`,
        });
      }
    }
  }
  return summary;
}
