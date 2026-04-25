import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "core/index": resolve(__dirname, "src/core/index.ts"),
        "renderer-three/index": resolve(
          __dirname,
          "src/renderer-three/index.ts",
        ),
      },
      formats: ["es"],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["three"],
    },
    sourcemap: false,
  },
});
