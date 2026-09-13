import { SingleCylinderPulseDsp } from "../dsp/single-cylinder-pulse";
import { parseEngineConfig, type EngineConfig } from "../../engine/config";
import { RotationalDynamics } from "../../engine/dynamics";
import { FiringEventGenerator } from "../../engine/events";
import type {
  ControllerToProcessorMessage,
  EngineAudioConfig,
  EngineAudioProcessorOptions,
  ProcessorToControllerMessage,
} from "./contracts";
import { ENGINE_AUDIO_PROCESSOR_NAME } from "./contracts";

const TELEMETRY_HZ = 30;
const LIMITER_ENGAGE_RATIO = 0.985;
const LIMITER_RELEASE_RATIO = 0.965;
const MAX_BLOCK_FRAMES = 4_096;
const MAX_EVENTS_PER_BLOCK = 512;

interface EngineRuntime {
  readonly config: EngineConfig;
  readonly dynamics: RotationalDynamics;
  readonly events: FiringEventGenerator;
  readonly dsp: SingleCylinderPulseDsp;
}

function finiteUnit(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be finite and in [0, 1]`);
  }
  return value;
}

/** Audio-time integration of a validated one-to-four-cylinder snapshot. */
export class EngineAudioProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "throttle",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate" as const,
      },
      {
        name: "gain",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate" as const,
      },
    ];
  }

  private runtime: EngineRuntime | null = null;
  private framesRendered = 0;
  private telemetryFrameRemainder = 0;
  private limiterActive = false;
  private faulted = false;
  private readonly angularVelocity = new Float64Array(MAX_BLOCK_FRAMES);
  private readonly effectiveThrottle = new Float64Array(MAX_BLOCK_FRAMES);
  private readonly limiterMask = new Uint8Array(MAX_BLOCK_FRAMES);
  private readonly rendered = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly eventSampleIndices = new Int32Array(MAX_EVENTS_PER_BLOCK);
  private readonly eventSampleOffsets = new Float64Array(MAX_EVENTS_PER_BLOCK);

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.port.onmessage = this.handleControllerMessage;
    const initial = (options?.processorOptions ?? undefined) as
      EngineAudioProcessorOptions | undefined;
    if (initial !== undefined)
      this.applyConfig(initial.requestId, initial.config);
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const frameCount = this.frameCount(outputs);
    this.zeroOutputs(outputs);
    if (this.faulted || this.runtime === null || frameCount === 0) return true;
    if (frameCount > MAX_BLOCK_FRAMES) {
      this.fatal("audio block exceeds supported frame capacity");
      return true;
    }
    try {
      const throttle = parameters.throttle;
      const gain = parameters.gain;
      const runtime = this.runtime;
      const blockStartFrame = this.framesRendered;
      for (let frame = 0; frame < frameCount; frame += 1) {
        runtime.dynamics.setThrottle(
          this.paramAt("throttle", throttle, frame, 0),
        );
        runtime.dynamics.advanceRealtimeFrame(sampleRate);
        const rpm = runtime.dynamics.getRpm();
        this.angularVelocity[frame] =
          runtime.dynamics.getAngularVelocityRadPerSec();
        this.effectiveThrottle[frame] = runtime.dynamics.getEffectiveThrottle();
        // The mask intentionally uses the state that drove this 1 kHz step.
        // A threshold crossing changes both torque and event permission for
        // the following sample, never cutting a pulse one sample before its
        // corresponding torque decision.
        this.limiterMask[frame] = this.limiterActive ? 1 : 0;
        this.updateLimiter(runtime, rpm);
        this.telemetryFrameRemainder += 1;
        const telemetryIntervalFrames = sampleRate / TELEMETRY_HZ;
        if (this.telemetryFrameRemainder >= telemetryIntervalFrames) {
          this.telemetryFrameRemainder -= telemetryIntervalFrames;
          this.postTelemetry(
            blockStartFrame + frame + 1,
            rpm,
            this.effectiveThrottle[frame]!,
          );
        }
      }
      let eventCount = runtime.events.advanceRealtime(
        this.angularVelocity,
        frameCount,
        sampleRate,
        blockStartFrame,
        this.eventSampleIndices,
        this.eventSampleOffsets,
      );
      eventCount = this.removeLimitedEvents(eventCount);
      runtime.dsp.processRealtime(
        this.rendered,
        frameCount,
        this.eventSampleIndices,
        this.eventSampleOffsets,
        eventCount,
        this.effectiveThrottle,
      );
      if (runtime.dsp.isFaulted()) throw new RangeError("DSP fault");
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sample =
          this.rendered[frame]! * this.paramAt("gain", gain, frame, 1);
        if (!Number.isFinite(sample)) throw new RangeError("non-finite output");
        for (let busIndex = 0; busIndex < outputs.length; busIndex += 1) {
          const bus = outputs[busIndex]!;
          for (
            let channelIndex = 0;
            channelIndex < bus.length;
            channelIndex += 1
          ) {
            const channel = bus[channelIndex]!;
            if (frame < channel.length) channel[frame] = sample;
          }
        }
      }
      this.framesRendered = blockStartFrame + frameCount;
    } catch (error: unknown) {
      this.zeroOutputs(outputs);
      this.fatal(
        error instanceof Error ? error.message : "engine processor fault",
      );
    }
    return true;
  }

  private applyConfig(requestId: string, config: EngineAudioConfig): void {
    try {
      if (typeof requestId !== "string" || requestId.length === 0)
        throw new RangeError("requestId must be a non-empty string");
      if (!Number.isSafeInteger(config?.version) || config.version < 1)
        throw new RangeError("config version must be a positive safe integer");
      const parsed = parseEngineConfig(config.snapshot, { maxCylinders: 4 });
      if (!parsed.ok)
        throw new RangeError(
          parsed.issues
            .map((issue) => `${issue.path} ${issue.message}`)
            .join("; "),
        );
      const snapshot = parsed.value;
      this.runtime = {
        config: snapshot,
        dynamics: new RotationalDynamics(snapshot),
        events: new FiringEventGenerator({
          cycleDegrees: snapshot.cycleDegrees,
          cylinders: snapshot.cylinders,
        }),
        dsp: new SingleCylinderPulseDsp({ sampleRate }),
      };
      this.framesRendered = 0;
      this.telemetryFrameRemainder = 0;
      this.limiterActive = false;
      this.faulted = false;
      this.port.postMessage({
        type: "config-applied",
        requestId,
      } satisfies ProcessorToControllerMessage);
      this.port.postMessage({
        type: "ready",
        requestId,
        sampleRate,
      } satisfies ProcessorToControllerMessage);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "configuration rejected";
      this.port.postMessage({
        type: "config-rejected",
        requestId,
        message,
      } satisfies ProcessorToControllerMessage);
    }
  }

  private updateLimiter(runtime: EngineRuntime, rpm: number): void {
    // One hysteretic state gates both the next 1 kHz drive-torque step and
    // the following sample's events. Idle assist deliberately remains available.
    if (
      this.limiterActive
        ? rpm <= runtime.config.redlineRpm * LIMITER_RELEASE_RATIO
        : rpm >= runtime.config.redlineRpm * LIMITER_ENGAGE_RATIO
    )
      this.limiterActive = !this.limiterActive;
    runtime.dynamics.setDriveTorqueMultiplier(this.limiterActive ? 0 : 1);
  }

  private removeLimitedEvents(eventCount: number): number {
    let write = 0;
    for (let index = 0; index < eventCount; index += 1) {
      if (this.limiterMask[this.eventSampleIndices[index]!] === 0) {
        this.eventSampleIndices[write] = this.eventSampleIndices[index]!;
        this.eventSampleOffsets[write] = this.eventSampleOffsets[index]!;
        write += 1;
      }
    }
    return write;
  }

  private paramAt(
    name: string,
    values: Float32Array | undefined,
    frame: number,
    fallback: number,
  ): number {
    if (values === undefined || values.length === 0) return fallback;
    return finiteUnit(
      name,
      values[values.length === 1 ? 0 : frame] ?? fallback,
    );
  }

  private postTelemetry(
    framesRendered: number,
    rpm: number,
    effectiveThrottle: number,
  ): void {
    if (!Number.isFinite(rpm) || !Number.isFinite(effectiveThrottle))
      throw new RangeError("non-finite telemetry");
    this.port.postMessage({
      type: "telemetry",
      framesRendered,
      rpm,
      effectiveThrottle,
      limiterActive: this.limiterActive,
    } satisfies ProcessorToControllerMessage);
  }

  private fatal(message: string): void {
    if (this.faulted) return;
    this.faulted = true;
    this.port.postMessage({
      type: "fatal-error",
      message,
    } satisfies ProcessorToControllerMessage);
  }

  private frameCount(outputs: Float32Array[][]): number {
    let largest = 0;
    for (let busIndex = 0; busIndex < outputs.length; busIndex += 1) {
      const bus = outputs[busIndex]!;
      for (let channelIndex = 0; channelIndex < bus.length; channelIndex += 1) {
        largest = Math.max(largest, bus[channelIndex]!.length);
      }
    }
    return largest;
  }

  private zeroOutputs(outputs: Float32Array[][]): void {
    for (let busIndex = 0; busIndex < outputs.length; busIndex += 1) {
      const bus = outputs[busIndex]!;
      for (let channelIndex = 0; channelIndex < bus.length; channelIndex += 1) {
        bus[channelIndex]!.fill(0);
      }
    }
  }

  private handleControllerMessage = (
    event: MessageEvent<ControllerToProcessorMessage>,
  ): void => {
    if (event.data.type === "replace-config")
      this.applyConfig(event.data.requestId, event.data.config);
  };
}

registerProcessor(ENGINE_AUDIO_PROCESSOR_NAME, EngineAudioProcessor);
