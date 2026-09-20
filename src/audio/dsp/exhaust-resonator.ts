import type { ExhaustConfig } from "../../engine/config";

/** Construction inputs for the browser-independent exhaust resonator. */
export interface ExhaustResonatorDspOptions {
  readonly sampleRate: number;
  readonly exhaust: ExhaustConfig;
}

/**
 * The effective fundamental used by the filter after sample-rate safety mapping.
 * `wasNyquistClamped` is useful for telemetry; it does not affect processing.
 */
export interface ExhaustResonatorState {
  readonly resonanceHz: number;
  readonly wasNyquistClamped: boolean;
}

const SPEED_OF_SOUND_M_PER_S = 343;
const MIN_RESONANCE_HZ = 15;
const NYQUIST_HEADROOM = 0.45;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validate(options: ExhaustResonatorDspOptions): void {
  const { sampleRate, exhaust } = options;
  if (!isFiniteNumber(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a positive finite number");
  }
  if (!isFiniteNumber(exhaust.pipeLengthM) || exhaust.pipeLengthM <= 0) {
    throw new RangeError("pipeLengthM must be a positive finite number");
  }
  if (!isFiniteNumber(exhaust.damping) || exhaust.damping < 0) {
    throw new RangeError("damping must be a finite non-negative number");
  }
  if (
    !isFiniteNumber(exhaust.mufflerAmount) ||
    exhaust.mufflerAmount < 0 ||
    exhaust.mufflerAmount > 1
  ) {
    throw new RangeError("mufflerAmount must be finite and in [0, 1]");
  }
}

/**
 * A stable, stateful second-order exhaust-pipe resonator.
 *
 * Pipe length maps to its quarter-wave fundamental (`343 / (4 * length)`).
 * A configuration may be valid before the AudioContext sample rate is known,
 * yet place that fundamental above Nyquist.  At construction it is therefore
 * clamped to `[min(15 Hz, 0.45 * Nyquist), 0.45 * Nyquist]`, rather than
 * rejected. Keeping the
 * resonance below Nyquist leaves transition room and prevents an edge-of-band
 * boost; the mapping is repeated whenever a new instance is made for a new
 * sample rate.
 *
 * The two delay values are allocated once and `process()` performs no
 * allocations. `reset()` is required when reusing an instance for a new stream
 * so that no previous pipe tail leaks into it.
 */
export class ExhaustResonatorDsp {
  private readonly b0: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private readonly dryGain: number;
  private readonly resonatorGain: number;
  private readonly state: ExhaustResonatorState;
  private delay1 = 0;
  private delay2 = 0;

  public constructor(options: ExhaustResonatorDspOptions) {
    validate(options);
    const { sampleRate, exhaust } = options;
    const nyquistLimit = sampleRate * 0.5 * NYQUIST_HEADROOM;
    // The lower clamp also protects against very long, but valid, pipe values.
    const rawResonanceHz = SPEED_OF_SOUND_M_PER_S / (4 * exhaust.pipeLengthM);
    const resonanceHz = clamp(
      rawResonanceHz,
      Math.min(MIN_RESONANCE_HZ, nyquistLimit),
      nyquistLimit,
    );
    const wasNyquistClamped = rawResonanceHz > nyquistLimit;

    // More physical damping and muffling lower Q. The bounded mapping avoids
    // coefficients that approach an unstable unit-circle pole for valid input.
    const quality =
      0.35 + 17.65 / (1 + exhaust.damping * 12 + exhaust.mufflerAmount * 4);
    const omega = (2 * Math.PI * resonanceHz) / sampleRate;
    const alpha = Math.sin(omega) / (2 * quality);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -this.b0;
    this.a1 = (-2 * Math.cos(omega)) / a0;
    this.a2 = (1 - alpha) / a0;
    // The dry-plus-resonator gain is at most one. This lets the filter retain
    // the upstream pulse renderer's peak protection without a second limiter.
    this.dryGain = 0.75 + 0.1 * exhaust.mufflerAmount;
    this.resonatorGain = 0.25 * (1 - exhaust.mufflerAmount);
    this.state = { resonanceHz, wasNyquistClamped };

    if (
      !isFiniteNumber(this.b0) ||
      !isFiniteNumber(this.b2) ||
      !isFiniteNumber(this.a1) ||
      !isFiniteNumber(this.a2) ||
      Math.abs(this.a2) >= 1
    ) {
      throw new RangeError(
        "exhaust configuration produces unusable coefficients",
      );
    }
  }

  /** Returns the immutable effective resonance and Nyquist-mapping result. */
  public getState(): ExhaustResonatorState {
    return this.state;
  }

  /** Clears both recursive delay elements. */
  public reset(): void {
    this.delay1 = 0;
    this.delay2 = 0;
  }

  /**
   * Filters `input` into caller-owned `output`; equal buffers are supported.
   * A non-finite input sample is safely converted to silence for that sample,
   * which keeps malformed upstream audio from poisoning recursive state.
   */
  public process(input: Float32Array, output: Float32Array): void {
    if (input.length !== output.length) {
      throw new RangeError("input and output must have equal lengths");
    }
    this.processRealtime(input, output, input.length);
  }

  /**
   * Allocation-free Worklet path. It advances exactly `frameCount` samples;
   * remaining caller-buffer contents and filter state are left untouched.
   */
  public processRealtime(
    input: Float32Array,
    output: Float32Array,
    frameCount: number,
  ): void {
    if (
      !Number.isSafeInteger(frameCount) ||
      frameCount < 0 ||
      frameCount > input.length ||
      frameCount > output.length
    ) {
      throw new RangeError(
        "frameCount must be a safe non-negative integer within both buffers",
      );
    }
    let delay1 = this.delay1;
    let delay2 = this.delay2;
    for (let index = 0; index < frameCount; index += 1) {
      const source = input[index]!;
      const x = isFiniteNumber(source) ? source : 0;
      const resonator = this.b0 * x + delay1;
      delay1 = -this.a1 * resonator + delay2;
      delay2 = this.b2 * x - this.a2 * resonator;
      const sample = this.dryGain * x + this.resonatorGain * resonator;
      if (
        !isFiniteNumber(sample) ||
        !isFiniteNumber(delay1) ||
        !isFiniteNumber(delay2)
      ) {
        delay1 = 0;
        delay2 = 0;
        output[index] = 0;
      } else {
        output[index] = sample;
      }
    }
    this.delay1 = delay1;
    this.delay2 = delay2;
  }
}
