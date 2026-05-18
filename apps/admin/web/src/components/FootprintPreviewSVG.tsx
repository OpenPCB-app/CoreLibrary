import type { FootprintPreview } from "../api";

const LAYER_COLOR: Record<string, string> = {
  "F.Cu": "#dc2626",
  "B.Cu": "#2563eb",
  "F.SilkS": "#e4e4e7",
  "B.SilkS": "#a1a1aa",
  "F.Mask": "rgba(168,85,247,0.25)",
  "F.Fab": "#facc15",
  "Edge.Cuts": "#facc15",
};

export function FootprintPreviewSVG({
  preview,
  size = 280,
}: {
  preview: FootprintPreview;
  size?: number;
}) {
  const pads = preview.pads ?? [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pads) {
    const hw = p.widthMm / 2;
    const hh = p.heightMm / 2;
    minX = Math.min(minX, p.centerMm.x - hw);
    maxX = Math.max(maxX, p.centerMm.x + hw);
    minY = Math.min(minY, p.centerMm.y - hh);
    maxY = Math.max(maxY, p.centerMm.y + hh);
  }
  if (!isFinite(minX)) {
    minX = -2;
    minY = -2;
    maxX = 2;
    maxY = 2;
  }
  const pad = 0.6;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const viewBox = `${minX - pad} ${minY - pad} ${w} ${h}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      style={{ transform: "scaleY(-1)", background: "#18181b" }}
    >
      {pads.map((p, i) => {
        const color = LAYER_COLOR[p.layer ?? "F.Cu"] ?? "#dc2626";
        const rx =
          p.shape === "roundrect" ? Math.min(p.widthMm, p.heightMm) * 0.25 : 0;
        const ry = rx;
        return (
          <g
            key={i}
            transform={`translate(${p.centerMm.x} ${p.centerMm.y}) rotate(${(p as { rotationDeg?: number; rotation?: number }).rotationDeg ?? p.rotation ?? 0})`}
          >
            {p.shape === "circle" ? (
              <circle r={Math.max(p.widthMm, p.heightMm) / 2} fill={color} />
            ) : (
              <rect
                x={-p.widthMm / 2}
                y={-p.heightMm / 2}
                width={p.widthMm}
                height={p.heightMm}
                rx={rx}
                ry={ry}
                fill={color}
              />
            )}
            <text
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.min(p.widthMm, p.heightMm) * 0.4}
              fill="#fff"
              style={{ transform: "scaleY(-1)" }}
            >
              {p.number}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
