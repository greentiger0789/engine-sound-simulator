import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioController } from "../../src/audio/controller";

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
  disconnected = false;

  connect<T>(destination: T): T {
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
}

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  static automaticallyReady = true;
  readonly port = new FakePort();
  readonly parameters = new Map([["gain", new FakeAudioParam()]]);
  onprocessorerror: (() => void) | null = null;
  disconnected = false;

  constructor() {
    FakeAudioWorkletNode.instances.push(this);
    if (FakeAudioWorkletNode.automaticallyReady) {
      queueMicrotask(() => {
        this.port.onmessage?.({
          data: { type: "ready", sampleRate: 48000 },
        } as MessageEvent);
      });
    }
  }

  connect<T>(destination: T): T {
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

  async resume(): Promise<void> {
    this.state = "running";
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
      ([type, _value, time]) => type === "set" && time === 10.015,
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

  it("only enters running after its active processor reports ready", async () => {
    FakeAudioWorkletNode.automaticallyReady = false;
    const controller = new AudioController();
    await controller.start();
    expect(controller.getSnapshot().status).toBe("starting");

    const lateReady = FakeAudioWorkletNode.instances[0].port.onmessage!;
    lateReady({ data: { type: "ready", sampleRate: 48000 } } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("running");

    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(30);
    await stopping;
    lateReady({ data: { type: "ready", sampleRate: 48000 } } as MessageEvent);
    expect(controller.getSnapshot().status).toBe("idle");
  });
});
