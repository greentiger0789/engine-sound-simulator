import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENGINE_AUDIO_PROCESSOR_NAME } from "../../src/audio/worklets/contracts";

class FakePort {
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeAudioWorkletProcessor {
  readonly port = new FakePort();
}

type ProcessorConstructor = new () => {
  readonly port: FakePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

describe("EngineAudioProcessor", () => {
  let registeredProcessor: ProcessorConstructor | undefined;

  beforeEach(() => {
    vi.resetModules();
    registeredProcessor = undefined;
    vi.stubGlobal("AudioWorkletProcessor", FakeAudioWorkletProcessor);
    vi.stubGlobal(
      "registerProcessor",
      (_name: string, ctor: ProcessorConstructor) => {
        registeredProcessor = ctor;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([44100, 48000])(
    "reports the runtime %d Hz sample rate and silences variable frame sizes",
    async (runtimeSampleRate) => {
      vi.stubGlobal("sampleRate", runtimeSampleRate);
      await import("../../src/audio/worklets/engine-audio-processor");

      expect(ENGINE_AUDIO_PROCESSOR_NAME).toBe("engine-audio-processor");
      expect(registeredProcessor).toBeDefined();

      const processor = new registeredProcessor!();
      expect(processor.port.messages).toEqual([
        { type: "ready", sampleRate: runtimeSampleRate },
      ]);

      for (const frameCount of [1, 127, 129, 257]) {
        const left = new Float32Array(frameCount).fill(0.75);
        const right = new Float32Array(frameCount).fill(-0.5);
        expect(processor.process([], [[left, right]], {})).toBe(true);
        expect([...left, ...right]).toEqual(new Array(frameCount * 2).fill(0));
      }
    },
  );

  it("declares throttle and gain as continuously automatable parameters", async () => {
    const processorModule =
      await import("../../src/audio/worklets/engine-audio-processor");

    expect(processorModule.EngineAudioProcessor.parameterDescriptors).toEqual([
      expect.objectContaining({ name: "throttle", automationRate: "a-rate" }),
      expect.objectContaining({ name: "gain", automationRate: "a-rate" }),
    ]);
  });
});
