/**
 * Engine configuration shared by UI, simulation, and DSP boundaries.
 *
 * This module deliberately has no browser, React, or Web Audio dependency so
 * configurations can be validated before they cross into an audio worklet.
 */
export interface CylinderConfig {
  readonly id: string;
  readonly firingAngleDeg: number;
  readonly bankId: string;
  readonly combustionStrength: number;
}

export interface TorqueCurvePoint {
  readonly rpm: number;
  readonly torqueNm: number;
}

export interface IntakeConfig {
  readonly noiseGain: number;
  readonly resonanceHz: number;
}

export interface ExhaustConfig {
  readonly pipeLengthM: number;
  readonly damping: number;
  readonly mufflerAmount: number;
}

export interface CombustionVariationConfig {
  /** Reproducible uint32 seed owned by the applied engine snapshot. */
  readonly seed: number;
  /** Symmetric maximum pulse-amplitude variation, as a fraction. */
  readonly amplitude: number;
  /** Symmetric maximum pulse-width variation, as a fraction. */
  readonly width: number;
}

export interface MechanicalConfig {
  /** Conservative linear gain for the additive crank-order component. */
  readonly gain: number;
  /** Frequencies expressed as cycles per 360-degree crank revolution. */
  readonly orders: readonly number[];
}

export interface EngineConfig {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly vehicleKind: string;
  readonly cycleDegrees: number;
  readonly cylinders: readonly CylinderConfig[];
  readonly idleRpm: number;
  readonly redlineRpm: number;
  readonly inertiaKgM2: number;
  readonly torqueCurve: readonly TorqueCurvePoint[];
  readonly intake: IntakeConfig;
  readonly exhaust: ExhaustConfig;
  readonly combustionVariation: CombustionVariationConfig;
  readonly mechanical: MechanicalConfig;
}

export interface EngineConfigValidationOptions {
  /** Optional UI-level cap. Omit it to accept every nonempty cylinder count. */
  readonly maxCylinders?: number;
}

export interface EngineConfigValidationIssue {
  /** JSONPath-like location, kept deterministic for UI error presentation. */
  readonly path: string;
  readonly message: string;
}

export type EngineConfigParseResult =
  | { readonly ok: true; readonly value: EngineConfig }
  | {
      readonly ok: false;
      readonly issues: readonly EngineConfigValidationIssue[];
    };

type UnknownRecord = Record<string, unknown>;

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "vehicleKind",
  "cycleDegrees",
  "cylinders",
  "idleRpm",
  "redlineRpm",
  "inertiaKgM2",
  "torqueCurve",
  "intake",
  "exhaust",
  "combustionVariation",
  "mechanical",
] as const;

const DEFAULT_COMBUSTION_VARIATION: CombustionVariationConfig = {
  seed: 0,
  amplitude: 0,
  width: 0,
};
const DEFAULT_MECHANICAL: MechanicalConfig = { gain: 0, orders: [1] };
const MAX_VARIATION_FRACTION = 0.25;
const MAX_MECHANICAL_GAIN = 0.2;
const MAX_MECHANICAL_ORDERS = 16;
const MAX_MECHANICAL_ORDER = 32;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: EngineConfigValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  path: string,
  issues: EngineConfigValidationIssue[],
): void {
  for (const key of Object.keys(value).sort()) {
    if (!allowedKeys.includes(key)) {
      addIssue(issues, `${path}.${key}`, "is not a supported property");
    }
  }
}

function readString(
  value: unknown,
  path: string,
  issues: EngineConfigValidationIssue[],
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    addIssue(issues, path, "must be a non-empty string");
    return undefined;
  }
  return value;
}

function readFiniteNumber(
  value: unknown,
  path: string,
  issues: EngineConfigValidationIssue[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addIssue(issues, path, "must be a finite number");
    return undefined;
  }
  return value;
}

function readRecord(
  value: unknown,
  path: string,
  issues: EngineConfigValidationIssue[],
): UnknownRecord | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object");
    return undefined;
  }
  return value;
}

/** Validates untrusted configuration data without normalizing or clamping it. */
export function parseEngineConfig(
  input: unknown,
  options: EngineConfigValidationOptions = {},
): EngineConfigParseResult {
  const issues: EngineConfigValidationIssue[] = [];
  const root = readRecord(input, "$", issues);
  if (!root) {
    return { ok: false, issues };
  }
  rejectUnknownKeys(root, ROOT_KEYS, "$", issues);

  const schemaVersion = readFiniteNumber(
    root.schemaVersion,
    "$.schemaVersion",
    issues,
  );
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    addIssue(issues, "$.schemaVersion", "must be the supported version 1");
  }
  const id = readString(root.id, "$.id", issues);
  const vehicleKind = readString(root.vehicleKind, "$.vehicleKind", issues);
  const cycleDegrees = readFiniteNumber(
    root.cycleDegrees,
    "$.cycleDegrees",
    issues,
  );
  if (cycleDegrees !== undefined && cycleDegrees <= 0) {
    addIssue(issues, "$.cycleDegrees", "must be greater than zero");
  }
  const idleRpm = readFiniteNumber(root.idleRpm, "$.idleRpm", issues);
  if (idleRpm !== undefined && idleRpm <= 0) {
    addIssue(issues, "$.idleRpm", "must be greater than zero");
  }
  const redlineRpm = readFiniteNumber(root.redlineRpm, "$.redlineRpm", issues);
  if (redlineRpm !== undefined && redlineRpm <= 0) {
    addIssue(issues, "$.redlineRpm", "must be greater than zero");
  }
  if (
    idleRpm !== undefined &&
    redlineRpm !== undefined &&
    idleRpm >= redlineRpm
  ) {
    addIssue(issues, "$.idleRpm", "must be less than $.redlineRpm");
  }
  const inertiaKgM2 = readFiniteNumber(
    root.inertiaKgM2,
    "$.inertiaKgM2",
    issues,
  );
  if (inertiaKgM2 !== undefined && inertiaKgM2 <= 0) {
    addIssue(issues, "$.inertiaKgM2", "must be greater than zero");
  }

  const cylinders = parseCylinders(
    root.cylinders,
    cycleDegrees,
    options,
    issues,
  );
  const torqueCurve = parseTorqueCurve(root.torqueCurve, issues);
  const intake = parseIntake(root.intake, issues);
  const exhaust = parseExhaust(root.exhaust, issues);
  const combustionVariation = parseCombustionVariation(
    root.combustionVariation,
    issues,
  );
  const mechanical = parseMechanical(root.mechanical, issues);

  if (
    issues.length > 0 ||
    schemaVersion !== 1 ||
    !id ||
    !vehicleKind ||
    cycleDegrees === undefined ||
    cycleDegrees <= 0 ||
    !cylinders ||
    idleRpm === undefined ||
    idleRpm <= 0 ||
    redlineRpm === undefined ||
    redlineRpm <= 0 ||
    inertiaKgM2 === undefined ||
    inertiaKgM2 <= 0 ||
    !torqueCurve ||
    !intake ||
    !exhaust ||
    !combustionVariation ||
    !mechanical
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      schemaVersion,
      id,
      vehicleKind,
      cycleDegrees,
      cylinders,
      idleRpm,
      redlineRpm,
      inertiaKgM2,
      torqueCurve,
      intake,
      exhaust,
      combustionVariation,
      mechanical,
    },
  };
}

/** Alias for call sites that only need validation terminology. */
export const validateEngineConfig = parseEngineConfig;

function parseCylinders(
  value: unknown,
  cycleDegrees: number | undefined,
  options: EngineConfigValidationOptions,
  issues: EngineConfigValidationIssue[],
): readonly CylinderConfig[] | undefined {
  if (!Array.isArray(value)) {
    addIssue(issues, "$.cylinders", "must be an array");
    return undefined;
  }
  if (value.length === 0) {
    addIssue(issues, "$.cylinders", "must contain at least one cylinder");
  }
  if (
    options.maxCylinders !== undefined &&
    (!Number.isInteger(options.maxCylinders) || options.maxCylinders < 1)
  ) {
    addIssue(issues, "$.options.maxCylinders", "must be a positive integer");
  } else if (
    options.maxCylinders !== undefined &&
    value.length > options.maxCylinders
  ) {
    addIssue(
      issues,
      "$.cylinders",
      `must contain at most ${options.maxCylinders} cylinders`,
    );
  }

  const cylinders: CylinderConfig[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const path = `$.cylinders[${index}]`;
    const cylinder = readRecord(value[index], path, issues);
    if (!cylinder) continue;
    rejectUnknownKeys(
      cylinder,
      ["id", "firingAngleDeg", "bankId", "combustionStrength"],
      path,
      issues,
    );
    const id = readString(cylinder.id, `${path}.id`, issues);
    if (id && seenIds.has(id)) addIssue(issues, `${path}.id`, "must be unique");
    if (id) seenIds.add(id);
    const firingAngleDeg = readFiniteNumber(
      cylinder.firingAngleDeg,
      `${path}.firingAngleDeg`,
      issues,
    );
    if (
      firingAngleDeg !== undefined &&
      cycleDegrees !== undefined &&
      cycleDegrees > 0 &&
      (firingAngleDeg < 0 || firingAngleDeg >= cycleDegrees)
    ) {
      addIssue(
        issues,
        `${path}.firingAngleDeg`,
        `must be in [0, ${cycleDegrees})`,
      );
    }
    const bankId = readString(cylinder.bankId, `${path}.bankId`, issues);
    const combustionStrength = readFiniteNumber(
      cylinder.combustionStrength,
      `${path}.combustionStrength`,
      issues,
    );
    if (combustionStrength !== undefined && combustionStrength < 0) {
      addIssue(issues, `${path}.combustionStrength`, "must not be negative");
    }
    if (
      id &&
      firingAngleDeg !== undefined &&
      bankId &&
      combustionStrength !== undefined
    ) {
      cylinders.push({ id, firingAngleDeg, bankId, combustionStrength });
    }
  }
  return cylinders.length === value.length && value.length > 0
    ? cylinders
    : undefined;
}

function parseTorqueCurve(
  value: unknown,
  issues: EngineConfigValidationIssue[],
): readonly TorqueCurvePoint[] | undefined {
  if (!Array.isArray(value)) {
    addIssue(issues, "$.torqueCurve", "must be an array");
    return undefined;
  }
  if (value.length < 2)
    addIssue(issues, "$.torqueCurve", "must contain at least two points");
  const points: TorqueCurvePoint[] = [];
  let previousRpm: number | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const path = `$.torqueCurve[${index}]`;
    const point = readRecord(value[index], path, issues);
    if (!point) continue;
    rejectUnknownKeys(point, ["rpm", "torqueNm"], path, issues);
    const rpm = readFiniteNumber(point.rpm, `${path}.rpm`, issues);
    const torqueNm = readFiniteNumber(
      point.torqueNm,
      `${path}.torqueNm`,
      issues,
    );
    if (rpm !== undefined && rpm < 0)
      addIssue(issues, `${path}.rpm`, "must not be negative");
    if (rpm !== undefined && previousRpm !== undefined && rpm <= previousRpm) {
      addIssue(
        issues,
        `${path}.rpm`,
        "must be strictly greater than the previous point",
      );
    }
    if (rpm !== undefined) previousRpm = rpm;
    if (rpm !== undefined && rpm >= 0 && torqueNm !== undefined)
      points.push({ rpm, torqueNm });
  }
  return points.length === value.length && value.length >= 2
    ? points
    : undefined;
}

function parseIntake(
  value: unknown,
  issues: EngineConfigValidationIssue[],
): IntakeConfig | undefined {
  const intake = readRecord(value, "$.intake", issues);
  if (!intake) return undefined;
  rejectUnknownKeys(intake, ["noiseGain", "resonanceHz"], "$.intake", issues);
  const noiseGain = readFiniteNumber(
    intake.noiseGain,
    "$.intake.noiseGain",
    issues,
  );
  const resonanceHz = readFiniteNumber(
    intake.resonanceHz,
    "$.intake.resonanceHz",
    issues,
  );
  if (noiseGain !== undefined && noiseGain < 0)
    addIssue(issues, "$.intake.noiseGain", "must not be negative");
  if (resonanceHz !== undefined && resonanceHz <= 0)
    addIssue(issues, "$.intake.resonanceHz", "must be greater than zero");
  return noiseGain !== undefined &&
    noiseGain >= 0 &&
    resonanceHz !== undefined &&
    resonanceHz > 0
    ? { noiseGain, resonanceHz }
    : undefined;
}

function parseExhaust(
  value: unknown,
  issues: EngineConfigValidationIssue[],
): ExhaustConfig | undefined {
  const exhaust = readRecord(value, "$.exhaust", issues);
  if (!exhaust) return undefined;
  rejectUnknownKeys(
    exhaust,
    ["pipeLengthM", "damping", "mufflerAmount"],
    "$.exhaust",
    issues,
  );
  const pipeLengthM = readFiniteNumber(
    exhaust.pipeLengthM,
    "$.exhaust.pipeLengthM",
    issues,
  );
  const damping = readFiniteNumber(
    exhaust.damping,
    "$.exhaust.damping",
    issues,
  );
  const mufflerAmount = readFiniteNumber(
    exhaust.mufflerAmount,
    "$.exhaust.mufflerAmount",
    issues,
  );
  if (pipeLengthM !== undefined && pipeLengthM <= 0)
    addIssue(issues, "$.exhaust.pipeLengthM", "must be greater than zero");
  if (damping !== undefined && damping < 0)
    addIssue(issues, "$.exhaust.damping", "must not be negative");
  if (mufflerAmount !== undefined && (mufflerAmount < 0 || mufflerAmount > 1)) {
    addIssue(issues, "$.exhaust.mufflerAmount", "must be in [0, 1]");
  }
  return pipeLengthM !== undefined &&
    pipeLengthM > 0 &&
    damping !== undefined &&
    damping >= 0 &&
    mufflerAmount !== undefined &&
    mufflerAmount >= 0 &&
    mufflerAmount <= 1
    ? { pipeLengthM, damping, mufflerAmount }
    : undefined;
}

function parseCombustionVariation(
  value: unknown,
  issues: EngineConfigValidationIssue[],
): CombustionVariationConfig | undefined {
  if (value === undefined) return { ...DEFAULT_COMBUSTION_VARIATION };
  const variation = readRecord(value, "$.combustionVariation", issues);
  if (!variation) return undefined;
  rejectUnknownKeys(
    variation,
    ["seed", "amplitude", "width"],
    "$.combustionVariation",
    issues,
  );
  const seed = readFiniteNumber(
    variation.seed,
    "$.combustionVariation.seed",
    issues,
  );
  const amplitude = readFiniteNumber(
    variation.amplitude,
    "$.combustionVariation.amplitude",
    issues,
  );
  const width = readFiniteNumber(
    variation.width,
    "$.combustionVariation.width",
    issues,
  );
  if (
    seed !== undefined &&
    (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff)
  ) {
    addIssue(
      issues,
      "$.combustionVariation.seed",
      "must be a uint32 safe integer",
    );
  }
  for (const [name, amount] of [
    ["amplitude", amplitude],
    ["width", width],
  ] as const) {
    if (
      amount !== undefined &&
      (amount < 0 || amount > MAX_VARIATION_FRACTION)
    ) {
      addIssue(
        issues,
        `$.combustionVariation.${name}`,
        `must be in [0, ${MAX_VARIATION_FRACTION}]`,
      );
    }
  }
  return seed !== undefined &&
    Number.isSafeInteger(seed) &&
    seed >= 0 &&
    seed <= 0xffff_ffff &&
    amplitude !== undefined &&
    amplitude >= 0 &&
    amplitude <= MAX_VARIATION_FRACTION &&
    width !== undefined &&
    width >= 0 &&
    width <= MAX_VARIATION_FRACTION
    ? { seed, amplitude, width }
    : undefined;
}

function parseMechanical(
  value: unknown,
  issues: EngineConfigValidationIssue[],
): MechanicalConfig | undefined {
  if (value === undefined)
    return { ...DEFAULT_MECHANICAL, orders: [...DEFAULT_MECHANICAL.orders] };
  const mechanical = readRecord(value, "$.mechanical", issues);
  if (!mechanical) return undefined;
  rejectUnknownKeys(mechanical, ["gain", "orders"], "$.mechanical", issues);
  const gain = readFiniteNumber(mechanical.gain, "$.mechanical.gain", issues);
  if (gain !== undefined && (gain < 0 || gain > MAX_MECHANICAL_GAIN)) {
    addIssue(
      issues,
      "$.mechanical.gain",
      `must be in [0, ${MAX_MECHANICAL_GAIN}]`,
    );
  }
  if (!Array.isArray(mechanical.orders)) {
    addIssue(issues, "$.mechanical.orders", "must be an array");
    return undefined;
  }
  if (
    mechanical.orders.length === 0 ||
    mechanical.orders.length > MAX_MECHANICAL_ORDERS
  ) {
    addIssue(
      issues,
      "$.mechanical.orders",
      `must contain 1 to ${MAX_MECHANICAL_ORDERS} values`,
    );
  }
  const orders: number[] = [];
  for (let index = 0; index < mechanical.orders.length; index += 1) {
    const order = readFiniteNumber(
      mechanical.orders[index],
      `$.mechanical.orders[${index}]`,
      issues,
    );
    if (order !== undefined && (order <= 0 || order > MAX_MECHANICAL_ORDER)) {
      addIssue(
        issues,
        `$.mechanical.orders[${index}]`,
        `must be in (0, ${MAX_MECHANICAL_ORDER}]`,
      );
    }
    if (order !== undefined && order > 0 && order <= MAX_MECHANICAL_ORDER) {
      orders.push(order);
    }
  }
  return gain !== undefined &&
    gain >= 0 &&
    gain <= MAX_MECHANICAL_GAIN &&
    orders.length === mechanical.orders.length &&
    orders.length >= 1 &&
    orders.length <= MAX_MECHANICAL_ORDERS
    ? { gain, orders }
    : undefined;
}
