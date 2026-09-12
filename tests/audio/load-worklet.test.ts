import { describe, expect, it, vi } from "vitest";

import { loadEngineAudioWorklet } from "../../src/audio/load-worklet";

describe("loadEngineAudioWorklet", () => {
  it("adds the supplied module to the supplied context", async () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    const context = { audioWorklet: { addModule } };
    const moduleUrl = new URL("https://example.test/worklets/engine.js");

    await expect(loadEngineAudioWorklet(context, moduleUrl)).resolves.toEqual({
      ok: true,
    });
    expect(addModule).toHaveBeenCalledOnce();
    expect(addModule).toHaveBeenCalledWith(moduleUrl);
  });

  it("returns a discriminable failure when module loading rejects", async () => {
    const failure = new Error("module could not be fetched");
    const context = {
      audioWorklet: { addModule: vi.fn().mockRejectedValue(failure) },
    };

    await expect(
      loadEngineAudioWorklet(context, "/missing-worklet.js"),
    ).resolves.toEqual({
      ok: false,
      type: "worklet-load-failed",
      error: failure,
    });
  });
});
