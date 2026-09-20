import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineAudioProcessorOptions } from "../../src/audio/worklets/contracts";
import { multiCylinderPresets } from "../../src/presets/multicylinder";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";

class OfflinePort {
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class OfflineAudioWorkletProcessor {
  readonly port = new OfflinePort();
}

type ProcessorInstance = {
  readonly port: OfflinePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => ProcessorInstance;

const allPresets = [singleCylinderPreset, ...multiCylinderPresets] as const;

function options(
  snapshot: (typeof allPresets)[number]["config"],
  requestId: string,
): AudioWorkletNodeOptions {
  const processorOptions: EngineAudioProcessorOptions = {
    requestId,
    config: { version: 1, snapshot: structuredClone(snapshot) },
  };
  return { processorOptions };
}

function render(
  processor: ProcessorInstance,
  frames: number,
  throttle: number,
  loadTorqueNm = 20,
): Float32Array {
  const output = new Float32Array(frames);
  processor.process([], [[output]], {
    throttle: new Float32Array([throttle]),
    gain: new Float32Array([1]),
    loadTorqueNm: new Float32Array([loadTorqueNm]),
  });
  return output;
}

function renderDuration(
  processor: ProcessorInstance,
  frames: number,
  throttle: number,
): Float32Array {
  const result = new Float32Array(frames);
  const partitions = [127, 128, 509];
  let written = 0;
  let block = 0;
  while (written < frames) {
    const blockFrames = Math.min(
      partitions[block % partitions.length]!,
      frames - written,
    );
    result.set(render(processor, blockFrames, throttle), written);
    written += blockFrames;
    block += 1;
  }
  return result;
}

describe("M4 resonator product regression", () => {
  let registeredProcessor: ProcessorConstructor | undefined;

  beforeEach(() => {
    vi.resetModules();
    registeredProcessor = undefined;
    vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
    vi.stubGlobal(
      "registerProcessor",
      (_name: string, Processor: ProcessorConstructor) => {
        registeredProcessor = Processor;
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([44_100, 48_000])(
    "keeps every M3 preset finite, protected, and seed-reproducible at %d Hz",
    async (runtimeSampleRate) => {
      vi.stubGlobal("sampleRate", runtimeSampleRate);
      await import("../../src/audio/worklets/engine-audio-processor");
      const Processor = registeredProcessor!;
      for (const preset of allPresets) {
        for (const throttle of [0, 0.5, 1]) {
          const first = new Processor(
            options(preset.config, `${preset.config.id}-${throttle}-first`),
          );
          const restarted = new Processor(
            options(preset.config, `${preset.config.id}-${throttle}-restart`),
          );
          const frames = Math.floor(runtimeSampleRate * 0.3);
          const firstPcm = renderDuration(first, frames, throttle);
          const restartedPcm = renderDuration(restarted, frames, throttle);

          expect(restartedPcm).toEqual(firstPcm);
          expect([...firstPcm].every(Number.isFinite)).toBe(true);
          expect(Math.max(...firstPcm.map(Math.abs))).toBeLessThanOrEqual(1);
          expect(first.port.messages).not.toContainEqual(
            expect.objectContaining({ type: "fatal-error" }),
          );
        }
      }
    },
  );

  it("uses intake and exhaust config in the product processor", async () => {
    vi.stubGlobal("sampleRate", 48_000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const Processor = registeredProcessor!;
    const baseline = structuredClone(singleCylinderPreset.config);
    const changed = {
      ...structuredClone(singleCylinderPreset.config),
      intake: { ...baseline.intake, resonanceHz: 1_200 },
      exhaust: { ...baseline.exhaust, pipeLengthM: 0.3 },
    };
    const baselinePcm = renderDuration(
      new Processor(options(baseline, "baseline")),
      48_000,
      0.8,
    );
    const changedPcm = renderDuration(
      new Processor(options(changed, "changed")),
      48_000,
      0.8,
    );

    expect(changedPcm).not.toEqual(baselinePcm);
    expect([...changedPcm].every(Number.isFinite)).toBe(true);
    expect(Math.max(...changedPcm.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it.each([44_100, 48_000])(
    "replaces state safely for extreme valid acoustics at %d Hz",
    async (runtimeSampleRate) => {
      vi.stubGlobal("sampleRate", runtimeSampleRate);
      await import("../../src/audio/worklets/engine-audio-processor");
      const Processor = registeredProcessor!;
      const extreme = {
        ...structuredClone(singleCylinderPreset.config),
        intake: {
          noiseGain: Number.MAX_VALUE,
          resonanceHz: Number.MAX_VALUE,
        },
        exhaust: {
          pipeLengthM: Number.MIN_VALUE,
          damping: Number.MAX_VALUE,
          mufflerAmount: 1,
        },
      };
      const replaced = new Processor(
        options(singleCylinderPreset.config, "initial"),
      );
      renderDuration(replaced, 1_024, 0);
      replaced.port.onmessage?.({
        data: {
          type: "replace-config",
          requestId: "extreme-replacement",
          config: { version: 1, snapshot: structuredClone(extreme) },
        },
      } as MessageEvent);
      const fresh = new Processor(options(extreme, "extreme-fresh"));
      const replacedPcm = renderDuration(replaced, 4_096, 0);
      const freshPcm = renderDuration(fresh, 4_096, 0);

      expect(replacedPcm).toEqual(freshPcm);
      expect([...replacedPcm].every(Number.isFinite)).toBe(true);
      expect(Math.max(...replacedPcm.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(replaced.port.messages).not.toContainEqual(
        expect.objectContaining({ type: "fatal-error" }),
      );
    },
  );
});
