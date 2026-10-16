import { mergeConfig } from "vite";
import base from "./vite.config";
export default mergeConfig(base, {
  server: {
    port: Number(process.env.TRAVPLAN_PREVIEW_PORT || 5180),
    host: "0.0.0.0",
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.TRAVPLAN_PREVIEW_API_URL || "http://127.0.0.1:3540",
        changeOrigin: true,
      },
    },
  },
});
