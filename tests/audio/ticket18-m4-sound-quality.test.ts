import { afterEach, describe, expect, it, vi } from "vitest";

import type { EngineAudioProcessorOptions } from "../../src/audio/worklets/contracts";
import { multiCylinderPresets } from "../../src/presets/multicylinder";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";

const ANALYSIS_FRAMES = 32_768;
const WARMUP_SECONDS = 0.5;
const REFERENCE_GAIN = 0.5;
const BLOCK_FRAMES = 128;
const COMPARISON_RPM = 4_800;
const COMPARISON_LOAD_TORQUE_NM = 10;
const COMPARISON_THROTTLE = 0.45;
const COMPARISON_SEED = 0x1800_0001;

class OfflinePort {
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class OfflineAudioWorkletProcessor {
  readonly port = new OfflinePort();
}

type ProcessorInstance = {
  readonly port: OfflinePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => ProcessorInstance;

type Preset =
  typeof singleCylinderPreset | (typeof multiCylinderPresets)[number];

export interface Ticket18MatrixRow {
  readonly name: string;
  readonly preset: Preset;
  /** Nominal initial and idle-control RPM; measured output excludes warm-up. */
  readonly rpm: number;
  readonly loadTorqueNm: number;
  readonly throttle: number;
  readonly sampleRate: number;
  readonly referenceGain: number;
  readonly seed: number;
}

/**
 * Reproducible M4 comparison controls. Loads counteract each row's selected
 * throttle near its nominal RPM; the test also records the final telemetry RPM
 * so a report never mistakes this dynamical product render for a fixed-speed
 * oscillator.
 */
export const TICKET_18_MEASUREMENT_MATRIX: readonly Ticket18MatrixRow[] = [
  {
    name: "single-common-48k",
    preset: singleCylinderPreset,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 48_000,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "twin-360-common-48k",
    preset: multiCylinderPresets[0]!,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 48_000,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "twin-180-common-48k",
    preset: multiCylinderPresets[1]!,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 48_000,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "twin-270-common-48k",
    preset: multiCylinderPresets[2]!,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 48_000,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "triple-common-48k",
    preset: multiCylinderPresets[3]!,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 48_000,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "four-common-48k",
    preset: multiCylinderPresets[4]!,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 48_000,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "single-common-44k1",
    preset: singleCylinderPreset,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 44_100,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
  {
    name: "four-common-44k1",
    preset: multiCylinderPresets[4]!,
    rpm: COMPARISON_RPM,
    loadTorqueNm: COMPARISON_LOAD_TORQUE_NM,
    throttle: COMPARISON_THROTTLE,
    sampleRate: 44_100,
    referenceGain: REFERENCE_GAIN,
    seed: COMPARISON_SEED,
  },
] as const;

/** Limits are deliberately broad regression guards, not real-engine claims. */
export const TICKET_18_MEASUREMENT_LIMITS = {
  minRms: 0.000_01,
  maxRms: 0.5,
  maxAbsoluteDc: 0.02,
  minCombustionOrderEnergyRatio: 0.000_1,
  // Top 10% of the band must remain at least 40 dB below total non-DC power.
  // Ticket 17 retains its stricter redline-only -45 dB guard separately.
  maxNyquistGuardDb: -40,
  maxRpmErrorRatio: 0.05,
  maxPeak: 1,
  maxP99BlockMs: (BLOCK_FRAMES / 48_000 / 2) * 1_000,
} as const;

export interface Ticket18MeasurementResult {
  readonly name: string;
  readonly targetRpm: number;
  readonly observedRpm: number;
  readonly processorsReady: boolean;
  readonly fatalFree: boolean;
  readonly finitePcm: boolean;
  readonly rms: number;
  readonly dc: number;
  readonly peak: number;
  readonly combustionOrderEnergyRatio: number;
  readonly nyquistGuardDb: number;
}

type MeasurementPath = "full-mix" | "combustion-probe";

function requestId(row: Ticket18MatrixRow, path: MeasurementPath): string {
  return `ticket-18-${row.name}-${path}`;
}

function options(
  row: Ticket18MatrixRow,
  path: MeasurementPath = "full-mix",
): AudioWorkletNodeOptions {
  const snapshot = structuredClone(row.preset.config);
  const processorOptions: EngineAudioProcessorOptions = {
    requestId: requestId(row, path),
    config: {
      version: 1,
      snapshot: {
        ...snapshot,
        // The product dynamics starts at idle. Setting it to the matrix RPM
        // supplies an explicit, reproducible starting condition.
        idleRpm: row.rpm,
        combustionVariation: {
          ...snapshot.combustionVariation,
          seed: row.seed,
        },
        intake:
          path === "combustion-probe"
            ? { ...snapshot.intake, noiseGain: 0 }
            : snapshot.intake,
        mechanical:
          path === "combustion-probe"
            ? { ...snapshot.mechanical, gain: 0 }
            : snapshot.mechanical,
      },
    },
  };
  return { processorOptions };
}

function fftPower(input: Float32Array): Float64Array {
  const size = input.length;
  const real = Float64Array.from(input);
  const imaginary = new Float64Array(size);
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed)
      [real[index], real[reversed]] = [real[reversed]!, real[index]!];
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < length / 2; offset += 1) {
        const cosine = Math.cos(angle * offset);
        const sine = Math.sin(angle * offset);
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd]! * cosine - imaginary[odd]! * sine;
        const oddImaginary = real[odd]! * sine + imaginary[odd]! * cosine;
        real[odd] = real[even]! - oddReal;
        imaginary[odd] = imaginary[even]! - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
  return Float64Array.from(
    { length: size / 2 + 1 },
    (_, bin) => real[bin]! ** 2 + imaginary[bin]! ** 2,
  );
}

function nyquistGuardDb(signal: Float32Array): number {
  const windowed = Float32Array.from(signal, (sample, index) => {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / signal.length);
    return sample * window;
  });
  const power = fftPower(windowed);
  const guardStart = Math.floor((power.length - 1) * 0.9);
  let total = 0;
  let guard = 0;
  for (let bin = 1; bin < power.length; bin += 1) {
    total += power[bin]!;
    if (bin >= guardStart) guard += power[bin]!;
  }
  return 10 * Math.log10(guard / total);
}

function maxCombustionOrderEnergyRatio(
  signal: Float32Array,
  sampleRate: number,
  nominalHz: number,
): number {
  let meanSquare = 0;
  for (const sample of signal) meanSquare += sample * sample;
  meanSquare /= signal.length;
  let greatest = 0;
  // A ±15% search reports the actual product's dynamic RPM drift while still
  // measuring the nominal firing order rather than an arbitrary spectral peak.
  for (let ratio = 0.85; ratio <= 1.15; ratio += 0.01) {
    const angularFrequency = (2 * Math.PI * nominalHz * ratio) / sampleRate;
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < signal.length; index += 1) {
      const sample = signal[index]!;
      cosine += sample * Math.cos(angularFrequency * index);
      sine += sample * Math.sin(angularFrequency * index);
    }
    greatest = Math.max(
      greatest,
      (2 * (cosine * cosine + sine * sine)) / signal.length ** 2,
    );
  }
  return greatest / meanSquare;
}

function lastTelemetryRpm(port: OfflinePort, fallback: number): number {
  const messages = port.messages as readonly {
    type?: unknown;
    rpm?: unknown;
  }[];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type === "telemetry" && typeof message.rpm === "number")
      return message.rpm;
  }
  return fallback;
}

function hasFatalError(port: OfflinePort): boolean {
  return (port.messages as readonly { type?: unknown }[]).some(
    (message) => message.type === "fatal-error",
  );
}

function isReady(
  port: OfflinePort,
  row: Ticket18MatrixRow,
  path: MeasurementPath,
): boolean {
  const messages = port.messages as readonly {
    type?: unknown;
    requestId?: unknown;
    sampleRate?: unknown;
  }[];
  const applied = messages.some(
    (message) =>
      message.type === "config-applied" &&
      message.requestId === requestId(row, path),
  );
  const ready = messages.some(
    (message) =>
      message.type === "ready" &&
      message.requestId === requestId(row, path) &&
      message.sampleRate === row.sampleRate,
  );
  return applied && ready;
}

export function measureTicket18Row(
  Processor: ProcessorConstructor,
  row: Ticket18MatrixRow,
): Ticket18MeasurementResult {
  const processor = new Processor(options(row, "full-mix"));
  const combustionProbe = new Processor(options(row, "combustion-probe"));
  const warmupFrames = Math.round(WARMUP_SECONDS * row.sampleRate);
  const totalFrames = warmupFrames + ANALYSIS_FRAMES;
  const pcm = new Float32Array(ANALYSIS_FRAMES);
  const combustionPcm = new Float32Array(ANALYSIS_FRAMES);
  const parameters = {
    throttle: new Float32Array([row.throttle]),
    gain: new Float32Array([row.referenceGain]),
    loadTorqueNm: new Float32Array([row.loadTorqueNm]),
  };
  for (let rendered = 0; rendered < totalFrames;) {
    const frames = Math.min(BLOCK_FRAMES, totalFrames - rendered);
    const block = new Float32Array(frames);
    const combustionBlock = new Float32Array(frames);
    processor.process([], [[block]], parameters);
    combustionProbe.process([], [[combustionBlock]], parameters);
    const destination = rendered - warmupFrames;
    if (destination >= 0) {
      pcm.set(block, destination);
      combustionPcm.set(combustionBlock, destination);
    } else if (destination + frames > 0) {
      pcm.set(block.subarray(-destination));
      combustionPcm.set(combustionBlock.subarray(-destination));
    }
    rendered += frames;
  }
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  for (const sample of pcm) {
    sum += sample;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const combustionHz =
    (row.rpm / 60) * (row.preset.config.cylinders.length / 2);
  return {
    name: row.name,
    targetRpm: row.rpm,
    observedRpm: lastTelemetryRpm(processor.port, Number.NaN),
    processorsReady:
      isReady(processor.port, row, "full-mix") &&
      isReady(combustionProbe.port, row, "combustion-probe"),
    fatalFree:
      !hasFatalError(processor.port) && !hasFatalError(combustionProbe.port),
    finitePcm:
      [...pcm].every(Number.isFinite) &&
      [...combustionPcm].every(Number.isFinite),
    rms: Math.sqrt(sumSquares / pcm.length),
    dc: sum / pcm.length,
    peak,
    combustionOrderEnergyRatio: maxCombustionOrderEnergyRatio(
      combustionPcm,
      row.sampleRate,
      combustionHz,
    ),
    nyquistGuardDb: nyquistGuardDb(pcm),
  };
}

describe("ticket 18 M4 sound-quality measurement matrix", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("measures every fixed comparison row through the product AudioWorklet path", async () => {
    const results: Ticket18MeasurementResult[] = [];
    for (const sampleRate of [
      ...new Set(TICKET_18_MEASUREMENT_MATRIX.map((row) => row.sampleRate)),
    ]) {
      vi.resetModules();
      let Processor: ProcessorConstructor | undefined;
      vi.stubGlobal("sampleRate", sampleRate);
      vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
      vi.stubGlobal(
        "registerProcessor",
        (_name: string, constructor: ProcessorConstructor) => {
          Processor = constructor;
        },
      );
      await import("../../src/audio/worklets/engine-audio-processor");
      for (const row of TICKET_18_MEASUREMENT_MATRIX) {
        if (row.sampleRate !== sampleRate) continue;
        const result = measureTicket18Row(Processor!, row);
        results.push(result);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        expect(result.processorsReady).toBe(true);
        expect(result.fatalFree).toBe(true);
        expect(result.finitePcm).toBe(true);
        expect(Number.isFinite(result.rms)).toBe(true);
        expect(Number.isFinite(result.dc)).toBe(true);
        expect(Number.isFinite(result.peak)).toBe(true);
        expect(Number.isFinite(result.combustionOrderEnergyRatio)).toBe(true);
        expect(Number.isFinite(result.nyquistGuardDb)).toBe(true);
        expect(result.rms).toBeGreaterThanOrEqual(
          TICKET_18_MEASUREMENT_LIMITS.minRms,
        );
        expect(result.rms).toBeLessThanOrEqual(
          TICKET_18_MEASUREMENT_LIMITS.maxRms,
        );
        expect(Math.abs(result.dc)).toBeLessThanOrEqual(
          TICKET_18_MEASUREMENT_LIMITS.maxAbsoluteDc,
        );
        expect(result.peak).toBeLessThanOrEqual(
          TICKET_18_MEASUREMENT_LIMITS.maxPeak,
        );
        expect(result.combustionOrderEnergyRatio).toBeGreaterThanOrEqual(
          TICKET_18_MEASUREMENT_LIMITS.minCombustionOrderEnergyRatio,
        );
        expect(result.nyquistGuardDb).toBeLessThanOrEqual(
          TICKET_18_MEASUREMENT_LIMITS.maxNyquistGuardDb,
        );
        expect(
          Math.abs(result.observedRpm - result.targetRpm) / result.targetRpm,
        ).toBeLessThanOrEqual(TICKET_18_MEASUREMENT_LIMITS.maxRpmErrorRatio);
      }
    }
    // Results are retained in this assertion's error diff and can be imported
    // through measureTicket18Row by the report workflow without snapshots.
    expect(results).toHaveLength(TICKET_18_MEASUREMENT_MATRIX.length);
  }, 30_000);

  it("keeps the 48 kHz / 128-frame product block p99 below half its audio budget", async () => {
    vi.resetModules();
    let Processor: ProcessorConstructor | undefined;
    vi.stubGlobal("sampleRate", 48_000);
    vi.stubGlobal("AudioWorkletProcessor", OfflineAudioWorkletProcessor);
    vi.stubGlobal(
      "registerProcessor",
      (_name: string, constructor: ProcessorConstructor) => {
        Processor = constructor;
      },
    );
    await import("../../src/audio/worklets/engine-audio-processor");
    const row = TICKET_18_MEASUREMENT_MATRIX.find(
      (candidate) => candidate.name === "four-common-48k",
    )!;
    const processor = new Processor!(options(row, "full-mix"));
    const output = new Float32Array(BLOCK_FRAMES);
    const parameters = {
      throttle: new Float32Array([row.throttle]),
      gain: new Float32Array([row.referenceGain]),
      loadTorqueNm: new Float32Array([row.loadTorqueNm]),
    };
    for (let block = 0; block < 250; block += 1)
      processor.process([], [[output]], parameters);
    const elapsedMs = new Float64Array(1_000);
    for (let block = 0; block < elapsedMs.length; block += 1) {
      const started = performance.now();
      processor.process([], [[output]], parameters);
      elapsedMs[block] = performance.now() - started;
    }
    elapsedMs.sort();
    const p99Ms = elapsedMs[Math.ceil(elapsedMs.length * 0.99) - 1]!;
    process.stdout.write(
      `${JSON.stringify({
        name: "48k-128-frame-block-budget",
        p99Ms,
        limitMs: TICKET_18_MEASUREMENT_LIMITS.maxP99BlockMs,
      })}\n`,
    );
    expect(p99Ms).toBeLessThan(TICKET_18_MEASUREMENT_LIMITS.maxP99BlockMs);
    expect(isReady(processor.port, row, "full-mix")).toBe(true);
    expect(hasFatalError(processor.port)).toBe(false);
    expect([...output].every(Number.isFinite)).toBe(true);
    expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(
      TICKET_18_MEASUREMENT_LIMITS.maxPeak,
    );
  }, 30_000);
});
