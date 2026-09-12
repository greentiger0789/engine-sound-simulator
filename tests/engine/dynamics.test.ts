import { describe, expect, it } from "vitest";

import {
  DYNAMICS_HZ,
  MAX_FRAME_ADVANCE_SECONDS,
  RotationalDynamics,
  interpolateTorqueCurve,
  radPerSecondToRpm,
  rpmToRadPerSecond,
} from "../../src/engine/dynamics";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";

function dynamics(options = {}): RotationalDynamics {
  return new RotationalDynamics(singleCylinderPreset.config, options);
}

function advanceInBlocks(
  model: RotationalDynamics,
  sampleRate: number,
  frames: readonly number[],
): void {
  for (const frameCount of frames) model.advanceFrames(frameCount, sampleRate);
}

function unevenBlocks(totalFrames: number): number[] {
  const blocks: number[] = [];
  let remaining = totalFrames;
  const sizes = [127, 1, 333, 64, 255, 17];
  let index = 0;
  while (remaining > 0) {
    const size = Math.min(remaining, sizes[index % sizes.length] ?? 1);
    blocks.push(size);
    remaining -= size;
    index += 1;
  }
  return blocks;
}

describe("RotationalDynamics", () => {
  it("centralizes reversible SI/rpm conversion", () => {
    expect(DYNAMICS_HZ).toBe(1_000);
    expect(rpmToRadPerSecond(60)).toBeCloseTo(2 * Math.PI, 12);
    expect(radPerSecondToRpm(2 * Math.PI)).toBeCloseTo(60, 12);
    expect(radPerSecondToRpm(rpmToRadPerSecond(7123.4))).toBeCloseTo(
      7123.4,
      10,
    );
    expect(() => rpmToRadPerSecond(Number.NaN)).toThrow(RangeError);
    expect(() => rpmToRadPerSecond(Number.MAX_VALUE)).toThrow(RangeError);
  });

  it("interpolates and clamps the configurable torque curve", () => {
    const curve = singleCylinderPreset.config.torqueCurve;
    expect(interpolateTorqueCurve(curve, 1250)).toBeCloseTo(14);
    expect(interpolateTorqueCurve(curve, 9000)).toBe(20);
    expect(interpolateTorqueCurve(curve, 0)).toBe(0);
    expect(() => interpolateTorqueCurve([{ rpm: 0, torqueNm: 1 }], 0)).toThrow(
      RangeError,
    );
    expect(() =>
      interpolateTorqueCurve(
        [
          { rpm: 0, torqueNm: -Number.MAX_VALUE },
          { rpm: 1, torqueNm: Number.MAX_VALUE },
        ],
        0.5,
      ),
    ).toThrow(RangeError);
  });

  it("uses a lagged throttle and follows a sustained opening smoothly", () => {
    const model = dynamics();
    model.setThrottle(1);
    const firstStep = model.advanceFrames(48, 48_000);
    expect(firstStep.effectiveThrottle).toBeGreaterThan(0);
    expect(firstStep.effectiveThrottle).toBeLessThan(1);

    const before = firstStep.rpm;
    model.advanceFrames(48_000 * 3, 48_000);
    const after = model.getState();
    expect(after.effectiveThrottle).toBeCloseTo(1, 8);
    expect(after.rpm).toBeGreaterThan(before + 500);
  });

  it("falls after closing throttle and maintains a finite near-idle state", () => {
    const model = dynamics();
    model.setThrottle(1);
    model.advanceFrames(48_000 * 3, 48_000);
    const openRpm = model.getState().rpm;
    model.setThrottle(0);
    model.advanceFrames(48_000 * 8, 48_000);
    const closed = model.getState();
    expect(closed.rpm).toBeLessThan(openRpm);
    expect(closed.rpm).toBeGreaterThan(900);
    expect(closed.rpm).toBeLessThan(1600);
    expect(Number.isFinite(closed.rpm)).toBe(true);
  });

  it("is deterministic and invariant to audio block partitions at 44.1 and 48 kHz", () => {
    const oneSecond44 = 44_100;
    const oneSecond48 = 48_000;
    const direct44 = dynamics();
    const split44 = dynamics();
    const split48 = dynamics();
    const repeat48 = dynamics();
    for (const model of [direct44, split44, split48, repeat48]) {
      model.setThrottle(0.63);
    }

    direct44.advanceFrames(oneSecond44, 44_100);
    advanceInBlocks(split44, 44_100, unevenBlocks(oneSecond44));
    advanceInBlocks(split48, 48_000, unevenBlocks(oneSecond48));
    repeat48.advanceFrames(oneSecond48, 48_000);

    expect(split44.getState()).toEqual(direct44.getState());
    expect(split48.getState()).toEqual(repeat48.getState());
    expect(split48.getState()).toEqual(direct44.getState());
  });

  it("keeps finite, non-negative state during abrupt controls and a long run", () => {
    const model = dynamics({ loadTorqueNm: 2 });
    for (let second = 0; second < 120; second += 1) {
      model.setThrottle(second % 2 === 0 ? 1 : 0);
      model.setLoadTorque(second % 3 === 0 ? 15 : 0);
      advanceInBlocks(model, 44_100, unevenBlocks(44_100));
      const state = model.getState();
      expect(state.rpm).toBeGreaterThanOrEqual(0);
      expect(state.angularVelocityRadPerSec).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(state.rpm)).toBe(true);
      expect(Number.isFinite(state.effectiveThrottle)).toBe(true);
    }
  });

  it("rejects invalid call-boundary values and invalid engine configuration", () => {
    const model = dynamics();
    expect(() => model.setThrottle(-0.001)).toThrow(RangeError);
    expect(() => model.setThrottle(1.001)).toThrow(RangeError);
    expect(() => model.setThrottle(Number.NaN)).toThrow(RangeError);
    expect(() => model.setLoadTorque(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => model.advanceFrames(-1, 48_000)).toThrow(RangeError);
    expect(() => model.advanceFrames(128, 0)).toThrow(RangeError);
    expect(() => model.advanceFrames(1, Number.MIN_VALUE)).toThrow(RangeError);
    expect(() => model.advanceFrames(MAX_FRAME_ADVANCE_SECONDS + 1, 1)).toThrow(
      RangeError,
    );

    const invalidConfig = structuredClone(singleCylinderPreset.config);
    (invalidConfig as { inertiaKgM2: number }).inertiaKgM2 = 0;
    expect(() => new RotationalDynamics(invalidConfig)).toThrow(RangeError);

    const overflowConfig = structuredClone(singleCylinderPreset.config);
    (overflowConfig as { inertiaKgM2: number }).inertiaKgM2 = Number.MIN_VALUE;
    expect(() => new RotationalDynamics(overflowConfig)).toThrow(RangeError);
  });
});
