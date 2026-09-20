import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineAudioProcessorOptions } from "../../src/audio/worklets/contracts";
import { FiringEventGenerator } from "../../src/engine/events";
import {
  multiCylinderPresets,
  parallelTwin180Preset,
  parallelTwin270Preset,
  parallelTwin360Preset,
} from "../../src/presets/multicylinder";
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
const throttleCases = [
  ["idle", 0],
  ["mid", 0.5],
  ["full", 1],
] as const;
const sampleRateHz = 48_000;
const offlineRenderPartitions = [
  ["128-frame quanta", Array.from({ length: 96 }, () => 128)],
  ["mixed uneven blocks", [127, 257, 4_096, 4_096, 3_712]],
] as const;

function processorOptions(
  preset: (typeof allPresets)[number],
  requestId: string,
): AudioWorkletNodeOptions {
  const processorOptions: EngineAudioProcessorOptions = {
    requestId,
    config: { version: 1, snapshot: structuredClone(preset.config) },
  };
  return { processorOptions };
}

function render(
  processor: ProcessorInstance,
  throttle: number,
  frames = 4_096,
): Float32Array {
  const output = new Float32Array(frames);
  processor.process([], [[output]], {
    throttle: new Float32Array([throttle]),
    gain: new Float32Array([1]),
    loadTorqueNm: new Float32Array([0]),
  });
  return output;
}

function peak(samples: Float32Array): number {
  let result = 0;
  for (const sample of samples) result = Math.max(result, Math.abs(sample));
  return result;
}

function renderLifecycle(
  processor: ProcessorInstance,
  throttle: number,
  partition: readonly number[],
): Float32Array[] {
  return partition.map((frames) => render(processor, throttle, frames));
}

function contiguousPcm(blocks: readonly Float32Array[]): Float32Array {
  const pcm = new Float32Array(
    blocks.reduce((frames, block) => frames + block.length, 0),
  );
  let offset = 0;
  for (const block of blocks) {
    pcm.set(block, offset);
    offset += block.length;
  }
  return pcm;
}

function createProcessor(
  Processor: ProcessorConstructor,
  preset: (typeof allPresets)[number],
  lifecycle: string,
): ProcessorInstance {
  const processor = new Processor(processorOptions(preset, lifecycle));
  expect(processor.port.messages).toEqual([
    { type: "config-applied", requestId: lifecycle },
    { type: "ready", requestId: lifecycle, sampleRate: sampleRateHz },
  ]);
  return processor;
}

function expectNoProcessorFault(processor: ProcessorInstance): void {
  expect(processor.port.messages).not.toContainEqual(
    expect.objectContaining({ type: "fatal-error" }),
  );
}

describe("M3 offline preset regression", () => {
  let registeredProcessor: ProcessorConstructor | undefined;

  beforeEach(() => {
    vi.resetModules();
    registeredProcessor = undefined;
    vi.stubGlobal("sampleRate", sampleRateHz);
    vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
    vi.stubGlobal(
      "registerProcessor",
      (_name: string, Processor: ProcessorConstructor) => {
        registeredProcessor = Processor;
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders every M3 preset at idle, mid, and full throttle across fresh and restarted offline lifecycles", async () => {
    await import("../../src/audio/worklets/engine-audio-processor");
    const Processor = registeredProcessor!;

    expect(allPresets.map((preset) => preset.config.id)).toContain(
      singleCylinderPreset.config.id,
    );

    for (const preset of allPresets) {
      for (const [throttleName, throttle] of throttleCases) {
        let referencePartitionPcm: Float32Array | undefined;
        for (const [partitionName, partition] of offlineRenderPartitions) {
          // A new Worklet instance after discarding the prior one models the
          // controller's stop/start graph recreation, including DSP reset.
          const freshProcessor = createProcessor(
            Processor,
            preset,
            `${preset.config.id}-${throttleName}-${partitionName}-fresh`,
          );
          const fresh = renderLifecycle(freshProcessor, throttle, partition);
          expectNoProcessorFault(freshProcessor);
          const restartedProcessor = createProcessor(
            Processor,
            preset,
            `${preset.config.id}-${throttleName}-${partitionName}-restarted`,
          );
          const restarted = renderLifecycle(
            restartedProcessor,
            throttle,
            partition,
          );
          expectNoProcessorFault(restartedProcessor);

          const freshPcm = contiguousPcm(fresh);
          expect(contiguousPcm(restarted)).toEqual(freshPcm);
          if (referencePartitionPcm === undefined) {
            referencePartitionPcm = freshPcm;
          } else {
            expect(freshPcm).toEqual(referencePartitionPcm);
          }
          for (const [blockIndex, output] of fresh.entries()) {
            expect(
              [...output].every(Number.isFinite),
              `${preset.config.id} ${throttleName} ${partitionName} block ${blockIndex}`,
            ).toBe(true);
            expect(peak(output)).toBeLessThanOrEqual(1);
          }
          expect(
            Math.max(...fresh.map(peak)),
            `${preset.config.id} ${throttleName} ${partitionName} must render energy within 0.256 s`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it.each([
    [parallelTwin180Preset, [180, 540]],
    [parallelTwin270Preset, [270, 450]],
    [parallelTwin360Preset, [360, 360]],
  ] as const)(
    "keeps %s combustion-event intervals at one fixed RPM",
    (preset, expectedIntervalsDeg) => {
      const rpm = 6_000;
      const degreesPerSample = (rpm * 360) / (60 * sampleRateHz);
      const generator = new FiringEventGenerator({
        cycleDegrees: preset.config.cycleDegrees,
        cylinders: preset.config.cylinders,
      });
      const angularVelocities = new Float64Array(1_920).fill(
        (rpm * 2 * Math.PI) / 60,
      );
      const eventSampleIndices = new Int32Array(16);
      const eventSampleOffsets = new Float64Array(16);
      const eventCount = generator.advanceRealtime(
        angularVelocities,
        angularVelocities.length,
        sampleRateHz,
        0,
        eventSampleIndices,
        eventSampleOffsets,
      );
      // The generator starts on a cycle boundary, so its first zero-degree
      // event is in cycle 1. Recover actual circular positions from the
      // realtime sample-index/offset buffers instead of rereading preset
      // angles.
      const observedAnglesDeg = [
        ...new Set(
          Array.from(
            { length: eventCount },
            (_, eventIndex) =>
              ((eventSampleIndices[eventIndex]! +
                eventSampleOffsets[eventIndex]!) *
                degreesPerSample) %
              preset.config.cycleDegrees,
          ),
        ),
      ].sort((left, right) => left - right);
      const circularIntervalsDeg = observedAnglesDeg.map(
        (angle, index) =>
          observedAnglesDeg[(index + 1) % observedAnglesDeg.length]! -
          angle +
          (index === observedAnglesDeg.length - 1
            ? preset.config.cycleDegrees
            : 0),
      );

      expect(eventCount).toBeGreaterThanOrEqual(4);
      expect(observedAnglesDeg).toHaveLength(2);
      expect(circularIntervalsDeg).toEqual(expectedIntervalsDeg);
    },
  );
});
