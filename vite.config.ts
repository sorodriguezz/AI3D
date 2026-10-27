import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // OpenCascade se carga como WebAssembly dentro de un Web Worker.
  // Las dependencias del worker se preempaquetan al arrancar: si Vite las descubre al cargar
  // el worker, recarga la página (en un arranque en frío se pierde lo que se estaba haciendo).
  optimizeDeps: { exclude: ["replicad-opencascadejs"], include: ["replicad", "manifold-3d"] },
  worker: { format: "es" as const },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
