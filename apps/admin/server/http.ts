export type Handler = (
  req: Request,
  params: Record<string, string>,
) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    const paramNames: string[] = [];
    const regexBody = pattern
      .replace(/\//g, "\\/")
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexBody}$`),
      paramNames,
      handler,
    });
  }

  get(p: string, h: Handler) {
    this.add("GET", p, h);
  }
  post(p: string, h: Handler) {
    this.add("POST", p, h);
  }
  patch(p: string, h: Handler) {
    this.add("PATCH", p, h);
  }
  del(p: string, h: Handler) {
    this.add("DELETE", p, h);
  }

  async dispatch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const m = url.pathname.match(route.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((n, i) => {
        params[n] = decodeURIComponent(m[i + 1] ?? "");
      });
      try {
        return await route.handler(req, params);
      } catch (err) {
        return problem(500, "internal-error", (err as Error).message);
      }
    }
    return problem(404, "not-found", `${req.method} ${url.pathname}`);
  }
}

export function ok<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function problem(
  status: number,
  type: string,
  detail: string,
): Response {
  return new Response(
    JSON.stringify({
      type: `https://openpcb.dev/problems/${type}`,
      title: type,
      status,
      detail,
    }),
    {
      status,
      headers: { "content-type": "application/problem+json" },
    },
  );
}
