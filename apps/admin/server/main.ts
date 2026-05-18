import { Router } from "./http";
import { installWatchers } from "./repo/index-cache";
import {
  deleteComponents,
  getComponentDetail,
  listComponents,
  listTags,
  patchComponent,
} from "./routes/components";
import {
  getFootprint,
  getSymbol,
  listFootprints,
  listSymbols,
} from "./routes/symbols-footprints";
import {
  deleteModel,
  getModelGlb,
  listModels,
  uploadModel,
} from "./routes/models";
import {
  downloadOpclib,
  gitStatus,
  repoInfo,
  runPack,
  runValidate,
} from "./routes/tools";
import { commitKicad, inspectKicad } from "./routes/import-kicad";
import { listTemplates, materializeTemplate } from "./routes/templates";

const router = new Router();

router.get("/api/info", repoInfo);
router.get("/api/components", listComponents);
router.get("/api/components/:id/detail", getComponentDetail);
router.patch("/api/components/:id", patchComponent);
router.post("/api/components/delete", deleteComponents);
router.get("/api/tags", listTags);
router.get("/api/symbols", listSymbols);
router.get("/api/symbols/:id", getSymbol);
router.get("/api/footprints", listFootprints);
router.get("/api/footprints/:id", getFootprint);
router.get("/api/models", listModels);
router.get("/api/models/:category/:slug.glb", getModelGlb);
router.post("/api/models/:category/:slug", uploadModel);
router.del("/api/models/:category/:slug", deleteModel);
router.post("/api/imports/kicad/inspect", inspectKicad);
router.post("/api/imports/kicad", commitKicad);
router.get("/api/templates", listTemplates);
router.post("/api/templates/:id/materialize", materializeTemplate);
router.post("/api/validate", runValidate);
router.post("/api/pack", runPack);
router.get("/api/dist/:name", downloadOpclib);
router.get("/api/git/status", gitStatus);

const PORT = Number(process.env.PORT ?? 7173);
const HOST = process.env.HOST ?? "127.0.0.1";

installWatchers();

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch(req) {
    // CORS for vite dev (5173)
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    return router.dispatch(req).then((res) => {
      res.headers.set("access-control-allow-origin", "*");
      return res;
    });
  },
});

console.log(`[admin] http://${server.hostname}:${server.port}`);
