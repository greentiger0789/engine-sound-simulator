import {
  parseEngineConfig,
  type EngineConfig,
  type TorqueCurvePoint,
} from "./config";

/** The fixed simulation cadence used by the audio-frame accumulator. */
export const DYNAMICS_HZ = 1_000;
export const DYNAMICS_STEP_SECONDS = 1 / DYNAMICS_HZ;
/** Upper bound for one real-time call; longer runs must use normal blocks. */
export const MAX_FRAME_ADVANCE_SECONDS = 10;

const TWO_PI = 2 * Math.PI;

/** Converts engine speed without duplicating rpm/radian conversion factors. */
export function rpmToRadPerSecond(rpm: number): number {
  requireFinite("rpm", rpm);
  const result = (rpm * TWO_PI) / 60;
  requireFinite("converted angular velocity", result);
  return result;
}

/** Converts angular velocity without duplicating rpm/radian conversion factors. */
export function radPerSecondToRpm(radPerSecond: number): number {
  requireFinite("radPerSecond", radPerSecond);
  const result = (radPerSecond * 60) / TWO_PI;
  requireFinite("converted rpm", result);
  return result;
}

export interface RotationalDynamicsOptions {
  /** Time constant of the effective intake opening. Defaults to 80 ms. */
  readonly intakeLagSeconds?: number;
  /** Time constant of the effective external load. Defaults to 50 ms. */
  readonly loadLagSeconds?: number;
  /** Constant resisting torque. Defaults to 1.5 N m. */
  readonly frictionTorqueNm?: number;
  /** Viscous resistance, in N m per rad/s. Defaults to 0.02. */
  readonly viscousFrictionNmPerRadPerSec?: number;
  /** Initial external load, in N m. Defaults to zero. */
  readonly loadTorqueNm?: number;
  /** Proportional idle-controller gain, in N m per rad/s. */
  readonly idleGainNmPerRadPerSec?: number;
  /** Maximum assist from the idle controller, in N m. */
  readonly idleMaxTorqueNm?: number;
  /** Starting speed. Defaults to the configured idle speed. */
  readonly initialRpm?: number;
}

export interface DynamicsState {
  readonly rpm: number;
  readonly angularVelocityRadPerSec: number;
  readonly effectiveThrottle: number;
  /** Smoothed resisting torque currently applied by the dynamometer. */
  readonly effectiveLoadTorqueNm: number;
  /** The bounded multiplier currently applied to combustion drive torque. */
  readonly driveTorqueMultiplier: number;
}

interface ValidatedOptions {
  readonly intakeLagSeconds: number;
  readonly loadLagSeconds: number;
  readonly frictionTorqueNm: number;
  readonly viscousFrictionNmPerRadPerSec: number;
  readonly idleGainNmPerRadPerSec: number;
  readonly idleMaxTorqueNm: number;
}

const DEFAULTS: ValidatedOptions = {
  intakeLagSeconds: 0.08,
  loadLagSeconds: 0.05,
  frictionTorqueNm: 1.5,
  viscousFrictionNmPerRadPerSec: 0.02,
  idleGainNmPerRadPerSec: 0.8,
  idleMaxTorqueNm: 25,
};

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function requireNonNegative(name: string, value: number): void {
  requireFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
}

function readOption(
  name: string,
  value: number | undefined,
  fallback: number,
  positive = false,
): number {
  const result = value ?? fallback;
  requireFinite(name, result);
  if (positive ? result <= 0 : result < 0) {
    throw new RangeError(
      `${name} must be ${positive ? "greater than zero" : "non-negative"}`,
    );
  }
  return result;
}

/** Linearly interpolates a validated torque curve, clamped at its endpoints. */
export function interpolateTorqueCurve(
  torqueCurve: readonly TorqueCurvePoint[],
  rpm: number,
): number {
  requireNonNegative("rpm", rpm);
  if (torqueCurve.length < 2) {
    throw new RangeError("torqueCurve must contain at least two points");
  }
  let previousRpm = -1;
  for (const point of torqueCurve) {
    requireNonNegative("torqueCurve.rpm", point.rpm);
    requireFinite("torqueCurve.torqueNm", point.torqueNm);
    if (point.rpm <= previousRpm) {
      throw new RangeError(
        "torqueCurve rpm values must be strictly increasing",
      );
    }
    previousRpm = point.rpm;
  }
  const first = torqueCurve[0];
  const last = torqueCurve[torqueCurve.length - 1];
  if (!first || !last) throw new RangeError("torqueCurve must not be empty");
  if (rpm <= first.rpm) return first.torqueNm;
  if (rpm >= last.rpm) return last.torqueNm;

  for (let index = 1; index < torqueCurve.length; index += 1) {
    const upper = torqueCurve[index];
    const lower = torqueCurve[index - 1];
    if (!upper || !lower) continue;
    if (rpm <= upper.rpm) {
      const proportion = (rpm - lower.rpm) / (upper.rpm - lower.rpm);
      const torqueDelta = upper.torqueNm - lower.torqueNm;
      requireFinite("torqueCurve torque delta", torqueDelta);
      const interpolatedTorque = lower.torqueNm + proportion * torqueDelta;
      requireFinite("interpolated torque", interpolatedTorque);
      return interpolatedTorque;
    }
  }
  return last.torqueNm;
}

/**
 * A fixed-1 kHz rotational model.  It deliberately has no sample phase or
 * audio dependency: callers advance it with the actual rendered frame count.
 */
export class RotationalDynamics {
  private readonly config: EngineConfig;
  private readonly options: ValidatedOptions;
  private angularVelocity: number;
  private effectiveThrottleValue = 0;
  private requestedThrottle = 0;
  private effectiveLoadTorqueValue: number;
  private requestedLoadTorque: number;
  private driveTorqueMultiplier = 1;
  private accumulatorSeconds = 0;

  public constructor(
    config: EngineConfig,
    options: RotationalDynamicsOptions = {},
  ) {
    const parsed = parseEngineConfig(config);
    if (!parsed.ok) {
      throw new RangeError("config is not a valid EngineConfig");
    }
    this.config = parsed.value;
    requireFinite("inverse inertiaKgM2", 1 / this.config.inertiaKgM2);
    this.options = {
      intakeLagSeconds: readOption(
        "intakeLagSeconds",
        options.intakeLagSeconds,
        DEFAULTS.intakeLagSeconds,
        true,
      ),
      loadLagSeconds: readOption(
        "loadLagSeconds",
        options.loadLagSeconds,
        DEFAULTS.loadLagSeconds,
        true,
      ),
      frictionTorqueNm: readOption(
        "frictionTorqueNm",
        options.frictionTorqueNm,
        DEFAULTS.frictionTorqueNm,
      ),
      viscousFrictionNmPerRadPerSec: readOption(
        "viscousFrictionNmPerRadPerSec",
        options.viscousFrictionNmPerRadPerSec,
        DEFAULTS.viscousFrictionNmPerRadPerSec,
      ),
      idleGainNmPerRadPerSec: readOption(
        "idleGainNmPerRadPerSec",
        options.idleGainNmPerRadPerSec,
        DEFAULTS.idleGainNmPerRadPerSec,
      ),
      idleMaxTorqueNm: readOption(
        "idleMaxTorqueNm",
        options.idleMaxTorqueNm,
        DEFAULTS.idleMaxTorqueNm,
      ),
    };
    const initialRpm = options.initialRpm ?? this.config.idleRpm;
    requireNonNegative("initialRpm", initialRpm);
    this.angularVelocity = rpmToRadPerSecond(initialRpm);
    const initialLoadTorque = readOption(
      "loadTorqueNm",
      options.loadTorqueNm,
      0,
    );
    this.requestedLoadTorque = initialLoadTorque;
    this.effectiveLoadTorqueValue = initialLoadTorque;
  }

  public setThrottle(throttle: number): void {
    requireFinite("throttle", throttle);
    if (throttle < 0 || throttle > 1) {
      throw new RangeError("throttle must be in [0, 1]");
    }
    this.requestedThrottle = throttle;
  }

  public setLoadTorque(loadTorqueNm: number): void {
    requireNonNegative("loadTorqueNm", loadTorqueNm);
    this.requestedLoadTorque = loadTorqueNm;
  }

  /**
   * Gates only combustion drive torque. This deliberately does not gate the
   * idle controller: a limiter cut must retain idle assist so its hysteretic
   * restart threshold can be reached without abusing the lagged throttle.
   */
  public setDriveTorqueMultiplier(multiplier: number): void {
    requireFinite("driveTorqueMultiplier", multiplier);
    if (multiplier < 0 || multiplier > 1) {
      throw new RangeError("driveTorqueMultiplier must be in [0, 1]");
    }
    this.driveTorqueMultiplier = multiplier;
  }

  /** Advances using the real audio frame count and sample rate. */
  public advanceFrames(frameCount: number, sampleRate: number): DynamicsState {
    if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
      throw new RangeError("frameCount must be a non-negative safe integer");
    }
    requireFinite("sampleRate", sampleRate);
    if (sampleRate <= 0)
      throw new RangeError("sampleRate must be greater than zero");

    const elapsedSeconds = frameCount / sampleRate;
    requireFinite("elapsedSeconds", elapsedSeconds);
    if (elapsedSeconds > MAX_FRAME_ADVANCE_SECONDS) {
      throw new RangeError(
        `elapsedSeconds must not exceed ${MAX_FRAME_ADVANCE_SECONDS}`,
      );
    }
    const nextAccumulatorSeconds = this.accumulatorSeconds + elapsedSeconds;
    requireFinite("accumulated elapsedSeconds", nextAccumulatorSeconds);
    this.accumulatorSeconds = nextAccumulatorSeconds;
    // The epsilon only absorbs floating-point representation error at an exact
    // millisecond boundary; it cannot create an extra simulation step.
    while (this.accumulatorSeconds + 1e-12 >= DYNAMICS_STEP_SECONDS) {
      this.accumulatorSeconds -= DYNAMICS_STEP_SECONDS;
      if (this.accumulatorSeconds < 0) this.accumulatorSeconds = 0;
      this.integrateFixedStep();
    }
    return this.getState();
  }

  /** Applies one fixed 1 ms model step; useful for deterministic offline tests. */
  public advanceFixedStep(): DynamicsState {
    this.integrateFixedStep();
    return this.getState();
  }

  /** Allocation-free one-frame advance for the validated AudioWorklet path. */
  public advanceRealtimeFrame(sampleRate: number): void {
    requireFinite("sampleRate", sampleRate);
    if (sampleRate <= 0) {
      throw new RangeError("sampleRate must be greater than zero");
    }
    const elapsedSeconds = 1 / sampleRate;
    requireFinite("elapsedSeconds", elapsedSeconds);
    if (elapsedSeconds > MAX_FRAME_ADVANCE_SECONDS) {
      throw new RangeError(
        `elapsedSeconds must not exceed ${MAX_FRAME_ADVANCE_SECONDS}`,
      );
    }
    const nextAccumulatorSeconds = this.accumulatorSeconds + elapsedSeconds;
    requireFinite("accumulated elapsedSeconds", nextAccumulatorSeconds);
    this.accumulatorSeconds = nextAccumulatorSeconds;
    while (this.accumulatorSeconds + 1e-12 >= DYNAMICS_STEP_SECONDS) {
      this.accumulatorSeconds -= DYNAMICS_STEP_SECONDS;
      if (this.accumulatorSeconds < 0) this.accumulatorSeconds = 0;
      this.integrateFixedStep();
    }
  }

  public getAngularVelocityRadPerSec(): number {
    return this.angularVelocity;
  }

  public getRpm(): number {
    return radPerSecondToRpm(this.angularVelocity);
  }

  public getEffectiveThrottle(): number {
    return this.effectiveThrottleValue;
  }

  private integrateFixedStep(): void {
    const lagCoefficient =
      1 - Math.exp(-DYNAMICS_STEP_SECONDS / this.options.intakeLagSeconds);
    const nextEffectiveThrottle =
      this.effectiveThrottleValue +
      (this.requestedThrottle - this.effectiveThrottleValue) * lagCoefficient;
    requireFinite("effective throttle", nextEffectiveThrottle);
    const loadLagCoefficient =
      1 - Math.exp(-DYNAMICS_STEP_SECONDS / this.options.loadLagSeconds);
    const nextEffectiveLoadTorque =
      this.effectiveLoadTorqueValue +
      (this.requestedLoadTorque - this.effectiveLoadTorqueValue) *
        loadLagCoefficient;
    requireNonNegative("effective load torque", nextEffectiveLoadTorque);

    const rpm = radPerSecondToRpm(this.angularVelocity);
    const driveTorque =
      this.driveTorqueMultiplier *
      nextEffectiveThrottle *
      interpolateTorqueCurve(this.config.torqueCurve, rpm);
    requireFinite("drive torque", driveTorque);
    const idleError = Math.max(
      0,
      rpmToRadPerSecond(this.config.idleRpm) - this.angularVelocity,
    );
    const idleTorque = Math.min(
      this.options.idleMaxTorqueNm,
      idleError * this.options.idleGainNmPerRadPerSec,
    );
    const frictionTorque =
      this.options.frictionTorqueNm +
      this.options.viscousFrictionNmPerRadPerSec * this.angularVelocity;
    requireFinite("friction torque", frictionTorque);
    const netTorque =
      driveTorque + idleTorque - frictionTorque - nextEffectiveLoadTorque;
    requireFinite("net torque", netTorque);
    const acceleration = netTorque / this.config.inertiaKgM2;
    requireFinite("angular acceleration", acceleration);
    const nextAngularVelocity =
      this.angularVelocity + acceleration * DYNAMICS_STEP_SECONDS;
    requireFinite("angular velocity", nextAngularVelocity);
    this.effectiveThrottleValue = nextEffectiveThrottle;
    this.effectiveLoadTorqueValue = nextEffectiveLoadTorque;
    // Redline is the hard simulation envelope, not only a limiter target.
    // Clamping here prevents one extreme-but-finite 1 kHz torque step from
    // exposing the downstream event/DSP path to an unsupported angular speed.
    this.angularVelocity = Math.min(
      rpmToRadPerSecond(this.config.redlineRpm),
      Math.max(0, nextAngularVelocity),
    );
  }

  public getState(): DynamicsState {
    const angularVelocityRadPerSec = this.angularVelocity;
    return {
      angularVelocityRadPerSec,
      rpm: radPerSecondToRpm(angularVelocityRadPerSec),
      effectiveThrottle: this.effectiveThrottleValue,
      effectiveLoadTorqueNm: this.effectiveLoadTorqueValue,
      driveTorqueMultiplier: this.driveTorqueMultiplier,
    };
  }
}

export function createRotationalDynamics(
  config: EngineConfig,
  options?: RotationalDynamicsOptions,
): RotationalDynamics {
  return new RotationalDynamics(config, options);
}
