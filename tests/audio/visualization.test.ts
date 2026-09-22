import { describe, expect, it } from "vitest";

import { singleCylinderPreset } from "../../src/presets/single-cylinder";
import {
  drawSpectrum,
  drawWaveform,
  firingEventMarkers,
  nyquistLabel,
  resizeCanvasForDisplay,
  startVisualizationLoop,
  type AnimationFrameScheduler,
  type CanvasDrawingContext,
} from "../../src/components/visualization";

class RecordingContext implements CanvasDrawingContext {
  readonly canvas = { width: 240, height: 80 };
  readonly calls: Array<readonly [string, ...number[]]> = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;

  clearRect(x: number, y: number, width: number, height: number): void {
    this.calls.push(["clearRect", x, y, width, height]);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.calls.push(["fillRect", x, y, width, height]);
  }

  beginPath(): void {
    this.calls.push(["beginPath"]);
  }

  moveTo(x: number, y: number): void {
    this.calls.push(["moveTo", x, y]);
  }

  lineTo(x: number, y: number): void {
    this.calls.push(["lineTo", x, y]);
  }

  stroke(): void {
    this.calls.push(["stroke"]);
  }
}

function fixtureConfig() {
  return {
    ...singleCylinderPreset.config,
    cylinders: [
      { id: "z", firingAngleDeg: 360, bankId: "b", combustionStrength: 1 },
      { id: "z-same", firingAngleDeg: 0, bankId: "a", combustionStrength: 1 },
      { id: "a", firingAngleDeg: 0, bankId: "a", combustionStrength: 1 },
      { id: "a", firingAngleDeg: 0, bankId: "b", combustionStrength: 1 },
      { id: "last", firingAngleDeg: 719.5, bankId: "b", combustionStrength: 1 },
    ],
  };
}

function expectFiniteDrawArguments(context: RecordingContext): void {
  for (const [, ...values] of context.calls) {
    for (const value of values) expect(Number.isFinite(value)).toBe(true);
  }
}

class FakeAnimationFrames implements AnimationFrameScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, (timestamp: number) => void>();
  readonly cancelled: number[] = [];
  maxPending = 0;

  requestAnimationFrame(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    this.maxPending = Math.max(this.maxPending, this.callbacks.size);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.cancelled.push(handle);
    // Keep the callback available so tests can prove an already queued callback
    // cannot resurrect the loop after cleanup.
  }

  step(timestamp: number): void {
    const entry = this.callbacks.entries().next().value as
      [number, (time: number) => void] | undefined;
    if (!entry) throw new Error("no animation frame is pending");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback(timestamp);
  }

  runCancelled(timestamp: number): void {
    const handle = this.cancelled.at(-1);
    if (handle === undefined) throw new Error("no frame was cancelled");
    this.callbacks.get(handle)?.(timestamp);
  }
}

describe("visualization helpers", () => {
  it("sorts firing markers by angle, cylinder id, then original order", () => {
    const events = firingEventMarkers(fixtureConfig());

    expect(events.map((event) => event.id)).toEqual([
      "a",
      "a",
      "z-same",
      "z",
      "last",
    ]);
    expect(events.map((event) => event.positionPercent)).toEqual([
      0,
      0,
      0,
      50,
      (719.5 / 720) * 100,
    ]);
    expect(events[0]?.order).toBe(2);
    expect(events[1]?.order).toBe(3);
    expect(events.map((event) => event.shortLabel)).toEqual([
      "C3",
      "C4",
      "C2",
      "C1",
      "C5",
    ]);
  });

  it("assigns separate lanes to coincident and near firing markers", () => {
    const config = fixtureConfig();
    config.cylinders = [
      { id: "same-a", firingAngleDeg: 10, bankId: "a", combustionStrength: 1 },
      { id: "same-b", firingAngleDeg: 10, bankId: "a", combustionStrength: 1 },
      { id: "near", firingAngleDeg: 15, bankId: "a", combustionStrength: 1 },
      {
        id: "separate",
        firingAngleDeg: 160,
        bankId: "a",
        combustionStrength: 1,
      },
    ];

    const events = firingEventMarkers(config);
    expect(events.map((event) => [event.id, event.lane])).toEqual([
      ["same-a", 0],
      ["same-b", 1],
      ["near", 2],
      ["separate", 0],
    ]);
  });

  it("does not make out-of-cycle display markers", () => {
    const config = fixtureConfig();
    config.cylinders = [
      ...config.cylinders,
      {
        id: "bad",
        firingAngleDeg: Number.NaN,
        bankId: "a",
        combustionStrength: 1,
      },
      { id: "end", firingAngleDeg: 720, bankId: "a", combustionStrength: 1 },
    ];

    expect(firingEventMarkers(config).map((event) => event.id)).not.toContain(
      "bad",
    );
    expect(firingEventMarkers(config).map((event) => event.id)).not.toContain(
      "end",
    );
  });

  it("uses the active 360-degree cycle for marker positions and boundaries", () => {
    const config = fixtureConfig();
    config.cycleDegrees = 360;
    config.cylinders = [
      { id: "start", firingAngleDeg: 0, bankId: "a", combustionStrength: 1 },
      {
        id: "middle",
        firingAngleDeg: 180,
        bankId: "a",
        combustionStrength: 1,
      },
      { id: "end", firingAngleDeg: 360, bankId: "a", combustionStrength: 1 },
    ];

    expect(firingEventMarkers(config)).toMatchObject([
      { id: "start", positionPercent: 0 },
      { id: "middle", positionPercent: 50 },
    ]);
  });

  it("sizes a canvas for DPR and does not change stable dimensions", () => {
    const canvas = { clientWidth: 200, clientHeight: 100, width: 0, height: 0 };

    expect(resizeCanvasForDisplay(canvas, 2)).toEqual({
      cssWidth: 200,
      cssHeight: 100,
      pixelWidth: 400,
      pixelHeight: 200,
      pixelRatio: 2,
    });
    const dimensions = { width: canvas.width, height: canvas.height };
    resizeCanvasForDisplay(canvas, 2);
    expect(canvas).toMatchObject(dimensions);
    expect(resizeCanvasForDisplay({ ...canvas, clientWidth: 0 }, 2)).toBeNull();
  });

  it("keeps waveform and spectrum drawing finite for empty and edge data", () => {
    const waveform = new RecordingContext();
    const spectrum = new RecordingContext();

    drawWaveform(waveform, new Uint8Array());
    drawSpectrum(spectrum, new Uint8Array([0, 255]));

    expectFiniteDrawArguments(waveform);
    expectFiniteDrawArguments(spectrum);
    expect(waveform.calls.some(([name]) => name === "stroke")).toBe(true);
    expect(spectrum.calls.filter(([name]) => name === "fillRect")).toHaveLength(
      3,
    );
  });

  it("bounds visible drawing work to the canvas pixel width", () => {
    const waveform = new RecordingContext();
    const spectrum = new RecordingContext();
    const analyserSize = 2048;

    drawWaveform(waveform, new Uint8Array(analyserSize).fill(128));
    drawSpectrum(spectrum, new Uint8Array(analyserSize / 2).fill(64));

    expect(
      waveform.calls.filter(([name]) => name === "moveTo" || name === "lineTo"),
    ).toHaveLength(waveform.canvas.width);
    // One fill paints the background; the rest are spectrum bars.
    expect(spectrum.calls.filter(([name]) => name === "fillRect")).toHaveLength(
      spectrum.canvas.width + 1,
    );
  });

  it("labels the spectrum range from zero through Nyquist", () => {
    expect(nyquistLabel(48_000)).toBe("0 Hz to 24.0 kHz (Nyquist)");
    expect(nyquistLabel(Number.NaN)).toBe("0 Hz to 0 Hz (Nyquist)");
  });

  it("caps analyser reads at 30 Hz and cleanup prevents a queued frame reading again", () => {
    const animationFrames = new FakeAnimationFrames();
    const timeBuffers = new Set<Uint8Array>();
    const frequencyBuffers = new Set<Uint8Array>();
    let timeReads = 0;
    let frequencyReads = 0;
    let draws = 0;
    let resizeDisconnects = 0;
    const cleanup = startVisualizationLoop({
      source: {
        fftSize: 8,
        frequencyBinCount: 4,
        getByteTimeDomainData(buffer) {
          timeReads += 1;
          timeBuffers.add(buffer);
        },
        getByteFrequencyData(buffer) {
          frequencyReads += 1;
          frequencyBuffers.add(buffer);
        },
      },
      scheduler: animationFrames,
      draw: () => {
        draws += 1;
      },
      disconnectResize: () => {
        resizeDisconnects += 1;
      },
    });

    expect(cleanup).not.toBeNull();
    for (let frame = 0; frame <= 240; frame += 1) {
      animationFrames.step((frame * 1_000) / 240);
    }

    expect(timeReads).toBeLessThanOrEqual(31);
    expect(frequencyReads).toBe(timeReads);
    expect(draws).toBe(timeReads);
    expect(timeBuffers.size).toBe(1);
    expect(frequencyBuffers.size).toBe(1);
    expect(animationFrames.maxPending).toBe(1);

    cleanup?.();
    const readsAtCleanup = timeReads;
    animationFrames.runCancelled(1_100);
    expect(timeReads).toBe(readsAtCleanup);
    expect(animationFrames.cancelled).toHaveLength(1);
    expect(resizeDisconnects).toBe(1);
  });
});
