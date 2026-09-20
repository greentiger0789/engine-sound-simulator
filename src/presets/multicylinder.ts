import type { EnginePreset } from "./single-cylinder";

const modelConfigDefaults = {
  schemaVersion: 1 as const,
  vehicleKind: "synthetic-model",
  cycleDegrees: 720,
  idleRpm: 1200,
  redlineRpm: 9000,
  inertiaKgM2: 0.12,
  torqueCurve: [
    { rpm: 0, torqueNm: 0 },
    { rpm: 3000, torqueNm: 42 },
    { rpm: 6000, torqueNm: 50 },
    { rpm: 9000, torqueNm: 28 },
  ],
  intake: { noiseGain: 0.2, resonanceHz: 210 },
  exhaust: { pipeLengthM: 1.25, damping: 0.18, mufflerAmount: 0.5 },
  combustionVariation: { seed: 0x16c0ffee, amplitude: 0.06, width: 0.04 },
  mechanical: { gain: 0.035, orders: [1, 2] },
} as const;

const modelValueSource = "model-values" as const;

function modelMetadata(name: string, description: string) {
  return {
    name,
    valueSource: modelValueSource,
    description: `Synthetic model values, not measured real-engine data. ${description}`,
  };
}

export const parallelTwin360Preset: EnginePreset = {
  metadata: modelMetadata(
    "360-degree parallel-twin model",
    "A 720-degree reference model with evenly paired firing phases.",
  ),
  config: {
    ...modelConfigDefaults,
    id: "parallel-twin-360-model",
    cylinders: [
      {
        id: "parallel-twin-360-cylinder-1",
        firingAngleDeg: 0,
        bankId: "parallel",
        combustionStrength: 1,
      },
      {
        id: "parallel-twin-360-cylinder-2",
        firingAngleDeg: 360,
        bankId: "parallel",
        combustionStrength: 1,
      },
    ],
  },
};

export const parallelTwin180Preset: EnginePreset = {
  metadata: modelMetadata(
    "180-degree parallel-twin model",
    "A 720-degree reference model with uneven firing intervals.",
  ),
  config: {
    ...modelConfigDefaults,
    id: "parallel-twin-180-model",
    cylinders: [
      {
        id: "parallel-twin-180-cylinder-1",
        firingAngleDeg: 0,
        bankId: "parallel",
        combustionStrength: 1,
      },
      {
        id: "parallel-twin-180-cylinder-2",
        firingAngleDeg: 180,
        bankId: "parallel",
        combustionStrength: 1,
      },
    ],
  },
};

export const parallelTwin270Preset: EnginePreset = {
  metadata: modelMetadata(
    "270-degree parallel-twin model",
    "A 720-degree reference model with uneven firing intervals.",
  ),
  config: {
    ...modelConfigDefaults,
    id: "parallel-twin-270-model",
    cylinders: [
      {
        id: "parallel-twin-270-cylinder-1",
        firingAngleDeg: 0,
        bankId: "parallel",
        combustionStrength: 1,
      },
      {
        id: "parallel-twin-270-cylinder-2",
        firingAngleDeg: 270,
        bankId: "parallel",
        combustionStrength: 1,
      },
    ],
  },
};

export const evenlySpacedTriplePreset: EnginePreset = {
  metadata: modelMetadata(
    "Evenly spaced triple model",
    "A 720-degree reference model with three evenly spaced firing phases.",
  ),
  config: {
    ...modelConfigDefaults,
    id: "evenly-spaced-triple-model",
    cylinders: [
      {
        id: "evenly-spaced-triple-cylinder-1",
        firingAngleDeg: 0,
        bankId: "inline",
        combustionStrength: 1,
      },
      {
        id: "evenly-spaced-triple-cylinder-2",
        firingAngleDeg: 240,
        bankId: "inline",
        combustionStrength: 1,
      },
      {
        id: "evenly-spaced-triple-cylinder-3",
        firingAngleDeg: 480,
        bankId: "inline",
        combustionStrength: 1,
      },
    ],
  },
};

export const evenlySpacedFourPreset: EnginePreset = {
  metadata: modelMetadata(
    "Evenly spaced four model",
    "A 720-degree reference model with four evenly spaced firing phases.",
  ),
  config: {
    ...modelConfigDefaults,
    id: "evenly-spaced-four-model",
    cylinders: [
      {
        id: "evenly-spaced-four-cylinder-1",
        firingAngleDeg: 0,
        bankId: "inline",
        combustionStrength: 1,
      },
      {
        id: "evenly-spaced-four-cylinder-2",
        firingAngleDeg: 180,
        bankId: "inline",
        combustionStrength: 1,
      },
      {
        id: "evenly-spaced-four-cylinder-3",
        firingAngleDeg: 360,
        bankId: "inline",
        combustionStrength: 1,
      },
      {
        id: "evenly-spaced-four-cylinder-4",
        firingAngleDeg: 540,
        bankId: "inline",
        combustionStrength: 1,
      },
    ],
  },
};

export const multiCylinderPresets: readonly EnginePreset[] = [
  parallelTwin360Preset,
  parallelTwin180Preset,
  parallelTwin270Preset,
  evenlySpacedTriplePreset,
  evenlySpacedFourPreset,
];
