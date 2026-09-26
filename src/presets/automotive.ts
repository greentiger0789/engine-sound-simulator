import type { EnginePreset } from "./single-cylinder";

const automotiveModelDefaults = {
  schemaVersion: 1 as const,
  vehicleKind: "synthetic-automotive-model",
  cycleDegrees: 720,
  idleRpm: 800,
  redlineRpm: 6500,
  inertiaKgM2: 0.24,
  torqueCurve: [
    { rpm: 0, torqueNm: 0 },
    { rpm: 1800, torqueNm: 170 },
    { rpm: 4000, torqueNm: 210 },
    { rpm: 6500, torqueNm: 120 },
  ],
  intake: { noiseGain: 0.18, resonanceHz: 170 },
  exhaust: { pipeLengthM: 1.6, damping: 0.22, mufflerAmount: 0.58 },
  combustionVariation: { seed: 0x23c0ffee, amplitude: 0.05, width: 0.035 },
  mechanical: { gain: 0.03, orders: [1, 2] },
} as const;

/** Explicit firing phases are model choices, not a derived or measured firing order. */
export const vSixPreset: EnginePreset = {
  metadata: {
    name: "Even-fire V6 model configuration",
    valueSource: "model-values",
    description:
      "Synthetic 720-degree V6 model values; not measured from or representative of a real vehicle.",
  },
  config: {
    ...automotiveModelDefaults,
    id: "even-fire-v6-model",
    cylinders: [
      {
        id: "v6-left-1",
        firingAngleDeg: 0,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v6-right-1",
        firingAngleDeg: 120,
        bankId: "right",
        combustionStrength: 1,
      },
      {
        id: "v6-left-2",
        firingAngleDeg: 240,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v6-right-2",
        firingAngleDeg: 360,
        bankId: "right",
        combustionStrength: 1,
      },
      {
        id: "v6-left-3",
        firingAngleDeg: 480,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v6-right-3",
        firingAngleDeg: 600,
        bankId: "right",
        combustionStrength: 1,
      },
    ],
  },
};

export const vEightPreset: EnginePreset = {
  metadata: {
    name: "Even-fire V8 model configuration",
    valueSource: "model-values",
    description:
      "Synthetic 720-degree V8 model values; not measured from or representative of a real vehicle.",
  },
  config: {
    ...automotiveModelDefaults,
    id: "even-fire-v8-model",
    cylinders: [
      {
        id: "v8-left-1",
        firingAngleDeg: 0,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v8-right-1",
        firingAngleDeg: 90,
        bankId: "right",
        combustionStrength: 1,
      },
      {
        id: "v8-left-2",
        firingAngleDeg: 180,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v8-right-2",
        firingAngleDeg: 270,
        bankId: "right",
        combustionStrength: 1,
      },
      {
        id: "v8-left-3",
        firingAngleDeg: 360,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v8-right-3",
        firingAngleDeg: 450,
        bankId: "right",
        combustionStrength: 1,
      },
      {
        id: "v8-left-4",
        firingAngleDeg: 540,
        bankId: "left",
        combustionStrength: 1,
      },
      {
        id: "v8-right-4",
        firingAngleDeg: 630,
        bankId: "right",
        combustionStrength: 1,
      },
    ],
  },
};

export const automotivePresets: readonly EnginePreset[] = [
  vSixPreset,
  vEightPreset,
];
