import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [react(), mkcert()],
  server: {
    port: 3001,
    host: "0.0.0.0",
    https: true,
  },
  build: {
    outDir: "dist",
  },
});
