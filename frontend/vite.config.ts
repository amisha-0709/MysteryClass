import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin API calls in dev; the backend runs on :8010 (8000 is often taken).
      "/api": "http://127.0.0.1:8010",
    },
  },
});
