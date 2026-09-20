import type { EngineConfig } from "../engine/config";

export interface EnginePreset {
  readonly metadata: {
    readonly name: string;
    readonly valueSource: "model-values";
    readonly description: string;
  };
  readonly config: EngineConfig;
}

/**
 * A deliberately synthetic four-stroke starting point. Its values are model
 * parameters for the simulator, not measurements or claims about a real engine.
 */
export const singleCylinderPreset: EnginePreset = {
  metadata: {
    name: "Single-cylinder model",
    valueSource: "model-values",
    description:
      "Synthetic model values; not measured from or representative of a real vehicle.",
  },
  config: {
    schemaVersion: 1,
    id: "single-cylinder-model",
    vehicleKind: "motorcycle",
    cycleDegrees: 720,
    cylinders: [
      {
        id: "cylinder-1",
        firingAngleDeg: 0,
        bankId: "single",
        combustionStrength: 1,
      },
    ],
    idleRpm: 1400,
    redlineRpm: 8000,
    inertiaKgM2: 0.08,
    torqueCurve: [
      { rpm: 0, torqueNm: 0 },
      { rpm: 2500, torqueNm: 28 },
      { rpm: 5500, torqueNm: 34 },
      { rpm: 8000, torqueNm: 20 },
    ],
    intake: { noiseGain: 0.18, resonanceHz: 190 },
    exhaust: { pipeLengthM: 1.1, damping: 0.16, mufflerAmount: 0.45 },
    combustionVariation: { seed: 0x16c0ffee, amplitude: 0.06, width: 0.04 },
    mechanical: { gain: 0.035, orders: [1, 2] },
  },
};

export const SINGLE_CYLINDER_PRESET = singleCylinderPreset;
export const singleCylinderEngineConfig = singleCylinderPreset.config;
