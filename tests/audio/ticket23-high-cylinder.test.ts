import { afterEach, describe, expect, it, vi } from "vitest";

import { evenlySpacedFourPreset } from "../../src/presets/multicylinder";
import { vEightPreset, vSixPreset } from "../../src/presets/automotive";

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

type ProcessorInstance = OfflineAudioWorkletProcessor & {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};
type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => ProcessorInstance;

async function loadProcessor(
  sampleRate: number,
): Promise<ProcessorConstructor> {
  vi.resetModules();
  let processor: ProcessorConstructor | undefined;
  vi.stubGlobal("sampleRate", sampleRate);
  vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
  vi.stubGlobal(
    "registerProcessor",
    (_name: string, constructor: ProcessorConstructor) => {
      processor = constructor;
    },
  );
  await import("../../src/audio/worklets/engine-audio-processor");
  if (!processor) throw new Error("processor did not register");
  return processor;
}

const parameters = {
  throttle: new Float32Array([1]),
  gain: new Float32Array([1]),
  loadTorqueNm: new Float32Array([0]),
};

describe("ticket 23 high-cylinder product path", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([44_100, 48_000])(
    "routes V6 and V8 through both banks with finite protected output at %d Hz",
    async (sampleRate) => {
      const Processor = await loadProcessor(sampleRate);
      for (const preset of [vSixPreset, vEightPreset]) {
        const processor = new Processor({
          processorOptions: {
            requestId: preset.config.id,
            config: { version: 1, snapshot: preset.config },
          },
        });
        const runtime = (
          processor as unknown as {
            runtime: {
              bankRouter: {
                routes: readonly { bankId: string; eventCount: number }[];
              };
            } | null;
          }
        ).runtime;
        expect(runtime, preset.config.id).not.toBeNull();
        expect(runtime!.bankRouter.routes.map((route) => route.bankId)).toEqual(
          ["left", "right"],
        );
        let leftEvents = 0;
        let rightEvents = 0;
        let peak = 0;
        let energy = 0;
        for (let blockIndex = 0; blockIndex < 500; blockIndex += 1) {
          const output = new Float32Array(blockIndex % 2 === 0 ? 128 : 256);
          expect(processor.process([], [[output]], parameters)).toBe(true);
          expect([...output].every(Number.isFinite)).toBe(true);
          for (const sample of output) {
            peak = Math.max(peak, Math.abs(sample));
            energy += sample * sample;
          }
          leftEvents += runtime!.bankRouter.routes[0]!.eventCount;
          rightEvents += runtime!.bankRouter.routes[1]!.eventCount;
        }
        expect(leftEvents, preset.config.id).toBeGreaterThan(0);
        expect(rightEvents, preset.config.id).toBeGreaterThan(0);
        expect(energy, preset.config.id).toBeGreaterThan(0);
        expect(peak, preset.config.id).toBeLessThanOrEqual(1);
        expect(
          processor.port.messages.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              "type" in message &&
              message.type === "fatal-error",
          ),
        ).toBe(false);
      }
    },
  );

  it.each([evenlySpacedFourPreset, vSixPreset, vEightPreset])(
    "keeps $config.id within the 48 kHz half-block p99 budget",
    async (preset) => {
      const Processor = await loadProcessor(48_000);
      const processor = new Processor({
        processorOptions: {
          requestId: preset.config.id,
          config: {
            version: 1,
            snapshot: {
              ...preset.config,
              idleRpm: Math.floor(preset.config.redlineRpm * 0.98),
            },
          },
        },
      });
      expect(
        (processor as unknown as { runtime: unknown }).runtime,
      ).not.toBeNull();
      const output = new Float32Array(128);
      for (let block = 0; block < 250; block += 1) {
        processor.process([], [[output]], parameters);
      }
      const elapsed = new Float64Array(2_000);
      for (let block = 0; block < elapsed.length; block += 1) {
        const started = performance.now();
        processor.process([], [[output]], parameters);
        elapsed[block] = performance.now() - started;
      }
      expect([...output].every(Number.isFinite)).toBe(true);
      expect(output.some((sample) => sample !== 0)).toBe(true);
      expect(
        processor.port.messages.some(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            "type" in message &&
            message.type === "fatal-error",
        ),
      ).toBe(false);
      elapsed.sort();
      expect(elapsed[Math.ceil(elapsed.length * 0.99) - 1]).toBeLessThan(
        (128 / 48_000 / 2) * 1_000,
      );
    },
  );
});
