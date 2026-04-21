import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "potree-core",
        replacement: fileURLToPath(
          new URL("../../packages/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^three$/,
        replacement: fileURLToPath(
          new URL(
            "./node_modules/three/build/three.module.js",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  server: {
    fs: {
      allow: ["../.."],
    },
  },
});
