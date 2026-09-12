import { defineConfig } from "vite";

export default defineConfig({
  base: "/__e2e__/",
  build: {
    outDir: "dist-e2e",
    rollupOptions: {
      input: "tests/e2e/worklet-harness.html",
    },
  },
});
