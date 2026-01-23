import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use relative paths for Tauri production builds
  base: mode === "production" ? "./" : "/",
  server: {
    host: "::",
    port: 8080,
  },
  // Prevent Vite from clearing the console when running in Tauri dev mode
  clearScreen: false,
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
