import { describe, expect, it } from "vitest";

import { BlockBudgetMeter } from "../../src/audio/dsp/block-budget-meter";

describe("BlockBudgetMeter", () => {
  it("derives the callback budget from frames and the actual sample rate", () => {
    const meter = new BlockBudgetMeter();
    meter.record(1, 128, 48_000);
    expect(meter.getLastBudgetMs()).toBeCloseTo(8 / 3, 12);
    expect(meter.getLastElapsedMs()).toBe(1);
    expect(meter.getMaximumLoadRatio()).toBeCloseTo(0.375, 12);
  });

  it("tracks a bounded fixed-histogram p99 without per-record allocation", () => {
    const meter = new BlockBudgetMeter();
    for (let index = 0; index < 99; index += 1) {
      meter.record(0.25, 128, 48_000);
    }
    meter.record(2, 128, 48_000);
    expect(meter.getSampleCount()).toBe(100);
    expect(meter.getP99LoadRatio()).toBeCloseTo(0.1, 12);
    expect(meter.getMaximumLoadRatio()).toBeCloseTo(0.75, 12);
    meter.reset();
    expect(meter.getSampleCount()).toBe(0);
    expect(meter.getP99LoadRatio()).toBe(0);
  });

  it("rejects invalid measurements without changing prior state", () => {
    const meter = new BlockBudgetMeter();
    meter.record(0.5, 128, 48_000);
    const samples = meter.getSampleCount();
    expect(() => meter.record(Number.NaN, 128, 48_000)).toThrow();
    expect(() => meter.record(0.5, 0, 48_000)).toThrow();
    expect(() => meter.record(0.5, 128, 0)).toThrow();
    expect(meter.getSampleCount()).toBe(samples);
  });
});
