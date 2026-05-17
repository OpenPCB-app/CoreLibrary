import type { SymbolPreview } from "../api";

interface Point {
  x: number;
  y: number;
}

function bbox(points: Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (!points.length) return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function collectPoints(preview: SymbolPreview): Point[] {
  const pts: Point[] = [];
  for (const g of preview.graphics ?? []) {
    if (g.kind === "polyline") pts.push(...g.points);
    else if (g.kind === "rect") {
      pts.push(g.start, g.end);
    } else if (g.kind === "circle") {
      pts.push(
        { x: g.center.x - g.radius, y: g.center.y - g.radius },
        { x: g.center.x + g.radius, y: g.center.y + g.radius },
      );
    } else if (g.kind === "arc") {
      pts.push(g.start, g.mid, g.end);
    }
  }
  for (const p of preview.pins ?? []) pts.push(p.position);
  return pts;
}

export function SymbolPreviewSVG({
  preview,
  size = 280,
}: {
  preview: SymbolPreview;
  size?: number;
}) {
  const pts = collectPoints(preview);
  const b = bbox(pts);
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
      {(preview.graphics ?? []).map((g, i) => {
        if (g.kind === "polyline") {
          const d = "M " + g.points.map((p) => `${p.x} ${p.y}`).join(" L ");
          return (
            <path
              key={i}
              d={d}
              stroke={stroke}
              strokeWidth={g.width ?? 0.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        if (g.kind === "rect") {
          const x = Math.min(g.start.x, g.end.x);
          const y = Math.min(g.start.y, g.end.y);
          const rw = Math.abs(g.end.x - g.start.x);
          const rh = Math.abs(g.end.y - g.start.y);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={rw}
              height={rh}
              stroke={stroke}
              strokeWidth={g.width ?? 0.2}
              fill={g.fill === "background" ? "#27272a" : "none"}
            />
          );
        }
        if (g.kind === "circle") {
          return (
            <circle
              key={i}
              cx={g.center.x}
              cy={g.center.y}
              r={g.radius}
              stroke={stroke}
              strokeWidth={g.width ?? 0.2}
              fill="none"
            />
          );
        }
        return null;
      })}
      {(preview.pins ?? []).map((pin, i) => (
        <g key={`pin-${i}`}>
          <circle
            cx={pin.position.x}
            cy={pin.position.y}
            r={0.4}
            fill="#fb923c"
          />
          <text
            x={pin.position.x}
            y={pin.position.y - 1.2}
            fontSize={1.2}
            fill="#e4e4e7"
            textAnchor="middle"
            style={{
              transform: "scaleY(-1)",
              transformOrigin: `${pin.position.x}px ${pin.position.y}px`,
            }}
          >
            {pin.number}
          </text>
        </g>
      ))}
    </svg>
  );
}
