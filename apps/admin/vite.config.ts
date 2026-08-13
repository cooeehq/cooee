import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const localApiPort = process.env.COOEE_API_PORT ?? "3000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "cooee-admin-metadata",
      transformIndexHtml(html) {
        return html
          .replaceAll("__COOEE_TITLE__", "Cooee")
          .replaceAll("__COOEE_DESCRIPTION__", "Manage your Cooee changelog.")
          .replaceAll("__COOEE_ROBOTS__", "noindex, nofollow, noarchive")
          .replaceAll(
            "__COOEE_SOCIAL_IMAGE_ALT__",
            "Cooee galah illustration with the Changelogs on autopilot tagline",
          )
          .replaceAll("__COOEE_SOCIAL_IMAGE_HEIGHT__", "908")
          .replaceAll("__COOEE_SOCIAL_IMAGE_TYPE__", "image/png")
          .replaceAll("__COOEE_SOCIAL_IMAGE_WIDTH__", "1732")
          .replaceAll(
            "https://cooee.invalid/__COOEE_CANONICAL_URL__",
            "https://app.cooee.sh/changelog",
          )
          .replaceAll(
            "https://cooee.invalid/__COOEE_SOCIAL_IMAGE_URL__",
            "https://app.cooee.sh/cooee-social-galah.png",
          );
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
  },
  define: {
    "import.meta.env.VITE_COOEE_APP_MODE": JSON.stringify("admin"),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${localApiPort}`,
      },
    },
  },
});
