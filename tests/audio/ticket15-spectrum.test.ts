import { describe, expect, it } from "vitest";

import { ExhaustResonatorDsp } from "../../src/audio/dsp/exhaust-resonator";
import { IntakePathDsp } from "../../src/audio/dsp/intake-path";

const SAMPLE_RATE = 48_000;
const FRAMES = SAMPLE_RATE * 2;
const SETTLED_AT = SAMPLE_RATE;
const FREQUENCIES_HZ = [
  50, 78, 190, 286, 400, 800, 1_200, 3_200, 12_000, 22_000,
] as const;

function renderTone(
  exhaust: ConstructorParameters<typeof ExhaustResonatorDsp>[0]["exhaust"],
  intake: ConstructorParameters<typeof IntakePathDsp>[0]["config"],
): Float32Array {
  // A four-stroke single at 6000 RPM fires 50 times per second.
  const combustion = new Float32Array(FRAMES);
  for (let frame = 0; frame < FRAMES; frame += SAMPLE_RATE / 50) {
    combustion[frame] = 0.5;
  }
  const exhaustOutput = new Float32Array(FRAMES);
  const intakeOutput = new Float32Array(FRAMES);
  new ExhaustResonatorDsp({ sampleRate: SAMPLE_RATE, exhaust }).process(
    combustion,
    exhaustOutput,
  );
  new IntakePathDsp({
    sampleRate: SAMPLE_RATE,
    config: intake,
    seed: 12_345,
  }).process({ output: intakeOutput, opening: 0.5, load: 0.5 });
  return Float32Array.from(
    exhaustOutput,
    (sample, frame) => sample + intakeOutput[frame]!,
  );
}

function bandEnergyDb(samples: Float32Array, frequencyHz: number): number {
  const halfWidthHz = Math.max(5, frequencyHz * 0.05);
  const stepHz = Math.max(1, Math.round(halfWidthHz / 5));
  let energy = 0;
  let binCount = 0;
  for (
    let binHz = Math.max(1, Math.round(frequencyHz - halfWidthHz));
    binHz <= Math.min(23_900, Math.round(frequencyHz + halfWidthHz));
    binHz += stepHz
  ) {
    let real = 0;
    let imaginary = 0;
    for (let frame = SETTLED_AT; frame < samples.length; frame += 1) {
      const phase = (2 * Math.PI * binHz * (frame - SETTLED_AT)) / SAMPLE_RATE;
      real += samples[frame]! * Math.cos(phase);
      imaginary -= samples[frame]! * Math.sin(phase);
    }
    energy +=
      (real * real + imaginary * imaginary) /
      ((samples.length - SETTLED_AT) * (samples.length - SETTLED_AT));
    binCount += 1;
  }
  return 10 * Math.log10(Math.max(1e-24, energy / binCount));
}

function spectrum(samples: Float32Array): number[] {
  return FREQUENCIES_HZ.map((frequency) =>
    Number(bandEnergyDb(samples, frequency).toFixed(2)),
  );
}

describe("Ticket 15 fixed-condition spectrum artifact", () => {
  it("reproduces the plotted resonance movement without Nyquist-edge growth", () => {
    const baseline = spectrum(
      renderTone(
        { pipeLengthM: 1.1, damping: 0.16, mufflerAmount: 0.45 },
        { noiseGain: 0.18, resonanceHz: 190 },
      ),
    );
    const changed = spectrum(
      renderTone(
        { pipeLengthM: 0.3, damping: 0.05, mufflerAmount: 0.1 },
        { noiseGain: 0.18, resonanceHz: 1_200 },
      ),
    );

    // These are the source values plotted in reports/015-spectrum.svg.
    const expectedBaseline = [
      -78.27, -83.9, -75.66, -79.82, -76.32, -77.59, -78.19, -77.72, -73.28,
      -73.35,
    ];
    const expectedChanged = [
      -79.14, -90.83, -87.53, -87.79, -77.9, -77.3, -75.25, -77.29, -73.67,
      -73.74,
    ];
    for (const [index, expected] of expectedBaseline.entries()) {
      expect(baseline[index]).toBeCloseTo(expected, 1);
    }
    for (const [index, expected] of expectedChanged.entries()) {
      expect(changed[index]).toBeCloseTo(expected, 1);
    }
    expect(changed[6]).toBeGreaterThan(baseline[6]);
    expect(changed.at(-1)).toBeLessThan(baseline.at(-1)! + 1);
  });
});
