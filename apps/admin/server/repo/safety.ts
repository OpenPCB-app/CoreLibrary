import { getIndex } from "./index-cache";

/**
 * Returns list of component ids that reference the given symbol/footprint.
 * Empty array = safe to delete.
 */
export function findReferencesToSymbol(symbolId: string): string[] {
  const idx = getIndex();
  const refs: string[] = [];
  for (const c of idx.components.values()) {
    if (c.file.symbol === symbolId) refs.push(c.file.id);
  }
  return refs;
}

export function findReferencesToFootprint(footprintId: string): string[] {
  const idx = getIndex();
  const refs: string[] = [];
  for (const c of idx.components.values()) {
    if (c.file.footprints.some((v) => v.footprint === footprintId)) {
      refs.push(c.file.id);
    }
  }
  return refs;
}

export function findFootprintsReferencingModel(slug: string): string[] {
  const idx = getIndex();
  const refs: string[] = [];
  for (const fp of idx.footprints.values()) {
    if ((fp.file.models3d ?? []).some((m) => m.includes(slug))) {
      refs.push(fp.file.id);
    }
  }
  return refs;
}
