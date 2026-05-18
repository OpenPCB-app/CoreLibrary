import { useEffect, useMemo, useState } from "react";
import { api, type TemplateField, type TemplateInfo } from "../api";

const SPDX_PRESETS = [
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC0-1.0",
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "proprietary",
];

export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [category, setCategory] = useState("generated");
  const [license, setLicense] = useState("CC0-1.0");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    footprintId: string;
    path: string;
  } | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    api
      .listTemplates()
      .then((d) => {
        setTemplates(d.items);
        const first = d.items[0];
        if (first) {
          setSelectedId(first.id);
          setValues({ ...first.defaults });
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const template = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedId(id);
    setValues({ ...t.defaults });
    setResult(null);
    setConflict(false);
    setError(null);
  }

  async function materialize(overwrite = false) {
    if (!template) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const data = await api.materializeTemplate(template.id, {
        values,
        category,
        license,
        slug: slug || undefined,
        ...(overwrite ? { conflictPolicy: "overwrite" as const } : {}),
      });
      setResult({ footprintId: data.footprintId, path: data.path });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) {
        setConflict(true);
        setError(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Generate from template</h1>
        <p className="text-xs text-zinc-500">
          IPC-7351B / parametric footprints
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-1">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTemplate(t.id)}
              data-testid={`tpl-${t.id}`}
              className={`block w-full text-left px-3 py-2 rounded text-sm ${
                selectedId === t.id
                  ? "bg-orange-600 text-white"
                  : "bg-zinc-900 hover:bg-zinc-800"
              }`}
            >
              <div className="font-semibold">{t.label}</div>
              <div className="text-[10px] text-zinc-400">{t.description}</div>
            </button>
          ))}
        </aside>

        <section className="space-y-4">
          {error && (
            <div className="p-3 rounded bg-red-950/60 border border-red-800 text-sm text-red-300">
              {error}
              {conflict && (
                <div className="mt-2">
                  <button
                    onClick={() => materialize(true)}
                    data-testid="tpl-overwrite"
                    className="px-2 py-1 rounded bg-red-700 text-xs"
                  >
                    Overwrite anyway
                  </button>
                </div>
              )}
            </div>
          )}
          {result && (
            <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800 text-sm">
              <div className="font-semibold text-emerald-300">
                ✓ Materialized
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                {result.footprintId}
              </div>
              <div className="text-xs font-mono text-zinc-500">
                {result.path}
              </div>
            </div>
          )}

          {template && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Parameters</h3>
              {template.schema.fields.map((field) => (
                <FieldEditor
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={(v) =>
                    setValues((cur) => ({ ...cur, [field.key]: v }))
                  }
                />
              ))}
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">Output</h3>
            <Field label="Category">
              <input
                value={category}
                data-testid="tpl-category"
                onChange={(e) => setCategory(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Slug override (optional)">
              <input
                value={slug}
                data-testid="tpl-slug"
                onChange={(e) => setSlug(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="License">
              <select
                value={license}
                data-testid="tpl-license"
                onChange={(e) => setLicense(e.target.value)}
                className="input"
              >
                {SPDX_PRESETS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
          </div>

          <button
            onClick={() => materialize(false)}
            disabled={busy || !template}
            data-testid="tpl-materialize"
            className="px-4 py-2 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-sm"
          >
            {busy ? "Generating…" : "Materialize footprint →"}
          </button>
        </section>
      </div>
      <style>{`.input { width: 100%; background: #0a0a0a; border: 1px solid #3f3f46; border-radius: 4px; padding: 4px 8px; font-size: 13px; }`}</style>
    </div>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case "int":
    case "float":
      return (
        <Field
          label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`}
          hint={field.description}
        >
          <input
            type="number"
            data-testid={`tpl-field-${field.key}`}
            value={typeof value === "number" ? value : field.default}
            min={field.min}
            max={field.max}
            step={field.step ?? (field.kind === "int" ? 1 : 0.01)}
            onChange={(e) =>
              onChange(
                field.kind === "int"
                  ? parseInt(e.target.value, 10)
                  : parseFloat(e.target.value),
              )
            }
            className="input"
          />
        </Field>
      );
    case "enum":
      return (
        <Field label={field.label} hint={field.description}>
          <select
            data-testid={`tpl-field-${field.key}`}
            value={typeof value === "string" ? value : field.default}
            onChange={(e) => onChange(e.target.value)}
            className="input"
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      );
    case "bool":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid={`tpl-field-${field.key}`}
            checked={typeof value === "boolean" ? value : field.default}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
  }
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
