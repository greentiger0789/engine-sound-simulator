import { describe, expect, it } from "vitest";

import {
  MAX_SUPPORTED_FIRING_EVENTS_PER_SECOND,
  parseEngineConfig,
} from "../../src/engine/config";
import { FiringEventGenerator } from "../../src/engine/events";
import {
  automotivePresets,
  vEightPreset,
  vSixPreset,
} from "../../src/presets/automotive";

const ONE_DEGREE_PER_SAMPLE = Math.PI / 180;

const cases = [
  {
    preset: vSixPreset,
    expected: [
      ["v6-left-1", 0, "left"],
      ["v6-right-1", 120, "right"],
      ["v6-left-2", 240, "left"],
      ["v6-right-2", 360, "right"],
      ["v6-left-3", 480, "left"],
      ["v6-right-3", 600, "right"],
    ],
    interval: 120,
  },
  {
    preset: vEightPreset,
    expected: [
      ["v8-left-1", 0, "left"],
      ["v8-right-1", 90, "right"],
      ["v8-left-2", 180, "left"],
      ["v8-right-2", 270, "right"],
      ["v8-left-3", 360, "left"],
      ["v8-right-3", 450, "right"],
      ["v8-left-4", 540, "left"],
      ["v8-right-4", 630, "right"],
    ],
    interval: 90,
  },
] as const;

describe("automotive model presets", () => {
  it("provides parseable synthetic V6 and V8 configurations within the core event ceiling", () => {
    expect(automotivePresets).toEqual([vSixPreset, vEightPreset]);

    for (const { preset, expected } of cases) {
      expect(preset.config.cycleDegrees).toBe(720);
      expect(preset.config.cylinders).toHaveLength(expected.length);
      expect(preset.metadata.name).toMatch(/model configuration/i);
      expect(preset.metadata.valueSource).toBe("model-values");
      expect(preset.metadata.description).toMatch(/not measured/i);
      expect(parseEngineConfig(preset.config)).toEqual({
        ok: true,
        value: preset.config,
      });
      expect(
        (preset.config.redlineRpm / 60) *
          (360 / preset.config.cycleDegrees) *
          expected.length,
      ).toBeLessThanOrEqual(MAX_SUPPORTED_FIRING_EVENTS_PER_SECOND);
    }
  });

  it("keeps the explicit cylinder phase and bank identity in chronological order", () => {
    for (const { preset, expected, interval } of cases) {
      expect(
        preset.config.cylinders.map(({ id, firingAngleDeg, bankId }) => [
          id,
          firingAngleDeg,
          bankId,
        ]),
      ).toEqual(expected);
      expect(new Set(preset.config.cylinders.map(({ id }) => id)).size).toBe(
        expected.length,
      );
      expect(
        preset.config.cylinders.map(({ firingAngleDeg }, index, cylinders) =>
          index + 1 === cylinders.length
            ? preset.config.cycleDegrees - firingAngleDeg
            : cylinders[index + 1]!.firingAngleDeg - firingAngleDeg,
        ),
      ).toEqual(Array(expected.length).fill(interval));
    }
  });

  it("emits the expected two-cycle sequence and assigns the wrap event to the next cycle", () => {
    for (const { preset, expected } of cases) {
      const generator = new FiringEventGenerator({
        cycleDegrees: preset.config.cycleDegrees,
        cylinders: preset.config.cylinders,
      });
      const firstCycle = generator.advanceSamples(
        new Float64Array(720).fill(ONE_DEGREE_PER_SAMPLE),
        1,
      );
      const boundary = generator.advanceSamples(
        new Float64Array(1).fill(ONE_DEGREE_PER_SAMPLE),
        1,
      );
      const restOfSecondCycle = generator.advanceSamples(
        new Float64Array(719).fill(ONE_DEGREE_PER_SAMPLE),
        1,
      );
      const events = [...firstCycle, ...boundary, ...restOfSecondCycle];

      expect(firstCycle).toHaveLength(expected.length);
      expect(boundary).toHaveLength(1);
      expect(restOfSecondCycle).toHaveLength(expected.length - 1);
      expect(
        events.map(
          ({ cylinderId, firingAngleDeg, cycleIndex, absoluteFrame }) => [
            cylinderId,
            firingAngleDeg,
            cycleIndex,
            absoluteFrame,
          ],
        ),
      ).toEqual(
        [0, 1].flatMap((cycleIndex) =>
          expected.map(([id, angle]) => [
            id,
            angle,
            cycleIndex,
            cycleIndex * 720 + angle,
          ]),
        ),
      );
      expect(boundary[0]).toMatchObject({
        cylinderId: expected[0][0],
        cycleIndex: 1,
        firingAngleDeg: 0,
        sampleIndex: 0,
        sampleOffset: 0,
        absoluteFrame: 720,
      });
    }
  });
});
