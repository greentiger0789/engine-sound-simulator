import type { FiringEvent } from "../../engine/events";

/** Configuration for the procedural combustion-pulse renderer. */
export interface SingleCylinderPulseDspOptions {
  readonly sampleRate: number;
  /** Linear pre-limiter gain. Kept deliberately low for initial playback. */
  readonly outputGain?: number;
  /** One-pole DC blocker corner frequency. */
  readonly dcBlockerHz?: number;
  /** Hard bound for simultaneously decaying pulses on the audio thread. */
  readonly maxActivePulses?: number;
  /** Hard bound for event validation and processing in one audio block. */
  readonly maxEventsPerBlock?: number;
}

export interface PulseRenderInput {
  readonly output: Float32Array;
  readonly events: readonly FiringEvent[];
  /** A scalar load, or an a-rate array with one value per output frame. */
  readonly load: number | ArrayLike<number>;
  readonly muted?: boolean;
}

export interface DspFaultState {
  readonly faulted: boolean;
  readonly reason: string | null;
}

/** Lightweight state useful for worklet telemetry and offline trigger checks. */
export interface PulseState {
  readonly activePulseCount: number;
  readonly triggeredPulseCount: number;
}

export interface OfflinePulseBlock {
  readonly frames: number;
  readonly events: readonly FiringEvent[];
  readonly load: number | ArrayLike<number>;
  readonly muted?: boolean;
}

const DEFAULT_GAIN = 0.18;
const DEFAULT_DC_BLOCKER_HZ = 18;
const DEFAULT_MAX_ACTIVE_PULSES = 256;
const DEFAULT_MAX_EVENTS_PER_BLOCK = 512;
const MAX_PULSE_CAPACITY = 4_096;
const PULSE_TAIL_WIDTHS = 16;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function validSampleRate(sampleRate: number): void {
  if (!finite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a positive finite number");
  }
}

/**
 * Stateful, analytic combustion pulse generator and final output protection.
 * It intentionally has no Web Audio dependency so a Worklet and offline tests
 * advance precisely the same sample loop.
 */
export class SingleCylinderPulseDsp {
  private readonly sampleRate: number;
  private readonly outputGain: number;
  private readonly dcCoefficient: number;
  private readonly maxActivePulses: number;
  private readonly maxEventsPerBlock: number;
  // Fixed-capacity structure-of-arrays storage avoids event-time allocation in
  // the Worklet loop. Cylinder identity is intentionally not needed after an
  // event has excited its analytic pulse.
  private readonly pulseAges: Float64Array;
  private readonly pulseAmplitudes: Float64Array;
  private readonly pulseWidths: Float64Array;
  private activePulseCount = 0;
  private triggeredPulseCount = 0;
  private previousInput = 0;
  private previousDcOutput = 0;
  private fault: DspFaultState = { faulted: false, reason: null };

  public constructor(options: SingleCylinderPulseDspOptions) {
    validSampleRate(options.sampleRate);
    const outputGain = options.outputGain ?? DEFAULT_GAIN;
    const dcBlockerHz = options.dcBlockerHz ?? DEFAULT_DC_BLOCKER_HZ;
    const maxActivePulses =
      options.maxActivePulses ?? DEFAULT_MAX_ACTIVE_PULSES;
    const maxEventsPerBlock =
      options.maxEventsPerBlock ?? DEFAULT_MAX_EVENTS_PER_BLOCK;
    if (!finite(outputGain) || outputGain < 0 || outputGain > 1) {
      throw new RangeError("outputGain must be finite and in [0, 1]");
    }
    if (
      !finite(dcBlockerHz) ||
      dcBlockerHz <= 0 ||
      dcBlockerHz >= options.sampleRate / 2
    ) {
      throw new RangeError("dcBlockerHz must be in (0, Nyquist)");
    }
    if (
      !Number.isSafeInteger(maxActivePulses) ||
      maxActivePulses <= 0 ||
      maxActivePulses > MAX_PULSE_CAPACITY
    ) {
      throw new RangeError(
        `maxActivePulses must be a positive safe integer up to ${MAX_PULSE_CAPACITY}`,
      );
    }
    if (
      !Number.isSafeInteger(maxEventsPerBlock) ||
      maxEventsPerBlock <= 0 ||
      maxEventsPerBlock > MAX_PULSE_CAPACITY
    ) {
      throw new RangeError(
        `maxEventsPerBlock must be a positive safe integer up to ${MAX_PULSE_CAPACITY}`,
      );
    }
    this.sampleRate = options.sampleRate;
    this.outputGain = outputGain;
    this.maxActivePulses = maxActivePulses;
    this.maxEventsPerBlock = maxEventsPerBlock;
    this.pulseAges = new Float64Array(maxActivePulses);
    this.pulseAmplitudes = new Float64Array(maxActivePulses);
    this.pulseWidths = new Float64Array(maxActivePulses);
    const dcCoefficient = Math.exp(
      (-2 * Math.PI * dcBlockerHz) / options.sampleRate,
    );
    if (!finite(dcCoefficient) || dcCoefficient <= 0 || dcCoefficient >= 1) {
      throw new RangeError(
        "dcBlockerHz/sampleRate produces an unusable coefficient",
      );
    }
    this.dcCoefficient = dcCoefficient;
  }

  public getFaultState(): DspFaultState {
    return this.fault;
  }

  public getPulseState(): PulseState {
    return {
      activePulseCount: this.activePulseCount,
      triggeredPulseCount: this.triggeredPulseCount,
    };
  }

  /** Clears a latched fault and all delay/pulse state before a safe restart. */
  public reset(): void {
    this.activePulseCount = 0;
    this.triggeredPulseCount = 0;
    this.previousInput = 0;
    this.previousDcOutput = 0;
    this.fault = { faulted: false, reason: null };
  }

  /**
   * Renders one finite block. Events are indexed relative to this block, as
   * emitted by FiringEventGenerator. A malformed block latches silence rather
   * than permitting a non-finite value to reach the output.
   */
  public process(input: PulseRenderInput): void {
    const { output, events, load, muted = false } = input;
    if (this.fault.faulted) {
      output.fill(0);
      return;
    }
    const problem = this.validateInput(output, events, load);
    if (problem !== null) {
      this.trip(output, problem);
      return;
    }

    let eventCursor = 0;
    for (let frame = 0; frame < output.length; frame += 1) {
      const frameLoad = this.loadAt(load, frame);
      while (
        eventCursor < events.length &&
        events[eventCursor]!.sampleIndex === frame
      ) {
        const event = events[eventCursor]!;
        if (!this.startPulse(event.sampleOffset, frameLoad)) {
          this.trip(output, "active pulse limit exceeded");
          return;
        }
        eventCursor += 1;
      }

      const raw = this.sumAndAdvancePulses();
      const dc =
        raw - this.previousInput + this.dcCoefficient * this.previousDcOutput;
      this.previousInput = raw;
      this.previousDcOutput = dc;
      // This smooth saturator is a final absolute peak guarantee, not a gain
      // substitute: |x / (1 + |x|)| is always strictly below one.
      const protectedSample =
        (dc * this.outputGain) / (1 + Math.abs(dc * this.outputGain));
      if (!finite(raw) || !finite(dc) || !finite(protectedSample)) {
        this.trip(output, "non-finite signal");
        return;
      }
      output[frame] = muted ? 0 : protectedSample;
    }
  }

  private validateInput(
    output: Float32Array,
    events: readonly FiringEvent[],
    load: number | ArrayLike<number>,
  ): string | null {
    if (!(output instanceof Float32Array)) return "output must be Float32Array";
    if (!Number.isSafeInteger(output.length)) return "output length is unsafe";
    // This check intentionally precedes iteration/indexing of events, keeping
    // hostile array-like input from extending real-time work beyond a bound.
    if (
      !Number.isSafeInteger(events.length) ||
      events.length < 0 ||
      events.length > this.maxEventsPerBlock
    ) {
      return "event count exceeds maxEventsPerBlock";
    }
    if (typeof load === "number") {
      if (!finite(load) || load < 0 || load > 1)
        return "load must be in [0, 1]";
    } else {
      if (
        !Number.isSafeInteger(load.length) ||
        (load.length !== 1 && load.length !== output.length)
      ) {
        return "load array length must be one or match output";
      }
      for (let index = 0; index < load.length; index += 1) {
        const value = load[index];
        if (!finite(value) || value < 0 || value > 1)
          return "load must be in [0, 1]";
      }
    }
    let previousSample = -1;
    for (const event of events) {
      if (
        !event ||
        typeof event.cylinderId !== "string" ||
        event.cylinderId.length === 0 ||
        !Number.isSafeInteger(event.sampleIndex) ||
        event.sampleIndex < 0 ||
        event.sampleIndex >= output.length ||
        event.sampleIndex < previousSample ||
        !finite(event.sampleOffset) ||
        event.sampleOffset < 0 ||
        event.sampleOffset >= 1 ||
        !Number.isSafeInteger(event.cycleIndex) ||
        !finite(event.firingAngleDeg) ||
        !finite(event.absoluteFrame)
      ) {
        return "invalid firing event";
      }
      previousSample = event.sampleIndex;
    }
    return null;
  }

  private loadAt(load: number | ArrayLike<number>, frame: number): number {
    return typeof load === "number"
      ? load
      : (load[load.length === 1 ? 0 : frame] as number);
  }

  private startPulse(sampleOffset: number, load: number): boolean {
    if (this.activePulseCount >= this.maxActivePulses) return false;
    // x² exp(-2x) has a continuous value and slope at ignition and a bounded,
    // rapidly decaying spectrum. Load changes both combustion strength and tail.
    const amplitude = 0.12 + 0.88 * load;
    const widthFrames = this.sampleRate * (0.0025 + 0.0075 * load);
    const index = this.activePulseCount;
    // The sample represents the interval end, preserving sub-sample ignition.
    this.pulseAges[index] = 1 - sampleOffset;
    this.pulseAmplitudes[index] = amplitude;
    this.pulseWidths[index] = widthFrames;
    this.activePulseCount += 1;
    this.triggeredPulseCount += 1;
    return true;
  }

  private sumAndAdvancePulses(): number {
    let sum = 0;
    let write = 0;
    for (let index = 0; index < this.activePulseCount; index += 1) {
      const age = this.pulseAges[index]!;
      const amplitude = this.pulseAmplitudes[index]!;
      const width = this.pulseWidths[index]!;
      const x = age / width;
      if (x < PULSE_TAIL_WIDTHS) {
        sum += amplitude * x * x * Math.exp(-2 * x);
        this.pulseAges[write] = age + 1;
        this.pulseAmplitudes[write] = amplitude;
        this.pulseWidths[write] = width;
        write += 1;
      }
    }
    this.activePulseCount = write;
    return sum;
  }

  private trip(output: Float32Array, reason: string): void {
    this.fault = { faulted: true, reason };
    this.activePulseCount = 0;
    this.previousInput = 0;
    this.previousDcOutput = 0;
    output.fill(0);
  }
}

/** Offline helper deliberately delegates every block to the real-time process loop. */
export function renderOfflinePulse(
  options: SingleCylinderPulseDspOptions,
  blocks: readonly OfflinePulseBlock[],
): Float32Array {
  const dsp = new SingleCylinderPulseDsp(options);
  const totalFrames = blocks.reduce((total, block) => total + block.frames, 0);
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 0) {
    throw new RangeError(
      "offline frame count must be a safe non-negative integer",
    );
  }
  const result = new Float32Array(totalFrames);
  let start = 0;
  for (const block of blocks) {
    if (!Number.isSafeInteger(block.frames) || block.frames < 0) {
      throw new RangeError(
        "offline block frames must be a safe non-negative integer",
      );
    }
    const output = result.subarray(start, start + block.frames);
    dsp.process({
      output,
      events: block.events,
      load: block.load,
      muted: block.muted,
    });
    start += block.frames;
  }
  return result;
}
