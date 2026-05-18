import { useEffect, useState } from "react";

import { api, modelUrl, type ComponentDetailResp } from "../api";
import { navigate } from "../router";
import { SymbolPreviewSVG } from "../components/SymbolPreviewSVG";
import { FootprintPreviewSVG } from "../components/FootprintPreviewSVG";
import { Model3DViewer } from "../components/Model3DViewer";

export function DetailPage({ id }: { id: string }) {
  const [data, setData] = useState<ComponentDetailResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [stepStatus, setStepStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    tags: string;
  }>({
    name: "",
    description: "",
    tags: "",
  });

  function reload() {
    api
      .componentDetail(id)
      .then((d) => {
        setData(d);
        setSelected(d.isDefault);
        setDraft({
          name: d.component.name,
          description: d.component.description ?? "",
          tags: (d.component.tags ?? []).join(", "),
        });
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }

  useEffect(() => reload(), [id]);

  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!data) return <div className="p-6 text-zinc-500">Loading…</div>;

  const variant =
    data.variants.find((v) => v.footprintId === selected) ?? data.variants[0];

  async function save() {
    await api.patchComponent(id, {
      name: draft.name,
      description: draft.description,
      tags: draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setEditing(false);
    reload();
  }

  async function onDelete() {
    if (!confirm(`Delete component ${data!.component.name}?`)) return;
    const deleteOrphans = confirm(
      "Also delete symbol & footprints that no other component references?",
    );
    const res = await api.deleteComponents([id], deleteOrphans);
    if (res.removed.length) navigate("browse");
    else alert("Nothing removed: " + JSON.stringify(res.skipped));
  }

  async function onUploadModel(file: File) {
    if (!variant?.footprint) return;
    const slug = variant.footprintId.split(".").pop() ?? variant.footprintId;
    const category = data!.component._category;
    await api.uploadModel(category, slug, file);
    reload();
  }

  async function onUploadStep(file: File) {
    if (!variant?.footprint) return;
    const slug = variant.footprintId.split(".").pop() ?? variant.footprintId;
    const category = data!.component._category;
    setStepBusy(true);
    setStepStatus(`Converting ${file.name}…`);
    try {
      const { convertStepToGlb } = await import("../three-d/step-to-glb");
      const bytes = await file.arrayBuffer();
      const result = await convertStepToGlb(bytes, {
        linearUnit: "millimeter",
        linearDeflectionType: "absolute_value",
        linearDeflection: 0.05,
        angularDeflection: 0.5,
      });
      if (result.status === "error") {
        setStepStatus(`Conversion failed: ${result.code} — ${result.message}`);
        return;
      }
      setStepStatus(
        `Uploading ${(result.glbBytes.byteLength / 1024).toFixed(1)} KB…`,
      );
      const glbFile = new File([result.glbBytes], `${slug}.glb`, {
        type: "model/gltf-binary",
      });
      await api.uploadModel(category, slug, glbFile, file);
      setStepStatus(`✓ Converted + uploaded`);
      reload();
    } catch (err) {
      setStepStatus(`Error: ${(err as Error).message}`);
    } finally {
      setStepBusy(false);
    }
  }

  const symbolPreview = data.symbol?.normalized?.preview;
  const footprintPreview = variant?.footprint?.normalized?.preview;

  // determine GLB url: derive from category + slug of selected footprint
  const fpSlug = variant?.footprintId.split(".").pop() ?? "";
  const glbCategory = data.component._category;
  const glbHref = variant?.footprint ? modelUrl(glbCategory, fpSlug) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline gap-4">
        <button
          onClick={() => navigate("browse")}
          className="text-zinc-400 hover:text-zinc-200"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold">{data.component.name}</h1>
        <span className="text-xs text-zinc-500">{data.component.id}</span>
        <div className="ml-auto flex gap-2">
          {editing ? (
            <>
              <button
                onClick={save}
                className="px-3 py-1 rounded bg-orange-600 hover:bg-orange-500 text-sm"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
              >
                Edit
              </button>
              <button
                onClick={onDelete}
                className="px-3 py-1 rounded bg-red-900 hover:bg-red-800 text-sm"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Metadata</h2>
          {editing ? (
            <div className="space-y-3">
              <label className="block">
                <div className="text-xs text-zinc-400">Name</div>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded"
                />
              </label>
              <label className="block">
                <div className="text-xs text-zinc-400">Description</div>
                <textarea
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  rows={3}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded"
                />
              </label>
              <label className="block">
                <div className="text-xs text-zinc-400">
                  Tags (comma-separated)
                </div>
                <input
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded"
                />
              </label>
            </div>
          ) : (
            <dl className="text-sm space-y-1.5">
              <div className="flex">
                <dt className="text-zinc-500 w-32">Description</dt>
                <dd>
                  {data.component.description || (
                    <em className="text-zinc-600">—</em>
                  )}
                </dd>
              </div>
              <div className="flex">
                <dt className="text-zinc-500 w-32">Category</dt>
                <dd>{data.component._category}</dd>
              </div>
              <div className="flex">
                <dt className="text-zinc-500 w-32">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {(data.component.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-800"
                    >
                      {t}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex">
                <dt className="text-zinc-500 w-32">Symbol</dt>
                <dd className="font-mono text-xs">{data.component.symbol}</dd>
              </div>
              <div className="flex">
                <dt className="text-zinc-500 w-32">License</dt>
                <dd>{data.component.provenance.license}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Symbol</h2>
          {symbolPreview ? (
            <SymbolPreviewSVG preview={symbolPreview as never} />
          ) : (
            <div className="text-sm text-zinc-500">No preview data.</div>
          )}
          {data.symbol && (
            <div className="text-xs text-zinc-500 mt-2">
              {data.symbol.name}
              {data.symbol.referencePrefix && (
                <> · ref {data.symbol.referencePrefix}</>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">
          Footprint variants ({data.variants.length})
        </h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {data.variants.map((v) => (
            <button
              key={v.footprintId}
              onClick={() => setSelected(v.footprintId)}
              className={`px-2 py-1 text-xs rounded border ${
                selected === v.footprintId
                  ? "bg-orange-600 border-orange-500 text-white"
                  : "bg-zinc-950 border-zinc-700 hover:border-zinc-500"
              }`}
            >
              {v.label}
              {v.footprintId === data.isDefault && (
                <span className="ml-1 opacity-70">★</span>
              )}
            </button>
          ))}
        </div>
        {variant && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500 mb-2">Footprint</div>
              {footprintPreview ? (
                <FootprintPreviewSVG preview={footprintPreview as never} />
              ) : (
                <div className="text-zinc-500 text-sm">No preview data.</div>
              )}
              <div className="text-xs text-zinc-400 mt-2">
                {variant.footprint?.name} ·{" "}
                {variant.footprint?.mountType ?? "—"}
              </div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500 mb-2">3D model</div>
              {variant.models3d.length > 0 && glbHref ? (
                <Model3DViewer url={glbHref} />
              ) : (
                <div className="text-zinc-500 text-sm">
                  No 3D model assigned.
                </div>
              )}
              <label className="mt-3 block text-xs text-zinc-400">
                Upload .glb:
                <input
                  type="file"
                  accept=".glb,model/gltf-binary"
                  data-testid="upload-glb"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadModel(f);
                  }}
                  className="block mt-1 text-xs"
                />
              </label>
              <label className="mt-2 block text-xs text-zinc-400">
                or upload .step (auto-convert):
                <input
                  type="file"
                  accept=".step,.stp"
                  disabled={stepBusy}
                  data-testid="upload-step"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadStep(f);
                  }}
                  className="block mt-1 text-xs disabled:opacity-50"
                />
              </label>
              {stepStatus && (
                <div className="mt-1 text-[11px] text-zinc-400">
                  {stepStatus}
                </div>
              )}
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500 mb-2">Pin map</div>
              <table className="text-xs w-full">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="text-left">Pin</th>
                    <th className="text-left">Pad</th>
                    <th className="text-left">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {variant.pinMap.map((m, i) => (
                    <tr key={i} className="border-t border-zinc-800">
                      <td>{m.pinNumber}</td>
                      <td>{m.padNumber}</td>
                      <td className="text-zinc-400">{m.pinName ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
