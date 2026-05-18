async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body || res.statusText}`);
  }
  const json = (await res.json()) as { ok: boolean; data: T };
  return json.data;
}

export interface ComponentListItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  tags: string[];
  symbol: string;
  defaultFootprint: string;
  footprintCount: number;
}

export interface ComponentDetailResp {
  component: {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    symbol: string;
    defaultFootprint: string;
    footprints: Array<{
      footprint: string;
      label: string;
      pinMap?: Array<{
        pinNumber: string;
        padNumber: string;
        pinName?: string;
      }>;
    }>;
    provenance: { source: string; license: string };
    _category: string;
  };
  symbol: SymbolFile | null;
  variants: Array<{
    footprintId: string;
    label: string;
    pinMap: Array<{ pinNumber: string; padNumber: string; pinName?: string }>;
    footprint: FootprintFile | null;
    models3d: string[];
  }>;
  isDefault: string;
}

export interface SymbolFile {
  id: string;
  name: string;
  referencePrefix?: string;
  normalized?: {
    preview?: SymbolPreview;
  };
}

export interface FootprintFile {
  id: string;
  name: string;
  mountType?: string;
  models3d?: string[];
  normalized?: {
    preview?: FootprintPreview;
  };
}

export interface SymbolPreview {
  kind: "symbol";
  units: "mm";
  name: string;
  graphics?: Array<
    | {
        kind: "polyline";
        points: Array<{ x: number; y: number }>;
        width?: number;
      }
    | {
        kind: "rect";
        start: { x: number; y: number };
        end: { x: number; y: number };
        width?: number;
        fill?: string;
      }
    | {
        kind: "circle";
        center: { x: number; y: number };
        radius: number;
        width?: number;
      }
    | {
        kind: "arc";
        start: { x: number; y: number };
        mid: { x: number; y: number };
        end: { x: number; y: number };
        width?: number;
      }
  >;
  pins?: Array<{
    number: string;
    name?: string;
    position: { x: number; y: number };
    length?: number;
    rotation?: number;
  }>;
}

export interface FootprintPreview {
  kind: "footprint";
  units: "mm";
  name: string;
  pads?: Array<{
    number: string;
    shape: string;
    centerMm: { x: number; y: number };
    widthMm: number;
    heightMm: number;
    rotation?: number;
    layer?: string;
  }>;
  graphics?: Array<{
    kind: "line" | "rect" | "circle" | "arc";
    layer?: string;
    [k: string]: unknown;
  }>;
}

export const api = {
  info: () =>
    call<{ name: string; version: string; repoRoot: string }>("/api/info"),
  components: (q?: string, tags?: string[]) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (tags && tags.length) u.set("tags", tags.join(","));
    return call<{ items: ComponentListItem[]; total: number }>(
      `/api/components${u.toString() ? `?${u}` : ""}`,
    );
  },
  componentDetail: (id: string) =>
    call<ComponentDetailResp>(
      `/api/components/${encodeURIComponent(id)}/detail`,
    ),
  tags: () =>
    call<{ items: Array<{ tag: string; count: number }> }>("/api/tags"),
  patchComponent: (
    id: string,
    patch: { name?: string; description?: string; tags?: string[] },
  ) =>
    call<{ id: string }>(`/api/components/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  deleteComponents: (ids: string[], deleteOrphans = false) =>
    call<{ removed: string[]; skipped: Array<{ id: string; reason: string }> }>(
      "/api/components/delete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, deleteOrphans }),
      },
    ),
  uploadModel: async (
    category: string,
    slug: string,
    glb: File,
    step?: File,
  ) => {
    const form = new FormData();
    form.set("glb", glb);
    if (step) form.set("step", step);
    const res = await fetch(
      `/api/models/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
      { method: "POST", body: form },
    );
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return (await res.json()).data;
  },
  validate: () =>
    call<{ code: number; stdout: string; stderr: string }>("/api/validate", {
      method: "POST",
    }),
  pack: () =>
    call<{ code: number; stdout: string; stderr: string; artifact?: string }>(
      "/api/pack",
      { method: "POST" },
    ),
  gitStatus: () =>
    call<{ dirty: number; files: Array<{ status: string; path: string }> }>(
      "/api/git/status",
    ),

  inspectKicad: async (files: File[]) => {
    const form = new FormData();
    files.forEach((f, i) => form.append(`f${i}`, f));
    const res = await fetch("/api/imports/kicad/inspect", {
      method: "POST",
      body: form,
    });
    const json = (await res.json()) as
      | { ok: true; data: InspectResp }
      | { detail: string; type: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      throw new Error(
        ("detail" in json && json.detail) || `inspect ${res.status}`,
      );
    }
    return json.data;
  },

  listTemplates: () => call<{ items: TemplateInfo[] }>("/api/templates"),

  materializeTemplate: async (
    id: string,
    body: {
      values: Record<string, unknown>;
      category: string;
      license: string;
      slug?: string;
      conflictPolicy?: "refuse" | "overwrite";
    },
  ) => {
    const res = await fetch(
      `/api/templates/${encodeURIComponent(id)}/materialize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json()) as
      | {
          ok: true;
          data: { footprintId: string; path: string; tags: string[] };
        }
      | { detail: string; type: string };
    if (!res.ok || !("ok" in json) || !json.ok) {
      const err = new Error(
        ("detail" in json && json.detail) || `materialize ${res.status}`,
      );
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return json.data;
  },

  commitKicad: async (body: CommitBody) => {
    const res = await fetch("/api/imports/kicad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as
      | { ok: true; data: CommitResp }
      | { detail: string; type: string; status: number };
    if (!res.ok || !("ok" in json) || !json.ok) {
      const err = new Error(
        ("detail" in json && json.detail) || `commit ${res.status}`,
      );
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return json.data;
  },
};

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  schema: { fields: TemplateField[] };
  defaults: Record<string, unknown>;
  generatorVersion: number;
}

export type TemplateField =
  | {
      kind: "int" | "float";
      key: string;
      label: string;
      description?: string;
      unit?: string;
      min: number;
      max: number;
      default: number;
      step?: number;
    }
  | {
      kind: "enum";
      key: string;
      label: string;
      description?: string;
      options: { value: string; label: string }[];
      default: string;
    }
  | {
      kind: "bool";
      key: string;
      label: string;
      description?: string;
      default: boolean;
    };

export interface InspectFootprint {
  id: string;
  fileName: string;
  name: string;
  mountType: string;
  padCount: number;
  packageCode: { imperial: string | null; metric: string | null };
  warningCount: number;
  preview: FootprintPreview;
}

export interface InspectSymbol {
  id: string;
  name: string;
  referencePrefix: string;
  pinCount: number;
  description: string | null;
  warningCount: number;
  preview: SymbolPreview;
}

export interface InspectResp {
  symbols: InspectSymbol[];
  footprints: InspectFootprint[];
  warnings: Array<{
    scope: string;
    itemId: string;
    itemName: string;
    code: string;
    message: string;
  }>;
  _inputs: {
    symbolLibrary: { fileName: string; content: string };
    footprints: Array<{ fileName: string; content: string }>;
    model3dFiles: Array<{ fileName: string }>;
  };
}

export interface CommitBody {
  inputs: InspectResp["_inputs"];
  selection: { symbolId: string; footprintId: string };
  component: {
    name: string;
    description?: string;
    category: string;
    license: string;
    tags?: string[];
    attribution?: string[];
    slug?: string;
  };
  conflictPolicy?: "refuse" | "overwrite";
}

export interface CommitResp {
  componentId: string;
  symbolId: string;
  footprintId: string | null;
  paths: {
    symbol: string;
    footprint: string | null;
    component: string;
  };
}

export function modelUrl(category: string, slug: string): string {
  return `/api/models/${encodeURIComponent(category)}/${encodeURIComponent(slug)}.glb`;
}
