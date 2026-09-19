import { describe, expect, it } from "vitest";

import {
  FiringEventGenerator,
  type FiringEvent,
} from "../../src/engine/events";
import { rpmToRadPerSecond } from "../../src/engine/dynamics";
import {
  renderOfflinePulse,
  SingleCylinderPulseDsp,
  type OfflinePulseBlock,
} from "../../src/audio/dsp/single-cylinder-pulse";

function event(frame: number, offset = 0.25): FiringEvent {
  return {
    cylinderId: "single",
    cycleIndex: Math.floor(frame / 960),
    firingAngleDeg: 0,
    sampleIndex: frame,
    sampleOffset: offset,
    absoluteFrame: frame + offset,
  };
}

function metrics(samples: Float32Array): {
  rms: number;
  dc: number;
  peak: number;
} {
  let sum = 0;
  let squareSum = 0;
  let peak = 0;
  for (const sample of samples) {
    sum += sample;
    squareSum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    rms: Math.sqrt(squareSum / samples.length),
    dc: sum / samples.length,
    peak,
  };
}

function blocksFor(
  totalFrames: number,
  sizes: readonly number[],
  absoluteEvents: readonly FiringEvent[],
  loadAt: (frame: number) => number,
): OfflinePulseBlock[] {
  const blocks: OfflinePulseBlock[] = [];
  let start = 0;
  let sizeIndex = 0;
  while (start < totalFrames) {
    const frames = Math.min(
      sizes[sizeIndex % sizes.length]!,
      totalFrames - start,
    );
    const events = absoluteEvents
      .filter(
        (candidate) =>
          candidate.sampleIndex >= start &&
          candidate.sampleIndex < start + frames,
      )
      .map((candidate) => ({
        ...candidate,
        sampleIndex: candidate.sampleIndex - start,
      }));
    const load = Float64Array.from({ length: frames }, (_, index) =>
      loadAt(start + index),
    );
    blocks.push({ frames, events, load });
    start += frames;
    sizeIndex += 1;
  }
  return blocks;
}

describe("SingleCylinderPulseDsp", () => {
  it("accepts only finite pre-saturator drive through the calibrated maximum", () => {
    expect(
      () =>
        new SingleCylinderPulseDsp({
          sampleRate: 44_100,
          outputGain: 20,
        }),
    ).not.toThrow();
    for (const outputGain of [-1, 20.000_001, Number.POSITIVE_INFINITY]) {
      expect(
        () => new SingleCylinderPulseDsp({ sampleRate: 44_100, outputGain }),
      ).toThrow("outputGain must be finite and in [0, 20]");
    }
  });

  it.each([44_100, 48_000])(
    "renders finite protected idle, mid, WOT, and abrupt-load waveforms at %d Hz",
    (sampleRate) => {
      const totalFrames = sampleRate * 2;
      const events = Array.from({ length: 100 }, (_, index) =>
        event(index * (sampleRate / 50)),
      );
      const scenarios = [
        () => 0,
        () => 0.5,
        () => 1,
        (frame: number) => (frame < totalFrames / 2 ? 0.05 : 1),
      ];
      for (const loadAt of scenarios) {
        const rendered = renderOfflinePulse(
          { sampleRate },
          blocksFor(totalFrames, [127, 128, 31], events, loadAt),
        );
        const settled = rendered.subarray(sampleRate / 2);
        const measured = metrics(settled);
        expect([...rendered].every(Number.isFinite)).toBe(true);
        expect(measured.peak).toBeLessThanOrEqual(1);
        expect(Math.abs(measured.dc)).toBeLessThan(0.003);
        expect(measured.rms).toBeGreaterThan(0);
      }
    },
  );

  it("has one responsive analytic pulse for each 6000 rpm four-stroke event", () => {
    const sampleRate = 48_000;
    const events = new FiringEventGenerator({
      cycleDegrees: 720,
      cylinders: [{ id: "single", firingAngleDeg: 0 }],
    }).advanceSamples(
      new Float64Array(sampleRate).fill(rpmToRadPerSecond(6_000)),
      sampleRate,
    );
    expect(events).toHaveLength(50);
    const renderAndCount = (sequence: readonly FiringEvent[]): number => {
      const dsp = new SingleCylinderPulseDsp({ sampleRate });
      for (const block of blocksFor(sampleRate, [128], sequence, () => 0.8)) {
        dsp.process({
          output: new Float32Array(block.frames),
          events: block.events,
          load: block.load,
        });
      }
      return dsp.getPulseState().triggeredPulseCount;
    };
    expect(renderAndCount(events)).toBe(50);
    // Overlapping tails cannot fabricate a trigger: omitting one event is
    // observable even though surrounding output windows still contain energy.
    expect(renderAndCount(events.slice(0, -1))).toBe(49);
  });

  it("is deterministic, responds to within-sample offsets, and is partition invariant", () => {
    const totalFrames = 8_003;
    const events = [
      event(0, 0.1),
      event(500, 0.8),
      event(3_000, 0.4),
      event(8_000, 0.2),
    ];
    const loadAt = (frame: number) => (frame < 4_000 ? 0.25 : 0.9);
    const oneFrame = renderOfflinePulse(
      { sampleRate: 48_000 },
      blocksFor(totalFrames, [1], events, loadAt),
    );
    const uneven = renderOfflinePulse(
      { sampleRate: 48_000 },
      blocksFor(totalFrames, [127, 128, 19, 301], events, loadAt),
    );
    expect(oneFrame).toEqual(uneven);
    expect(oneFrame).toEqual(
      renderOfflinePulse(
        { sampleRate: 48_000 },
        blocksFor(totalFrames, [128], events, loadAt),
      ),
    );

    const early = new Float32Array(4);
    const late = new Float32Array(4);
    new SingleCylinderPulseDsp({ sampleRate: 48_000 }).process({
      output: early,
      events: [event(0, 0.1)],
      load: 1,
    });
    new SingleCylinderPulseDsp({ sampleRate: 48_000 }).process({
      output: late,
      events: [event(0, 0.9)],
      load: 1,
    });
    expect(early[0]).toBeGreaterThan(late[0]!);
  });

  it("preserves finite pulse and filter state across more than ten seconds", () => {
    const sampleRate = 44_100;
    const totalFrames = sampleRate * 11 + 17;
    const events = Array.from({ length: 551 }, (_, index) =>
      event(index * (sampleRate / 50)),
    );
    const rendered = renderOfflinePulse(
      { sampleRate },
      blocksFor(totalFrames, [1, 127, 128, 509], events, () => 0.7),
    );
    expect([...rendered].every(Number.isFinite)).toBe(true);
    expect(metrics(rendered.subarray(sampleRate)).peak).toBeLessThanOrEqual(1);
  });

  it("mutes exactly and latches silence after invalid input", () => {
    const dsp = new SingleCylinderPulseDsp({ sampleRate: 48_000 });
    const muted = new Float32Array(64);
    dsp.process({ output: muted, events: [event(0)], load: 1, muted: true });
    expect([...muted]).toEqual(new Array(64).fill(0));

    const faulty = new Float32Array(16);
    dsp.process({ output: faulty, events: [event(0)], load: Number.NaN });
    expect(dsp.getFaultState()).toEqual({
      faulted: true,
      reason: "load must be in [0, 1]",
    });
    expect([...faulty]).toEqual(new Array(16).fill(0));
    const afterFault = new Float32Array(16);
    dsp.process({ output: afterFault, events: [], load: 1 });
    expect([...afterFault]).toEqual(new Array(16).fill(0));
  });

  it("faults to silence when recursive mastering state becomes non-finite", () => {
    const dsp = new SingleCylinderPulseDsp({ sampleRate: 44_100 });
    (
      dsp as unknown as {
        previousFinalOutput: number;
      }
    ).previousFinalOutput = Number.POSITIVE_INFINITY;
    const output = new Float32Array(32).fill(1);
    dsp.process({ output, events: [], load: 0 });
    expect(dsp.getFaultState()).toEqual({
      faulted: true,
      reason: "non-finite signal",
    });
    expect([...output]).toEqual(new Array(32).fill(0));
  });

  it("makes higher load both louder and longer-lived", () => {
    const low = new Float32Array(1_024);
    const high = new Float32Array(1_024);
    new SingleCylinderPulseDsp({ sampleRate: 48_000, outputGain: 1 }).process({
      output: low,
      events: [event(0)],
      load: 0,
    });
    new SingleCylinderPulseDsp({ sampleRate: 48_000, outputGain: 1 }).process({
      output: high,
      events: [event(0)],
      load: 1,
    });
    expect(metrics(high).peak).toBeGreaterThan(metrics(low).peak);
    expect(Math.abs(high[700]!)).toBeGreaterThan(Math.abs(low[700]!));
  });

  it("limits an accepted dense overlap without muting it", () => {
    const dsp = new SingleCylinderPulseDsp({
      sampleRate: 48_000,
    });
    const output = new Float32Array(768);
    dsp.process({
      output,
      events: Array.from({ length: 256 }, (_, index) => ({
        ...event(0, 0.1),
        cylinderId: `dense-${index}`,
      })),
      load: 1,
    });
    const measured = metrics(output);
    expect(dsp.getFaultState()).toEqual({ faulted: false, reason: null });
    expect(measured.peak).toBeGreaterThan(0.7);
    expect(measured.peak).toBeLessThanOrEqual(0.8);
    expect(measured.rms).toBeGreaterThan(0);
  });

  it("rejects overlong event input before event traversal", () => {
    let indexed = false;
    const oversizedEvents = {
      length: 513,
      get 0(): FiringEvent {
        indexed = true;
        throw new Error("event entry must not be read");
      },
    } as unknown as readonly FiringEvent[];
    const dsp = new SingleCylinderPulseDsp({ sampleRate: 48_000 });
    const output = new Float32Array(8);
    dsp.process({ output, events: oversizedEvents, load: 1 });
    expect(indexed).toBe(false);
    expect(dsp.getFaultState()).toEqual({
      faulted: true,
      reason: "event count exceeds maxEventsPerBlock",
    });
    expect([...output]).toEqual(new Array(8).fill(0));
  });

  it("rejects a DC blocker coefficient rounded to one", () => {
    expect(
      () =>
        new SingleCylinderPulseDsp({
          sampleRate: Number.MAX_VALUE,
          dcBlockerHz: 1,
        }),
    ).toThrow("unusable coefficient");
  });

  it("bounds dense active pulses and faults safely to silence", () => {
    const dsp = new SingleCylinderPulseDsp({
      sampleRate: 48_000,
      maxActivePulses: 2,
    });
    const output = new Float32Array(16);
    dsp.process({
      output,
      events: [
        event(0, 0.1),
        { ...event(0, 0.2), cylinderId: "two" },
        { ...event(0, 0.3), cylinderId: "three" },
      ],
      load: 1,
    });
    expect(dsp.getFaultState()).toEqual({
      faulted: true,
      reason: "active pulse limit exceeded",
    });
    expect(dsp.getPulseState()).toEqual({
      activePulseCount: 0,
      triggeredPulseCount: 2,
    });
    expect([...output]).toEqual(new Array(16).fill(0));
  });
});
