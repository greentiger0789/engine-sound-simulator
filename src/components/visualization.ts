import type { EngineConfig } from "../engine/config";

export interface FiringEventMarker {
  readonly id: string;
  readonly angleDeg: number;
  /** Percentage offset in the applied engine cycle. */
  readonly positionPercent: number;
  readonly order: number;
  /** Compact label for the positioned marker; full details belong in the legend. */
  readonly shortLabel: string;
  /** Vertical lane used to keep coincident and near-coincident markers apart. */
  readonly lane: number;
}

export interface VisualizationFrameSource {
  readonly fftSize: number;
  readonly frequencyBinCount: number;
  getByteTimeDomainData(destination: Uint8Array<ArrayBuffer>): void;
  getByteFrequencyData(destination: Uint8Array<ArrayBuffer>): void;
}

export interface AnimationFrameScheduler {
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

export interface VisualizationLoopOptions {
  readonly source: VisualizationFrameSource;
  readonly scheduler: AnimationFrameScheduler;
  readonly draw: (timeData: Uint8Array, frequencyData: Uint8Array) => void;
  /** Owned by the mounted component and disconnected with its animation loop. */
  readonly disconnectResize?: () => void;
}

export interface CanvasDimensions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly pixelRatio: number;
}

export interface CanvasSizeTarget {
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
}

export interface CanvasDrawingContext {
  canvas: { width: number; height: number };
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
}

const MAX_CANVAS_DIMENSION = 16_384;
// At the supported 320 px viewport the usable track can be about 204 px wide.
// A gap of one fifth of the active cycle leaves room for a 1.5 rem marker even
// when the endpoint transform differs from the centered transform used in the
// middle. Keeping this proportional preserves the layout for 360° and 720°.
const MARKER_LANE_GAP_RATIO = 0.2;
const MAX_ANALYSER_BUFFER_LENGTH = 1 << 20;
const MAX_DISPLAY_HZ = 30;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Produces a display-only, deterministic event sequence from the applied
 * engine configuration. Invalid angles are ignored defensively: active
 * configurations are validated before they reach the UI.
 */
export function firingEventMarkers(
  config: EngineConfig,
): readonly FiringEventMarker[] {
  const cycleDegrees =
    Number.isFinite(config.cycleDegrees) && config.cycleDegrees > 0
      ? config.cycleDegrees
      : 0;
  if (cycleDegrees === 0) return [];
  const markerLaneGapDegrees = cycleDegrees * MARKER_LANE_GAP_RATIO;
  const sorted = config.cylinders
    .map((cylinder, order) => ({ ...cylinder, order }))
    .filter(
      (cylinder) =>
        Number.isFinite(cylinder.firingAngleDeg) &&
        cylinder.firingAngleDeg >= 0 &&
        cylinder.firingAngleDeg < cycleDegrees,
    )
    .sort(
      (left, right) =>
        left.firingAngleDeg - right.firingAngleDeg ||
        left.id.localeCompare(right.id) ||
        left.order - right.order,
    )
    .map(({ id, firingAngleDeg, order }) => ({ id, firingAngleDeg, order }));
  const laneAngles: number[] = [];

  return sorted.map(({ id, firingAngleDeg, order }) => {
    let lane = laneAngles.findIndex(
      (lastAngle) => firingAngleDeg - lastAngle >= markerLaneGapDegrees,
    );
    if (lane === -1) {
      lane = laneAngles.length;
      laneAngles.push(firingAngleDeg);
    } else {
      laneAngles[lane] = firingAngleDeg;
    }
    return {
      id,
      angleDeg: firingAngleDeg,
      positionPercent: (firingAngleDeg / cycleDegrees) * 100,
      order,
      shortLabel: `C${order + 1}`,
      lane,
    };
  });
}

function validBufferLength(value: number): number | null {
  return Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_ANALYSER_BUFFER_LENGTH
    ? value
    : null;
}

/**
 * Runs display-only analyser reads at a fixed maximum cadence. It owns one
 * pending animation frame at a time and makes cleanup safe even if a browser
 * invokes an already-cancelled callback.
 */
export function startVisualizationLoop(
  options: VisualizationLoopOptions,
): (() => void) | null {
  const timeLength = validBufferLength(options.source.fftSize);
  const frequencyLength = validBufferLength(options.source.frequencyBinCount);
  if (timeLength === null || frequencyLength === null) return null;

  const timeData = new Uint8Array(timeLength);
  const frequencyData = new Uint8Array(frequencyLength);
  const minimumFrameInterval = 1_000 / MAX_DISPLAY_HZ;
  let animationFrame: number | null = null;
  let lastReadAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const frame = (timestamp: number) => {
    if (disposed) return;
    if (timestamp - lastReadAt >= minimumFrameInterval) {
      options.source.getByteTimeDomainData(timeData);
      options.source.getByteFrequencyData(frequencyData);
      options.draw(timeData, frequencyData);
      lastReadAt = timestamp;
    }
    animationFrame = options.scheduler.requestAnimationFrame(frame);
  };

  animationFrame = options.scheduler.requestAnimationFrame(frame);
  return () => {
    disposed = true;
    if (animationFrame !== null)
      options.scheduler.cancelAnimationFrame(animationFrame);
    options.disconnectResize?.();
  };
}

/** Resizes a canvas backing store without changing it for an unchanged box. */
export function resizeCanvasForDisplay(
  canvas: CanvasSizeTarget,
  devicePixelRatio: number,
): CanvasDimensions | null {
  const cssWidth = positiveInteger(canvas.clientWidth);
  const cssHeight = positiveInteger(canvas.clientHeight);
  if (cssWidth === 0 || cssHeight === 0) return null;

  const pixelRatio = Math.max(1, finite(devicePixelRatio, 1));
  const pixelWidth = Math.min(
    MAX_CANVAS_DIMENSION,
    Math.max(1, Math.round(cssWidth * pixelRatio)),
  );
  const pixelHeight = Math.min(
    MAX_CANVAS_DIMENSION,
    Math.max(1, Math.round(cssHeight * pixelRatio)),
  );
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  return { cssWidth, cssHeight, pixelWidth, pixelHeight, pixelRatio };
}

function drawableSize(
  context: CanvasDrawingContext,
): readonly [number, number] | null {
  const width = positiveInteger(context.canvas.width);
  const height = positiveInteger(context.canvas.height);
  return width > 0 && height > 0 ? [width, height] : null;
}

export function drawWaveform(
  context: CanvasDrawingContext,
  samples: Uint8Array,
): void {
  const size = drawableSize(context);
  if (!size) return;
  const [width, height] = size;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#09111f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#67e8f9";
  context.lineWidth = 1;
  context.beginPath();

  if (samples.length === 0) {
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
  } else {
    // Drawing more points than physical pixels increases main-thread work
    // without adding visible detail. Sample the analyser buffer at the canvas
    // resolution while retaining both endpoints.
    const pointCount = Math.min(samples.length, Math.max(2, Math.floor(width)));
    for (let point = 0; point < pointCount; point += 1) {
      const index =
        pointCount === 1
          ? 0
          : Math.round((point / (pointCount - 1)) * (samples.length - 1));
      const sample = finite(samples[index] ?? 128, 128);
      const x = pointCount === 1 ? 0 : (point / (pointCount - 1)) * width;
      const y = (1 - Math.min(255, Math.max(0, sample)) / 255) * height;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  context.stroke();
}

export function drawSpectrum(
  context: CanvasDrawingContext,
  bins: Uint8Array,
): void {
  const size = drawableSize(context);
  if (!size) return;
  const [width, height] = size;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#09111f";
  context.fillRect(0, 0, width, height);
  if (bins.length === 0) return;

  context.fillStyle = "#a3e635";
  const barCount = Math.min(bins.length, Math.max(1, Math.floor(width)));
  const barWidth = width / barCount;
  for (let bar = 0; bar < barCount; bar += 1) {
    const firstBin = Math.floor((bar / barCount) * bins.length);
    const endBin = Math.max(
      firstBin + 1,
      Math.floor(((bar + 1) / barCount) * bins.length),
    );
    let bin = 0;
    for (let index = firstBin; index < endBin; index += 1) {
      bin = Math.max(bin, finite(bins[index] ?? 0));
    }
    bin = Math.min(255, Math.max(0, bin));
    const barHeight = (bin / 255) * height;
    context.fillRect(
      bar * barWidth,
      height - barHeight,
      Math.max(1, barWidth - 1),
      barHeight,
    );
  }
}

export function nyquistLabel(sampleRate: number): string {
  const nyquist = Math.max(0, finite(sampleRate) / 2);
  return nyquist >= 1_000
    ? `0 Hz to ${(nyquist / 1_000).toFixed(1)} kHz (Nyquist)`
    : `0 Hz to ${nyquist.toFixed(0)} Hz (Nyquist)`;
}
