import { describe, expect, it } from "vitest";

import { IntakePathDsp } from "../../src/audio/dsp/intake-path";

const config = { noiseGain: 0.3, resonanceHz: 1_200 };

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function binEnergy(
  samples: Float32Array,
  sampleRate: number,
  frequency: number,
): number {
  let cosine = 0;
  let sine = 0;
  for (let frame = 0; frame < samples.length; frame += 1) {
    const phase = (2 * Math.PI * frequency * frame) / sampleRate;
    cosine += samples[frame]! * Math.cos(phase);
    sine += samples[frame]! * Math.sin(phase);
  }
  return cosine * cosine + sine * sine;
}

function render(
  options: ConstructorParameters<typeof IntakePathDsp>[0],
  opening: number | ArrayLike<number>,
  load: number | ArrayLike<number>,
  frames = 16_384,
): Float32Array {
  const output = new Float32Array(frames);
  new IntakePathDsp(options).process({ output, opening, load });
  return output;
}

describe("IntakePathDsp", () => {
  it("scales its additive contribution with opening and load", () => {
    const options = { sampleRate: 48_000, config, seed: 123 };
    const closed = render(options, 0, 1);
    const unloaded = render(options, 1, 0);
    const loaded = render(options, 1, 1);
    expect(rms(closed)).toBe(0);
    expect(rms(unloaded)).toBeGreaterThan(0);
    expect(rms(loaded)).toBeGreaterThan(rms(unloaded) * 3);
  });

  it("changes noise bandwidth with opening and follows the configured resonance", () => {
    const sampleRate = 48_000;
    const options = { sampleRate, config, seed: 456 };
    const narrow = render(options, 0.08, 1);
    const open = render(options, 1, 1);
    const highFrequency = 6_000;
    // Normalize by the low band so the opening-dependent gain cannot make a
    // broadband amplitude change look like a bandwidth change.
    expect(
      binEnergy(open, sampleRate, highFrequency) /
        binEnergy(open, sampleRate, 400),
    ).toBeGreaterThan(
      (binEnergy(narrow, sampleRate, highFrequency) /
        binEnergy(narrow, sampleRate, 400)) *
        3,
    );
    const lowResonance = render(
      { sampleRate, config: { noiseGain: 0.3, resonanceHz: 1_200 }, seed: 456 },
      1,
      1,
    );
    const highResonance = render(
      { sampleRate, config: { noiseGain: 0.3, resonanceHz: 4_000 }, seed: 456 },
      1,
      1,
    );
    expect(binEnergy(lowResonance, sampleRate, 1_200)).toBeGreaterThan(
      binEnergy(highResonance, sampleRate, 1_200) * 1.5,
    );
    expect(binEnergy(highResonance, sampleRate, 4_000)).toBeGreaterThan(
      binEnergy(lowResonance, sampleRate, 4_000) * 1.5,
    );
  });

  it("is finite and exactly repeatable after reset for the same seed and controls", () => {
    const dsp = new IntakePathDsp({ sampleRate: 44_100, config, seed: 789 });
    const opening = Float64Array.from(
      { length: 2_048 },
      (_, index) => index / 2_047,
    );
    const load = Float64Array.from(
      { length: 2_048 },
      (_, index) => 1 - index / 4_094,
    );
    const first = new Float32Array(2_048);
    const second = new Float32Array(2_048);
    dsp.process({ output: first, opening, load });
    dsp.reset();
    dsp.process({ output: second, opening, load });
    expect([...first].every(Number.isFinite)).toBe(true);
    expect(second).toEqual(first);
  });

  it("matches the checked API for variable realtime blocks without touching spare frames", () => {
    const options = { sampleRate: 48_000, config, seed: 987 };
    const opening = Float64Array.from(
      { length: 191 },
      (_, index) => (index % 31) / 30,
    );
    const load = Float64Array.from(
      { length: 191 },
      (_, index) => 0.2 + (index % 17) / 21,
    );
    const checked = new Float32Array(191);
    new IntakePathDsp(options).process({ output: checked, opening, load });

    const realtime = new IntakePathDsp(options);
    const actual = new Float32Array(191);
    let offset = 0;
    for (const frames of [64, 127]) {
      const output = new Float32Array(128).fill(0.75);
      const blockOpening = new Float64Array(128);
      const blockLoad = new Float64Array(128);
      blockOpening.set(opening.subarray(offset, offset + frames));
      blockLoad.set(load.subarray(offset, offset + frames));
      realtime.processRealtime(output, frames, blockOpening, blockLoad);
      actual.set(output.subarray(0, frames), offset);
      expect(output[frames]).toBe(0.75);
      offset += frames;
    }
    expect(actual).toEqual(checked);
    expect(() =>
      realtime.processRealtime(
        new Float32Array(4),
        5,
        new Float64Array(4),
        new Float64Array(4),
      ),
    ).toThrow("frameCount must fit output, opening, and load buffers");
  });

  it.each([44_100, 48_000])(
    "maps pathological positive resonance below Nyquist and remains finite at %d Hz",
    (sampleRate) => {
      const dsp = new IntakePathDsp({
        sampleRate,
        config: { noiseGain: 1, resonanceHz: Number.MAX_VALUE },
        seed: 1,
      });
      expect(dsp.getEffectiveResonanceHz()).toBe(sampleRate * 0.225);
      const output = new Float32Array(sampleRate);
      dsp.process({ output, opening: 1, load: 1 });
      expect([...output].every(Number.isFinite)).toBe(true);
      expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(0.35);
    },
  );
});
