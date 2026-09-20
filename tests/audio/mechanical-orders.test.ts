import { describe, expect, it } from "vitest";

import { MechanicalOrdersDsp } from "../../src/audio/dsp/mechanical-orders";

const RPM_6000_RAD_PER_SEC = 200 * Math.PI;

function magnitudeAt(
  samples: Float32Array,
  sampleRate: number,
  frequencyHz: number,
): number {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = (2 * Math.PI * frequencyHz * index) / sampleRate;
    real += samples[index]! * Math.cos(angle);
    imaginary -= samples[index]! * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) / samples.length;
}

describe("MechanicalOrdersDsp", () => {
  it("is deterministic after reset and invariant to block partitioning", () => {
    const options = { sampleRate: 48_000, gain: 0.2, orders: [1, 2.5, 4] };
    const frames = 1_024;
    const whole = new Float32Array(frames);
    const partitioned = new Float32Array(frames);
    const dsp = new MechanicalOrdersDsp(options);

    dsp.process({
      output: whole,
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    dsp.reset();
    dsp.process({
      output: partitioned.subarray(0, 317),
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    dsp.process({
      output: partitioned.subarray(317),
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    expect(partitioned).toEqual(whole);

    dsp.reset();
    const resetOutput = new Float32Array(frames);
    dsp.process({
      output: resetOutput,
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    expect(resetOutput).toEqual(whole);
  });

  it.each([44_100, 48_000])(
    "keeps disabled and enabled output finite and bounded at %d Hz",
    (sampleRate) => {
      for (const gain of [0, 0.25]) {
        const output = new Float32Array(sampleRate / 10);
        new MechanicalOrdersDsp({
          sampleRate,
          gain,
          orders: [0.5, 1, 3, 7],
        }).process({
          output,
          angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
        });
        expect([...output].every(Number.isFinite)).toBe(true);
        expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(gain);
      }
    },
  );

  it("changes PCM when the configured crank orders differ", () => {
    const first = new Float32Array(1_024);
    const second = new Float32Array(1_024);
    new MechanicalOrdersDsp({
      sampleRate: 48_000,
      gain: 0.2,
      orders: [1],
    }).process({
      output: first,
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    new MechanicalOrdersDsp({
      sampleRate: 48_000,
      gain: 0.2,
      orders: [2],
    }).process({
      output: second,
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    expect(second).not.toEqual(first);
  });

  it("rejects orders beyond the bounded supported range", () => {
    expect(
      () =>
        new MechanicalOrdersDsp({
          sampleRate: 48_000,
          gain: 0.1,
          orders: [33],
        }),
    ).toThrow("(0, 32]");
  });

  it("concentrates a second-order component at 200 Hz at 6000 rpm", () => {
    const sampleRate = 48_000;
    const output = new Float32Array(sampleRate);
    new MechanicalOrdersDsp({
      sampleRate,
      gain: 0.2,
      orders: [2],
    }).process({ output, angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC });

    const target = magnitudeAt(output, sampleRate, 200);
    expect(target).toBeGreaterThan(magnitudeAt(output, sampleRate, 199) * 100);
    expect(target).toBeGreaterThan(magnitudeAt(output, sampleRate, 201) * 100);
  });

  it("rejects malformed blocks before advancing oscillator state", () => {
    const options = { sampleRate: 48_000, gain: 0.2, orders: [2] };
    const afterFailure = new MechanicalOrdersDsp(options);
    const reference = new MechanicalOrdersDsp(options);
    const invalidOutput = new Float32Array(4).fill(-1);
    expect(() =>
      afterFailure.process({
        output: invalidOutput,
        angularVelocityRadPerSec: new Float64Array([100, Number.NaN, 100, 100]),
      }),
    ).toThrow("finite non-negative");
    expect(invalidOutput).toEqual(new Float32Array(4).fill(-1));

    const actual = new Float32Array(32);
    const expected = new Float32Array(32);
    afterFailure.process({
      output: actual,
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    reference.process({
      output: expected,
      angularVelocityRadPerSec: RPM_6000_RAD_PER_SEC,
    });
    expect(actual).toEqual(expected);
  });

  it("uses only requested realtime frames and validates all of them first", () => {
    const dsp = new MechanicalOrdersDsp({
      sampleRate: 48_000,
      gain: 0.2,
      orders: [2],
    });
    const output = new Float32Array(8).fill(-1);
    const velocities = new Float64Array(8).fill(RPM_6000_RAD_PER_SEC);
    dsp.processRealtime(output, 4, velocities);
    expect(output.subarray(4)).toEqual(new Float32Array(4).fill(-1));
    expect(() =>
      dsp.processRealtime(
        output,
        5,
        new Float64Array([1, 1, 1, 1, Number.POSITIVE_INFINITY]),
      ),
    ).toThrow("finite non-negative");
  });
});
