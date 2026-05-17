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
};

export function modelUrl(category: string, slug: string): string {
  return `/api/models/${encodeURIComponent(category)}/${encodeURIComponent(slug)}.glb`;
}
