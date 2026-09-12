/**
 * Browser-independent lifecycle rules for the audio controller.
 *
 * The controller owns asynchronous Web Audio work, while this module makes
 * the observable state changes and user-facing failures deterministic.
 */
export type AudioLifecycleStatus =
  "idle" | "starting" | "running" | "stopping" | "suspended" | "error";

export type AudioLifecycleEvent =
  "start-requested" | "processor-ready" | "stop-requested" | "stopped";

export type RejectedAudioLifecycleTransitionReason =
  "start-already-active" | "invalid-transition";

export type AudioLifecycleTransition =
  | {
      readonly accepted: true;
      readonly status: AudioLifecycleStatus;
    }
  | {
      readonly accepted: false;
      /** The unchanged state; callers must treat rejected transitions as no-ops. */
      readonly status: AudioLifecycleStatus;
      readonly reason: RejectedAudioLifecycleTransitionReason;
    };

/**
 * Applies one lifecycle event. A second start is deliberately rejected rather
 * than starting another AudioContext or AudioWorkletNode.
 */
export function transitionAudioLifecycle(
  status: AudioLifecycleStatus,
  event: AudioLifecycleEvent,
): AudioLifecycleTransition {
  if (
    event === "start-requested" &&
    (status === "starting" || status === "running")
  ) {
    return { accepted: false, status, reason: "start-already-active" };
  }

  const nextStatus = getNextStatus(status, event);
  if (nextStatus === null) {
    return { accepted: false, status, reason: "invalid-transition" };
  }
  return { accepted: true, status: nextStatus };
}

function getNextStatus(
  status: AudioLifecycleStatus,
  event: AudioLifecycleEvent,
): AudioLifecycleStatus | null {
  if (
    (status === "idle" || status === "suspended" || status === "error") &&
    event === "start-requested"
  )
    return "starting";
  if (status === "starting" && event === "processor-ready") return "running";
  if (
    (status === "starting" || status === "running" || status === "suspended") &&
    event === "stop-requested"
  )
    return "stopping";
  if (status === "stopping" && event === "stopped") return "idle";
  return null;
}

export type AudioLifecycleFailure =
  | { readonly type: "processorerror" }
  | { readonly type: "worklet-load-failed" };

export type DisplayableAudioError =
  | {
      readonly code: "processor-error";
      readonly message: "The audio processor stopped unexpectedly.";
      readonly recoverable: true;
    }
  | {
      readonly code: "worklet-load-failed";
      readonly message: "The audio processor could not be loaded.";
      readonly recoverable: true;
    };

/** Converts browser/loader failure signals into stable UI-facing text. */
export function toDisplayableAudioError(
  failure: AudioLifecycleFailure,
): DisplayableAudioError {
  switch (failure.type) {
    case "processorerror":
      return {
        code: "processor-error",
        message: "The audio processor stopped unexpectedly.",
        recoverable: true,
      };
    case "worklet-load-failed":
      return {
        code: "worklet-load-failed",
        message: "The audio processor could not be loaded.",
        recoverable: true,
      };
  }
}
