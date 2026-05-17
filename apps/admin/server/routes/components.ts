import { existsSync, unlinkSync } from "node:fs";
import { getIndex } from "../repo/index-cache";
import { writeJsonFile } from "../repo/write";
import {
  findReferencesToFootprint,
  findReferencesToSymbol,
} from "../repo/safety";
import { ok, problem, type Handler } from "../http";

export const listComponents: Handler = (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const tagsParam = url.searchParams.get("tags");
  const requiredTags = tagsParam
    ? tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const idx = getIndex();
  const items = [...idx.components.values()]
    .filter(({ file }) => {
      if (q) {
        const hay = [
          file.id,
          file.name,
          file.description ?? "",
          (file.tags ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (requiredTags.length) {
        const have = new Set(file.tags ?? []);
        if (!requiredTags.every((t) => have.has(t))) return false;
      }
      return true;
    })
    .map(({ file, category }) => ({
      id: file.id,
      name: file.name,
      description: file.description,
      category,
      tags: file.tags ?? [],
      symbol: file.symbol,
      defaultFootprint: file.defaultFootprint,
      footprintCount: file.footprints.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return ok({ items, total: items.length });
};

export const getComponentDetail: Handler = (_req, params) => {
  const idx = getIndex();
  const c = idx.components.get(params.id!);
  if (!c) return problem(404, "not-found", `component ${params.id}`);

  const symbol = idx.symbols.get(c.file.symbol)?.file ?? null;
  const variants = c.file.footprints.map((v) => {
    const fp = idx.footprints.get(v.footprint);
    const models3d = fp?.file.models3d ?? [];
    return {
      footprintId: v.footprint,
      label: v.label,
      pinMap: v.pinMap ?? [],
      footprint: fp?.file ?? null,
      models3d,
    };
  });

  return ok({
    component: { ...c.file, _category: c.category },
    symbol,
    variants,
    isDefault: c.file.defaultFootprint,
  });
};

export const patchComponent: Handler = async (req, params) => {
  const idx = getIndex();
  const c = idx.components.get(params.id!);
  if (!c) return problem(404, "not-found", `component ${params.id}`);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    tags?: string[];
  } | null;
  if (!body) return problem(400, "invalid-body", "JSON body required");

  const next = { ...c.file };
  if (typeof body.name === "string") next.name = body.name;
  if (typeof body.description === "string") next.description = body.description;
  if (Array.isArray(body.tags)) {
    next.tags = body.tags.filter((t) => typeof t === "string");
  }
  writeJsonFile(c.absPath, next);
  return ok({ id: next.id });
};

export const deleteComponents: Handler = async (req) => {
  const body = (await req.json().catch(() => null)) as {
    ids?: string[];
    deleteOrphans?: boolean;
  } | null;
  if (!body || !Array.isArray(body.ids)) {
    return problem(400, "invalid-body", "ids[] required");
  }
  const idx = getIndex();
  const removed: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const id of body.ids) {
    const c = idx.components.get(id);
    if (!c) {
      skipped.push({ id, reason: "not-found" });
      continue;
    }
    unlinkSync(c.absPath);
    removed.push(id);

    if (body.deleteOrphans) {
      const symId = c.file.symbol;
      const sym = idx.symbols.get(symId);
      if (
        sym &&
        existsSync(sym.absPath) &&
        findReferencesToSymbol(symId).filter((r) => r !== id).length === 0
      ) {
        unlinkSync(sym.absPath);
      }
      for (const v of c.file.footprints) {
        const fp = idx.footprints.get(v.footprint);
        if (
          fp &&
          existsSync(fp.absPath) &&
          findReferencesToFootprint(v.footprint).filter((r) => r !== id)
            .length === 0
        ) {
          unlinkSync(fp.absPath);
        }
      }
    }
  }
  // Rebuild after batch
  const { rebuildIndex } = await import("../repo/index-cache");
  rebuildIndex();
  return ok({ removed, skipped });
};

export const listTags: Handler = () => {
  const idx = getIndex();
  const counts = new Map<string, number>();
  for (const c of idx.components.values()) {
    for (const t of c.file.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const items = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return ok({ items });
};
