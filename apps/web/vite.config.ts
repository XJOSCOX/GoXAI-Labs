import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (normalizedId.includes("/node_modules/react") || normalizedId.includes("/node_modules/react-dom") || normalizedId.includes("/node_modules/react-router")) {
            return "react-vendor";
          }

          if (normalizedId.includes("/node_modules/@supabase/")) {
            return "supabase";
          }

          if (normalizedId.includes("/node_modules/lucide-react")) {
            return "icons";
          }

          if (normalizedId.includes("/node_modules/yaml") || normalizedId.includes("/packages/label-templates/")) {
            return "label-templates";
          }

          if (normalizedId.includes("/node_modules/")) {
            return "vendor";
          }
        }
      }
    }
  },
  plugins: [react()],
  server: {
    port: 5173
  }
});
