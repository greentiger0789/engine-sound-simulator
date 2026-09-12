import { describe, expect, it } from "vitest";

import { resolveEngineAudioWorkletModuleUrl } from "../../src/audio/worklet-module-url";

describe("resolveEngineAudioWorkletModuleUrl", () => {
  it("resolves the development entry from an explicit origin", () => {
    expect(
      resolveEngineAudioWorkletModuleUrl("https://example.test/deep/path").href,
    ).toBe("https://example.test/src/audio/worklets/engine-audio-processor.ts");
  });
});
