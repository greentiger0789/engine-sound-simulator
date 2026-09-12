/**
 * Messages sent from the main-thread controller to the audio processor.
 *
 * Configuration replacement is intentionally reserved for the engine model
 * ticket. Continuous controls belong to AudioParams, not this channel.
 */
/** The stable name used by the main thread when it creates AudioWorkletNode. */
export const ENGINE_AUDIO_PROCESSOR_NAME = "engine-audio-processor";

export type ControllerToProcessorMessage = ReplaceConfigMessage;

export interface ReplaceConfigMessage {
  readonly type: "replace-config";
  readonly config: EngineAudioConfig;
}

/** A deliberately opaque configuration boundary until the engine model exists. */
export interface EngineAudioConfig {
  readonly version: number;
}

/** Messages sent from the processor to the main-thread controller. */
export type ProcessorToControllerMessage =
  ReadyMessage | TelemetryMessage | FatalErrorMessage;

export interface ReadyMessage {
  readonly type: "ready";
  readonly sampleRate: number;
}

export interface TelemetryMessage {
  readonly type: "telemetry";
  readonly framesRendered: number;
}

export interface FatalErrorMessage {
  readonly type: "fatal-error";
  readonly message: string;
}
