import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, normalize, sep } from "node:path";

const dataDir = resolve(import.meta.dirname, "data");

// Liefert data/ im Dev Server unter <base>data/ aus und kopiert es beim Build nach dist/data.
function serveData(): Plugin {
  let base = "/";
  let outDir = "dist";
  return {
    name: "serve-data",
    configResolved(config) {
      base = config.base;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const prefix = `${base}data/`;
        if (!url.startsWith(prefix)) return next();
        const file = normalize(resolve(dataDir, decodeURIComponent(url.slice(prefix.length))));
        if (!file.startsWith(dataDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (existsSync(dataDir)) cpSync(dataDir, resolve(outDir, "data"), { recursive: true });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react(), serveData()],
});
