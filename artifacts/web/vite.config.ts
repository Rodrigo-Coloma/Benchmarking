import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
// Tailwind 3 + PostCSS — la config vive en tailwind.config.js / postcss.config.js

/**
 * BASE_PATH controla el subpath donde se sirve la app.
 *   - dev / local: "/"   (default)
 *   - producción / V3:   "/evidencias/"
 *
 * Debe empezar y terminar con "/".
 */
const basePath = process.env.BASE_PATH ?? "/";
if (!basePath.endsWith("/")) {
  throw new Error("BASE_PATH debe terminar con / (recibido: " + basePath + ")");
}

// Backend dev server. Vite hace proxy de /api hacia él para que la cookie
// httpOnly funcione en el mismo origen.
const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8080";

export default defineConfig({
  base: basePath,
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      [`${basePath === "/" ? "" : basePath.replace(/\/$/, "")}/api`]: {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
