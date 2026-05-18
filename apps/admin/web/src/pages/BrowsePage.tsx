import { useEffect, useMemo, useState } from "react";
import { api, type ComponentListItem } from "../api";
import { navigate } from "../router";

export function BrowsePage() {
  const [items, setItems] = useState<ComponentListItem[]>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [q, setQ] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.tags().then((r) => setTags(r.items));
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .components(q || undefined, [...selectedTags])
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [q, selectedTags]);

  const visibleTags = useMemo(() => tags.slice(0, 30), [tags]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Search components..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="browse-search"
          className="flex-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-800 focus:outline-none focus:border-zinc-600"
        />
        <span className="text-sm text-zinc-400">{items.length} components</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleTags.map(({ tag, count }) => {
          const on = selectedTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => {
                const next = new Set(selectedTags);
                if (on) next.delete(tag);
                else next.add(tag);
                setSelectedTags(next);
              }}
              className={`px-2 py-1 text-xs rounded-full border ${
                on
                  ? "bg-orange-600 border-orange-500 text-white"
                  : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {tag} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
        {selectedTags.size > 0 && (
          <button
            onClick={() => setSelectedTags(new Set())}
            className="px-2 py-1 text-xs rounded-full border bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            clear
          </button>
        )}
      </div>
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {loading ? (
        <div className="text-zinc-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {items.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate("detail", c.id)}
              data-testid={`browse-card-${c.id}`}
              className="text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-lg p-4 transition"
            >
              <div className="flex justify-between items-baseline">
                <h3 className="font-semibold text-zinc-100">{c.name}</h3>
                <span className="text-xs text-zinc-500">{c.category}</span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                {c.description ?? (
                  <em className="opacity-50">no description</em>
                )}
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                {c.tags.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-800 text-zinc-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="text-xs text-zinc-500 mt-2">
                {c.footprintCount} footprint{c.footprintCount === 1 ? "" : "s"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
