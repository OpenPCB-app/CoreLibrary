import { useEffect, useState } from "react";
import { api } from "../api";

export function PackPage() {
  const [info, setInfo] = useState<{ name: string; version: string } | null>(
    null,
  );
  const [git, setGit] = useState<{
    dirty: number;
    files: Array<{ status: string; path: string }>;
  } | null>(null);
  const [validateOut, setValidateOut] = useState<string | null>(null);
  const [packOut, setPackOut] = useState<{
    stdout: string;
    stderr: string;
    artifact?: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function refreshGit() {
    api.gitStatus().then(setGit);
  }

  useEffect(() => {
    api.info().then(setInfo);
    refreshGit();
    const t = setInterval(refreshGit, 4000);
    return () => clearInterval(t);
  }, []);

  async function runValidate() {
    setBusy("validate");
    try {
      const r = await api.validate();
      setValidateOut(
        `exit=${r.code}\n\nstdout:\n${r.stdout}\n\nstderr:\n${r.stderr}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function runPack() {
    setBusy("pack");
    try {
      const r = await api.pack();
      setPackOut(r);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Repository</h2>
        {info && (
          <div className="text-sm">
            <div>
              <span className="text-zinc-500">name:</span> {info.name}
            </div>
            <div>
              <span className="text-zinc-500">version:</span> {info.version}
            </div>
          </div>
        )}
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">Git status</h2>
          <span className="text-xs text-zinc-500">
            {git ? `${git.dirty} dirty file${git.dirty === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        {git && git.files.length > 0 ? (
          <ul className="text-xs font-mono space-y-0.5 max-h-64 overflow-auto">
            {git.files.map((f, i) => (
              <li key={i}>
                <span className="text-orange-400">{f.status}</span>{" "}
                <span className="text-zinc-300">{f.path}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-zinc-500">Working tree clean.</div>
        )}
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">Validate</h2>
          <button
            disabled={busy === "validate"}
            onClick={runValidate}
            className="px-3 py-1 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-sm"
          >
            {busy === "validate" ? "Running…" : "Run validate"}
          </button>
        </div>
        {validateOut && (
          <pre className="text-xs bg-zinc-950 p-3 rounded overflow-auto max-h-96 text-zinc-300">
            {validateOut}
          </pre>
        )}
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">Pack (.opclib)</h2>
          <button
            disabled={busy === "pack"}
            onClick={runPack}
            className="px-3 py-1 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-sm"
          >
            {busy === "pack" ? "Packing…" : "Run pack"}
          </button>
        </div>
        {packOut && (
          <>
            <pre className="text-xs bg-zinc-950 p-3 rounded overflow-auto max-h-64 text-zinc-300">
              {packOut.stdout}
              {packOut.stderr && "\n\nstderr:\n" + packOut.stderr}
            </pre>
            {packOut.artifact && (
              <a
                href={`/api/dist/${encodeURIComponent(packOut.artifact)}`}
                className="inline-block mt-3 px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-sm"
                download
              >
                Download {packOut.artifact}
              </a>
            )}
          </>
        )}
      </section>
    </div>
  );
}
