/** Construction-time controls for the additive mechanical-order oscillator. */
export interface MechanicalOrdersOptions {
  readonly sampleRate: number;
  /**
   * Linear output gain. It is capped at 0.25 so this additive layer retains
   * at least 12 dB of headroom for combustion and intake contributions.
   */
  readonly gain: number;
  /** Cycles per 360-degree crank revolution. */
  readonly orders: readonly number[];
}

/** Checked offline input; velocity may be a scalar or one value per frame. */
export interface MechanicalOrdersRenderInput {
  readonly output: Float32Array;
  readonly angularVelocityRadPerSec: number | ArrayLike<number>;
}

const TWO_PI = 2 * Math.PI;
const MAX_ORDERS = 16;
const MAX_ORDER = 32;
const MAX_GAIN = 0.25;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Additive, phase-continuous sinusoidal mechanical components.
 *
 * Each order is measured against crank revolutions, not cam revolutions. The
 * mix is normalized by its number of oscillators, which guarantees its peak
 * cannot exceed `gain` before it is added to other engine sound layers.
 */
export class MechanicalOrdersDsp {
  private readonly sampleRate: number;
  private readonly orders: Float64Array;
  private readonly phases: Float64Array;
  private readonly mixGain: number;

  public constructor(options: MechanicalOrdersOptions) {
    if (!finite(options.sampleRate) || options.sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive finite number");
    }
    if (!finite(options.gain) || options.gain < 0 || options.gain > MAX_GAIN) {
      throw new RangeError(`gain must be finite and in [0, ${MAX_GAIN}]`);
    }
    if (
      !Array.isArray(options.orders) ||
      options.orders.length === 0 ||
      options.orders.length > MAX_ORDERS
    ) {
      throw new RangeError(
        `orders must contain between 1 and ${MAX_ORDERS} entries`,
      );
    }
    for (const order of options.orders) {
      if (!finite(order) || order <= 0 || order > MAX_ORDER) {
        throw new RangeError(
          `each order must be finite and in (0, ${MAX_ORDER}]`,
        );
      }
    }

    this.sampleRate = options.sampleRate;
    this.orders = Float64Array.from(options.orders);
    this.phases = new Float64Array(options.orders.length);
    this.mixGain = options.gain / options.orders.length;
  }

  /** Restores the deterministic zero-phase state. */
  public reset(): void {
    this.phases.fill(0);
  }

  /**
   * Checked offline renderer. Array controls may contain one scalar value or
   * exactly one value per output frame. Validation happens before rendering,
   * so an invalid block cannot partially advance oscillator phases.
   */
  public process(input: MechanicalOrdersRenderInput): void {
    const { output, angularVelocityRadPerSec } = input;
    this.validateOfflineInput(output, angularVelocityRadPerSec);

    for (let frame = 0; frame < output.length; frame += 1) {
      const velocity =
        typeof angularVelocityRadPerSec === "number"
          ? angularVelocityRadPerSec
          : (angularVelocityRadPerSec[
              angularVelocityRadPerSec.length === 1 ? 0 : frame
            ] as number);
      output[frame] = this.renderSample(velocity);
    }
  }

  /**
   * Allocation-free a-rate Worklet path. The caller owns all buffers; only
   * the requested frames are read/written. Input is prevalidated to keep
   * state unchanged when a malformed realtime block is supplied.
   */
  public processRealtime(
    output: Float32Array,
    frameCount: number,
    angularVelocityRadPerSec: Float64Array,
  ): void {
    if (
      !Number.isSafeInteger(frameCount) ||
      frameCount < 0 ||
      frameCount > output.length ||
      frameCount > angularVelocityRadPerSec.length
    ) {
      throw new RangeError(
        "frameCount must fit output and angularVelocityRadPerSec buffers",
      );
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      const velocity = angularVelocityRadPerSec[frame]!;
      if (!finite(velocity) || velocity < 0) {
        throw new RangeError(
          "angularVelocityRadPerSec must contain finite non-negative values",
        );
      }
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      output[frame] = this.renderSample(angularVelocityRadPerSec[frame]!);
    }
  }

  private validateOfflineInput(
    output: Float32Array,
    angularVelocityRadPerSec: number | ArrayLike<number>,
  ): void {
    if (!(output instanceof Float32Array)) {
      throw new TypeError("output must be a Float32Array");
    }
    if (typeof angularVelocityRadPerSec === "number") {
      if (!finite(angularVelocityRadPerSec) || angularVelocityRadPerSec < 0) {
        throw new RangeError(
          "angularVelocityRadPerSec must be finite and non-negative",
        );
      }
      return;
    }
    if (
      angularVelocityRadPerSec.length !== 1 &&
      angularVelocityRadPerSec.length !== output.length
    ) {
      throw new RangeError(
        "angularVelocityRadPerSec array length must be one or match output",
      );
    }
    for (let frame = 0; frame < angularVelocityRadPerSec.length; frame += 1) {
      const velocity = angularVelocityRadPerSec[frame] as number;
      if (!finite(velocity) || velocity < 0) {
        throw new RangeError(
          "angularVelocityRadPerSec must contain finite non-negative values",
        );
      }
    }
  }

  private renderSample(angularVelocityRadPerSec: number): number {
    let mixed = 0;
    const crankCyclesPerSample =
      angularVelocityRadPerSec / (TWO_PI * this.sampleRate);
    for (let index = 0; index < this.orders.length; index += 1) {
      const phase = this.phases[index]!;
      mixed += Math.sin(TWO_PI * phase);
      const nextPhase = phase + crankCyclesPerSample * this.orders[index]!;
      // Keeping phase in [0, 1) protects sin() argument precision indefinitely.
      // A finite control can still overflow when paired with an impractically
      // small, but valid, sample rate. Fall back to a known finite phase rather
      // than allowing a NaN to poison subsequent realtime blocks.
      this.phases[index] = finite(nextPhase)
        ? nextPhase - Math.floor(nextPhase)
        : 0;
    }
    return mixed * this.mixGain;
  }
}
