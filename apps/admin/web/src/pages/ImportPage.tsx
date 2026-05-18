import { useState } from "react";
import {
  api,
  type CommitResp,
  type InspectFootprint,
  type InspectResp,
  type InspectSymbol,
} from "../api";
import { navigate } from "../router";
import { SymbolPreviewSVG } from "../components/SymbolPreviewSVG";
import { FootprintPreviewSVG } from "../components/FootprintPreviewSVG";

type Step = "upload" | "select" | "meta" | "result";

const SPDX_PRESETS = [
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC0-1.0",
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "proprietary",
];

export function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [inspect, setInspect] = useState<InspectResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>("");
  const [selectedFootprintId, setSelectedFootprintId] = useState<string>("");
  const [meta, setMeta] = useState({
    name: "",
    description: "",
    category: "imported",
    license: "CC-BY-4.0",
    licenseOverride: "",
    attribution: "",
    tags: "",
    slug: "",
  });
  const [result, setResult] = useState<CommitResp | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  async function doInspect() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.inspectKicad(files);
      setInspect(data);
      setSelectedSymbolId(data.symbols[0]?.id ?? "");
      setSelectedFootprintId(data.footprints[0]?.id ?? "");
      const firstSym = data.symbols[0];
      const firstFp = data.footprints[0];
      setMeta((m) => ({
        ...m,
        name: firstSym?.name
          ? `${firstSym.name}${firstFp ? " " + firstFp.name : ""}`
          : m.name,
      }));
      setStep("select");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doCommit(overwrite = false) {
    if (!inspect) return;
    setBusy(true);
    setError(null);
    setConflictMessage(null);
    try {
      const license =
        meta.license === "Other (free-text)"
          ? meta.licenseOverride
          : meta.license;
      const data = await api.commitKicad({
        inputs: inspect._inputs,
        selection: {
          symbolId: selectedSymbolId,
          footprintId: selectedFootprintId,
        },
        component: {
          name: meta.name,
          description: meta.description,
          category: meta.category,
          license,
          tags: meta.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          attribution: meta.attribution
            ? meta.attribution
                .split("\n")
                .map((a) => a.trim())
                .filter(Boolean)
            : undefined,
          ...(meta.slug ? { slug: meta.slug } : {}),
        },
        ...(overwrite ? { conflictPolicy: "overwrite" as const } : {}),
      });
      setResult(data);
      setStep("result");
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) {
        setConflictMessage(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const sym: InspectSymbol | undefined = inspect?.symbols.find(
    (s) => s.id === selectedSymbolId,
  );
  const fp: InspectFootprint | undefined = inspect?.footprints.find(
    (f) => f.id === selectedFootprintId,
  );

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <header className="flex items-baseline gap-4">
        <h1 className="text-2xl font-bold">Import KiCad</h1>
        <div className="text-xs text-zinc-500">
          .kicad_sym + .kicad_mod, or a .zip
        </div>
      </header>

      <StepBar step={step} />

      {error && (
        <div className="p-3 rounded bg-red-950/60 border border-red-800 text-sm text-red-300">
          {error}
        </div>
      )}

      {step === "upload" && (
        <section className="space-y-4">
          <label
            className="block border-2 border-dashed border-zinc-700 rounded-lg p-8 text-center cursor-pointer hover:border-orange-600"
            data-testid="import-dropzone"
          >
            <input
              type="file"
              multiple
              accept=".kicad_sym,.kicad_mod,.zip,.step,.stp,.glb"
              className="hidden"
              onChange={(e) => {
                const list = e.target.files;
                if (!list) return;
                setFiles(Array.from(list));
              }}
            />
            <div className="text-sm">
              {files.length > 0
                ? `${files.length} file(s) selected`
                : "Click to choose files…"}
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              You need at least one .kicad_sym and one .kicad_mod (or a .zip
              containing them).
            </div>
          </label>
          {files.length > 0 && (
            <ul className="text-xs text-zinc-400 list-disc pl-6">
              {files.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
          )}
          <button
            disabled={busy || files.length === 0}
            onClick={doInspect}
            className="px-4 py-2 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-sm"
            data-testid="inspect-btn"
          >
            {busy ? "Inspecting…" : "Inspect →"}
          </button>
        </section>
      )}

      {step === "select" && inspect && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="font-semibold mb-2 text-sm">Symbols</h3>
              <select
                value={selectedSymbolId}
                onChange={(e) => setSelectedSymbolId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm mb-3"
                data-testid="symbol-select"
              >
                {inspect.symbols.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.pinCount} pins)
                  </option>
                ))}
              </select>
              {sym && <SymbolPreviewSVG preview={sym.preview as never} />}
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h3 className="font-semibold mb-2 text-sm">Footprints</h3>
              <select
                value={selectedFootprintId}
                onChange={(e) => setSelectedFootprintId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm mb-3"
                data-testid="footprint-select"
              >
                {inspect.footprints.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.padCount} pads, {f.mountType})
                  </option>
                ))}
              </select>
              {fp && <FootprintPreviewSVG preview={fp.preview as never} />}
            </div>
          </div>
          {inspect.warnings.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-400">
                {inspect.warnings.length} warning(s)
              </summary>
              <ul className="mt-1 pl-4 text-zinc-400 space-y-0.5">
                {inspect.warnings.map((w, i) => (
                  <li key={i}>
                    [{w.scope}/{w.code}] {w.itemName}: {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setStep("upload")}
              className="px-3 py-1.5 rounded bg-zinc-800 text-sm"
            >
              ← Back
            </button>
            <button
              disabled={!selectedSymbolId || !selectedFootprintId}
              onClick={() => setStep("meta")}
              className="px-3 py-1.5 rounded bg-orange-600 disabled:opacity-40 text-sm"
              data-testid="next-to-meta"
            >
              Next: metadata →
            </button>
          </div>
        </section>
      )}

      {step === "meta" && (
        <section className="space-y-4 max-w-2xl">
          <Field label="Component name *">
            <input
              data-testid="meta-name"
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={meta.description}
              onChange={(e) =>
                setMeta({ ...meta, description: e.target.value })
              }
              rows={2}
              className="input"
            />
          </Field>
          <Field
            label="Category (kebab-case; becomes on-disk subfolder)"
            hint="e.g. passive, ic, connector, imported"
          >
            <input
              data-testid="meta-category"
              value={meta.category}
              onChange={(e) => setMeta({ ...meta, category: e.target.value })}
              className="input"
            />
          </Field>
          <Field
            label="Slug override (optional)"
            hint="kebab-case; defaults to slugified component name"
          >
            <input
              value={meta.slug}
              onChange={(e) => setMeta({ ...meta, slug: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="License *">
            <select
              data-testid="meta-license"
              value={meta.license}
              onChange={(e) => setMeta({ ...meta, license: e.target.value })}
              className="input"
            >
              {SPDX_PRESETS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
              <option>Other (free-text)</option>
            </select>
          </Field>
          {meta.license === "Other (free-text)" && (
            <Field label="License identifier">
              <input
                value={meta.licenseOverride}
                onChange={(e) =>
                  setMeta({ ...meta, licenseOverride: e.target.value })
                }
                placeholder="e.g. WTFPL"
                className="input"
              />
            </Field>
          )}
          <Field label="Tags (comma-separated)">
            <input
              value={meta.tags}
              onChange={(e) => setMeta({ ...meta, tags: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Attribution (one per line)">
            <textarea
              value={meta.attribution}
              onChange={(e) =>
                setMeta({ ...meta, attribution: e.target.value })
              }
              rows={2}
              className="input"
              placeholder="Original author, source URL, etc."
            />
          </Field>
          {conflictMessage && (
            <div className="p-3 rounded bg-amber-950/60 border border-amber-700 text-sm">
              <div className="text-amber-300 font-semibold mb-1">
                Conflict — entries already exist
              </div>
              <div className="text-xs text-zinc-400 mb-2">
                {conflictMessage}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setConflictMessage(null)}
                  className="px-2 py-1 rounded bg-zinc-800 text-xs"
                >
                  Edit slug
                </button>
                <button
                  onClick={() => doCommit(true)}
                  className="px-2 py-1 rounded bg-red-700 text-xs"
                  data-testid="overwrite-btn"
                >
                  Overwrite anyway
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setStep("select")}
              className="px-3 py-1.5 rounded bg-zinc-800 text-sm"
            >
              ← Back
            </button>
            <button
              disabled={busy || !meta.name || !meta.category}
              onClick={() => doCommit(false)}
              className="px-3 py-1.5 rounded bg-orange-600 disabled:opacity-40 text-sm"
              data-testid="commit-btn"
            >
              {busy ? "Committing…" : "Commit →"}
            </button>
          </div>
          <style>{`.input { width: 100%; background: #0a0a0a; border: 1px solid #3f3f46; border-radius: 4px; padding: 4px 8px; font-size: 13px; }`}</style>
        </section>
      )}

      {step === "result" && result && (
        <section className="space-y-4">
          <div className="p-4 rounded bg-emerald-950/40 border border-emerald-800">
            <div className="font-semibold text-emerald-300 mb-2">
              ✓ Imported successfully
            </div>
            <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-500">Component</dt>
              <dd className="font-mono text-xs">{result.componentId}</dd>
              <dt className="text-zinc-500">Symbol</dt>
              <dd className="font-mono text-xs">{result.symbolId}</dd>
              <dt className="text-zinc-500">Footprint</dt>
              <dd className="font-mono text-xs">{result.footprintId ?? "—"}</dd>
              <dt className="text-zinc-500 pt-2">Files written</dt>
              <dd className="pt-2 text-xs font-mono">
                {result.paths.symbol}
                <br />
                {result.paths.footprint && (
                  <>
                    {result.paths.footprint}
                    <br />
                  </>
                )}
                {result.paths.component}
              </dd>
            </dl>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate("detail", result.componentId)}
              className="px-3 py-1.5 rounded bg-orange-600 text-sm"
              data-testid="open-detail-btn"
            >
              Open component →
            </button>
            <button
              onClick={() => {
                setFiles([]);
                setInspect(null);
                setResult(null);
                setStep("upload");
              }}
              className="px-3 py-1.5 rounded bg-zinc-800 text-sm"
            >
              Import another
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: Step[] = ["upload", "select", "meta", "result"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded ${
              s === step
                ? "bg-orange-600 text-white"
                : steps.indexOf(step) > i
                  ? "bg-emerald-800/50 text-emerald-300"
                  : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {i + 1}. {s}
          </span>
          {i < steps.length - 1 && <span className="text-zinc-700">→</span>}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-zinc-600 mt-0.5">{hint}</div>}
    </label>
  );
}
