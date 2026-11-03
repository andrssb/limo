import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: resolve(__dirname, "public"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        "content/linkedin":          resolve(__dirname, "src/content/linkedin.ts"),
        "content/coaching-widget":   resolve(__dirname, "src/content/coaching-widget.ts"),
        "sidepanel/index":           resolve(__dirname, "src/sidepanel/index.html"),
        "offscreen/index":           resolve(__dirname, "src/offscreen/index.html"),
        "permission/index":          resolve(__dirname, "src/permission/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          // CSS fica junto com o HTML do sidepanel
          if (assetInfo.name?.endsWith(".css")) return "sidepanel/[name].[ext]";
          return "[name].[ext]";
        },
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
