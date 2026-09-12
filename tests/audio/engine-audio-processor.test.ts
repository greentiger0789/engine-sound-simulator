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
    "reports the runtime %d Hz sample rate and renders a finite low-level reference signal for variable frame sizes",
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
        const left = new Float32Array(frameCount);
        const right = new Float32Array(frameCount);
        expect(
          processor.process([], [[left, right]], {
            gain: new Float32Array([1]),
          }),
        ).toBe(true);
        expect([...left, ...right].every(Number.isFinite)).toBe(true);
        expect(Math.max(...left.map(Math.abs))).toBeLessThan(0.06);
        expect(left).toEqual(right);
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

  it("uses both scalar and per-frame gain automation", async () => {
    vi.stubGlobal("sampleRate", 48000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const processor = new registeredProcessor!();
    const scalar = new Float32Array(8);
    const automated = new Float32Array(8);

    processor.process([], [[scalar]], { gain: new Float32Array([0]) });
    processor.process([], [[automated]], {
      gain: new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]),
    });

    expect([...scalar]).toEqual(new Array(8).fill(0));
    expect(automated[0]).toBe(0);
    expect(automated[2]).toBe(0);
    expect(automated[1]).not.toBe(0);
    expect(automated[3]).not.toBe(0);
  });
});
