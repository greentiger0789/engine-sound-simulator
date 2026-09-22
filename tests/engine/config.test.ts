import { describe, expect, it } from "vitest";

import {
  MAX_SUPPORTED_FIRING_EVENTS_PER_SECOND,
  MAX_SUPPORTED_REDLINE_RPM,
  parseEngineConfig,
} from "../../src/engine/config";
import {
  singleCylinderPreset,
  twoStrokeSingleCylinderPreset,
} from "../../src/presets/single-cylinder";

function validInput(): Record<string, unknown> {
  return structuredClone(singleCylinderPreset.config) as unknown as Record<
    string,
    unknown
  >;
}

function issuePaths(input: unknown): readonly string[] {
  const result = parseEngineConfig(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe("parseEngineConfig", () => {
  it("parses the single-cylinder model preset", () => {
    const result = parseEngineConfig(singleCylinderPreset.config);
    expect(result).toEqual({ ok: true, value: singleCylinderPreset.config });
    expect(singleCylinderPreset.config.cycleDegrees).toBe(720);
    expect(singleCylinderPreset.config.cylinders).toHaveLength(1);
    expect(singleCylinderPreset.config.cylinders[0]?.firingAngleDeg).toBe(0);
    expect(singleCylinderPreset.metadata.valueSource).toBe("model-values");
    expect(singleCylinderPreset.metadata.description).toMatch(/not measured/i);
  });

  it("supports a 360-degree two-stroke cycle and bounds firing angles by that active cycle", () => {
    expect(parseEngineConfig(twoStrokeSingleCylinderPreset.config)).toEqual({
      ok: true,
      value: twoStrokeSingleCylinderPreset.config,
    });
    expect(twoStrokeSingleCylinderPreset.config.cycleDegrees).toBe(360);

    const outOfRange = structuredClone(
      twoStrokeSingleCylinderPreset.config,
    ) as unknown as Record<string, unknown>;
    (outOfRange.cylinders as Array<Record<string, unknown>>)[0].firingAngleDeg =
      360;
    expect(issuePaths(outOfRange)).toContain("$.cylinders[0].firingAngleDeg");
  });

  it("accepts distinct cylinders at the same firing angle", () => {
    const input = validInput();
    input.cylinders = [
      { id: "left", firingAngleDeg: 0, bankId: "left", combustionStrength: 1 },
      {
        id: "right",
        firingAngleDeg: 0,
        bankId: "right",
        combustionStrength: 0.9,
      },
    ];
    expect(parseEngineConfig(input).ok).toBe(true);
  });

  it("accepts any nonempty cylinder count by default and supports an MVP UI cap", () => {
    const input = validInput();
    input.cylinders = Array.from({ length: 5 }, (_, index) => ({
      id: `cylinder-${index}`,
      firingAngleDeg: index * 100,
      bankId: "inline",
      combustionStrength: 1,
    }));
    expect(parseEngineConfig(input).ok).toBe(true);
    expect(parseEngineConfig(input, { maxCylinders: 4 })).toMatchObject({
      ok: false,
    });
  });

  it("rejects unknown or unshaped values with paths", () => {
    expect(issuePaths(null)).toEqual(["$"]);
    const input = validInput();
    input.unexpected = true;
    expect(issuePaths(input)).toContain("$.unexpected");
  });

  it.each([
    [
      "$.idleRpm",
      (input: Record<string, unknown>) => (input.idleRpm = Number.NaN),
    ],
    [
      "$.redlineRpm",
      (input: Record<string, unknown>) => (input.redlineRpm = Infinity),
    ],
    [
      "$.cylinders[0].combustionStrength",
      (input: Record<string, unknown>) => {
        (
          input.cylinders as Array<Record<string, unknown>>
        )[0].combustionStrength = Number.NaN;
      },
    ],
  ])("rejects non-finite numbers at %s", (path, mutate) => {
    const input = validInput();
    mutate(input);
    expect(issuePaths(input)).toContain(path);
  });

  it("rejects empty cylinders, duplicate IDs, and out-of-cycle phases", () => {
    const empty = validInput();
    empty.cylinders = [];
    expect(issuePaths(empty)).toContain("$.cylinders");

    const duplicate = validInput();
    duplicate.cylinders = [
      { id: "same", firingAngleDeg: 0, bankId: "a", combustionStrength: 1 },
      { id: "same", firingAngleDeg: 360, bankId: "b", combustionStrength: 1 },
    ];
    expect(issuePaths(duplicate)).toContain("$.cylinders[1].id");

    const outOfRange = validInput();
    (outOfRange.cylinders as Array<Record<string, unknown>>)[0].firingAngleDeg =
      720;
    expect(issuePaths(outOfRange)).toContain("$.cylinders[0].firingAngleDeg");
  });

  it("rejects invalid inertia, RPM ordering, and malformed torque curves", () => {
    const inertia = validInput();
    inertia.inertiaKgM2 = 0;
    expect(issuePaths(inertia)).toContain("$.inertiaKgM2");

    const rpm = validInput();
    rpm.idleRpm = rpm.redlineRpm;
    expect(issuePaths(rpm)).toContain("$.idleRpm");

    const curve = validInput();
    curve.torqueCurve = [
      { rpm: 3000, torqueNm: 20 },
      { rpm: 2000, torqueNm: 25 },
    ];
    expect(issuePaths(curve)).toContain("$.torqueCurve[1].rpm");
  });

  it("enforces the supported redline and aggregate firing-density ceilings", () => {
    expect(MAX_SUPPORTED_REDLINE_RPM).toBe(12_000);
    expect(MAX_SUPPORTED_FIRING_EVENTS_PER_SECOND).toBe(800);

    const highRpm = validInput();
    highRpm.redlineRpm = MAX_SUPPORTED_REDLINE_RPM + 1;
    expect(issuePaths(highRpm)).toContain("$.redlineRpm");

    const dense = validInput();
    dense.redlineRpm = MAX_SUPPORTED_REDLINE_RPM;
    dense.cycleDegrees = 180;
    dense.cylinders = Array.from({ length: 4 }, (_, index) => ({
      id: `dense-${index}`,
      firingAngleDeg: index * 40,
      bankId: "inline",
      combustionStrength: 1,
    }));
    expect(issuePaths(dense)).toContain("$.cylinders");

    dense.cycleDegrees = 360;
    dense.cylinders = Array.from({ length: 4 }, (_, index) => ({
      id: `boundary-${index}`,
      firingAngleDeg: index * 90,
      bankId: "inline",
      combustionStrength: 1,
    }));
    expect(parseEngineConfig(dense).ok).toBe(true);
  });

  it("normalizes omitted M4 sound controls to compatible disabled defaults", () => {
    const input = validInput();
    delete input.combustionVariation;
    delete input.mechanical;
    const result = parseEngineConfig(input);

    expect(result).toMatchObject({
      ok: true,
      value: {
        combustionVariation: { seed: 0, amplitude: 0, width: 0 },
        mechanical: { gain: 0, orders: [1] },
      },
    });
  });

  it("rejects invalid variation seeds, amounts, mechanical gain, and orders", () => {
    const variation = validInput();
    variation.combustionVariation = {
      seed: 0x1_0000_0000,
      amplitude: 0.3,
      width: -0.1,
    };
    expect(issuePaths(variation)).toEqual(
      expect.arrayContaining([
        "$.combustionVariation.seed",
        "$.combustionVariation.amplitude",
        "$.combustionVariation.width",
      ]),
    );

    const mechanical = validInput();
    mechanical.mechanical = { gain: 0.3, orders: [0, Number.NaN, 33] };
    expect(issuePaths(mechanical)).toEqual(
      expect.arrayContaining([
        "$.mechanical.gain",
        "$.mechanical.orders[0]",
        "$.mechanical.orders[1]",
        "$.mechanical.orders[2]",
      ]),
    );
  });

  it("remains independent from React, DOM, and Web Audio imports", async () => {
    const source = await import("../../src/engine/config?raw");
    expect(source.default).not.toMatch(/from\s+["'](?:react|.*audio.*)["']/i);
    expect(source.default).not.toMatch(/AudioContext|window\.|document\./);
  });
});
