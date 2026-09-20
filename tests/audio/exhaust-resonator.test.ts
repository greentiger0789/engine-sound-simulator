import { describe, expect, it } from "vitest";

import { ExhaustResonatorDsp } from "../../src/audio/dsp/exhaust-resonator";
import type { ExhaustConfig } from "../../src/engine/config";

const DEFAULT_EXHAUST: ExhaustConfig = {
  pipeLengthM: 1.25,
  damping: 0.18,
  mufflerAmount: 0.5,
};

function sine(
  sampleRate: number,
  frequencyHz: number,
  frames: number,
): Float32Array {
  return Float32Array.from({ length: frames }, (_, index) =>
    Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate),
  );
}

function rms(samples: Float32Array, start = 0): number {
  let sum = 0;
  for (let index = start; index < samples.length; index += 1) {
    sum += samples[index]! * samples[index]!;
  }
  return Math.sqrt(sum / (samples.length - start));
}

function impulse(frames: number): Float32Array {
  const result = new Float32Array(frames);
  result[0] = 1;
  return result;
}

describe("ExhaustResonatorDsp", () => {
  it.each([44_100, 48_000])(
    "keeps valid pathological configurations finite and stable at %d Hz",
    (sampleRate) => {
      const configurations: ExhaustConfig[] = [
        { pipeLengthM: Number.MIN_VALUE, damping: 0, mufflerAmount: 0 },
        {
          pipeLengthM: Number.MAX_VALUE,
          damping: Number.MAX_VALUE,
          mufflerAmount: 1,
        },
        DEFAULT_EXHAUST,
      ];
      for (const exhaust of configurations) {
        const dsp = new ExhaustResonatorDsp({ sampleRate, exhaust });
        const output = new Float32Array(sampleRate * 3);
        dsp.process(impulse(output.length), output);
        expect([...output].every(Number.isFinite)).toBe(true);
        expect(rms(output, sampleRate * 2)).toBeLessThan(0.001);
      }
    },
  );

  it("reset makes the same input sequence deterministic", () => {
    const dsp = new ExhaustResonatorDsp({
      sampleRate: 48_000,
      exhaust: DEFAULT_EXHAUST,
    });
    const input = sine(48_000, dsp.getState().resonanceHz, 8_192);
    const first = new Float32Array(input.length);
    const second = new Float32Array(input.length);
    dsp.process(input, first);
    dsp.reset();
    dsp.process(input, second);
    expect(second).toEqual(first);
  });

  it("processes only the requested realtime frames without allocating slices", () => {
    const input = sine(48_000, 100, 256);
    const realtime = new Float32Array(256).fill(-1);
    const expected = new Float32Array(128);
    const realtimeDsp = new ExhaustResonatorDsp({
      sampleRate: 48_000,
      exhaust: DEFAULT_EXHAUST,
    });
    const fullBufferDsp = new ExhaustResonatorDsp({
      sampleRate: 48_000,
      exhaust: DEFAULT_EXHAUST,
    });
    realtimeDsp.processRealtime(input, realtime, 128);
    fullBufferDsp.process(input.subarray(0, 128), expected);
    expect(realtime.subarray(0, 128)).toEqual(expected);
    expect(realtime.subarray(128)).toEqual(new Float32Array(128).fill(-1));

    expect(() => realtimeDsp.processRealtime(input, realtime, -1)).toThrow(
      "frameCount",
    );
    expect(() => realtimeDsp.processRealtime(input, realtime, 257)).toThrow(
      "frameCount",
    );
  });

  it("moves energy between resonance bands when pipe length changes", () => {
    const sampleRate = 48_000;
    const shortPipe = new ExhaustResonatorDsp({
      sampleRate,
      exhaust: { pipeLengthM: 0.5, damping: 0.05, mufflerAmount: 0 },
    });
    const longPipe = new ExhaustResonatorDsp({
      sampleRate,
      exhaust: { pipeLengthM: 2, damping: 0.05, mufflerAmount: 0 },
    });
    const shortBand = shortPipe.getState().resonanceHz;
    const longBand = longPipe.getState().resonanceHz;
    const frames = sampleRate;
    const shortInput = sine(sampleRate, shortBand, frames);
    const longInput = sine(sampleRate, longBand, frames);
    const shortAtShort = new Float32Array(frames);
    const longAtShort = new Float32Array(frames);
    const shortAtLong = new Float32Array(frames);
    const longAtLong = new Float32Array(frames);
    shortPipe.process(shortInput, shortAtShort);
    longPipe.process(shortInput, longAtShort);
    shortPipe.reset();
    longPipe.reset();
    shortPipe.process(longInput, shortAtLong);
    longPipe.process(longInput, longAtLong);
    const settledAt = Math.floor(sampleRate / 4);
    expect(rms(shortAtShort, settledAt)).toBeGreaterThan(
      rms(longAtShort, settledAt) * 1.1,
    );
    expect(rms(longAtLong, settledAt)).toBeGreaterThan(
      rms(shortAtLong, settledAt) * 1.1,
    );
  });

  it.each([44_100, 48_000])(
    "maps above-Nyquist pipe fundamentals below the edge without amplifying Nyquist at %d Hz",
    (sampleRate) => {
      const dsp = new ExhaustResonatorDsp({
        sampleRate,
        exhaust: { pipeLengthM: 0.001, damping: 0, mufflerAmount: 0 },
      });
      expect(dsp.getState()).toMatchObject({
        wasNyquistClamped: true,
        resonanceHz: sampleRate * 0.5 * 0.45,
      });
      const frames = sampleRate;
      const input = sine(sampleRate, sampleRate * 0.5 * 0.99, frames);
      const output = new Float32Array(frames);
      dsp.process(input, output);
      expect([...output].every(Number.isFinite)).toBe(true);
      expect(rms(output, sampleRate / 4)).toBeLessThan(
        rms(input, sampleRate / 4) * 1.05,
      );
    },
  );
});
