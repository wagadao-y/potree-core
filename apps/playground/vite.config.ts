import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [
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
