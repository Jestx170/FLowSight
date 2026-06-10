import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  // In production the app is served by Flask under /static, so assets must be
  // requested from there. In dev the proxy below handles /api, so base is "/".
  base: mode === "production" ? "/static/" : "/",
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "::",
    port: Number(process.env.PORT) || 8080,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      // Forward all API + MJPEG stream traffic to the Flask backend. The stream
      // is multipart/x-mixed-replace, which http-proxy passes through unbuffered.
      "/api": { target: "http://localhost:5001", changeOrigin: true },
    },
  },
  preview: {
    host: "::",
    port: Number(process.env.PORT) || 8080,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
}));
