import { describe, expect, it } from "vitest";

import {
  SingleCylinderPulseDsp,
  type SingleCylinderPulseDspOptions,
} from "../../src/audio/dsp/single-cylinder-pulse";
import { SeededRandom } from "../../src/audio/dsp/seeded-random";
import type { FiringEvent } from "../../src/engine/events";

const SAMPLE_RATE = 48_000;
const TOTAL_FRAMES = 24_000;
const EVENT_FRAMES = [200, 2_100, 4_030, 6_500, 9_100, 12_700, 17_000, 21_300];

function render(
  variation: NonNullable<SingleCylinderPulseDspOptions["variation"]>,
  partitions: readonly number[],
): Float32Array {
  const dsp = new SingleCylinderPulseDsp({
    sampleRate: SAMPLE_RATE,
    variation,
  });
  const result = new Float32Array(TOTAL_FRAMES);
  let written = 0;
  let partitionIndex = 0;
  while (written < result.length) {
    const frames = Math.min(
      partitions[partitionIndex % partitions.length]!,
      result.length - written,
    );
    const events: FiringEvent[] = EVENT_FRAMES.flatMap((frame, index) =>
      frame >= written && frame < written + frames
        ? [
            {
              cylinderId: "cylinder-1",
              cycleIndex: index,
              firingAngleDeg: 0,
              sampleIndex: frame - written,
              sampleOffset: (index + 1) / 10,
              absoluteFrame: frame + (index + 1) / 10,
            },
          ]
        : [],
    );
    const block = new Float32Array(frames);
    dsp.process({ output: block, events, load: 0.7 });
    result.set(block, written);
    written += frames;
    partitionIndex += 1;
  }
  return result;
}

describe("seeded combustion variation", () => {
  it("reproduces the waveform for one seed across render partitions", () => {
    const variation = { seed: 0x1234_5678, amplitude: 0.08, width: 0.05 };
    const contiguous = render(variation, [TOTAL_FRAMES]);
    const partitioned = render(variation, [1, 127, 509, 128]);

    expect(partitioned).toEqual(contiguous);
    expect([...contiguous].every(Number.isFinite)).toBe(true);
    expect(Math.max(...contiguous.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it("changes PCM for another seed while retaining protected finite output", () => {
    const first = render(
      { seed: 11, amplitude: 0.08, width: 0.05 },
      [127, 128],
    );
    const second = render(
      { seed: 12, amplitude: 0.08, width: 0.05 },
      [127, 128],
    );

    expect(second).not.toEqual(first);
    expect([...second].every(Number.isFinite)).toBe(true);
    expect(Math.max(...second.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it("supports disabled variation and resets the uint32 generator exactly", () => {
    const disabledA = render({ seed: 1, amplitude: 0, width: 0 }, [128]);
    const disabledB = render({ seed: 99, amplitude: 0, width: 0 }, [128]);
    expect(disabledB).toEqual(disabledA);

    const random = new SeededRandom(0);
    const values = [random.nextSigned(), random.nextSigned()];
    random.reset();
    expect([random.nextSigned(), random.nextSigned()]).toEqual(values);
    expect(values.every((value) => value >= -1 && value < 1)).toBe(true);
  });

  it("rejects invalid seeds and out-of-contract variation bounds", () => {
    expect(() => new SeededRandom(-1)).toThrow(/uint32/);
    expect(
      () =>
        new SingleCylinderPulseDsp({
          sampleRate: SAMPLE_RATE,
          variation: { seed: 1, amplitude: 0.251, width: 0 },
        }),
    ).toThrow(/variation amounts/);
  });
});
