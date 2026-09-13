import { describe, expect, it } from "vitest";

import { parseEngineConfig } from "../../src/engine/config";
import { FiringEventGenerator } from "../../src/engine/events";
import {
  evenlySpacedFourPreset,
  evenlySpacedTriplePreset,
  multiCylinderPresets,
  parallelTwin180Preset,
  parallelTwin270Preset,
  parallelTwin360Preset,
} from "../../src/presets/multicylinder";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";

const ONE_DEGREE_PER_SAMPLE = Math.PI / 180;

const expectedPresets = [
  {
    preset: parallelTwin360Preset,
    angles: [0, 360],
    intervals: [360, 360],
  },
  {
    preset: parallelTwin180Preset,
    angles: [0, 180],
    intervals: [180, 540],
  },
  {
    preset: parallelTwin270Preset,
    angles: [0, 270],
    intervals: [270, 450],
  },
  {
    preset: evenlySpacedTriplePreset,
    angles: [0, 240, 480],
    intervals: [240, 240, 240],
  },
  {
    preset: evenlySpacedFourPreset,
    angles: [0, 180, 360, 540],
    intervals: [180, 180, 180, 180],
  },
] as const;

function circularIntervals(firingAngles: readonly number[]): number[] {
  const sorted = [...firingAngles].sort((left, right) => left - right);
  return sorted.map(
    (angle, index) =>
      (sorted[(index + 1) % sorted.length] as number) -
      angle +
      (index === sorted.length - 1 ? 720 : 0),
  );
}

describe("multi-cylinder presets", () => {
  it("exports the documented presets in order with parseable synthetic configs", () => {
    expect(multiCylinderPresets).toEqual(
      expectedPresets.map(({ preset }) => preset),
    );

    for (const { preset } of expectedPresets) {
      expect(parseEngineConfig(preset.config)).toEqual({
        ok: true,
        value: preset.config,
      });
      expect(preset.config.cycleDegrees).toBe(720);
      expect(preset.metadata.valueSource).toBe("model-values");
      expect(preset.metadata.description).toMatch(/synthetic/i);
      expect(preset.metadata.description).toMatch(/not measured/i);
      expect(preset.config.cylinders.length).toBeGreaterThan(1);
      expect(preset.config).not.toHaveProperty("cylinderCount");
    }
  });

  it("uses the required circular firing intervals, including each wrap to the next cycle", () => {
    for (const {
      preset,
      angles: expectedAngles,
      intervals,
    } of expectedPresets) {
      const angles = preset.config.cylinders.map(
        (cylinder) => cylinder.firingAngleDeg,
      );
      expect(angles).toEqual(expectedAngles);
      expect(circularIntervals(angles)).toEqual(intervals);
      expect(angles).toHaveLength(intervals.length);
    }
  });

  it("preserves each preset's cylinder identity and continuous event ordering", () => {
    for (const { preset } of expectedPresets) {
      const expectedCycle = [...preset.config.cylinders].sort(
        (left, right) =>
          left.firingAngleDeg - right.firingAngleDeg ||
          left.id.localeCompare(right.id),
      );
      const generator = new FiringEventGenerator({
        cycleDegrees: preset.config.cycleDegrees,
        cylinders: preset.config.cylinders,
      });
      const events = generator.advanceSamples(
        new Float64Array(720 * 2).fill(ONE_DEGREE_PER_SAMPLE),
        1,
      );

      expect(events).toHaveLength(expectedCycle.length * 2);
      expect(
        events.map(
          ({ cylinderId, cycleIndex, sampleOffset, absoluteFrame }) => ({
            cylinderId,
            cycleIndex,
            sampleOffset,
            absoluteFrame,
          }),
        ),
      ).toEqual(
        [0, 1].flatMap((cycleIndex) =>
          expectedCycle.map((cylinder) => ({
            cylinderId: cylinder.id,
            cycleIndex,
            sampleOffset: 0,
            absoluteFrame:
              cycleIndex * preset.config.cycleDegrees + cylinder.firingAngleDeg,
          })),
        ),
      );
    }
  });

  it("sorts simultaneous firing by cylinder ID without changing its sample time", () => {
    const events = new FiringEventGenerator({
      cycleDegrees: 720,
      cylinders: [
        { id: "z-last", firingAngleDeg: 90 },
        { id: "a-first", firingAngleDeg: 90 },
      ],
    }).advanceSamples(new Float64Array(91).fill(ONE_DEGREE_PER_SAMPLE), 1);

    expect(events).toMatchObject([
      {
        cylinderId: "a-first",
        cycleIndex: 0,
        sampleIndex: 90,
        sampleOffset: 0,
        absoluteFrame: 90,
      },
      {
        cylinderId: "z-last",
        cycleIndex: 0,
        sampleIndex: 90,
        sampleOffset: 0,
        absoluteFrame: 90,
      },
    ]);
  });

  it("keeps the single-cylinder 720-degree preset parseable and event-compatible", () => {
    expect(parseEngineConfig(singleCylinderPreset.config)).toEqual({
      ok: true,
      value: singleCylinderPreset.config,
    });
    const events = new FiringEventGenerator({
      cycleDegrees: singleCylinderPreset.config.cycleDegrees,
      cylinders: singleCylinderPreset.config.cylinders,
    }).advanceSamples(new Float64Array(721).fill(ONE_DEGREE_PER_SAMPLE), 1);
    expect(events.map((event) => [event.cylinderId, event.cycleIndex])).toEqual(
      [
        ["cylinder-1", 0],
        ["cylinder-1", 1],
      ],
    );
  });
});
