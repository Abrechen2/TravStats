import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Force Three.js to be pre-bundled together
    include: ["three", "react-globe.gl"],
    // Exclude from optimization to prevent splitting
    exclude: [],
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
        sourcemapIgnoreList: () => true,
        // Force heavy third-party libs into named vendor chunks so feature
        // chunks (mapAnimationHelpers, AdvancedStatsPage, …) don't drag a
        // copy of maplibre/deck.gl/three with them when they touch a single
        // utility from the barrel index.
        manualChunks(id) {
          // Vite's runtime preload helper (`__vitePreload`) is a virtual
          // module shared by every lazy route. Rollup defaults to hoisting
          // shared utilities into the largest chunk that imports them —
          // here that was vendor-deck, which made every lazy chunk pull
          // 324 KB of deck.gl just to get the preload helper. Pin it next
          // to React (small, always preloaded) so the bleed stops.
          if (id.includes("preload-helper")) return "vendor-react";
          if (!id.includes("node_modules")) return undefined;
          // Pin React + ReactDOM + scheduler into their own chunk so Rollup
          // does NOT hoist them into vendor-deck.
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          )
            return "vendor-react";
          // Preact is pulled in transitively by @deck.gl/widgets and
          // float-tooltip (deduped). Rollup hoists it into the largest
          // sibling (vendor-deck), which then pulls vendor-deck into any
          // chunk that touches the shared preact instance — including the
          // entry chunk. Pinning preact into its own tiny chunk breaks
          // that bleed.
          if (id.includes("/preact/")) return "vendor-preact";
          if (id.includes("/maplibre-gl/")) return "vendor-maplibre";
          if (id.includes("/@deck.gl/") || id.includes("/deck.gl/")) return "vendor-deck";
          if (id.includes("/react-globe.gl/")) return "vendor-globe";
          if (id.includes("/three/")) return "vendor-three";
          if (id.includes("/jspdf/") || id.includes("/jspdf-")) return "vendor-jspdf";
          if (id.includes("/exceljs/")) return "vendor-exceljs";
          if (id.includes("/tesseract.js/")) return "vendor-tesseract";
          return undefined;
        },
      },
      // Preserve module structure to prevent initialization issues
      preserveEntrySignatures: false,
      // Ensure proper external handling - don't externalize Three.js
      external: [],
    },
    // Enable minification for production builds
    minify: process.env.NODE_ENV === "production" ? "esbuild" : false,
    // Explicitly disable source maps to prevent browser from trying to load them
    sourcemap: false,
    chunkSizeWarningLimit: 1000, // Keep warning at 1MB to track large chunks
    // Ensure proper handling of CommonJS modules
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
      // Ensure proper handling of Three.js CommonJS exports
      strictRequires: false,
      // Preserve require statements for better compatibility
      requireReturnsDefault: "auto",
      // Don't transform dynamic requires
      dynamicRequireTargets: [],
      // Preserve module structure to prevent initialization issues
      defaultIsModuleExports: "auto",
    },
    // Improve module resolution for better compatibility
    target: "es2020",
    // Ensure proper module format
    modulePreload: {
      polyfill: false,
      // Drop heavy vendor chunks from the entry's <link rel="modulepreload">
      // list. With manualChunks splitting, Vite eagerly preloads any vendor
      // chunk reachable through the entry's static graph — even when only
      // lazy routes actually consume them. /login then pays for vendor-deck
      // it never uses. They still load on demand from the lazy route.
      resolveDependencies(_filename, deps, { hostType }) {
        if (hostType !== "html") return deps;
        return deps.filter(
          (d) =>
            !d.includes("vendor-deck") &&
            !d.includes("vendor-three") &&
            !d.includes("vendor-globe") &&
            !d.includes("vendor-maplibre") &&
            !d.includes("vendor-jspdf") &&
            !d.includes("vendor-exceljs") &&
            !d.includes("vendor-tesseract"),
        );
      },
    },
  },
});
