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
        // Optimize chunk file names for better caching
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
        // Explicitly disable source map generation
        sourcemapIgnoreList: () => true,
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
    },
  },
});
