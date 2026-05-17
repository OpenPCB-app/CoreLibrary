import { getIndex } from "../repo/index-cache";
import { ok, problem, type Handler } from "../http";

export const getSymbol: Handler = (_req, params) => {
  const s = getIndex().symbols.get(params.id!);
  if (!s) return problem(404, "not-found", `symbol ${params.id}`);
  return ok(s.file);
};

export const getFootprint: Handler = (_req, params) => {
  const f = getIndex().footprints.get(params.id!);
  if (!f) return problem(404, "not-found", `footprint ${params.id}`);
  return ok(f.file);
};

export const listSymbols: Handler = () => {
  const idx = getIndex();
  return ok({
    items: [...idx.symbols.values()].map(({ file, category }) => ({
      id: file.id,
      name: file.name,
      category,
      referencePrefix: file.referencePrefix ?? null,
    })),
  });
};

export const listFootprints: Handler = () => {
  const idx = getIndex();
  return ok({
    items: [...idx.footprints.values()].map(({ file, category }) => ({
      id: file.id,
      name: file.name,
      category,
      mountType: file.mountType ?? null,
      models3d: file.models3d ?? [],
    })),
  });
};
