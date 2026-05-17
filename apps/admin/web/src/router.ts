import { useEffect, useState } from "react";

export interface Route {
  page: "browse" | "detail" | "pack";
  id?: string;
}

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h === "" || h === "browse") return { page: "browse" };
  if (h === "pack") return { page: "pack" };
  if (h.startsWith("c/"))
    return { page: "detail", id: decodeURIComponent(h.slice(2)) };
  return { page: "browse" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(page: Route["page"], id?: string): void {
  if (page === "browse") window.location.hash = "/browse";
  else if (page === "pack") window.location.hash = "/pack";
  else if (page === "detail" && id)
    window.location.hash = `/c/${encodeURIComponent(id)}`;
}
