import { useRoute, navigate } from "./router";
import { BrowsePage } from "./pages/BrowsePage";
import { DetailPage } from "./pages/DetailPage";
import { PackPage } from "./pages/PackPage";
import { ImportPage } from "./pages/ImportPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export function App() {
  const route = useRoute();

  return (
    <div className="min-h-full flex">
      <nav className="w-44 shrink-0 border-r border-zinc-800 bg-zinc-950 p-4 space-y-2">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
          Core Library
        </div>
        <NavBtn
          active={route.page === "browse" || route.page === "detail"}
          onClick={() => navigate("browse")}
          testid="nav-browse"
        >
          Browse
        </NavBtn>
        <NavBtn
          active={route.page === "import"}
          onClick={() => navigate("import")}
          testid="nav-import"
        >
          Import
        </NavBtn>
        <NavBtn
          active={route.page === "templates"}
          onClick={() => navigate("templates")}
          testid="nav-templates"
        >
          Templates
        </NavBtn>
        <NavBtn
          active={route.page === "pack"}
          onClick={() => navigate("pack")}
          testid="nav-pack"
        >
          Validate &amp; Pack
        </NavBtn>
        <div className="pt-4 text-[10px] text-zinc-600">
          local admin · 127.0.0.1
        </div>
      </nav>
      <main className="flex-1 min-w-0 overflow-auto">
        {route.page === "browse" && <BrowsePage />}
        {route.page === "detail" && route.id && <DetailPage id={route.id} />}
        {route.page === "import" && <ImportPage />}
        {route.page === "templates" && <TemplatesPage />}
        {route.page === "pack" && <PackPage />}
      </main>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testid?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`block w-full text-left px-3 py-2 rounded text-sm ${
        active ? "bg-orange-600 text-white" : "text-zinc-300 hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}
