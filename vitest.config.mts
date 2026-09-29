import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mantener coherencia con el alias "@/*" -> "./src/*" de tsconfig.json
      "@": path.resolve(root, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // No fallar si aún no existen pruebas (soporta el estado inicial del proyecto).
    passWithNoTests: true,
  },
});
