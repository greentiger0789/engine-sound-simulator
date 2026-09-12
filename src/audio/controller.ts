import { loadEngineAudioWorklet } from "./load-worklet";
import { resolveEngineAudioWorkletModuleUrl } from "./worklet-module-url";
import {
  ENGINE_AUDIO_PROCESSOR_NAME,
  type ProcessorToControllerMessage,
} from "./worklets/contracts";

export type AudioControllerStatus =
  "idle" | "starting" | "running" | "stopping" | "suspended" | "error";

export type AudioControllerErrorCode =
  | "insecure-context"
  | "unsupported"
  | "worklet-load-failed"
  | "processor-error"
  | "fatal-error"
  | "context-state-change"
  | "start-failed";

export interface AudioControllerError {
  readonly code: AudioControllerErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface AudioControllerSnapshot {
  readonly status: AudioControllerStatus;
  readonly volume: number;
  readonly muted: boolean;
  readonly error: AudioControllerError | null;
}

type SnapshotListener = () => void;

const FADE_SECONDS = 0.03;
const REFERENCE_GAIN = 0.15;

/**
 * Owns every browser AudioContext resource. UI code only observes this class;
 * it never creates nodes or directly changes context state.
 */
export class AudioController {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private fadeGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private teardownPromise: Promise<void> | null = null;
  private stopRequested = false;
  private disposed = false;
  private readonly listeners = new Set<SnapshotListener>();
  private snapshot: AudioControllerSnapshot = {
    status: "idle",
    volume: 1,
    muted: false,
    error: null,
  };

  getSnapshot(): AudioControllerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.snapshot.status === "running" || this.startPromise !== null) {
      return this.startPromise ?? Promise.resolve();
    }
    if (this.stopPromise !== null) {
      return this.stopPromise.then(() => this.start());
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.disposed || this.snapshot.status === "idle") {
      return Promise.resolve();
    }
    if (this.stopPromise !== null) {
      return this.stopPromise;
    }
    this.stopRequested = true;
    const pendingStart = this.startPromise;
    this.stopPromise = (
      pendingStart === null ? Promise.resolve() : pendingStart
    )
      .then(() => this.stopInternal())
      .finally(() => {
        this.stopPromise = null;
      });
    return this.stopPromise;
  }

  setVolume(volume: number): void {
    const normalized = Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume))
      : 0;
    this.setSnapshot({ volume: normalized });
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.setSnapshot({ muted: Boolean(muted) });
    this.applyVolume();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.teardown();
    this.setSnapshot({ status: "idle", error: null });
    this.listeners.clear();
  }

  private async startInternal(): Promise<void> {
    this.stopRequested = false;
    this.setSnapshot({ status: "starting", error: null });

    if (globalThis.isSecureContext === false) {
      this.fail("insecure-context", "Audio requires a secure context.", false);
      return;
    }
    if (
      typeof AudioContext === "undefined" ||
      typeof AudioWorkletNode === "undefined"
    ) {
      this.fail(
        "unsupported",
        "AudioWorklet is not supported by this browser.",
        false,
      );
      return;
    }

    try {
      if (
        this.context !== null &&
        this.node !== null &&
        this.fadeGain !== null &&
        this.context.state === "suspended"
      ) {
        await this.context.resume();
        if (this.stopRequested || this.disposed) return;
        this.fadeGain.gain.cancelScheduledValues(this.context.currentTime);
        this.fadeGain.gain.setValueAtTime(0, this.context.currentTime);
        this.fadeGain.gain.linearRampToValueAtTime(
          1,
          this.context.currentTime + FADE_SECONDS,
        );
        this.setSnapshot({ status: "running", error: null });
        return;
      }
      // An error can originate asynchronously from the processor. Never let a
      // retry retain that failed graph or its event handlers.
      if (this.context !== null || this.teardownPromise !== null) {
        await this.teardown();
      }
      if (this.stopRequested || this.disposed) return;
      const context = new AudioContext();
      this.context = context;
      context.onstatechange = this.handleContextStateChange;

      const loadResult = await loadEngineAudioWorklet(
        context,
        resolveEngineAudioWorkletModuleUrl(),
      );
      if (!loadResult.ok) {
        this.fail(
          "worklet-load-failed",
          "The audio processor could not be loaded.",
          true,
        );
        await this.teardown();
        return;
      }
      if (this.disposed || this.stopRequested) {
        await this.teardown();
        return;
      }

      const node = new AudioWorkletNode(context, ENGINE_AUDIO_PROCESSOR_NAME);
      const fadeGain = context.createGain();
      const volumeGain = context.createGain();
      this.node = node;
      this.fadeGain = fadeGain;
      this.volumeGain = volumeGain;
      node.onprocessorerror = () => this.handleProcessorError();
      node.port.onmessage = this.handleProcessorMessage;
      node.parameters
        .get("gain")
        ?.setValueAtTime(REFERENCE_GAIN, context.currentTime);
      fadeGain.gain.setValueAtTime(0, context.currentTime);
      this.applyVolume();
      node.connect(fadeGain).connect(volumeGain).connect(context.destination);

      await context.resume();
      if (this.disposed || this.stopRequested) {
        await this.teardown();
        return;
      }
      fadeGain.gain.linearRampToValueAtTime(
        1,
        context.currentTime + FADE_SECONDS,
      );
      this.setSnapshot({ status: "running", error: null });
    } catch (error: unknown) {
      this.fail(
        "start-failed",
        error instanceof Error ? error.message : "Audio could not be started.",
        true,
      );
      await this.teardown();
    }
  }

  private async stopInternal(): Promise<void> {
    this.setSnapshot({ status: "stopping" });
    const context = this.context;
    const fadeGain = this.fadeGain;
    if (context !== null && fadeGain !== null) {
      fadeGain.gain.cancelScheduledValues(context.currentTime);
      fadeGain.gain.setValueAtTime(fadeGain.gain.value, context.currentTime);
      fadeGain.gain.linearRampToValueAtTime(
        0,
        context.currentTime + FADE_SECONDS,
      );
      await new Promise<void>((resolve) =>
        setTimeout(resolve, FADE_SECONDS * 1000),
      );
    }
    await this.teardown();
    if (!this.disposed) this.setSnapshot({ status: "idle", error: null });
  }

  private applyVolume(): void {
    const gain = this.volumeGain;
    const context = this.context;
    if (gain === null || context === null) return;
    gain.gain.setValueAtTime(
      this.snapshot.muted ? 0 : this.snapshot.volume,
      context.currentTime,
    );
  }

  private handleProcessorMessage = (
    event: MessageEvent<ProcessorToControllerMessage>,
  ): void => {
    if (event.data.type === "fatal-error") {
      this.fail("fatal-error", event.data.message, false);
      void this.teardown();
    }
  };

  private handleProcessorError(): void {
    this.fail(
      "processor-error",
      "The audio processor stopped unexpectedly.",
      true,
    );
    void this.teardown();
  }

  private handleContextStateChange = (): void => {
    const context = this.context;
    if (
      context === null ||
      this.disposed ||
      this.snapshot.status === "stopping"
    )
      return;
    if (context.state === "suspended") {
      this.setSnapshot({ status: "suspended" });
    } else if (context.state === "closed") {
      this.fail("context-state-change", "The audio context was closed.", true);
      void this.teardown();
    }
  };

  private fail(
    code: AudioControllerErrorCode,
    message: string,
    recoverable: boolean,
  ): void {
    this.setSnapshot({
      status: "error",
      error: { code, message, recoverable },
    });
  }

  private teardown(): Promise<void> {
    if (this.teardownPromise !== null) return this.teardownPromise;
    this.teardownPromise = this.teardownInternal().finally(() => {
      this.teardownPromise = null;
    });
    return this.teardownPromise;
  }

  private async teardownInternal(): Promise<void> {
    const context = this.context;
    const node = this.node;
    const fadeGain = this.fadeGain;
    const volumeGain = this.volumeGain;
    this.context = null;
    this.node = null;
    this.fadeGain = null;
    this.volumeGain = null;
    if (node !== null) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.disconnect();
    }
    fadeGain?.disconnect();
    volumeGain?.disconnect();
    if (context !== null) {
      context.onstatechange = null;
      if (context.state !== "closed") {
        try {
          await context.close();
        } catch {
          // A context can already be closed by the browser during teardown.
        }
      }
    }
  }

  private setSnapshot(change: Partial<AudioControllerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}

/** Creates the browser-backed controller without creating an AudioContext yet. */
export function createBrowserAudioController(): AudioController {
  return new AudioController();
}
