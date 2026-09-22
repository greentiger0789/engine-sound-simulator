import { loadEngineAudioWorklet } from "./load-worklet";
import {
  toDisplayableAudioError,
  transitionAudioLifecycle,
  type AudioLifecycleStatus,
} from "./lifecycle";
import { resolveEngineAudioWorkletModuleUrl } from "./worklet-module-url";
import {
  ENGINE_AUDIO_LOAD_TORQUE_PARAM,
  ENGINE_AUDIO_PROCESSOR_NAME,
  MAX_LOAD_TORQUE_NM,
  type EngineAudioConfig,
  type ProcessorToControllerMessage,
} from "./worklets/contracts";
import {
  parseEngineConfig,
  type EngineConfig,
  type EngineConfigValidationIssue,
} from "../engine/config";
import { singleCylinderEngineConfig } from "../presets/single-cylinder";

export type AudioControllerStatus = AudioLifecycleStatus;

export type AudioControllerErrorCode =
  | "insecure-context"
  | "unsupported"
  | "worklet-load-failed"
  | "processor-error"
  | "fatal-error"
  | "config-rejected"
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
  readonly throttle: number;
  /** Dynamometer resisting torque in N m, bounded to [0, 40]. */
  readonly loadTorqueNm: number;
  readonly telemetry: AudioTelemetry;
  /** Last configuration confirmed by the processor. */
  readonly activeConfig: EngineConfig;
  /** Validated configuration waiting for the next start acknowledgement. */
  readonly pendingConfig: EngineConfig | null;
}

export type ConfigStageResult =
  | { readonly ok: true; readonly value: EngineConfig }
  | {
      readonly ok: false;
      readonly reason: "validation";
      readonly issues: readonly EngineConfigValidationIssue[];
    }
  | { readonly ok: false; readonly reason: "audio-active" };

export interface AudioTelemetry {
  readonly rpm: number;
  readonly effectiveThrottle: number;
  readonly limiterActive: boolean;
}

/**
 * Read-only audio data source for rendering output visualizations. The
 * controller owns its lifetime; consumers must not connect or disconnect it.
 */
export interface AudioVisualizationSource {
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly frequencyBinCount: number;
  readonly minDecibels: number;
  readonly maxDecibels: number;
  getByteTimeDomainData(destinationData: Uint8Array<ArrayBuffer>): void;
  getByteFrequencyData(destinationData: Uint8Array<ArrayBuffer>): void;
}

type SnapshotListener = () => void;

const FADE_SECONDS = 0.03;
const REFERENCE_GAIN = 1;
const VISUALIZATION_FFT_SIZE = 2048;
const VISUALIZATION_SMOOTHING_TIME_CONSTANT = 0.75;
const VISUALIZATION_MIN_DECIBELS = -100;
const VISUALIZATION_MAX_DECIBELS = -20;
/**
 * UI and AudioParam boundary for the dynamometer. The processor samples this
 * a-rate N m value each audio frame; dynamics smooths the requested load at
 * its 1 kHz integration boundaries.
 */
export { MAX_LOAD_TORQUE_NM } from "./worklets/contracts";
const INITIAL_TELEMETRY: AudioTelemetry = {
  rpm: 0,
  effectiveThrottle: 0,
  limiterActive: false,
};

function validatedSingleCylinderConfig(): EngineConfig {
  const parsed = parseEngineConfig(singleCylinderEngineConfig, {
    maxCylinders: 1,
  });
  if (!parsed.ok || parsed.value.cylinders.length !== 1) {
    throw new Error("The single-cylinder engine configuration is invalid.");
  }
  return parsed.value;
}

interface FadeState {
  readonly from: number;
  readonly to: number;
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * Owns every browser AudioContext resource. UI code only observes this class;
 * it never creates nodes or directly changes context state.
 */
export class AudioController {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private fadeGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private visualizationSource: AudioVisualizationSource | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private visibilityPromise: Promise<void> | null = null;
  private teardownPromise: Promise<void> | null = null;
  private fadeState: FadeState | null = null;
  private processorReady = false;
  private configApplied = false;
  private requestId = 0;
  private activeRequestId: string | null = null;
  private activeConfig = validatedSingleCylinderConfig();
  private pendingConfig: EngineConfig | null = null;
  private requestedConfig: EngineConfig | null = null;
  private stopRequested = false;
  private disposed = false;
  private visibilityHidden = false;
  private readonly listeners = new Set<SnapshotListener>();
  private snapshot: AudioControllerSnapshot = {
    status: "idle",
    volume: 1,
    muted: false,
    error: null,
    throttle: 0,
    loadTorqueNm: 0,
    telemetry: INITIAL_TELEMETRY,
    activeConfig: this.activeConfig,
    pendingConfig: null,
  };

  getSnapshot(): AudioControllerSnapshot {
    return this.snapshot;
  }

  /** Returns the current output-monitor tap, or null when no graph is live. */
  getVisualizationSource(): AudioVisualizationSource | null {
    return this.visualizationSource;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    // Do not allow an explicit user restart to race a page-hide fade/suspend.
    // Once that operation is complete, this same user gesture may resume it.
    if (this.visibilityPromise !== null) {
      return this.visibilityPromise.then(() => this.start());
    }
    if (this.stopPromise !== null) {
      return this.stopPromise.then(() => this.start());
    }
    if (
      this.snapshot.status === "running" ||
      this.snapshot.status === "starting"
    ) {
      const transition = transitionAudioLifecycle(
        this.snapshot.status,
        "start-requested",
      );
      if (!transition.accepted) {
        return this.startPromise ?? Promise.resolve();
      }
    }
    if (this.startPromise !== null) {
      return this.startPromise ?? Promise.resolve();
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

  /**
   * Applies the document visibility policy without installing document-level
   * listeners. Showing a page intentionally does nothing: Web Audio resume
   * must remain tied to a later explicit user start action.
   */
  handleVisibilityChange(hidden: boolean): Promise<void> {
    this.visibilityHidden = hidden;
    if (!hidden || this.disposed) return Promise.resolve();
    return this.beginVisibilitySuspend();
  }

  private beginVisibilitySuspend(): Promise<void> {
    if (this.visibilityPromise !== null) return this.visibilityPromise;
    if (
      this.snapshot.status !== "starting" &&
      this.snapshot.status !== "running"
    ) {
      return Promise.resolve();
    }

    const context = this.context;
    const fadeGain = this.fadeGain;
    if (context === null || fadeGain === null) return Promise.resolve();
    this.visibilityPromise = this.suspendForVisibility(
      context,
      fadeGain,
    ).finally(() => {
      this.visibilityPromise = null;
    });
    return this.visibilityPromise;
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

  setThrottle(throttle: number): void {
    const normalized = Number.isFinite(throttle)
      ? Math.min(1, Math.max(0, throttle))
      : 0;
    this.setSnapshot({ throttle: normalized });
    const parameter = this.node?.parameters.get("throttle");
    if (parameter !== undefined && this.context !== null) {
      parameter.setValueAtTime(normalized, this.context.currentTime);
    }
  }

  setLoadTorque(loadTorqueNm: number): void {
    const normalized = Number.isFinite(loadTorqueNm)
      ? Math.min(MAX_LOAD_TORQUE_NM, Math.max(0, loadTorqueNm))
      : 0;
    this.setSnapshot({ loadTorqueNm: normalized });
    const parameter = this.node?.parameters.get(ENGINE_AUDIO_LOAD_TORQUE_PARAM);
    if (parameter !== undefined && this.context !== null) {
      parameter.setValueAtTime(normalized, this.context.currentTime);
    }
  }

  /**
   * Validates and stages an editor snapshot without touching browser audio.
   * The editor accepts any cycle supported by the shared configuration
   * validator; firing angles remain bounded by that active cycle.
   */
  stageConfig(input: unknown): ConfigStageResult {
    const recoveringRejectedConfig =
      this.snapshot.status === "error" &&
      this.snapshot.error?.code === "config-rejected" &&
      this.context === null &&
      this.node === null &&
      this.fadeGain === null &&
      this.volumeGain === null;
    if (this.snapshot.status !== "idle" && !recoveringRejectedConfig) {
      return { ok: false, reason: "audio-active" };
    }
    const parsed = parseEngineConfig(input, { maxCylinders: 4 });
    if (!parsed.ok) {
      return { ok: false, reason: "validation", issues: parsed.issues };
    }
    // parseEngineConfig constructs a new typed object, so this is detached
    // from the caller's untrusted object before it becomes observable state.
    this.pendingConfig = parsed.value;
    this.setSnapshot({
      ...(recoveringRejectedConfig ? { status: "idle", error: null } : {}),
      pendingConfig: this.pendingConfig,
    });
    return { ok: true, value: this.pendingConfig };
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
    const transition = transitionAudioLifecycle(
      this.snapshot.status,
      "start-requested",
    );
    if (!transition.accepted) return;
    this.setSnapshot({ status: transition.status, error: null });

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
        this.scheduleFade(this.fadeGain, this.context.currentTime, 0, 1);
        if (this.processorReady) {
          const readyTransition = transitionAudioLifecycle(
            this.snapshot.status,
            "processor-ready",
          );
          if (readyTransition.accepted) {
            this.setSnapshot({ status: readyTransition.status, error: null });
          }
        }
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
        this.failDisplayable(
          toDisplayableAudioError({ type: "worklet-load-failed" }),
        );
        await this.teardown();
        return;
      }
      if (this.disposed || this.stopRequested) {
        await this.teardown();
        return;
      }

      const requestId = String(++this.requestId);
      const configToApply = this.pendingConfig ?? this.activeConfig;
      const config: EngineAudioConfig = {
        version: 1,
        snapshot: configToApply,
      };
      const node = new AudioWorkletNode(context, ENGINE_AUDIO_PROCESSOR_NAME, {
        processorOptions: { requestId, config },
      });
      const fadeGain = context.createGain();
      const volumeGain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = VISUALIZATION_FFT_SIZE;
      analyser.smoothingTimeConstant = VISUALIZATION_SMOOTHING_TIME_CONSTANT;
      analyser.minDecibels = VISUALIZATION_MIN_DECIBELS;
      analyser.maxDecibels = VISUALIZATION_MAX_DECIBELS;
      const visualizationSource: AudioVisualizationSource = {
        sampleRate: context.sampleRate,
        get fftSize() {
          return analyser.fftSize;
        },
        get frequencyBinCount() {
          return analyser.frequencyBinCount;
        },
        get minDecibels() {
          return analyser.minDecibels;
        },
        get maxDecibels() {
          return analyser.maxDecibels;
        },
        getByteTimeDomainData(destinationData) {
          analyser.getByteTimeDomainData(destinationData);
        },
        getByteFrequencyData(destinationData) {
          analyser.getByteFrequencyData(destinationData);
        },
      };
      this.node = node;
      this.fadeGain = fadeGain;
      this.volumeGain = volumeGain;
      this.analyser = analyser;
      this.visualizationSource = visualizationSource;
      this.processorReady = false;
      this.configApplied = false;
      this.activeRequestId = requestId;
      this.requestedConfig = configToApply;
      node.onprocessorerror = () => this.handleProcessorError();
      node.port.onmessage = (event) => this.handleProcessorMessage(node, event);
      node.parameters
        .get("gain")
        ?.setValueAtTime(REFERENCE_GAIN, context.currentTime);
      node.parameters
        .get("throttle")
        ?.setValueAtTime(this.snapshot.throttle, context.currentTime);
      node.parameters
        .get(ENGINE_AUDIO_LOAD_TORQUE_PARAM)
        ?.setValueAtTime(this.snapshot.loadTorqueNm, context.currentTime);
      fadeGain.gain.setValueAtTime(0, context.currentTime);
      this.applyVolume();
      node.connect(fadeGain).connect(volumeGain).connect(context.destination);
      // This is a tap, not part of the audible signal path. An AnalyserNode
      // does not need a destination connection to expose output data.
      volumeGain.connect(analyser);

      await context.resume();
      if (this.disposed || this.stopRequested) {
        await this.teardown();
        return;
      }
      // A hide may have happened while the module or graph was initializing.
      // Keep the fresh graph silent and suspend it before start can complete.
      if (this.visibilityHidden) await this.beginVisibilitySuspend();
      // Remain silent until this exact initialization request is acknowledged.
    } catch (error: unknown) {
      // Detach any partially constructed graph before publishing the error so
      // renderers cannot retain a stale visualization source.
      const teardown = this.teardown();
      this.fail(
        "start-failed",
        error instanceof Error ? error.message : "Audio could not be started.",
        true,
      );
      await teardown;
    }
  }

  private async stopInternal(): Promise<void> {
    const transition = transitionAudioLifecycle(
      this.snapshot.status,
      "stop-requested",
    );
    if (!transition.accepted) return;
    this.setSnapshot({ status: transition.status });
    const context = this.context;
    const fadeGain = this.fadeGain;
    if (context !== null && fadeGain !== null) {
      const heldValue = this.holdFade(fadeGain, context.currentTime);
      this.scheduleFade(fadeGain, context.currentTime, heldValue, 0);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, FADE_SECONDS * 1000),
      );
    }
    await this.teardown();
    if (!this.disposed) {
      const transition = transitionAudioLifecycle("stopping", "stopped");
      if (transition.accepted) {
        this.setSnapshot({ status: transition.status, error: null });
      }
    }
  }

  private async suspendForVisibility(
    context: AudioContext,
    fadeGain: GainNode,
  ): Promise<void> {
    const heldValue = this.holdFade(fadeGain, context.currentTime);
    this.scheduleFade(fadeGain, context.currentTime, heldValue, 0);
    await new Promise<void>((resolve) =>
      setTimeout(resolve, FADE_SECONDS * 1000),
    );
    // stop(), dispose(), or a processor failure may have detached this graph
    // while the fade timer was pending.
    if (
      this.disposed ||
      this.stopRequested ||
      this.context !== context ||
      this.fadeGain !== fadeGain
    ) {
      return;
    }
    try {
      await context.suspend();
    } catch {
      // A browser may close the context between the guard above and suspend.
      return;
    }
    if (this.context === context && context.state === "suspended") {
      this.markSuspended();
    }
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
    source: AudioWorkletNode,
    event: MessageEvent<ProcessorToControllerMessage>,
  ): void => {
    if (source !== this.node || this.disposed || this.stopRequested) return;
    const message = event.data;
    if (
      (message.type === "config-applied" ||
        message.type === "config-rejected" ||
        message.type === "ready") &&
      message.requestId !== this.activeRequestId
    ) {
      return;
    }
    if (message.type === "config-applied") {
      this.configApplied = true;
    } else if (message.type === "ready") {
      // A ready response alone is not evidence that the requested config was
      // accepted. In particular, ignore a reversed or stale handshake.
      if (!this.configApplied) return;
      this.processorReady = true;
      // A pending snapshot becomes active only after this node has confirmed
      // the exact initialization handshake in order.
      if (
        this.pendingConfig !== null &&
        this.requestedConfig === this.pendingConfig
      ) {
        this.activeConfig = this.pendingConfig;
        this.pendingConfig = null;
        this.setSnapshot({
          activeConfig: this.activeConfig,
          pendingConfig: null,
        });
      }
      if (
        this.snapshot.status === "starting" &&
        this.context &&
        this.fadeGain
      ) {
        const transition = transitionAudioLifecycle(
          this.snapshot.status,
          "processor-ready",
        );
        if (transition.accepted) {
          if (this.visibilityHidden) {
            void this.beginVisibilitySuspend();
          } else {
            this.setSnapshot({ status: transition.status, error: null });
            this.scheduleFade(this.fadeGain, this.context.currentTime, 0, 1);
          }
        }
      }
    } else if (message.type === "config-rejected") {
      // Begin detaching the failed graph before notifying listeners. A listener
      // may synchronously stage a corrected snapshot from the error state.
      const teardown = this.teardown();
      this.fail("config-rejected", message.message, true);
      void teardown;
    } else if (message.type === "telemetry") {
      if (
        Number.isFinite(message.rpm) &&
        Number.isFinite(message.effectiveThrottle)
      ) {
        this.setSnapshot({
          telemetry: {
            rpm: message.rpm,
            effectiveThrottle: message.effectiveThrottle,
            limiterActive: message.limiterActive,
          },
        });
      } else {
        this.fail(
          "fatal-error",
          "The audio processor reported invalid telemetry.",
          false,
        );
        void this.teardown();
      }
    } else if (message.type === "fatal-error") {
      this.fail("fatal-error", message.message, false);
      void this.teardown();
    }
  };

  private handleProcessorError(): void {
    this.failDisplayable(toDisplayableAudioError({ type: "processorerror" }));
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
      this.markSuspended();
    } else if (context.state === "closed") {
      this.fail("context-state-change", "The audio context was closed.", true);
      void this.teardown();
    }
  };

  private markSuspended(): void {
    const transition = transitionAudioLifecycle(
      this.snapshot.status,
      "context-suspended",
    );
    if (transition.accepted) this.setSnapshot({ status: transition.status });
  }

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

  private failDisplayable(error: AudioControllerError): void {
    this.setSnapshot({ status: "error", error });
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
    const analyser = this.analyser;
    this.context = null;
    this.node = null;
    this.fadeGain = null;
    this.volumeGain = null;
    this.analyser = null;
    this.visualizationSource = null;
    this.fadeState = null;
    this.processorReady = false;
    this.configApplied = false;
    this.activeRequestId = null;
    this.requestedConfig = null;
    if (node !== null) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.disconnect();
    }
    fadeGain?.disconnect();
    volumeGain?.disconnect();
    analyser?.disconnect();
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

  private scheduleFade(
    fadeGain: GainNode,
    startTime: number,
    from: number,
    to: number,
  ): void {
    fadeGain.gain.cancelScheduledValues(startTime);
    fadeGain.gain.setValueAtTime(from, startTime);
    fadeGain.gain.linearRampToValueAtTime(to, startTime + FADE_SECONDS);
    this.fadeState = {
      from,
      to,
      startTime,
      endTime: startTime + FADE_SECONDS,
    };
  }

  private holdFade(fadeGain: GainNode, time: number): number {
    const gain = fadeGain.gain;
    const holdingGain = gain as AudioParam & {
      cancelAndHoldAtTime?: (holdTime: number) => AudioParam;
    };
    const value = this.fadeValueAt(time);
    if (holdingGain.cancelAndHoldAtTime !== undefined) {
      holdingGain.cancelAndHoldAtTime(time);
    } else {
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(value, time);
    }
    return value;
  }

  private fadeValueAt(time: number): number {
    const fade = this.fadeState;
    if (fade === null || time >= fade.endTime) return fade?.to ?? 0;
    if (time <= fade.startTime) return fade.from;
    const progress = (time - fade.startTime) / (fade.endTime - fade.startTime);
    return fade.from + (fade.to - fade.from) * progress;
  }
}

/** Creates the browser-backed controller without creating an AudioContext yet. */
export function createBrowserAudioController(): AudioController {
  return new AudioController();
}
