import { defineConfig } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// The backend's land-mask binaries live at ../../backend/data/*. Rather
// than copy them into public/ (would duplicate in git) we mount a tiny
// middleware that reads them straight off disk. Vite's static serve
// doesn't cross root-level boundaries by default.
const BACKEND_DATA = resolve(__dirname, "..", "..", "backend", "data");

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: 8010,
    host: "0.0.0.0",
  },
  build: {
    target: "es2022",
  },
  plugins: [
    {
      name: "serve-land-masks",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next();
          const match = req.url.match(/^\/land-mask-(0\.\d+)deg\.bin$/);
          if (!match) return next();
          const filePath = resolve(BACKEND_DATA, `land-mask-${match[1]}deg.bin`);
          if (!existsSync(filePath)) {
            res.statusCode = 404;
            res.end(`land mask not found: ${filePath}`);
            return;
          }
          const buf = readFileSync(filePath);
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", String(buf.byteLength));
          res.end(buf);
        });
      },
    },
  ],
});
