import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioController } from "../../src/audio/controller";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";
import { DEFAULT_DRIVETRAIN_CONFIG } from "../../src/engine/drivetrain";

class FakeAudioParam {
  value = 1;
  readonly calls: Array<[string, number, number]> = [];

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.calls.push(["set", value, time]);
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.calls.push(["ramp", value, time]);
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.calls.push(["cancel", 0, time]);
    return this;
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();
  readonly connections: unknown[] = [];
  disconnected = false;

  connect<T>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeAnalyserNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  minDecibels = 0;
  maxDecibels = 0;
  readonly sampleRate = 48000;
  readonly connections: unknown[] = [];
  readonly timeDomainReads: Uint8Array<ArrayBuffer>[] = [];
  readonly frequencyReads: Uint8Array<ArrayBuffer>[] = [];
  disconnected = false;

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  connect<T>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  getByteTimeDomainData(destinationData: Uint8Array<ArrayBuffer>): void {
    this.timeDomainReads.push(destinationData);
    destinationData.fill(128);
  }

  getByteFrequencyData(destinationData: Uint8Array<ArrayBuffer>): void {
    this.frequencyReads.push(destinationData);
    destinationData.fill(64);
  }
}

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly messages: unknown[] = [];
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  static automaticallyReady = true;
  readonly port = new FakePort();
  readonly parameters = new Map([
    ["gain", new FakeAudioParam()],
    ["throttle", new FakeAudioParam()],
    ["loadTorqueNm", new FakeAudioParam()],
    ["clutch", new FakeAudioParam()],
  ]);
  onprocessorerror: (() => void) | null = null;
  disconnected = false;
  readonly connections: unknown[] = [];
  readonly options: AudioWorkletNodeOptions | undefined;

  constructor(
    _context?: AudioContext,
    _name?: string,
    options?: AudioWorkletNodeOptions,
  ) {
    this.options = options;
    FakeAudioWorkletNode.instances.push(this);
    if (FakeAudioWorkletNode.automaticallyReady) {
      queueMicrotask(() => {
        const requestId = (options?.processorOptions as { requestId?: string })
          ?.requestId;
        this.port.onmessage?.({
          data: { type: "config-applied", requestId },
        } as MessageEvent);
        this.port.onmessage?.({
          data: { type: "ready", requestId, sampleRate: 48000 },
        } as MessageEvent);
      });
    }
  }

  connect<T>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static loadWorklet: () => Promise<void> = async () => undefined;
  readonly audioWorklet = {
    addModule: vi.fn(() => FakeAudioContext.loadWorklet()),
  };
  readonly destination = {} as AudioDestinationNode;
  readonly gains: FakeGainNode[] = [];
  readonly analysers: FakeAnalyserNode[] = [];
  readonly sampleRate = 48000;
  currentTime = 10;
  state: AudioContextState = "suspended";
  onstatechange: (() => void) | null = null;
  close = vi.fn(async () => {
    this.state = "closed";
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain(): GainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  createAnalyser(): AnalyserNode {
    const analyser = new FakeAnalyserNode();
    this.analysers.push(analyser);
    return analyser as unknown as AnalyserNode;
  }

  async resume(): Promise<void> {
    this.state = "running";
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
    this.onstatechange?.();
  }
}

describe("AudioController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.instances = [];
    FakeAudioWorkletNode.instances = [];
    FakeAudioWorkletNode.automaticallyReady = true;
    FakeAudioContext.loadWorklet = async () => undefined;
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("location", { origin: "https://example.test" });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates audio only on start and fades both start and stop", async () => {
    const controller = new AudioController();
    expect(FakeAudioContext.instances).toHaveLength(0);

    await controller.start();
    const context = FakeAudioContext.instances[0];
    expect(controller.getSnapshot().status).toBe("running");
    expect(context.gains[0].gain.calls).toContainEqual(["set", 0, 10]);
    expect(context.gains[0].gain.calls).toContainEqual(["ramp", 1, 10.03]);

    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    expect(context.gains[0].gain.calls).toContainEqual(["ramp", 0, 10.03]);
    expect(context.close).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("exposes one configured output-monitor analyser without inserting it into the audible path", async () => {
    const controller = new AudioController();
    expect(controller.getVisualizationSource()).toBeNull();

    await controller.start();
    const context = FakeAudioContext.instances[0];
    const analyser = context.analysers[0];
    const source = controller.getVisualizationSource();
    expect(context.analysers).toHaveLength(1);
    expect(source).not.toBe(analyser);
    expect(source).toMatchObject({
      sampleRate: 48000,
      fftSize: 2048,
      frequencyBinCount: 1024,
      minDecibels: -100,
      maxDecibels: -20,
    });
    const timeDomain = new Uint8Array(new ArrayBuffer(4));
    const frequency = new Uint8Array(new ArrayBuffer(4));
    source?.getByteTimeDomainData(timeDomain);
    source?.getByteFrequencyData(frequency);
    expect(analyser.timeDomainReads).toEqual([timeDomain]);
    expect(analyser.frequencyReads).toEqual([frequency]);

    const [fade, volume] = context.gains;
    expect(FakeAudioWorkletNode.instances[0].connections).toEqual([fade]);
    expect(fade.connections).toEqual([volume]);
    expect(volume.connections).toEqual([context.destination, analyser]);
    expect(analyser.connections).toEqual([]);

    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    expect(controller.getVisualizationSource()).toBeNull();
    expect(analyser.disconnected).toBe(true);

    await controller.start();
    expect(FakeAudioContext.instances[1].analysers).toHaveLength(1);
    expect(FakeAudioContext.instances[1].analysers[0]).not.toBe(analyser);
  });

  it("holds the instantaneous start envelope when stopped mid-fade", async () => {
    const controller = new AudioController();
    await controller.start();
    const context = FakeAudioContext.instances[0];
    context.currentTime = 10.015;

    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    const calls = context.gains[0].gain.calls;
    const heldValue = calls.find(
      ([type, , time]) => type === "set" && time === 10.015,
    )?.[1];
    expect(heldValue).toBeCloseTo(0.5);
    expect(calls).toContainEqual(["ramp", 0, 10.045]);
    expect(calls).not.toContainEqual(["set", 1, 10.015]);
  });

  it("is idempotent and reflects volume and mute through its gain node", async () => {
    const controller = new AudioController();
    controller.setVolume(2);
    controller.setMuted(true);
    const first = controller.start();
    const second = controller.start();
    await Promise.all([first, second]);

    const context = FakeAudioContext.instances[0];
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context.gains[1].gain.calls).toContainEqual(["set", 0, 10]);
    controller.setMuted(false);
    expect(context.gains[1].gain.calls).toContainEqual(["set", 1, 10]);
  });

  it("sends throttle through its a-rate AudioParam", async () => {
    const controller = new AudioController();
    controller.setThrottle(2);
    await controller.start();
    const throttle =
      FakeAudioWorkletNode.instances[0].parameters.get("throttle")!;
    expect(throttle.calls).toContainEqual(["set", 1, 10]);

    controller.setThrottle(0.35);
    expect(throttle.calls).toContainEqual(["set", 0.35, 10]);
  });

  it("clamps dynamometer load in N m and sends it through its a-rate AudioParam", async () => {
    const controller = new AudioController();
    controller.setLoadTorque(100);
    await controller.start();
    const load =
      FakeAudioWorkletNode.instances[0].parameters.get("loadTorqueNm")!;
    expect(controller.getSnapshot().loadTorqueNm).toBe(40);
    expect(load.calls).toContainEqual(["set", 40, 10]);

    controller.setLoadTorque(12.5);
    expect(load.calls).toContainEqual(["set", 12.5, 10]);
  });

  it("validates stopped vehicle configuration and carries gear and clutch across a restart", async () => {
    const controller = new AudioController();
    expect(
      controller.stageDrivetrainConfig({
        ...DEFAULT_DRIVETRAIN_CONFIG,
        vehicleMassKg: -1,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "$.vehicleMassKg" }] });
    expect(
      controller.stageDrivetrainConfig({
        ...DEFAULT_DRIVETRAIN_CONFIG,
        gearRatios: [0, -2],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "$.gearRatios[1]" }] });
    expect(controller.getSnapshot().drivetrainConfig).toEqual(
      DEFAULT_DRIVETRAIN_CONFIG,
    );
    controller.setDrivetrainGear(1);
    controller.setClutch(0.7);
    await controller.start();
    const firstNode = FakeAudioWorkletNode.instances[0];
    expect(firstNode.options?.processorOptions).toMatchObject({
      config: { drivetrainGear: 1, drivetrain: DEFAULT_DRIVETRAIN_CONFIG },
    });
    expect(firstNode.parameters.get("clutch")?.calls).toContainEqual([
      "set",
      0.7,
      10,
    ]);
    expect(controller.stageDrivetrainConfig(DEFAULT_DRIVETRAIN_CONFIG)).toEqual(
      {
        ok: false,
        reason: "audio-active",
      },
    );
    controller.setDrivetrainGear(2);
    expect(firstNode.port.messages).toContainEqual({
      type: "set-drivetrain-gear",
      gear: 2,
    });
    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    await controller.start();
    expect(
      FakeAudioWorkletNode.instances[1].options?.processorOptions,
    ).toMatchObject({
      config: { drivetrainGear: 2 },
    });
    expect(controller.getSnapshot().telemetry.vehicleSpeedMps).toBe(0);
  });

  it("uses the calibrated reference gain while retaining the processor gain path", async () => {
    const controller = new AudioController();
    await controller.start();
    const gain = FakeAudioWorkletNode.instances[0].parameters.get("gain")!;
    expect(gain.calls).toContainEqual(["set", 1, 10]);
  });

  it("stages valid stopped snapshots for 360-degree and 720-degree cycles without creating audio", () => {
    const controller = new AudioController();
    const source = { ...singleCylinderPreset.config, id: "staged" };
    const staged = controller.stageConfig(source);

    expect(staged).toMatchObject({ ok: true, value: { id: "staged" } });
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      activeConfig: { id: singleCylinderPreset.config.id },
      pendingConfig: { id: "staged" },
    });
    source.id = "mutated-after-stage";
    expect(controller.getSnapshot().pendingConfig?.id).toBe("staged");

    const twoStroke = controller.stageConfig({
      ...singleCylinderPreset.config,
      id: "staged-two-stroke",
      cycleDegrees: 360,
    });
    expect(twoStroke).toMatchObject({
      ok: true,
      value: { id: "staged-two-stroke", cycleDegrees: 360 },
    });

    const invalidBoundary = controller.stageConfig({
      ...singleCylinderPreset.config,
      cycleDegrees: 360,
      cylinders: [
        {
          ...singleCylinderPreset.config.cylinders[0],
          firingAngleDeg: 360,
        },
      ],
    });
    expect(invalidBoundary).toMatchObject({ ok: false, reason: "validation" });
    expect(controller.getSnapshot().pendingConfig?.id).toBe(
      "staged-two-stroke",
    );
  });

  it("rejects staging while audio is active", async () => {
    const controller = new AudioController();
    await controller.start();
    expect(controller.stageConfig(singleCylinderPreset.config)).toEqual({
      ok: false,
      reason: "audio-active",
    });
  });

  it("maps unavailable audio and processor errors to displayable snapshots", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const unavailable = new AudioController();
    await unavailable.start();
    expect(unavailable.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "unsupported", recoverable: false },
    });

    vi.stubGlobal("AudioContext", FakeAudioContext);
    const controller = new AudioController();
    await controller.start();
    FakeAudioWorkletNode.instances[0].onprocessorerror?.();
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "processor-error", recoverable: true },
    });

    await Promise.resolve();
    await controller.start();
    expect(FakeAudioContext.instances).toHaveLength(2);
  });

  it("reports secure-context and worklet-loading failures with distinct codes", async () => {
    vi.stubGlobal("isSecureContext", false);
    const insecure = new AudioController();
    await insecure.start();
    expect(insecure.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "insecure-context", recoverable: false },
    });
    expect(FakeAudioContext.instances).toHaveLength(0);

    vi.stubGlobal("isSecureContext", true);
    FakeAudioContext.loadWorklet = async () => {
      throw new Error("module fetch failed");
    };
    const loadFailure = new AudioController();
    await loadFailure.start();
    expect(loadFailure.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "worklet-load-failed", recoverable: true },
    });
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("silences and closes the graph after a fatal processor message", async () => {
    const controller = new AudioController();
    await controller.start();
    const context = FakeAudioContext.instances[0];
    const analyser = context.analysers[0];
    FakeAudioWorkletNode.instances[0].port.onmessage?.({
      data: { type: "fatal-error", message: "non-finite output" },
    } as MessageEvent);

    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: {
        code: "fatal-error",
        message: "non-finite output",
        recoverable: false,
      },
    });
    expect(controller.getVisualizationSource()).toBeNull();
    expect(analyser.disconnected).toBe(true);
    await Promise.resolve();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("resumes one suspended graph without constructing a second context", async () => {
    const controller = new AudioController();
    await controller.start();
    const context = FakeAudioContext.instances[0];
    context.state = "suspended";
    context.onstatechange?.();
    expect(controller.getSnapshot().status).toBe("suspended");

    await controller.start();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(controller.getSnapshot().status).toBe("running");
  });

  it("fades then suspends on page hide, and only explicit start resumes it", async () => {
    const controller = new AudioController();
    await controller.start();
    const context = FakeAudioContext.instances[0];

    const hiding = controller.handleVisibilityChange(true);
    await vi.advanceTimersByTimeAsync(30);
    await hiding;
    expect(context.gains[0].gain.calls).toContainEqual(["ramp", 0, 10.03]);
    expect(context.state).toBe("suspended");
    expect(controller.getSnapshot().status).toBe("suspended");

    await controller.handleVisibilityChange(false);
    expect(context.state).toBe("suspended");
    expect(controller.getSnapshot().status).toBe("suspended");

    await controller.start();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context.state).toBe("running");
    expect(controller.getSnapshot().status).toBe("running");
  });

  it("honours a hide received while the worklet is still starting", async () => {
    let finishLoad: (() => void) | undefined;
    FakeAudioContext.loadWorklet = () =>
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      });
    const controller = new AudioController();
    const starting = controller.start();
    const hiding = controller.handleVisibilityChange(true);
    finishLoad?.();

    await vi.advanceTimersByTimeAsync(30);
    await starting;
    await hiding;
    const context = FakeAudioContext.instances[0];
    expect(context.state).toBe("suspended");
    expect(controller.getSnapshot().status).toBe("suspended");
    expect(context.gains[0].gain.calls).not.toContainEqual(["ramp", 1, 10.03]);
  });

  it("handles processor failure by detaching the graph before recovery", async () => {
    const controller = new AudioController();
    await controller.start();
    const failedNode = FakeAudioWorkletNode.instances[0];
    const failedContext = FakeAudioContext.instances[0];

    failedNode.onprocessorerror?.();
    await Promise.resolve();
    expect(failedNode.disconnected).toBe(true);
    expect(failedContext.close).toHaveBeenCalledOnce();
    expect(controller.getVisualizationSource()).toBeNull();

    await controller.start();
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioWorkletNode.instances).toHaveLength(2);
    expect(controller.getSnapshot().status).toBe("running");
  });

  it("does not suspend a graph that stop detached during a visibility fade", async () => {
    const controller = new AudioController();
    await controller.start();
    const context = FakeAudioContext.instances[0];
    const hiding = controller.handleVisibilityChange(true);
    const stopping = controller.stop();

    await vi.advanceTimersByTimeAsync(30);
    await hiding;
    await stopping;
    expect(context.close).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("serializes stop behind a worklet load still in flight", async () => {
    let finishLoad: (() => void) | undefined;
    FakeAudioContext.loadWorklet = () =>
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      });
    const controller = new AudioController();
    const starting = controller.start();
    const stopping = controller.stop();
    finishLoad?.();

    await starting;
    await vi.runAllTimersAsync();
    await stopping;
    expect(controller.getSnapshot().status).toBe("idle");
    expect(FakeAudioWorkletNode.instances).toHaveLength(0);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("completes a queued stop when the in-flight worklet load fails", async () => {
    let failLoad: ((reason: Error) => void) | undefined;
    FakeAudioContext.loadWorklet = () =>
      new Promise<void>((_resolve, reject) => {
        failLoad = reject;
      });
    const controller = new AudioController();
    const starting = controller.start();
    const stopping = controller.stop();
    failLoad?.(new Error("module fetch failed"));

    await starting;
    await stopping;
    expect(controller.getSnapshot()).toMatchObject({
      status: "idle",
      error: null,
    });
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("queues a requested restart until an in-progress stop has completed", async () => {
    const controller = new AudioController();
    await controller.start();

    const stopping = controller.stop();
    const restarting = controller.start();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    await restarting;

    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioWorkletNode.instances).toHaveLength(2);
    expect(controller.getSnapshot().status).toBe("running");
  });

  it("only enters running after its active processor reports ready", async () => {
    FakeAudioWorkletNode.automaticallyReady = false;
    const controller = new AudioController();
    await controller.start();
    expect(controller.getSnapshot().status).toBe("starting");

    const lateReady = FakeAudioWorkletNode.instances[0].port.onmessage!;
    await controller.start();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioWorkletNode.instances).toHaveLength(1);
    expect(controller.getSnapshot().status).toBe("starting");

    lateReady({
      data: { type: "config-applied", requestId: "1" },
    } as MessageEvent);
    lateReady({
      data: { type: "ready", requestId: "1", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("running");

    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    lateReady({
      data: { type: "ready", requestId: "1", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("requires config-applied before matching ready and ignores stale request ids", async () => {
    FakeAudioWorkletNode.automaticallyReady = false;
    const controller = new AudioController();
    await controller.start();
    const message = FakeAudioWorkletNode.instances[0].port.onmessage!;

    message({
      data: { type: "ready", requestId: "1", sampleRate: 48000 },
    } as MessageEvent);
    message({
      data: { type: "config-applied", requestId: "99" },
    } as MessageEvent);
    message({
      data: { type: "ready", requestId: "99", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("starting");

    message({
      data: { type: "config-applied", requestId: "1" },
    } as MessageEvent);
    message({
      data: { type: "ready", requestId: "1", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("running");
  });

  it("does not promote pending config for ready-first or stale-node acknowledgements", async () => {
    FakeAudioWorkletNode.automaticallyReady = false;
    const controller = new AudioController();
    const staged = { ...singleCylinderPreset.config, id: "ordering-config" };
    controller.stageConfig(staged);
    await controller.start();
    const firstHandler = FakeAudioWorkletNode.instances[0].port.onmessage!;

    firstHandler({
      data: { type: "ready", requestId: "1", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot()).toMatchObject({
      status: "starting",
      activeConfig: { id: singleCylinderPreset.config.id },
      pendingConfig: { id: "ordering-config" },
    });

    firstHandler({
      data: { type: "config-rejected", requestId: "1", message: "reject" },
    } as MessageEvent);
    await Promise.resolve();
    await controller.start();
    const secondHandler = FakeAudioWorkletNode.instances[1].port.onmessage!;
    firstHandler({
      data: { type: "config-applied", requestId: "2" },
    } as MessageEvent);
    firstHandler({
      data: { type: "ready", requestId: "2", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("starting");
    expect(controller.getSnapshot().pendingConfig?.id).toBe("ordering-config");

    secondHandler({
      data: { type: "config-applied", requestId: "2" },
    } as MessageEvent);
    secondHandler({
      data: { type: "ready", requestId: "2", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      activeConfig: { id: "ordering-config" },
      pendingConfig: null,
    });
  });

  it("tears down a rejected configuration and retains it for a retry", async () => {
    FakeAudioWorkletNode.automaticallyReady = false;
    const controller = new AudioController();
    const staged = { ...singleCylinderPreset.config, id: "retry-config" };
    expect(controller.stageConfig(staged)).toMatchObject({ ok: true });
    await controller.start();
    expect(
      (
        FakeAudioWorkletNode.instances[0].options?.processorOptions as {
          config: { snapshot: { id: string } };
        }
      ).config.snapshot.id,
    ).toBe("retry-config");
    FakeAudioWorkletNode.instances[0].port.onmessage?.({
      data: { type: "config-rejected", requestId: "1", message: "bad config" },
    } as MessageEvent);
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "config-rejected", recoverable: true },
    });
    expect(controller.getSnapshot()).toMatchObject({
      activeConfig: { id: singleCylinderPreset.config.id },
      pendingConfig: { id: "retry-config" },
    });
    await Promise.resolve();

    FakeAudioWorkletNode.automaticallyReady = true;
    await controller.start();
    expect(FakeAudioWorkletNode.instances).toHaveLength(2);
    expect(controller.getSnapshot().status).toBe("running");
    expect(controller.getSnapshot()).toMatchObject({
      activeConfig: { id: "retry-config" },
      pendingConfig: null,
    });
  });

  it("recovers a rejected configuration by staging a corrected stopped snapshot", async () => {
    FakeAudioWorkletNode.automaticallyReady = false;
    const controller = new AudioController();
    const rejected = { ...singleCylinderPreset.config, id: "rejected-config" };
    expect(controller.stageConfig(rejected)).toMatchObject({ ok: true });
    await controller.start();
    FakeAudioWorkletNode.instances[0].port.onmessage?.({
      data: { type: "config-rejected", requestId: "1", message: "bad config" },
    } as MessageEvent);
    await Promise.resolve();

    const corrected = {
      ...singleCylinderPreset.config,
      id: "corrected-config",
    };
    expect(
      controller.stageConfig({
        ...corrected,
        cylinders: [{ ...corrected.cylinders[0], firingAngleDeg: 720 }],
      }),
    ).toMatchObject({ ok: false, reason: "validation" });
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "config-rejected", message: "bad config" },
      pendingConfig: { id: "rejected-config" },
    });

    expect(controller.stageConfig(corrected)).toMatchObject({ ok: true });
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: "idle",
      error: null,
      activeConfig: { id: singleCylinderPreset.config.id },
      pendingConfig: { id: "corrected-config" },
    });

    await controller.start();
    const retry = FakeAudioWorkletNode.instances[1].port.onmessage!;
    retry({ data: { type: "config-applied", requestId: "2" } } as MessageEvent);
    retry({
      data: { type: "ready", requestId: "2", sampleRate: 48000 },
    } as MessageEvent);
    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      activeConfig: { id: "corrected-config" },
      pendingConfig: null,
    });
  });
});
