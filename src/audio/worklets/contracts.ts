import type { EngineConfig } from "../../engine/config";
import type { DrivetrainConfig } from "../../engine/drivetrain";

/** The stable name used by the main thread when it creates AudioWorkletNode. */
export const ENGINE_AUDIO_PROCESSOR_NAME = "engine-audio-processor";

/** Shared AudioParam contract for the simple dynamometer load. */
export const ENGINE_AUDIO_LOAD_TORQUE_PARAM = "loadTorqueNm";
export const MAX_LOAD_TORQUE_NM = 40;
export const ENGINE_AUDIO_CLUTCH_PARAM = "clutch";

/** A versioned, structured-cloneable engine snapshot crossing into the worklet. */
export interface EngineAudioConfig {
  readonly version: number;
  readonly snapshot: EngineConfig;
  readonly drivetrain?: DrivetrainConfig;
  readonly drivetrainGear?: number;
}

/** A request identity prevents delayed replies from an older node starting audio. */
export interface EngineConfigRequest {
  readonly requestId: string;
  readonly config: EngineAudioConfig;
}

/** Passed as `AudioWorkletNodeOptions.processorOptions` when a node is created. */
export type EngineAudioProcessorOptions = EngineConfigRequest;

export type ControllerToProcessorMessage =
  ReplaceConfigMessage | SetDrivetrainGearMessage;

export interface SetDrivetrainGearMessage {
  readonly type: "set-drivetrain-gear";
  readonly gear: number;
}

export interface ReplaceConfigMessage extends EngineConfigRequest {
  readonly type: "replace-config";
}

export type ProcessorToControllerMessage =
  | ConfigAppliedMessage
  | ConfigRejectedMessage
  | ReadyMessage
  | TelemetryMessage
  | FatalErrorMessage;

export interface ConfigAppliedMessage {
  readonly type: "config-applied";
  readonly requestId: string;
}

export interface ConfigRejectedMessage {
  readonly type: "config-rejected";
  readonly requestId: string;
  readonly message: string;
}

export interface ReadyMessage {
  readonly type: "ready";
  readonly requestId: string;
  readonly sampleRate: number;
}

export interface TelemetryMessage {
  readonly type: "telemetry";
  readonly framesRendered: number;
  readonly rpm: number;
  readonly effectiveThrottle: number;
  readonly limiterActive: boolean;
  readonly vehicleSpeedMps?: number;
  readonly drivetrainGear?: number;
  readonly clutch?: number;
}

export interface FatalErrorMessage {
  readonly type: "fatal-error";
  readonly message: string;
}
