import { DYNAMICS_STEP_SECONDS } from "./dynamics";

/** Gear 0 is neutral. Forward ratios count engine turns per wheel turn. */
export interface DrivetrainConfig {
  readonly gearRatios: readonly number[];
  readonly vehicleMassKg: number;
  readonly wheelRadiusM: number;
  readonly rollingResistanceN: number;
  readonly aerodynamicDragNPerMpsSquared: number;
  readonly clutchStiffnessNmPerRadPerSec: number;
  readonly maxClutchTorqueNm: number;
}

export interface DrivetrainState {
  readonly gear: number;
  readonly clutchCoupling: number;
  readonly vehicleSpeedMps: number;
  /** Non-negative resisting torque to pass to the engine dynamics. */
  readonly engineLoadTorqueNm: number;
}

export interface DrivetrainConfigIssue {
  readonly path: string;
  readonly message: string;
}

export type DrivetrainConfigResult =
  | { readonly ok: true; readonly value: DrivetrainConfig }
  | { readonly ok: false; readonly issues: readonly DrivetrainConfigIssue[] };

export const DEFAULT_DRIVETRAIN_CONFIG: DrivetrainConfig = Object.freeze({
  gearRatios: Object.freeze([0, 11.5, 7.5, 5.4, 4.2, 3.4]),
  vehicleMassKg: 320,
  wheelRadiusM: 0.31,
  rollingResistanceN: 45,
  aerodynamicDragNPerMpsSquared: 0.42,
  clutchStiffnessNmPerRadPerSec: 2,
  maxClutchTorqueNm: 25,
});

const LIMITS = {
  vehicleMassKg: [1, 100_000],
  wheelRadiusM: [0.05, 5],
  rollingResistanceN: [0, 100_000],
  aerodynamicDragNPerMpsSquared: [0, 1_000],
  clutchStiffnessNmPerRadPerSec: [0, 10_000],
  maxClutchTorqueNm: [0, 100_000],
} as const;
const MAX_VEHICLE_SPEED_MPS = 150;
const MAX_STEP_SECONDS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates and copies a separate vehicle configuration. */
export function parseDrivetrainConfig(input: unknown): DrivetrainConfigResult {
  const issues: DrivetrainConfigIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", message: "must be an object" }] };
  }
  const fields = ["gearRatios", ...Object.keys(LIMITS)];
  for (const key of Object.keys(input)) {
    if (!fields.includes(key))
      issues.push({ path: `$.${key}`, message: "unknown field" });
  }
  const rawRatios = input.gearRatios;
  let gearRatios: number[] | undefined;
  if (
    !Array.isArray(rawRatios) ||
    rawRatios.length < 2 ||
    rawRatios.length > 16
  ) {
    issues.push({
      path: "$.gearRatios",
      message: "must contain neutral and 1 to 15 forward gears",
    });
  } else {
    gearRatios = [];
    for (let index = 0; index < rawRatios.length; index += 1) {
      const ratio: unknown = rawRatios[index];
      if (
        typeof ratio !== "number" ||
        !Number.isFinite(ratio) ||
        (index === 0 ? ratio !== 0 : ratio < 0.1 || ratio > 100)
      ) {
        issues.push({
          path: `$.gearRatios[${index}]`,
          message:
            index === 0
              ? "neutral ratio must be zero"
              : "forward ratio must be finite and in [0.1, 100]",
        });
      } else {
        gearRatios.push(ratio);
      }
    }
  }

  const numbers: Record<string, number> = {};
  for (const field of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = input[field];
    const [minimum, maximum] = LIMITS[field];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    ) {
      issues.push({
        path: `$.${field}`,
        message: `must be finite and in [${minimum}, ${maximum}]`,
      });
    } else {
      numbers[field] = value;
    }
  }
  if (issues.length > 0 || !gearRatios) return { ok: false, issues };
  return {
    ok: true,
    value: {
      gearRatios,
      vehicleMassKg: numbers.vehicleMassKg!,
      wheelRadiusM: numbers.wheelRadiusM!,
      rollingResistanceN: numbers.rollingResistanceN!,
      aerodynamicDragNPerMpsSquared: numbers.aerodynamicDragNPerMpsSquared!,
      clutchStiffnessNmPerRadPerSec: numbers.clutchStiffnessNmPerRadPerSec!,
      maxClutchTorqueNm: numbers.maxClutchTorqueNm!,
    },
  };
}

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
}

/** Independent 1 kHz vehicle model; the audio path uses only scalar getters. */
export class Drivetrain {
  private readonly config: DrivetrainConfig;
  private gear = 0;
  private clutchCoupling = 0;
  private vehicleSpeedMps = 0;
  private engineLoadTorqueNm = 0;
  private accumulatorSeconds = 0;

  public constructor(config: DrivetrainConfig = DEFAULT_DRIVETRAIN_CONFIG) {
    const parsed = parseDrivetrainConfig(config);
    if (!parsed.ok)
      throw new RangeError(
        `invalid drivetrain config: ${parsed.issues.map((issue) => issue.path).join(", ")}`,
      );
    this.config = parsed.value;
  }

  public setGear(gear: number): void {
    if (
      !Number.isInteger(gear) ||
      gear < 0 ||
      gear >= this.config.gearRatios.length
    ) {
      throw new RangeError("gear must be a configured integer index");
    }
    this.gear = gear;
    this.engineLoadTorqueNm = 0;
  }

  public setClutch(coupling: number): void {
    if (!Number.isFinite(coupling) || coupling < 0 || coupling > 1) {
      throw new RangeError("clutch coupling must be in [0, 1]");
    }
    this.clutchCoupling = coupling;
    this.engineLoadTorqueNm = 0;
  }

  /** One deterministic millisecond; call before the matching engine step. */
  public advanceFixedStep(engineAngularVelocityRadPerSec: number): void {
    requireFiniteNonNegative(
      "engineAngularVelocityRadPerSec",
      engineAngularVelocityRadPerSec,
    );
    const ratio = this.config.gearRatios[this.gear] ?? 0;
    const wheelAngularVelocity =
      this.vehicleSpeedMps / this.config.wheelRadiusM;
    const slip = Math.max(
      0,
      engineAngularVelocityRadPerSec - wheelAngularVelocity * ratio,
    );
    const transferTorque =
      ratio === 0 || this.clutchCoupling === 0
        ? 0
        : this.clutchCoupling *
          Math.min(
            this.config.maxClutchTorqueNm,
            slip * this.config.clutchStiffnessNmPerRadPerSec,
          );
    const resistance =
      this.config.rollingResistanceN +
      this.config.aerodynamicDragNPerMpsSquared *
        this.vehicleSpeedMps *
        this.vehicleSpeedMps;
    const acceleration =
      ((transferTorque * ratio) / this.config.wheelRadiusM - resistance) /
      this.config.vehicleMassKg;
    const nextSpeed =
      this.vehicleSpeedMps + acceleration * DYNAMICS_STEP_SECONDS;
    if (
      !Number.isFinite(transferTorque) ||
      !Number.isFinite(resistance) ||
      !Number.isFinite(acceleration) ||
      !Number.isFinite(nextSpeed)
    ) {
      throw new RangeError("drivetrain step overflowed");
    }
    this.engineLoadTorqueNm = transferTorque;
    this.vehicleSpeedMps = Math.min(
      MAX_VEHICLE_SPEED_MPS,
      Math.max(0, nextSpeed),
    );
  }

  /** Allocation-free audio-frame accumulator matching engine dynamics cadence. */
  public advanceRealtimeFrame(
    engineAngularVelocityRadPerSec: number,
    sampleRate: number,
  ): void {
    requireFiniteNonNegative(
      "engineAngularVelocityRadPerSec",
      engineAngularVelocityRadPerSec,
    );
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError("sampleRate must be finite and positive");
    }
    const elapsedSeconds = 1 / sampleRate;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds > MAX_STEP_SECONDS) {
      throw new RangeError("frame duration is out of range");
    }
    this.accumulatorSeconds += elapsedSeconds;
    while (this.accumulatorSeconds + 1e-12 >= DYNAMICS_STEP_SECONDS) {
      this.accumulatorSeconds -= DYNAMICS_STEP_SECONDS;
      if (this.accumulatorSeconds < 0) this.accumulatorSeconds = 0;
      this.advanceFixedStep(engineAngularVelocityRadPerSec);
    }
  }

  public getEngineLoadTorqueNm(): number {
    return this.engineLoadTorqueNm;
  }

  public getVehicleSpeedMps(): number {
    return this.vehicleSpeedMps;
  }

  public getGear(): number {
    return this.gear;
  }

  public getClutchCoupling(): number {
    return this.clutchCoupling;
  }

  public getState(): DrivetrainState {
    return {
      gear: this.gear,
      clutchCoupling: this.clutchCoupling,
      vehicleSpeedMps: this.vehicleSpeedMps,
      engineLoadTorqueNm: this.engineLoadTorqueNm,
    };
  }
}
