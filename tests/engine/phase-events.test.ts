import { describe, expect, it } from "vitest";

import {
  FiringEventGenerator,
  type FiringEvent,
} from "../../src/engine/events";
import { CrankPhaseIntegrator, normalizePhase } from "../../src/engine/phase";

const SIX_THOUSAND_RPM = (6_000 * 2 * Math.PI) / 60;

function generator(initialPhaseDegrees = 0): FiringEventGenerator {
  return new FiringEventGenerator({
    cycleDegrees: 720,
    cylinders: [{ id: "one", firingAngleDeg: 0 }],
    initialPhaseDegrees,
  });
}

function blocks(total: number): number[] {
  const result: number[] = [];
  const pattern = [1, 127, 13, 256, 37];
  for (let remaining = total, index = 0; remaining > 0; index += 1) {
    const size = Math.min(remaining, pattern[index % pattern.length] as number);
    result.push(size);
    remaining -= size;
  }
  return result;
}

function continuousEventFields(events: readonly FiringEvent[]) {
  return events.map(
    ({
      cylinderId,
      cycleIndex,
      firingAngleDeg,
      sampleOffset,
      absoluteFrame,
    }) => ({
      cylinderId,
      cycleIndex,
      firingAngleDeg,
      sampleOffset,
      absoluteFrame,
    }),
  );
}

describe("CrankPhaseIntegrator and FiringEventGenerator", () => {
  it("normalizes phase and scans each advance as [previous, next)", () => {
    expect(normalizePhase(-1, 720)).toBe(719);
    const phase = new CrankPhaseIntegrator(720, 719);
    const interval = phase.advance(Math.PI, 1);
    expect(interval.previous.phaseDegrees).toBe(719);
    expect(interval.next.phaseDegrees).toBe(179);
    expect(interval.next.cycleIndex).toBe(1);

    const endBoundary = new FiringEventGenerator({
      cycleDegrees: 720,
      cylinders: [{ id: "one", firingAngleDeg: 1 }],
    }).advanceSamples([Math.PI / 180, Math.PI / 180], 1);
    // The crossing at the first sample's end belongs to the second interval.
    expect(endBoundary).toMatchObject([
      { absoluteFrame: 1, sampleIndex: 1, sampleOffset: 0 },
    ]);

    const cycleBoundary = generator(719).advanceSamples(
      [Math.PI / 180, Math.PI / 180],
      1,
    );
    expect(cycleBoundary).toMatchObject([
      { cycleIndex: 1, absoluteFrame: 1, sampleIndex: 1, sampleOffset: 0 },
    ]);
  });

  it("does not snap a legitimate low-speed increment to zero", () => {
    const phase = new CrankPhaseIntegrator(720);
    const interval = phase.advance((2 * Math.PI) / 360_000_000_000_000, 1);
    expect(interval.next.phaseDegrees).toBeGreaterThan(0);
    expect(interval.nextAbsoluteDegrees).toBeGreaterThan(
      interval.previousAbsoluteDegrees,
    );

    for (const sampleRate of [44_100, 48_000]) {
      const degreesPerSample = 1e-11;
      const nearBoundary = generator(719.99999999995);
      const events = nearBoundary.advanceSamples(
        new Float64Array(8).fill(
          (degreesPerSample * sampleRate * 2 * Math.PI) / 360,
        ),
        sampleRate,
      );
      const expectedFrame = (720 - 719.99999999995) / degreesPerSample;
      expect(events).toHaveLength(1);
      expect(events[0]?.absoluteFrame).toBeGreaterThan(1);
      expect(
        Math.abs((events[0]?.absoluteFrame as number) - expectedFrame),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("emits exactly 50 single-cylinder 720-degree events per second at 6000 rpm", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const events = generator().advanceSamples(
        new Float64Array(sampleRate).fill(SIX_THOUSAND_RPM),
        sampleRate,
      );
      expect(events, `${sampleRate} Hz`).toHaveLength(50);
      expect(events.map((event) => event.absoluteFrame)).toEqual(
        Array.from({ length: 50 }, (_, index) => (index * sampleRate) / 50),
      );
    }
  });

  it("preserves event time and absolute-frame continuity across buffer partitions", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const direct = generator().advanceSamples(
        new Float64Array(sampleRate).fill(SIX_THOUSAND_RPM),
        sampleRate,
      );
      const splitGenerator = generator();
      const split = blocks(sampleRate).flatMap((length) =>
        splitGenerator.advanceSamples(
          new Float64Array(length).fill(SIX_THOUSAND_RPM),
          sampleRate,
        ),
      );
      expect(split).toHaveLength(direct.length);
      for (let index = 0; index < direct.length; index += 1) {
        expect(split[index]?.absoluteFrame).toBeCloseTo(
          direct[index]?.absoluteFrame as number,
          8,
        );
      }
      expect(splitGenerator.getNextFrame()).toBe(sampleRate);
    }
  });

  it("sorts coincident firings by cylinder id and handles abrupt a-rate changes", () => {
    const simultaneous = new FiringEventGenerator({
      cycleDegrees: 720,
      cylinders: [
        { id: "z", firingAngleDeg: 0 },
        { id: "a", firingAngleDeg: 0 },
      ],
    });
    expect(
      simultaneous
        .advanceSamples([SIX_THOUSAND_RPM], 48_000)
        .map((event) => event.cylinderId),
    ).toEqual(["a", "z"]);

    const changed = generator();
    const events = changed.advanceSamples(
      [0, SIX_THOUSAND_RPM, 0, SIX_THOUSAND_RPM],
      50,
    );
    expect(events.map((event) => event.absoluteFrame)).toEqual([1, 3]);
    expect(events.map((event) => event.sampleIndex)).toEqual([1, 3]);
    expect(events.map((event) => event.sampleOffset)).toEqual([0, 0]);
    expect(changed.getPhaseState().cycleIndex).toBe(2);
  });

  it("does not reset phase when an a-rate velocity change is partitioned", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const velocities = Float64Array.from(
        { length: sampleRate },
        (_, index) =>
          index % 5 === 0
            ? 0
            : index % 3 === 0
              ? SIX_THOUSAND_RPM / 2
              : SIX_THOUSAND_RPM,
      );
      const direct = generator().advanceSamples(velocities, sampleRate);
      const splitGenerator = generator();
      const split: ReturnType<FiringEventGenerator["advanceSamples"]> = [];
      let start = 0;
      for (const length of blocks(sampleRate)) {
        split.push(
          ...splitGenerator.advanceSamples(
            velocities.subarray(start, start + length),
            sampleRate,
          ),
        );
        start += length;
      }
      expect(continuousEventFields(split)).toEqual(
        continuousEventFields(direct),
      );
    }
  });

  it("matches analytic timing after an abrupt non-cycle-aligned velocity change", () => {
    for (const sampleRate of [44_100, 48_000]) {
      const threeDegreesPerSample = (3 * sampleRate * 2 * Math.PI) / 360;
      const velocities = new Float64Array(64);
      velocities.fill(threeDegreesPerSample, 10, 50);
      const options = {
        cycleDegrees: 720,
        cylinders: [{ id: "one", firingAngleDeg: 200 }],
        initialPhaseDegrees: 100,
      } as const;
      const direct = new FiringEventGenerator(options).advanceSamples(
        velocities,
        sampleRate,
      );
      const splitGenerator = new FiringEventGenerator(options);
      const split = [
        ...splitGenerator.advanceSamples(
          velocities.subarray(0, 13),
          sampleRate,
        ),
        ...splitGenerator.advanceSamples(
          velocities.subarray(13, 41),
          sampleRate,
        ),
        ...splitGenerator.advanceSamples(velocities.subarray(41), sampleRate),
      ];
      expect(direct).toHaveLength(1);
      expect(direct[0]?.absoluteFrame).toBeCloseTo(43 + 1 / 3, 10);
      expect(continuousEventFields(split)).toEqual(
        continuousEventFields(direct),
      );
    }
  });

  it("emits none at zero rpm and rejects invalid input atomically", () => {
    const events = generator();
    expect(events.advanceSamples([0, 0], 48_000)).toEqual([]);
    const before = [events.getPhaseState(), events.getNextFrame()];
    expect(() =>
      events.advanceSamples([SIX_THOUSAND_RPM, Number.NaN], 48_000),
    ).toThrow(RangeError);
    expect([events.getPhaseState(), events.getNextFrame()]).toEqual(before);
    expect(() => events.advanceSamples([SIX_THOUSAND_RPM], 0)).toThrow(
      RangeError,
    );
    expect(() => events.advanceSamples([SIX_THOUSAND_RPM], 48_000, 9)).toThrow(
      RangeError,
    );

    const limited = new FiringEventGenerator({
      cycleDegrees: 720,
      cylinders: [{ id: "one", firingAngleDeg: 0 }],
      maxEventsPerSample: 1,
    });
    expect(() =>
      limited.advanceSamples([SIX_THOUSAND_RPM * 10_000], 1),
    ).toThrow(RangeError);
    expect(limited.getPhaseState()).toEqual({ phaseDegrees: 0, cycleIndex: 0 });

    const lateFailure = new FiringEventGenerator({
      cycleDegrees: 1,
      cylinders: [{ id: "one", firingAngleDeg: 0 }],
      initialCycleIndex: Number.MAX_SAFE_INTEGER - 1,
      maxEventsPerSample: 4,
    });
    const lateFailureBefore = [
      lateFailure.getPhaseState(),
      lateFailure.getNextFrame(),
    ];
    const oneDegreePerSample = (2 * Math.PI) / 360;
    expect(() =>
      lateFailure.advanceSamples([oneDegreePerSample, oneDegreePerSample], 1),
    ).toThrow(RangeError);
    expect([lateFailure.getPhaseState(), lateFailure.getNextFrame()]).toEqual(
      lateFailureBefore,
    );
  });
});
