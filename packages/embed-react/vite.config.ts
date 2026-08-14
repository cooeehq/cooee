import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "@base-ui/react/popover",
        "react",
        "react-dom",
        "react/jsx-runtime",
        "marked",
      ],
    },
    sourcemap: true,
    target: "es2022",
  },
});
