/**
 * 2D AABB + segment helpers shared by the footprint gates.
 *
 * `tools/orientation-gate.ts#referenceBounds` builds ONE union box for its
 * coverage heuristic and only understands the `a`/`b`/`center` graphic forms it
 * needs — it silently ignores `polyline`, `rect` and `arc3`. DRC needs
 * per-graphic bounds and real segment geometry for every preview kind, so the
 * parsing lives here instead of widening that gate's public surface (changing
 * `referenceBounds` would move the orientation gate's own results).
 *
 * Preview graphic kinds actually present in the library (`normalized.preview.graphics[]`):
 *   line     { a, b }
 *   polyline { points[], closed }
 *   rect     { x, y, width, height }   — x/y is the min corner
 *   circle   { center, radiusMm }
 *   arc3     { start, mid, end }       — 3-point arc
 */

export interface PointMm {
  x: number;
  y: number;
}

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Structural view of one `normalized.preview.graphics[]` entry. */
export interface PreviewGraphic {
  kind?: string;
  layer?: string;
  strokeWidthMm?: number;
  a?: PointMm;
  b?: PointMm;
  start?: PointMm;
  mid?: PointMm;
  end?: PointMm;
  center?: PointMm;
  radiusMm?: number;
  points?: PointMm[];
  closed?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function isPoint(p: PointMm | undefined): p is PointMm {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** ~15 degrees per tessellated segment — well under a 0.15mm silk clearance. */
const ARC_STEP_RAD = Math.PI / 12;

/**
 * Tessellate a 3-point arc into a polyline.
 *
 * Necessary rather than cosmetic: the round THT parts in the library (TO-92,
 * D5 LEDs, radial caps) draw a silk arc that curves *around* the pad row, so an
 * AABB stand-in for the arc reports a silk-over-pad hit that does not exist.
 * Collinear points degrade to the two straight chords.
 */
export function arcPoints(
  start: PointMm,
  mid: PointMm,
  end: PointMm,
): PointMm[] {
  const d =
    2 *
    (start.x * (mid.y - end.y) +
      mid.x * (end.y - start.y) +
      end.x * (start.y - mid.y));
  if (Math.abs(d) < 1e-12) return [start, mid, end];
  const s2 = start.x * start.x + start.y * start.y;
  const m2 = mid.x * mid.x + mid.y * mid.y;
  const e2 = end.x * end.x + end.y * end.y;
  const cx =
    (s2 * (mid.y - end.y) + m2 * (end.y - start.y) + e2 * (start.y - mid.y)) /
    d;
  const cy =
    (s2 * (end.x - mid.x) + m2 * (start.x - end.x) + e2 * (mid.x - start.x)) /
    d;
  const r = Math.hypot(start.x - cx, start.y - cy);
  const a0 = Math.atan2(start.y - cy, start.x - cx);
  const wrap = (t: number): number => {
    let v = t;
    while (v <= 0) v += 2 * Math.PI;
    while (v > 2 * Math.PI) v -= 2 * Math.PI;
    return v;
  };
  // Sweep counter-clockwise unless `mid` says the short way round is the other.
  const toMid = wrap(Math.atan2(mid.y - cy, mid.x - cx) - a0);
  const toEnd = wrap(Math.atan2(end.y - cy, end.x - cx) - a0);
  const sweep = toMid <= toEnd ? toEnd : toEnd - 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP_RAD));
  const pts: PointMm[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + (sweep * i) / steps;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function circlePoints(center: PointMm, radiusMm: number): PointMm[] {
  const steps = 32;
  const pts: PointMm[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (2 * Math.PI * i) / steps;
    pts.push({
      x: center.x + radiusMm * Math.cos(a),
      y: center.y + radiusMm * Math.sin(a),
    });
  }
  return pts;
}

export function boundsFromPoints(
  points: readonly (PointMm | undefined)[],
): Bounds2D | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (!isPoint(p)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function unionBounds(list: readonly Bounds2D[]): Bounds2D | null {
  if (list.length === 0) return null;
  let acc: Bounds2D | null = null;
  for (const b of list) {
    acc = acc
      ? {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        }
      : b;
  }
  return acc;
}

export function expandBounds(b: Bounds2D, marginMm: number): Bounds2D {
  return {
    minX: b.minX - marginMm,
    minY: b.minY - marginMm,
    maxX: b.maxX + marginMm,
    maxY: b.maxY + marginMm,
  };
}

/** True when `inner` sits inside `outer`, allowing `tolMm` of slop per side. */
export function boundsContains(
  outer: Bounds2D,
  inner: Bounds2D,
  tolMm = 0,
): boolean {
  return (
    inner.minX >= outer.minX - tolMm &&
    inner.minY >= outer.minY - tolMm &&
    inner.maxX <= outer.maxX + tolMm &&
    inner.maxY <= outer.maxY + tolMm
  );
}

/** How far `inner` pokes outside `outer` on its worst side (0 when contained). */
export function escapeDistance(outer: Bounds2D, inner: Bounds2D): number {
  return Math.max(
    0,
    outer.minX - inner.minX,
    outer.minY - inner.minY,
    inner.maxX - outer.maxX,
    inner.maxY - outer.maxY,
  );
}

/**
 * Edge-to-edge separation between two AABBs. Positive = clear gap (diagonal
 * boxes get the true corner-to-corner distance); 0 = touching; negative = the
 * boxes overlap, and the magnitude is the shallowest penetration depth.
 */
export function boundsGap(a: Bounds2D, b: Bounds2D): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY);
  if (dx > 0 && dy > 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

/** Strict overlap (touching edges do not count). */
export function boundsIntersect(a: Bounds2D, b: Bounds2D): boolean {
  return boundsGap(a, b) < 0;
}

/**
 * AABB of a `widthMm` x `heightMm` rectangle centred at `center` and rotated by
 * `rotationDeg`. Multiples of 90 take an exact branch so pad maths stays free
 * of trig dust; everything else uses the rotated-extent formula.
 */
export function rotatedRectBounds(
  center: PointMm,
  widthMm: number,
  heightMm: number,
  rotationDeg = 0,
): Bounds2D {
  const norm = (((rotationDeg ?? 0) % 360) + 360) % 360;
  let ex: number;
  let ey: number;
  if (Math.abs(norm % 90) < 1e-9) {
    const swap = Math.abs(norm - 90) < 1e-9 || Math.abs(norm - 270) < 1e-9;
    ex = (swap ? heightMm : widthMm) / 2;
    ey = (swap ? widthMm : heightMm) / 2;
  } else {
    const rad = (norm * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    ex = (widthMm / 2) * c + (heightMm / 2) * s;
    ey = (widthMm / 2) * s + (heightMm / 2) * c;
  }
  return {
    minX: center.x - ex,
    minY: center.y - ey,
    maxX: center.x + ex,
    maxY: center.y + ey,
  };
}

/**
 * Segment-vs-AABB test (Liang-Barsky clip). Used so a long diagonal silk line
 * is only flagged where it actually crosses a pad, not over its whole AABB.
 */
export function segmentIntersectsBounds(
  a: PointMm,
  b: PointMm,
  box: Bounds2D,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a.x - box.minX) &&
    clip(dx, box.maxX - a.x) &&
    clip(-dy, a.y - box.minY) &&
    clip(dy, box.maxY - a.y)
  );
}

/** AABB of one preview graphic. Arcs and circles are approximated by their box. */
export function graphicBounds(g: PreviewGraphic): Bounds2D | null {
  switch (g.kind) {
    case "line":
      return boundsFromPoints([g.a, g.b]);
    case "polyline":
      return boundsFromPoints(g.points ?? []);
    case "arc3":
      // Tessellated, not the 3 defining points: bounding those alone
      // understates the bulge of anything past a quarter turn.
      return isPoint(g.start) && isPoint(g.mid) && isPoint(g.end)
        ? boundsFromPoints(arcPoints(g.start, g.mid, g.end))
        : boundsFromPoints([g.start, g.mid, g.end]);
    case "circle": {
      if (!isPoint(g.center) || !Number.isFinite(g.radiusMm ?? NaN)) return null;
      const r = g.radiusMm ?? 0;
      return {
        minX: g.center.x - r,
        minY: g.center.y - r,
        maxX: g.center.x + r,
        maxY: g.center.y + r,
      };
    }
    case "rect": {
      const { x, y, width, height } = g;
      if (
        !Number.isFinite(x ?? NaN) ||
        !Number.isFinite(y ?? NaN) ||
        !Number.isFinite(width ?? NaN) ||
        !Number.isFinite(height ?? NaN)
      ) {
        return null;
      }
      const x0 = x ?? 0;
      const y0 = y ?? 0;
      return {
        minX: Math.min(x0, x0 + (width ?? 0)),
        minY: Math.min(y0, y0 + (height ?? 0)),
        maxX: Math.max(x0, x0 + (width ?? 0)),
        maxY: Math.max(y0, y0 + (height ?? 0)),
      };
    }
    default:
      return boundsFromPoints([g.a, g.b, g.start, g.mid, g.end, g.center]);
  }
}

/**
 * Stroke segments of a graphic, as `[from, to]` pairs. Straight kinds are
 * exact; `arc3` and `circle` are tessellated (see {@link arcPoints}). Empty
 * only for an unrecognised or malformed kind, where callers fall back to
 * {@link graphicBounds}.
 */
export function graphicSegments(g: PreviewGraphic): Array<[PointMm, PointMm]> {
  const segs: Array<[PointMm, PointMm]> = [];
  const chain = (points: readonly PointMm[], closed: boolean): void => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const from = points[i];
      const to = points[i + 1];
      if (isPoint(from) && isPoint(to)) segs.push([from, to]);
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (closed && points.length > 2 && isPoint(first) && isPoint(last)) {
      segs.push([last, first]);
    }
  };
  if (g.kind === "line" && isPoint(g.a) && isPoint(g.b)) segs.push([g.a, g.b]);
  else if (g.kind === "polyline") chain(g.points ?? [], g.closed === true);
  else if (g.kind === "arc3") {
    if (isPoint(g.start) && isPoint(g.mid) && isPoint(g.end)) {
      chain(arcPoints(g.start, g.mid, g.end), false);
    }
  } else if (g.kind === "circle") {
    if (isPoint(g.center) && Number.isFinite(g.radiusMm ?? NaN)) {
      chain(circlePoints(g.center, g.radiusMm ?? 0), true);
    }
  } else if (g.kind === "rect") {
    const box = graphicBounds(g);
    if (box) {
      chain(
        [
          { x: box.minX, y: box.minY },
          { x: box.maxX, y: box.minY },
          { x: box.maxX, y: box.maxY },
          { x: box.minX, y: box.maxY },
        ],
        true,
      );
    }
  }
  return segs;
}
