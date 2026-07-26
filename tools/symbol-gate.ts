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
  /** Exact label anchor, used to detect deliberately coincident pins. */
  anchor: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Visible glyph count. KiCad marks sub/superscripts as `_{IN}` / `^{2}`; the
 * markup punctuation is not rendered, so counting it inflated every such label
 * by ~3 characters and manufactured overlaps (V_{IN} ⨯ V_{OUT} on the ME6211
 * was a phantom 0.3 mm collision).
 */
function visibleLength(text: string): number {
  return text.replace(/[_^]\{([^}]*)\}/g, "$1").length;
}

function labelBox(label: PreviewLabelLike): LabelBox {
  const w = visibleLength(label.text) * label.fontSizeMm * 0.62;
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
    anchor: `${label.at.x},${label.at.y}`,
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

export interface PreviewPinLike {
  id?: string;
  anchor: { x: number; y: number };
}

/**
 * Pin ids that share their anchor with another pin. KiCad's stacked-power
 * idiom draws every GND/VDD pad at one point, so their labels — names AND
 * numbers, which sit at different offsets from the same anchor — necessarily
 * overlap. That is by design, and validate.ts G1d already guarantees stacked
 * pins share a name (one net).
 */
function stackedPinIds(pins: readonly PreviewPinLike[]): Set<string> {
  const byAnchor = new Map<string, string[]>();
  for (const pin of pins) {
    if (!pin.id) continue;
    const key = `${pin.anchor.x},${pin.anchor.y}`;
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), pin.id]);
  }
  const stacked = new Set<string>();
  for (const ids of byAnchor.values()) {
    if (ids.length > 1) for (const id of ids) stacked.add(id);
  }
  return stacked;
}

/** Return human-readable descriptions of every pin name/number label collision. */
export function findSymbolTextOverlaps(
  labels: readonly PreviewLabelLike[],
  pins: readonly PreviewPinLike[] = [],
): string[] {
  const stacked = stackedPinIds(pins);
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
      // Deliberately coincident pins — see stackedPinIds. Flagging these buried
      // the real collisions in noise (14 of 15 flagged components were this).
      if (a.anchor === b.anchor) continue;
      if (a.pin && b.pin && stacked.has(a.pin) && stacked.has(b.pin)) continue;
      if (boxesOverlap(a, b)) {
        out.push(
          `"${a.text}"(${a.role.replace("pin-", "")}) ⨯ "${b.text}"(${b.role.replace("pin-", "")})`,
        );
      }
    }
  }
  return out;
}
