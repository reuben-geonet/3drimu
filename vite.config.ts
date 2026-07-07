import { defineConfig } from "vite";

export default defineConfig({
  base: "/3drimu/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    sourcemap: false
  }
});
