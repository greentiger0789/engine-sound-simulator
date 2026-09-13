import {
  CrankPhaseIntegrator,
  type PhaseInterval,
  type PhaseState,
} from "./phase";

export interface FiringCylinder {
  readonly id: string;
  readonly firingAngleDeg: number;
}

/** A firing crossing, positioned continuously in the input audio block. */
export interface FiringEvent {
  readonly cylinderId: string;
  readonly cycleIndex: number;
  readonly firingAngleDeg: number;
  /** Zero-based sample containing the event within the current input block. */
  readonly sampleIndex: number;
  /** Fractional position within `sampleIndex`, always in `[0, 1)`. */
  readonly sampleOffset: number;
  /** Absolute, fractional audio frame. */
  readonly absoluteFrame: number;
}

export interface FiringEventGeneratorOptions {
  readonly cycleDegrees: number;
  readonly cylinders: readonly FiringCylinder[];
  readonly initialPhaseDegrees?: number;
  readonly initialCycleIndex?: number;
  readonly initialFrame?: number;
  /** Hard real-time safety cap. An over-dense sample is rejected atomically. */
  readonly maxEventsPerSample?: number;
}

const FULL_TURN_DEGREES = 360;
const TWO_PI = 2 * Math.PI;
const DEFAULT_MAX_EVENTS_PER_SAMPLE = 128;

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requireSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function compareEvents(left: FiringEvent, right: FiringEvent): number {
  if (left.absoluteFrame !== right.absoluteFrame) {
    return left.absoluteFrame - right.absoluteFrame;
  }
  return left.cylinderId < right.cylinderId
    ? -1
    : left.cylinderId > right.cylinderId
      ? 1
      : 0;
}

/**
 * Converts a-rate angular velocity into deterministic firing crossings. Events
 * scan `[previous,next)`: a crossing at a sample's end belongs to its next
 * sample, including the zero-degree cycle boundary.
 */
export class FiringEventGenerator {
  private phase: CrankPhaseIntegrator;
  private readonly preflightPhase: CrankPhaseIntegrator;
  private readonly cylinders: readonly FiringCylinder[];
  private readonly maxEventsPerSample: number;
  private nextFrame: number;

  public constructor(options: FiringEventGeneratorOptions) {
    this.phase = new CrankPhaseIntegrator(
      options.cycleDegrees,
      options.initialPhaseDegrees,
      options.initialCycleIndex,
    );
    this.preflightPhase = this.phase.clone();
    this.cylinders = validateCylinders(options.cylinders, options.cycleDegrees);
    const maxEventsPerSample =
      options.maxEventsPerSample ?? DEFAULT_MAX_EVENTS_PER_SAMPLE;
    requireSafeInteger("maxEventsPerSample", maxEventsPerSample);
    if (maxEventsPerSample <= 0) {
      throw new RangeError("maxEventsPerSample must be greater than zero");
    }
    this.maxEventsPerSample = maxEventsPerSample;
    this.nextFrame = options.initialFrame ?? 0;
    requireSafeInteger("initialFrame", this.nextFrame);
    if (this.nextFrame < 0)
      throw new RangeError("initialFrame must not be negative");
  }

  public getPhaseState(): PhaseState {
    return this.phase.getState();
  }

  public getNextFrame(): number {
    return this.nextFrame;
  }

  /**
   * Writes crossings into caller-owned typed storage without allocating event
   * objects, phase clones, intervals, or sort buffers. Crossings are emitted
   * in chronological order within each frame; ties retain the validated
   * angle/id ordering of `cylinders`.
   */
  public advanceRealtime(
    angularVelocitiesRadPerSec: Float64Array,
    length: number,
    sampleRate: number,
    startFrame: number,
    sampleIndices: Int32Array,
    sampleOffsets: Float64Array,
  ): number {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > angularVelocitiesRadPerSec.length ||
      length > Number.MAX_SAFE_INTEGER - startFrame ||
      startFrame !== this.nextFrame
    ) {
      throw new RangeError("invalid realtime frame range");
    }
    if (sampleIndices.length !== sampleOffsets.length) {
      throw new RangeError("realtime event storage lengths must match");
    }
    this.preflightRealtimeStorage(
      angularVelocitiesRadPerSec,
      length,
      sampleRate,
      sampleIndices.length,
    );

    let count = 0;
    for (let index = 0; index < length; index += 1) {
      const previousAbsoluteDegrees = this.phase.getAbsoluteDegrees();
      this.phase.advanceRealtime(
        angularVelocitiesRadPerSec[index]!,
        sampleRate,
      );
      const nextAbsoluteDegrees = this.phase.getAbsoluteDegrees();
      const span = nextAbsoluteDegrees - previousAbsoluteDegrees;
      if (span <= 0) continue;
      let eventsThisSample = 0;
      let previousFiring = Number.NEGATIVE_INFINITY;
      let previousCylinderIndex = -1;
      for (;;) {
        let nextFiring = Number.POSITIVE_INFINITY;
        let nextCylinderIndex = -1;
        for (
          let cylinderIndex = 0;
          cylinderIndex < this.cylinders.length;
          cylinderIndex += 1
        ) {
          const cylinder = this.cylinders[cylinderIndex]!;
          let cycleIndex = Math.ceil(
            (previousAbsoluteDegrees - cylinder.firingAngleDeg) /
              this.phase.cycleDegrees,
          );
          let firing =
            cylinder.firingAngleDeg + cycleIndex * this.phase.cycleDegrees;
          while (
            firing < previousFiring ||
            (firing === previousFiring &&
              cylinderIndex <= previousCylinderIndex)
          ) {
            cycleIndex += 1;
            firing += this.phase.cycleDegrees;
          }
          if (firing < nextFiring) {
            nextFiring = firing;
            nextCylinderIndex = cylinderIndex;
          }
        }
        if (nextFiring >= nextAbsoluteDegrees) break;
        sampleIndices[count] = index;
        sampleOffsets[count] = Math.max(
          0,
          Math.min(
            (nextFiring - previousAbsoluteDegrees) / span,
            1 - Number.EPSILON,
          ),
        );
        count += 1;
        eventsThisSample += 1;
        previousFiring = nextFiring;
        previousCylinderIndex = nextCylinderIndex;
      }
    }
    this.nextFrame = startFrame + length;
    return count;
  }

  /**
   * Counts the exact typed-buffer requirement against scalar copies of the
   * integrator's numeric state. This keeps storage rejection atomic without
   * allocating a phase clone on the audio thread.
   */
  private preflightRealtimeStorage(
    angularVelocitiesRadPerSec: Float64Array,
    length: number,
    sampleRate: number,
    storageCapacity: number,
  ): void {
    requireFinite("sampleRate", sampleRate);
    if (sampleRate <= 0)
      throw new RangeError("sampleRate must be greater than zero");
    const phase = this.preflightPhase;
    phase.copyRealtimeStateFrom(this.phase);
    const cycleDegrees = phase.cycleDegrees;
    let required = 0;

    for (let index = 0; index < length; index += 1) {
      const velocity = angularVelocitiesRadPerSec[index]!;
      requireFinite("angularVelocityRadPerSec", velocity);
      if (velocity < 0)
        throw new RangeError("angularVelocityRadPerSec must not be negative");
      const previousAbsoluteDegrees = phase.getAbsoluteDegrees();
      phase.advanceRealtime(velocity, sampleRate);
      const nextAbsoluteDegrees = phase.getAbsoluteDegrees();

      let eventsThisSample = 0;
      for (
        let cylinderIndex = 0;
        cylinderIndex < this.cylinders.length;
        cylinderIndex += 1
      ) {
        const cylinder = this.cylinders[cylinderIndex]!;
        let firing =
          cylinder.firingAngleDeg +
          Math.ceil(
            (previousAbsoluteDegrees - cylinder.firingAngleDeg) / cycleDegrees,
          ) *
            cycleDegrees;
        while (firing < nextAbsoluteDegrees) {
          eventsThisSample += 1;
          firing += cycleDegrees;
        }
      }
      if (eventsThisSample > this.maxEventsPerSample) {
        throw new RangeError("event density exceeds maxEventsPerSample");
      }
      required += eventsThisSample;
      if (required > storageCapacity) {
        throw new RangeError("realtime event storage exceeded");
      }
    }
  }

  /**
   * Advances an a-rate velocity block. `startFrame` must be continuous with
   * prior calls. All inputs are checked before state changes; any error leaves
   * phase and frame untouched.
   */
  public advanceSamples(
    angularVelocitiesRadPerSec: ArrayLike<number>,
    sampleRate: number,
    startFrame = this.nextFrame,
  ): FiringEvent[] {
    requireFinite("sampleRate", sampleRate);
    if (sampleRate <= 0)
      throw new RangeError("sampleRate must be greater than zero");
    requireSafeInteger("startFrame", startFrame);
    if (startFrame < 0) throw new RangeError("startFrame must not be negative");
    if (startFrame !== this.nextFrame) {
      throw new RangeError("startFrame must be continuous with prior calls");
    }
    const length = angularVelocitiesRadPerSec.length;
    requireSafeInteger("angular velocity length", length);
    if (length < 0 || startFrame + length > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("frame range must be safe");
    }

    for (let index = 0; index < length; index += 1) {
      const velocity = angularVelocitiesRadPerSec[index];
      requireFinite("angularVelocityRadPerSec", velocity);
      if (velocity < 0)
        throw new RangeError("angularVelocityRadPerSec must not be negative");
      const increment = ((velocity / TWO_PI) * FULL_TURN_DEGREES) / sampleRate;
      requireFinite("phase increment", increment);
      // At most one initial crossing plus all complete cycles may be visible.
      const upperBound =
        increment === 0
          ? 0
          : Math.ceil(increment / this.phase.cycleDegrees + 1) *
            this.cylinders.length;
      if (upperBound > this.maxEventsPerSample) {
        throw new RangeError("event density exceeds maxEventsPerSample");
      }
    }

    // Build the result against a private copy. If integration detects a late
    // numerical boundary error, neither phase nor frame continuity advances.
    const workingPhase = this.phase.clone();
    const events: FiringEvent[] = [];
    for (let index = 0; index < length; index += 1) {
      const interval = workingPhase.advance(
        angularVelocitiesRadPerSec[index] as number,
        sampleRate,
      );
      this.appendIntervalEvents(events, interval, index, startFrame);
    }
    events.sort(compareEvents);
    this.phase = workingPhase;
    this.nextFrame = startFrame + length;
    return events;
  }

  private appendIntervalEvents(
    destination: FiringEvent[],
    interval: PhaseInterval,
    sampleIndex: number,
    startFrame: number,
  ): void {
    const span =
      interval.nextAbsoluteDegrees - interval.previousAbsoluteDegrees;
    if (span <= 0) return;
    for (const cylinder of this.cylinders) {
      const firstCycle = Math.ceil(
        (interval.previousAbsoluteDegrees - cylinder.firingAngleDeg) /
          this.phase.cycleDegrees,
      );
      for (
        let cycleIndex = firstCycle;
        cylinder.firingAngleDeg + cycleIndex * this.phase.cycleDegrees <
        interval.nextAbsoluteDegrees;
        cycleIndex += 1
      ) {
        const firingAbsoluteDegrees =
          cylinder.firingAngleDeg + cycleIndex * this.phase.cycleDegrees;
        const interpolatedOffset =
          (firingAbsoluteDegrees - interval.previousAbsoluteDegrees) / span;
        const withinSample = Math.max(
          0,
          Math.min(interpolatedOffset, 1 - Number.EPSILON),
        );
        destination.push({
          cylinderId: cylinder.id,
          cycleIndex,
          firingAngleDeg: cylinder.firingAngleDeg,
          sampleIndex,
          sampleOffset: withinSample,
          absoluteFrame: startFrame + sampleIndex + withinSample,
        });
      }
    }
  }
}

function validateCylinders(
  cylinders: readonly FiringCylinder[],
  cycleDegrees: number,
): readonly FiringCylinder[] {
  if (cylinders.length === 0)
    throw new RangeError("cylinders must not be empty");
  const ids = new Set<string>();
  const result = cylinders.map((cylinder) => {
    if (
      !cylinder ||
      typeof cylinder.id !== "string" ||
      cylinder.id.length === 0
    ) {
      throw new RangeError("cylinder id must be a non-empty string");
    }
    if (ids.has(cylinder.id))
      throw new RangeError("cylinder ids must be unique");
    ids.add(cylinder.id);
    requireFinite("firingAngleDeg", cylinder.firingAngleDeg);
    if (
      cylinder.firingAngleDeg < 0 ||
      cylinder.firingAngleDeg >= cycleDegrees
    ) {
      throw new RangeError("firingAngleDeg must be in [0, cycleDegrees)");
    }
    return { id: cylinder.id, firingAngleDeg: cylinder.firingAngleDeg };
  });
  return result.sort((left, right) =>
    left.firingAngleDeg === right.firingAngleDeg
      ? left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0
      : left.firingAngleDeg - right.firingAngleDeg,
  );
}
