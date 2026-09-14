import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineAudioProcessorOptions } from "../../src/audio/worklets/contracts";
import { ENGINE_AUDIO_PROCESSOR_NAME } from "../../src/audio/worklets/contracts";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";
import {
  evenlySpacedTriplePreset,
  evenlySpacedFourPreset,
  parallelTwin360Preset,
} from "../../src/presets/multicylinder";

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

type ProcessorInstance = {
  readonly port: FakePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};
type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => ProcessorInstance;

function options(requestId = "request-1"): AudioWorkletNodeOptions {
  const processorOptions: EngineAudioProcessorOptions = {
    requestId,
    config: {
      version: 1,
      snapshot: structuredClone(singleCylinderPreset.config),
    },
  };
  return { processorOptions };
}

function render(
  processor: ProcessorInstance,
  frames: number,
  throttle: Float32Array,
  gain = new Float32Array([1]),
): Float32Array {
  const output = new Float32Array(frames);
  processor.process([], [[output]], { throttle, gain });
  return output;
}

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
  afterEach(() => vi.unstubAllGlobals());

  it.each([44100, 48000])(
    "initializes a %d Hz snapshot and renders finite audio across uneven blocks",
    async (runtimeSampleRate) => {
      vi.stubGlobal("sampleRate", runtimeSampleRate);
      await import("../../src/audio/worklets/engine-audio-processor");
      expect(ENGINE_AUDIO_PROCESSOR_NAME).toBe("engine-audio-processor");
      const processor = new registeredProcessor!(options("initial"));
      expect(processor.port.messages).toEqual([
        { type: "config-applied", requestId: "initial" },
        { type: "ready", requestId: "initial", sampleRate: runtimeSampleRate },
      ]);
      for (const frames of [1, 127, 129, 257]) {
        const output = render(processor, frames, new Float32Array([0.5]));
        expect([...output].every(Number.isFinite)).toBe(true);
        expect(Math.max(...output.map(Math.abs))).toBeLessThan(1);
      }
    },
  );

  it("stays silent before configuration and rejects bad snapshots without ready", async () => {
    vi.stubGlobal("sampleRate", 48000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const silent = new registeredProcessor!();
    expect(render(silent, 32, new Float32Array([1]))).toEqual(
      new Float32Array(32),
    );
    const rejected = new registeredProcessor!({
      processorOptions: {
        requestId: "bad",
        config: { version: 1, snapshot: { nope: true } },
      },
    });
    expect(rejected.port.messages).toHaveLength(1);
    expect(rejected.port.messages[0]).toMatchObject({
      type: "config-rejected",
      requestId: "bad",
    });
    expect(render(rejected, 32, new Float32Array([1]))).toEqual(
      new Float32Array(32),
    );
  });

  it.each([
    singleCylinderPreset.config,
    parallelTwin360Preset.config,
    evenlySpacedTriplePreset.config,
    evenlySpacedFourPreset.config,
  ])(
    "accepts and freshly resets a validated multi-cylinder snapshot",
    async (snapshot) => {
      vi.stubGlobal("sampleRate", 48000);
      await import("../../src/audio/worklets/engine-audio-processor");
      const processor = new registeredProcessor!(options("one"));
      render(processor, 256, new Float32Array([1]));
      const internal = processor as unknown as {
        framesRendered: number;
        runtime: { config: { cylinders: readonly unknown[] } };
      };
      processor.port.onmessage?.({
        data: {
          type: "replace-config",
          requestId: "replacement",
          config: { version: 1, snapshot: structuredClone(snapshot) },
        },
      } as MessageEvent);
      expect(processor.port.messages.slice(-2)).toEqual([
        { type: "config-applied", requestId: "replacement" },
        { type: "ready", requestId: "replacement", sampleRate: 48000 },
      ]);
      expect(internal.framesRendered).toBe(0);
      expect(internal.runtime.config.cylinders).toHaveLength(
        snapshot.cylinders.length,
      );
      expect(
        [...render(processor, 127, new Float32Array([0.5]))].every(
          Number.isFinite,
        ),
      ).toBe(true);
    },
  );

  it("treats scalar and a-rate throttle equivalently and accepts a mid-block opening", async () => {
    vi.stubGlobal("sampleRate", 48000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const scalar = new registeredProcessor!(options("scalar"));
    const vector = new registeredProcessor!(options("vector"));
    for (const frames of [127, 129, 257]) {
      render(scalar, frames, new Float32Array([0.7]));
      render(vector, frames, new Float32Array(frames).fill(0.7));
    }
    const state = (processor: ProcessorInstance) => {
      const internal = processor as unknown as {
        runtime: {
          dynamics: { getState(): { effectiveThrottle: number } };
        };
      };
      return internal.runtime.dynamics.getState();
    };
    expect(state(scalar).effectiveThrottle).toBeCloseTo(
      state(vector).effectiveThrottle,
      10,
    );

    const closed = new registeredProcessor!(options("closed"));
    const opened = new registeredProcessor!(options("opened"));
    const changed = new registeredProcessor!(options("changed"));
    const frames = 1_920;
    render(closed, frames, new Float32Array([0]));
    render(opened, frames, new Float32Array([1]));
    const automation = new Float32Array(frames);
    automation.fill(1, frames / 2);
    render(changed, frames, automation);
    expect(state(changed).effectiveThrottle).toBeGreaterThan(
      state(closed).effectiveThrottle,
    );
    expect(state(changed).effectiveThrottle).toBeLessThan(
      state(opened).effectiveThrottle,
    );
  });

  it("declares a-rate parameters and latches finite-value faults to silence", async () => {
    vi.stubGlobal("sampleRate", 48000);
    const module =
      await import("../../src/audio/worklets/engine-audio-processor");
    expect(module.EngineAudioProcessor.parameterDescriptors).toEqual([
      expect.objectContaining({ name: "throttle", automationRate: "a-rate" }),
      expect.objectContaining({ name: "gain", automationRate: "a-rate" }),
    ]);
    const processor = new registeredProcessor!(options());
    expect(render(processor, 32, new Float32Array([Number.NaN]))).toEqual(
      new Float32Array(32),
    );
    expect(processor.port.messages.at(-1)).toMatchObject({
      type: "fatal-error",
    });
    expect(render(processor, 32, new Float32Array([1]))).toEqual(
      new Float32Array(32),
    );
  });

  it("applies the gain AudioParam as an exact post-protection PCM scale", async () => {
    vi.stubGlobal("sampleRate", 48000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const low = new registeredProcessor!(options("low-gain"));
    const high = new registeredProcessor!(options("high-gain"));
    let lowEnergy = 0;
    let highEnergy = 0;
    let lowPeak = 0;
    let highPeak = 0;
    const framesPerBlock = 512;
    const blockCount = 64;
    for (let block = 0; block < blockCount; block += 1) {
      const lowOutput = render(
        low,
        framesPerBlock,
        new Float32Array([1]),
        new Float32Array([0.15]),
      );
      const highOutput = render(
        high,
        framesPerBlock,
        new Float32Array([1]),
        new Float32Array([1]),
      );
      for (let frame = 0; frame < framesPerBlock; frame += 1) {
        const lowSample = lowOutput[frame]!;
        const highSample = highOutput[frame]!;
        expect(Number.isFinite(lowSample)).toBe(true);
        expect(Number.isFinite(highSample)).toBe(true);
        lowEnergy += lowSample * lowSample;
        highEnergy += highSample * highSample;
        lowPeak = Math.max(lowPeak, Math.abs(lowSample));
        highPeak = Math.max(highPeak, Math.abs(highSample));
      }
    }
    const ratio = 1 / 0.15;
    expect(lowPeak).toBeGreaterThan(0);
    expect(highPeak).toBeLessThanOrEqual(1);
    expect(highPeak / lowPeak).toBeCloseTo(ratio, 5);
    expect(Math.sqrt(highEnergy / lowEnergy)).toBeCloseTo(ratio, 5);
  });

  it("follows throttle up and back to idle while limiting telemetry to 30 Hz", async () => {
    vi.stubGlobal("sampleRate", 48000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const processor = new registeredProcessor!(options("trajectory"));
    const internal = processor as unknown as {
      runtime: {
        dynamics: {
          getState(): { rpm: number; effectiveThrottle: number };
        };
      };
    };
    const renderDuration = (seconds: number, throttle: number) => {
      let remaining = seconds * 48_000;
      const blocks = [127, 128, 257];
      let index = 0;
      while (remaining > 0) {
        const frames = Math.min(remaining, blocks[index++ % blocks.length]!);
        render(processor, frames, new Float32Array([throttle]));
        remaining -= frames;
      }
    };

    const idle = internal.runtime.dynamics.getState();
    renderDuration(2, 1);
    const opened = internal.runtime.dynamics.getState();
    expect(opened.rpm).toBeGreaterThan(idle.rpm + 500);
    expect(opened.effectiveThrottle).toBeGreaterThan(0.99);

    renderDuration(8, 0);
    const returned = internal.runtime.dynamics.getState();
    expect(returned.rpm).toBeGreaterThanOrEqual(900);
    expect(returned.rpm).toBeLessThanOrEqual(1600);
    expect(returned.effectiveThrottle).toBeLessThan(0.001);

    const telemetry = processor.port.messages.filter(
      (message) => (message as { type?: string }).type === "telemetry",
    );
    expect(telemetry.length).toBeGreaterThanOrEqual(200);
    expect(telemetry.length).toBeLessThanOrEqual(300);
  });

  it.each([44_100, 48_000])(
    "uses the preallocated real-time path and posts 20-30 Hz telemetry inside %d Hz large blocks",
    async (runtimeSampleRate) => {
      vi.stubGlobal("sampleRate", runtimeSampleRate);
      const { FiringEventGenerator } = await import("../../src/engine/events");
      const { SingleCylinderPulseDsp } =
        await import("../../src/audio/dsp/single-cylinder-pulse");
      const eventsSpy = vi.spyOn(
        FiringEventGenerator.prototype,
        "advanceSamples",
      );
      const dspSpy = vi.spyOn(SingleCylinderPulseDsp.prototype, "process");
      await import("../../src/audio/worklets/engine-audio-processor");
      const processor = new registeredProcessor!(options("realtime"));
      const blockPattern = [2048, 4096, 127, 257];
      let rendered = 0;
      let blockIndex = 0;
      while (rendered < runtimeSampleRate * 2) {
        const frames = Math.min(
          blockPattern[blockIndex % blockPattern.length]!,
          runtimeSampleRate * 2 - rendered,
        );
        const output = render(processor, frames, new Float32Array([0.6]));
        expect([...output].every(Number.isFinite)).toBe(true);
        rendered += frames;
        blockIndex += 1;
      }
      expect(eventsSpy).not.toHaveBeenCalled();
      expect(dspSpy).not.toHaveBeenCalled();
      const telemetry = processor.port.messages.filter(
        (message) => (message as { type?: string }).type === "telemetry",
      ) as Array<{ framesRendered: number }>;
      expect(telemetry.length).toBeGreaterThanOrEqual(40);
      expect(telemetry.length).toBeLessThanOrEqual(60);
      for (let index = 1; index < telemetry.length; index += 1) {
        expect(
          telemetry[index]!.framesRendered -
            telemetry[index - 1]!.framesRendered,
        ).toBe(runtimeSampleRate / 30);
      }
    },
  );

  it("uses the limiter's one state for both drive torque and combustion pulses", async () => {
    vi.stubGlobal("sampleRate", 48000);
    await import("../../src/audio/worklets/engine-audio-processor");
    const snapshot = {
      ...structuredClone(singleCylinderPreset.config),
      idleRpm: 1000,
      redlineRpm: 1100,
      cycleDegrees: 360,
    };
    const processor = new registeredProcessor!({
      processorOptions: {
        requestId: "limiter",
        config: { version: 1, snapshot },
      },
    });
    const internal = processor as unknown as {
      limiterActive: boolean;
      runtime: {
        dynamics: { getState(): { driveTorqueMultiplier: number } };
        dsp: { getPulseState(): { triggeredPulseCount: number } };
      };
    };
    for (let index = 0; index < 1000 && !internal.limiterActive; index += 1)
      render(processor, 128, new Float32Array([1]));
    expect(internal.limiterActive).toBe(true);
    expect(internal.runtime.dynamics.getState().driveTorqueMultiplier).toBe(0);
    const before = internal.runtime.dsp.getPulseState().triggeredPulseCount;
    // The limiter state is sampled before each following frame's event mask,
    // matching the multiplier that advances that frame's dynamics boundary.
    render(processor, 1024, new Float32Array([1]));
    expect(internal.runtime.dsp.getPulseState().triggeredPulseCount).toBe(
      before,
    );

    for (let index = 0; index < 1000 && internal.limiterActive; index += 1)
      render(processor, 128, new Float32Array([0]));
    expect(internal.limiterActive).toBe(false);
    expect(internal.runtime.dynamics.getState().driveTorqueMultiplier).toBe(1);
    render(processor, 4096, new Float32Array([0]));
    expect(
      internal.runtime.dsp.getPulseState().triggeredPulseCount,
    ).toBeGreaterThan(before);
  });
});
