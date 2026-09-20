import type { IntakeConfig } from "../../engine/config";

/** Construction-time parameters for the additive procedural intake path. */
export interface IntakePathOptions {
  readonly sampleRate: number;
  readonly config: IntakeConfig;
  /** A uint32 seed; the default is fixed for reproducible offline renders. */
  readonly seed?: number;
}

/** Per-block controls. Scalars and a-rate arrays are both supported. */
export interface IntakePathRenderInput {
  /** Receives only the intake contribution; the caller adds it to combustion. */
  readonly output: Float32Array;
  /** Throttle/intake opening in [0, 1]. */
  readonly opening: number | ArrayLike<number>;
  /** Engine load in [0, 1]. */
  readonly load: number | ArrayLike<number>;
}

const DEFAULT_SEED = 0x6d2b79f5;
const MIN_RESONANCE_HZ = 20;
const MAX_RESONANCE_NYQUIST_RATIO = 0.45;
const MAX_OUTPUT = 0.35;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function controlAt(control: number | ArrayLike<number>, frame: number): number {
  return typeof control === "number"
    ? control
    : (control[control.length === 1 ? 0 : frame] as number);
}

/**
 * Stateful, seeded intake-noise generator with a stable band-pass resonator.
 *
 * `resonanceHz` is mapped, rather than rejected, at construction: it is
 * clamped to [20 Hz, 0.45 * sampleRate / 2]. This preserves every statically
 * valid positive config at both 44.1 and 48 kHz while leaving coefficient
 * headroom below Nyquist. `process()` writes an additive contribution only;
 * it cannot replace combustion synthesis.
 */
export class IntakePathDsp {
  private readonly sampleRate: number;
  private readonly noiseGain: number;
  private readonly effectiveResonanceHz: number;
  private readonly initialSeed: number;
  private readonly resonanceB0: number;
  private readonly resonanceB2: number;
  private readonly resonanceA1: number;
  private readonly resonanceA2: number;
  private randomState: number;
  private lowpassState = 0;
  private bandpassX1 = 0;
  private bandpassX2 = 0;
  private bandpassY1 = 0;
  private bandpassY2 = 0;

  public constructor(options: IntakePathOptions) {
    if (!finite(options.sampleRate) || options.sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive finite number");
    }
    const { noiseGain, resonanceHz } = options.config;
    if (!finite(noiseGain) || noiseGain < 0) {
      throw new RangeError("noiseGain must be a finite non-negative number");
    }
    if (!finite(resonanceHz) || resonanceHz <= 0) {
      throw new RangeError("resonanceHz must be a positive finite number");
    }
    const seed = options.seed ?? DEFAULT_SEED;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError("seed must be a uint32 safe integer");
    }

    this.sampleRate = options.sampleRate;
    this.noiseGain = noiseGain;
    this.initialSeed = seed === 0 ? DEFAULT_SEED : seed;
    this.randomState = this.initialSeed;
    const maxResonanceHz =
      (options.sampleRate / 2) * MAX_RESONANCE_NYQUIST_RATIO;
    this.effectiveResonanceHz = Math.min(
      maxResonanceHz,
      Math.max(MIN_RESONANCE_HZ, resonanceHz),
    );

    // RBJ band-pass (constant skirt gain, Q = 1). The mapped frequency makes
    // a0 safely positive and keeps this recursive section stable.
    const omega =
      (2 * Math.PI * this.effectiveResonanceHz) / options.sampleRate;
    const alpha = Math.sin(omega) / 2;
    const a0 = 1 + alpha;
    this.resonanceB0 = alpha / a0;
    this.resonanceB2 = -this.resonanceB0;
    this.resonanceA1 = (-2 * Math.cos(omega)) / a0;
    this.resonanceA2 = (1 - alpha) / a0;
  }

  /** The post-mapping center frequency, useful for telemetry and tests. */
  public getEffectiveResonanceHz(): number {
    return this.effectiveResonanceHz;
  }

  /** Restores PRNG and all filter delays, making the next render reproducible. */
  public reset(): void {
    this.randomState = this.initialSeed;
    this.lowpassState = 0;
    this.bandpassX1 = 0;
    this.bandpassX2 = 0;
    this.bandpassY1 = 0;
    this.bandpassY2 = 0;
  }

  /**
   * Renders the intake contribution without per-sample allocation. Opening
   * controls both amplitude and the low-pass noise bandwidth; load controls
   * amplitude, so a closed/unloaded intake remains quiet.
   */
  public process(input: IntakePathRenderInput): void {
    const { output, opening, load } = input;
    this.validateInput(output, opening, "opening");
    this.validateInput(output, load, "load");

    for (let frame = 0; frame < output.length; frame += 1) {
      const frameOpening = controlAt(opening, frame);
      const frameLoad = controlAt(load, frame);
      output[frame] = this.renderSample(frameOpening, frameLoad);
    }
  }

  /**
   * Allocation-free Worklet path using caller-owned a-rate buffers. Only the
   * first `frameCount` positions are read or written, so variable AudioWorklet
   * blocks do not advance state through spare buffer positions.
   */
  public processRealtime(
    output: Float32Array,
    frameCount: number,
    opening: Float64Array,
    load: Float64Array,
  ): void {
    if (
      !Number.isSafeInteger(frameCount) ||
      frameCount < 0 ||
      frameCount > output.length ||
      frameCount > opening.length ||
      frameCount > load.length
    ) {
      throw new RangeError(
        "frameCount must fit output, opening, and load buffers",
      );
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameOpening = opening[frame]!;
      const frameLoad = load[frame]!;
      if (
        !finite(frameOpening) ||
        frameOpening < 0 ||
        frameOpening > 1 ||
        !finite(frameLoad) ||
        frameLoad < 0 ||
        frameLoad > 1
      ) {
        throw new RangeError("opening and load must be in [0, 1]");
      }
      output[frame] = this.renderSample(frameOpening, frameLoad);
    }
  }

  private validateInput(
    output: Float32Array,
    control: number | ArrayLike<number>,
    name: "opening" | "load",
  ): void {
    if (!(output instanceof Float32Array)) {
      throw new TypeError("output must be Float32Array");
    }
    if (typeof control === "number") {
      if (!finite(control) || control < 0 || control > 1) {
        throw new RangeError(`${name} must be in [0, 1]`);
      }
      return;
    }
    if (control.length !== 1 && control.length !== output.length) {
      throw new RangeError(`${name} array length must be one or match output`);
    }
    for (let index = 0; index < control.length; index += 1) {
      const value = control[index] as number;
      if (!finite(value) || value < 0 || value > 1) {
        throw new RangeError(`${name} must be in [0, 1]`);
      }
    }
  }

  private nextWhiteNoise(): number {
    // xorshift32 is reproducible in JavaScript's uint32 bitwise arithmetic.
    let state = this.randomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    return (this.randomState / 0x8000_0000 - 1) * 0.5;
  }

  private renderSample(frameOpening: number, frameLoad: number): number {
    const white = this.nextWhiteNoise();
    // The opening-dependent cutoff is capped well below Nyquist at every real
    // AudioContext sample rate, preventing white-noise-like output.
    const cutoffHz = Math.min(
      this.sampleRate * 0.35,
      300 + 7_200 * frameOpening,
    );
    const lowpassCoefficient =
      1 - Math.exp((-2 * Math.PI * cutoffHz) / this.sampleRate);
    this.lowpassState += lowpassCoefficient * (white - this.lowpassState);

    const resonant =
      this.resonanceB0 * this.lowpassState +
      this.resonanceB2 * this.bandpassX2 -
      this.resonanceA1 * this.bandpassY1 -
      this.resonanceA2 * this.bandpassY2;
    this.bandpassX2 = this.bandpassX1;
    this.bandpassX1 = this.lowpassState;
    this.bandpassY2 = this.bandpassY1;
    this.bandpassY1 = resonant;

    const gain = this.noiseGain * frameOpening * (0.15 + 0.85 * frameLoad);
    const contribution = gain * (0.4 * this.lowpassState + 1.6 * resonant);
    // A bounded component retains mixing headroom and does not become a
    // substitute for the engine signal when a custom config uses high gain.
    return Math.max(-MAX_OUTPUT, Math.min(MAX_OUTPUT, contribution));
  }
}
