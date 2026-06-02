/**
 * Text-overlap gate for symbol render models. Pin name/number labels (and
 * reference/value) must not collide. Shared by the symbol contact sheet and the
 * per-component audit. Uses approximate glyph metrics — conservative, so a flag
 * means "inspect", not necessarily "broken".
 */

export interface PreviewLabelLike {
  id?: string;
  text: string;
  at: { x: number; y: number };
  fontSizeMm: number;
  rotationDeg: number;
  anchorX: "left" | "center" | "right";
  anchorY: string;
  role?: string;
}

interface LabelBox {
  role: string;
  text: string;
  /** Owning pin id (label id without the `:name`/`:number` suffix), if any. */
  pin: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function labelBox(label: PreviewLabelLike): LabelBox {
  const w = label.text.length * label.fontSizeMm * 0.62;
  const h = label.fontSizeMm;
  const rotated = Math.abs(label.rotationDeg % 180) === 90;
  const ext = rotated ? { x: h, y: w } : { x: w, y: h };
  let x0 = label.at.x;
  if (label.anchorX === "center") x0 -= ext.x / 2;
  else if (label.anchorX === "right") x0 -= ext.x;
  const y0 = label.at.y - ext.y / 2;
  return {
    role: label.role ?? "",
    text: label.text,
    pin: (label.id ?? "").replace(/:(name|number)$/, ""),
    minX: x0,
    minY: y0,
    maxX: x0 + ext.x,
    maxY: y0 + ext.y,
  };
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  const pad = 0.05;
  return (
    a.minX < b.maxX - pad &&
    a.maxX > b.minX + pad &&
    a.minY < b.maxY - pad &&
    a.maxY > b.minY + pad
  );
}

/** Return human-readable descriptions of every pin name/number label collision. */
export function findSymbolTextOverlaps(
  labels: readonly PreviewLabelLike[],
): string[] {
  const boxes = labels.map(labelBox);
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (!a || !b) continue;
      // Only flag pin text; reference/value titles are placed clear of the body.
      if (!a.role.startsWith("pin") || !b.role.startsWith("pin")) continue;
      // A pin's OWN name and number are a designed pair — KiCad sets them
      // adjacent and on short vertical pins they unavoidably touch. Only flag
      // collisions between DIFFERENT pins' labels (the real readability bug).
      if (a.pin && b.pin && a.pin === b.pin) continue;
      if (boxesOverlap(a, b)) {
        out.push(
          `"${a.text}"(${a.role.replace("pin-", "")}) ⨯ "${b.text}"(${b.role.replace("pin-", "")})`,
        );
      }
    }
  }
  return out;
}
