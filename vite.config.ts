import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const workletEntryName = "engine-audio-worklet";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["dev", "vite-app", "dev.localhost"],
  },
  build: {
    rollupOptions: {
      // An AudioWorklet is loaded by URL, not through the application's import
      // graph. Keep it as an explicit Rollup entry so it is present even before
      // the product controller imports the loader.
      input: {
        index: "index.html",
        [workletEntryName]: "src/audio/worklets/engine-audio-processor.ts",
      },
      output: {
        // This deliberately has no content hash: callers can resolve the same
        // base-relative URL in development and from the Nginx production image.
        entryFileNames: (chunk) =>
          chunk.name === workletEntryName
            ? "assets/engine-audio-worklet.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
