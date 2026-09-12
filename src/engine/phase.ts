/** A normalized crank-phase position with a monotonically increasing cycle. */
export interface PhaseState {
  readonly phaseDegrees: number;
  readonly cycleIndex: number;
}

/** The half-open angular interval advanced by one audio sample. */
export interface PhaseInterval {
  readonly previous: PhaseState;
  readonly next: PhaseState;
  readonly previousAbsoluteDegrees: number;
  readonly nextAbsoluteDegrees: number;
}

const FULL_TURN_DEGREES = 360;
const TWO_PI = 2 * Math.PI;
const PHASE_BOUNDARY_EPSILON_DEGREES = 1e-10;

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requireSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

/**
 * Integrates a non-negative, per-sample angular velocity.  Calls either finish
 * completely or throw before changing state, so a caller may safely retry an
 * invalid sample after correcting its input.
 */
export class CrankPhaseIntegrator {
  private phaseDegrees: number;
  private cycleIndex: number;
  private phaseCompensationDegrees = 0;

  public constructor(
    public readonly cycleDegrees: number,
    initialPhaseDegrees = 0,
    initialCycleIndex = 0,
  ) {
    requireFinite("cycleDegrees", cycleDegrees);
    if (cycleDegrees <= 0) {
      throw new RangeError("cycleDegrees must be greater than zero");
    }
    requireFinite("initialPhaseDegrees", initialPhaseDegrees);
    requireSafeInteger("initialCycleIndex", initialCycleIndex);
    this.phaseDegrees = normalizePhase(initialPhaseDegrees, cycleDegrees);
    this.cycleIndex = initialCycleIndex;
  }

  public getState(): PhaseState {
    return { phaseDegrees: this.phaseDegrees, cycleIndex: this.cycleIndex };
  }

  /** Copies all integration state, including compensated-summation residue. */
  public clone(): CrankPhaseIntegrator {
    const copy = new CrankPhaseIntegrator(
      this.cycleDegrees,
      this.phaseDegrees,
      this.cycleIndex,
    );
    copy.phaseCompensationDegrees = this.phaseCompensationDegrees;
    return copy;
  }

  /** Advances exactly one sample and returns its angular interval `[previous,next)`. */
  public advance(
    angularVelocityRadPerSec: number,
    sampleRate: number,
  ): PhaseInterval {
    requireFinite("angularVelocityRadPerSec", angularVelocityRadPerSec);
    if (angularVelocityRadPerSec < 0) {
      throw new RangeError("angularVelocityRadPerSec must not be negative");
    }
    requireFinite("sampleRate", sampleRate);
    if (sampleRate <= 0) {
      throw new RangeError("sampleRate must be greater than zero");
    }

    // Dividing by 2π before scaling preserves ordinary rpm-derived velocities
    // such as 6000 rpm much better than multiplying by 180/π.
    const deltaDegrees =
      ((angularVelocityRadPerSec / TWO_PI) * FULL_TURN_DEGREES) / sampleRate;
    requireFinite("phase increment", deltaDegrees);
    const previous = this.getState();
    const previousAbsoluteDegrees = absoluteDegrees(
      previous,
      this.cycleDegrees,
    );
    // Compensated summation prevents a steady a-rate velocity from drifting
    // across a cycle boundary merely because its degree increment is not exact
    // in binary floating point.
    const compensatedDelta = deltaDegrees - this.phaseCompensationDegrees;
    const summedPhase = previous.phaseDegrees + compensatedDelta;
    const nextCompensationDegrees =
      summedPhase - previous.phaseDegrees - compensatedDelta;
    let cycleAdvance = Math.floor(summedPhase / this.cycleDegrees);
    let nextPhaseDegrees = summedPhase - cycleAdvance * this.cycleDegrees;
    // Canonicalize only values adjacent to a cycle boundary. In particular,
    // do not snap an ordinary tiny advance away from phase zero.
    const boundaryEpsilonDegrees = Math.min(
      PHASE_BOUNDARY_EPSILON_DEGREES,
      this.cycleDegrees * 1e-12,
    );
    if (
      deltaDegrees > 0 &&
      this.cycleDegrees - nextPhaseDegrees < boundaryEpsilonDegrees
    ) {
      cycleAdvance += 1;
      nextPhaseDegrees = 0;
    } else if (cycleAdvance > 0 && nextPhaseDegrees < boundaryEpsilonDegrees) {
      nextPhaseDegrees = 0;
    }
    const nextCycleIndex = previous.cycleIndex + cycleAdvance;
    requireSafeInteger("next cycleIndex", nextCycleIndex);
    const next: PhaseState = {
      phaseDegrees: normalizePhase(nextPhaseDegrees, this.cycleDegrees),
      cycleIndex: nextCycleIndex,
    };
    const nextAbsoluteDegrees = absoluteDegrees(next, this.cycleDegrees);
    requireFinite("next absolute phase", nextAbsoluteDegrees);

    this.phaseDegrees = next.phaseDegrees;
    this.cycleIndex = next.cycleIndex;
    this.phaseCompensationDegrees = nextCompensationDegrees;
    return { previous, next, previousAbsoluteDegrees, nextAbsoluteDegrees };
  }
}

export function normalizePhase(
  phaseDegrees: number,
  cycleDegrees: number,
): number {
  requireFinite("phaseDegrees", phaseDegrees);
  requireFinite("cycleDegrees", cycleDegrees);
  if (cycleDegrees <= 0)
    throw new RangeError("cycleDegrees must be greater than zero");
  const normalized =
    ((phaseDegrees % cycleDegrees) + cycleDegrees) % cycleDegrees;
  // `%` can produce -0, which is awkward at a public boundary.
  return normalized === 0 ? 0 : normalized;
}

export function absoluteDegrees(
  state: PhaseState,
  cycleDegrees: number,
): number {
  requireSafeInteger("cycleIndex", state.cycleIndex);
  const result = state.cycleIndex * cycleDegrees + state.phaseDegrees;
  requireFinite("absolute phase", result);
  if (Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("absolute phase must remain in the safe range");
  }
  return result;
}
