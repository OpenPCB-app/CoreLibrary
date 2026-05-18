/**
 * Symbol preview renderer. Robust against two shapes of `normalized.preview`:
 *   (A) legacy seed format — graphics: {rect: {start,end}}, pins: {position}
 *   (B) shared/rendering FootprintRenderModel — graphics: {rect: {x,y,width,height}}, pins: {anchor, bodyEnd}
 *
 * The shapes are normalized to a canonical {points,rects,circles,pins} struct
 * before SVG output.
 */
interface Pt {
  x: number;
  y: number;
}

interface Canonical {
  paths: Array<{ pts: Pt[]; width: number }>;
  rects: Array<{ x: number; y: number; w: number; h: number; fill: string }>;
  circles: Array<{ cx: number; cy: number; r: number; width: number }>;
  pins: Array<{ x: number; y: number; number: string }>;
}

function asPt(v: unknown): Pt | null {
  if (v && typeof v === "object" && "x" in v && "y" in v) {
    const o = v as { x: unknown; y: unknown };
    if (typeof o.x === "number" && typeof o.y === "number") {
      return { x: o.x, y: o.y };
    }
  }
  return null;
}

function normalize(preview: unknown): Canonical {
  const out: Canonical = { paths: [], rects: [], circles: [], pins: [] };
  if (!preview || typeof preview !== "object") return out;
  const p = preview as Record<string, unknown>;

  for (const g of (p.graphics as unknown[]) ?? []) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const kind = obj.kind;
    const width =
      typeof obj.width === "number"
        ? obj.width
        : typeof obj.strokeWidthMm === "number"
          ? obj.strokeWidthMm
          : 0.2;
    if (kind === "polyline" && Array.isArray(obj.points)) {
      const pts = (obj.points as unknown[])
        .map((q) => asPt(q))
        .filter((q): q is Pt => q !== null);
      out.paths.push({ pts, width });
    } else if (kind === "rect") {
      const start = asPt(obj.start);
      const end = asPt(obj.end);
      if (start && end) {
        out.rects.push({
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w: Math.abs(end.x - start.x),
          h: Math.abs(end.y - start.y),
          fill: typeof obj.fill === "string" ? obj.fill : "none",
        });
      } else if (
        typeof obj.x === "number" &&
        typeof obj.y === "number" &&
        typeof obj.width === "number" &&
        typeof obj.height === "number"
      ) {
        out.rects.push({
          x: obj.x,
          y: obj.y,
          w: obj.width,
          h: obj.height,
          fill: typeof obj.fill === "string" ? obj.fill : "none",
        });
      }
    } else if (kind === "circle") {
      const center = asPt(obj.center);
      if (center && typeof obj.radius === "number") {
        out.circles.push({
          cx: center.x,
          cy: center.y,
          r: obj.radius,
          width,
        });
      }
    }
  }

  for (const pinRaw of (p.pins as unknown[]) ?? []) {
    if (!pinRaw || typeof pinRaw !== "object") continue;
    const pin = pinRaw as Record<string, unknown>;
    const at = asPt(pin.position) ?? asPt(pin.anchor) ?? asPt(pin.bodyEnd);
    if (!at) continue;
    const number =
      typeof pin.number === "string"
        ? pin.number
        : typeof pin.name === "string"
          ? pin.name
          : "";
    out.pins.push({ x: at.x, y: at.y, number });
  }
  return out;
}

function bbox(c: Canonical) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const push = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const pa of c.paths) for (const pt of pa.pts) push(pt.x, pt.y);
  for (const r of c.rects) {
    push(r.x, r.y);
    push(r.x + r.w, r.y + r.h);
  }
  for (const c2 of c.circles) {
    push(c2.cx - c2.r, c2.cy - c2.r);
    push(c2.cx + c2.r, c2.cy + c2.r);
  }
  for (const pin of c.pins) push(pin.x, pin.y);
  if (!isFinite(minX)) return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  return { minX, minY, maxX, maxY };
}

export function SymbolPreviewSVG({
  preview,
  size = 280,
}: {
  preview: unknown;
  size?: number;
}) {
  const c = normalize(preview);
  const b = bbox(c);
  const pad = 3;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const viewBox = `${b.minX - pad} ${b.minY - pad} ${w} ${h}`;
  const stroke = "#a1a1aa";

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      style={{ transform: "scaleY(-1)", background: "#18181b" }}
    >
      {c.paths.map((p, i) => (
        <path
          key={`p-${i}`}
          d={"M " + p.pts.map((pt) => `${pt.x} ${pt.y}`).join(" L ")}
          stroke={stroke}
          strokeWidth={p.width || 0.2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {c.rects.map((r, i) => (
        <rect
          key={`r-${i}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          stroke={stroke}
          strokeWidth={0.2}
          fill={r.fill === "background" ? "#27272a" : "none"}
        />
      ))}
      {c.circles.map((cc, i) => (
        <circle
          key={`c-${i}`}
          cx={cc.cx}
          cy={cc.cy}
          r={cc.r}
          stroke={stroke}
          strokeWidth={cc.width || 0.2}
          fill="none"
        />
      ))}
      {c.pins.map((pin, i) => (
        <g key={`pin-${i}`}>
          <circle cx={pin.x} cy={pin.y} r={0.4} fill="#fb923c" />
          <text
            x={pin.x}
            y={pin.y - 1.2}
            fontSize={1.2}
            fill="#e4e4e7"
            textAnchor="middle"
            style={{
              transform: "scaleY(-1)",
              transformOrigin: `${pin.x}px ${pin.y}px`,
            }}
          >
            {pin.number}
          </text>
        </g>
      ))}
    </svg>
  );
}
