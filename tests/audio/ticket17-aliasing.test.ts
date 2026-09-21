import { afterEach, describe, expect, it, vi } from "vitest";

import { ExhaustResonatorDsp } from "../../src/audio/dsp/exhaust-resonator";
import { MechanicalOrdersDsp } from "../../src/audio/dsp/mechanical-orders";
import { SingleCylinderPulseDsp } from "../../src/audio/dsp/single-cylinder-pulse";
import { FiringEventGenerator } from "../../src/engine/events";
import { multiCylinderPresets } from "../../src/presets/multicylinder";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";

const allPresets = [singleCylinderPreset, ...multiCylinderPresets] as const;
const ANALYSIS_FRAMES = 32_768;

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
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => ProcessorInstance;

function fftPower(input: Float32Array): Float64Array {
  const size = input.length;
  const real = Float64Array.from(input);
  const imaginary = new Float64Array(size);
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed]!, real[index]!];
    }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < length / 2; offset += 1) {
        const cosine = Math.cos(angle * offset);
        const sine = Math.sin(angle * offset);
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd]! * cosine - imaginary[odd]! * sine;
        const oddImaginary = real[odd]! * sine + imaginary[odd]! * cosine;
        real[odd] = real[even]! - oddReal;
        imaginary[odd] = imaginary[even]! - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
  return Float64Array.from(
    { length: size / 2 + 1 },
    (_, bin) => real[bin]! ** 2 + imaginary[bin]! ** 2,
  );
}

function renderAtRedline(
  preset: (typeof allPresets)[number],
  sampleRate: number,
): { source: Float32Array; engineSynchronousOutput: Float32Array } {
  const { config } = preset;
  const warmupFrames = sampleRate;
  const totalFrames = warmupFrames + ANALYSIS_FRAMES;
  const angularVelocity = (config.redlineRpm * 2 * Math.PI) / 60;
  const eventGenerator = new FiringEventGenerator({
    cycleDegrees: config.cycleDegrees,
    cylinders: config.cylinders,
  });
  const pulse = new SingleCylinderPulseDsp({
    sampleRate,
    variation: config.combustionVariation,
  });
  const exhaust = new ExhaustResonatorDsp({
    sampleRate,
    exhaust: config.exhaust,
  });
  const mechanical = new MechanicalOrdersDsp({
    sampleRate,
    gain: config.mechanical.gain,
    orders: config.mechanical.orders,
  });
  const source = new Float32Array(ANALYSIS_FRAMES);
  const engineSynchronousOutput = new Float32Array(ANALYSIS_FRAMES);
  let absoluteFrame = 0;
  while (absoluteFrame < totalFrames) {
    const frameCount = Math.min(128, totalFrames - absoluteFrame);
    const velocities = new Float64Array(frameCount).fill(angularVelocity);
    const events = eventGenerator.advanceSamples(
      velocities,
      sampleRate,
      absoluteFrame,
    );
    const combustion = new Float32Array(frameCount);
    pulse.process({ output: combustion, events, load: 1 });
    const exhaustOutput = new Float32Array(frameCount);
    exhaust.process(combustion, exhaustOutput);
    const mechanicalOutput = new Float32Array(frameCount);
    mechanical.process({
      output: mechanicalOutput,
      angularVelocityRadPerSec: angularVelocity,
    });
    for (let frame = 0; frame < frameCount; frame += 1) {
      const destination = absoluteFrame + frame - warmupFrames;
      if (destination >= 0) {
        source[destination] = combustion[frame]!;
        engineSynchronousOutput[destination] =
          exhaustOutput[frame]! + mechanicalOutput[frame]!;
      }
    }
    absoluteFrame += frameCount;
  }
  return { source, engineSynchronousOutput };
}

function nyquistGuardDb(signal: Float32Array): number {
  const windowed = Float32Array.from(signal, (sample, index) => {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / signal.length);
    return sample * window;
  });
  const power = fftPower(windowed);
  const guardStart = Math.floor((power.length - 1) * 0.9);
  let total = 0;
  let guard = 0;
  for (let bin = 1; bin < power.length; bin += 1) {
    total += power[bin]!;
    if (bin >= guardStart) guard += power[bin]!;
  }
  return 10 * Math.log10(guard / total);
}

describe("ticket 17 redline aliasing guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([44_100, 48_000])(
    "measures every preset at redline and %d Hz",
    (sampleRate) => {
      for (const preset of allPresets) {
        const rendered = renderAtRedline(preset, sampleRate);
        const guardDb = nyquistGuardDb(rendered.source);
        expect([...rendered.source].every(Number.isFinite)).toBe(true);
        expect(
          [...rendered.engineSynchronousOutput].every(Number.isFinite),
        ).toBe(true);
        expect(
          Math.max(...rendered.engineSynchronousOutput.map(Math.abs)),
        ).toBeLessThanOrEqual(1);
        // The top 10% below Nyquist must stay at least 80 dB below total
        // non-DC energy. The analytic x² exp(-2x) source pulse supplies the
        // pre-resonator bandwidth control; this guard catches regressions to
        // discontinuous/impulse-like excitation without relying on a final LPF.
        expect(guardDb).toBeLessThanOrEqual(-80);
      }
    },
    30_000,
  );

  it.each([44_100, 48_000])(
    "keeps every product preset finite and Nyquist-bounded near redline at %d Hz",
    async (runtimeSampleRate) => {
      vi.resetModules();
      let Processor: ProcessorConstructor | undefined;
      vi.stubGlobal("sampleRate", runtimeSampleRate);
      vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
      vi.stubGlobal(
        "registerProcessor",
        (_name: string, constructor: ProcessorConstructor) => {
          Processor = constructor;
        },
      );
      await import("../../src/audio/worklets/engine-audio-processor");

      for (const preset of allPresets) {
        const snapshot = structuredClone(preset.config);
        const processor = new Processor!({
          processorOptions: {
            requestId: `product-${preset.config.id}`,
            config: {
              version: 1,
              snapshot: {
                ...snapshot,
                idleRpm: Math.floor(snapshot.redlineRpm * 0.98),
              },
            },
          },
        });
        const parameters = {
          throttle: new Float32Array([1]),
          gain: new Float32Array([1]),
          loadTorqueNm: new Float32Array([0]),
        };
        const result = new Float32Array(ANALYSIS_FRAMES);
        const warmupFrames = runtimeSampleRate;
        const totalFrames = warmupFrames + result.length;
        let rendered = 0;
        while (rendered < totalFrames) {
          const frames = Math.min(128, totalFrames - rendered);
          const block = new Float32Array(frames);
          processor.process([], [[block]], parameters);
          const destination = rendered - warmupFrames;
          if (destination >= 0) result.set(block, destination);
          else if (destination + frames > 0) {
            result.set(block.subarray(-destination), 0);
          }
          rendered += frames;
        }
        const guardDb = nyquistGuardDb(result);
        expect([...result].every(Number.isFinite)).toBe(true);
        expect(Math.max(...result.map(Math.abs))).toBeLessThanOrEqual(1);
        expect(guardDb).toBeLessThanOrEqual(-45);
      }
    },
    30_000,
  );

  it("keeps 48 kHz / 128-frame product DSP p99 below half a block", async () => {
    vi.resetModules();
    let Processor: ProcessorConstructor | undefined;
    vi.stubGlobal("sampleRate", 48_000);
    vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
    vi.stubGlobal(
      "registerProcessor",
      (_name: string, constructor: ProcessorConstructor) => {
        Processor = constructor;
      },
    );
    await import("../../src/audio/worklets/engine-audio-processor");
    const base = structuredClone(
      multiCylinderPresets[multiCylinderPresets.length - 1]!.config,
    );
    const processor = new Processor!({
      processorOptions: {
        requestId: "ticket-17-budget",
        config: {
          version: 1,
          snapshot: {
            ...base,
            idleRpm: Math.floor(base.redlineRpm * 0.98),
            cylinders: base.cylinders.map((cylinder, index) => ({
              ...cylinder,
              bankId: index % 2 === 0 ? "left" : "right",
            })),
          },
        },
      },
    });
    const output = new Float32Array(128);
    const outputs = [[output]];
    const parameters = {
      throttle: new Float32Array([1]),
      gain: new Float32Array([1]),
      loadTorqueNm: new Float32Array([0]),
    };
    for (let block = 0; block < 250; block += 1) {
      processor.process([], outputs, parameters);
    }
    const elapsed = new Float64Array(2_000);
    for (let block = 0; block < elapsed.length; block += 1) {
      const started = performance.now();
      processor.process([], outputs, parameters);
      elapsed[block] = performance.now() - started;
    }
    elapsed.sort();
    const p99Ms = elapsed[Math.ceil(elapsed.length * 0.99) - 1]!;
    expect(p99Ms).toBeLessThan((128 / 48_000 / 2) * 1_000);
    expect([...output].every(Number.isFinite)).toBe(true);
    expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});
