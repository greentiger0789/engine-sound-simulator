import { describe, expect, it } from "vitest";

import {
  toDisplayableAudioError,
  transitionAudioLifecycle,
  type AudioLifecycleStatus,
} from "../../src/audio/lifecycle";

describe("transitionAudioLifecycle", () => {
  it("follows the complete normal start and stop lifecycle", () => {
    const events = [
      "start-requested",
      "processor-ready",
      "stop-requested",
      "stopped",
    ] as const;
    let status: AudioLifecycleStatus = "idle";

    for (const event of events) {
      const transition = transitionAudioLifecycle(status, event);
      expect(transition.accepted).toBe(true);
      if (!transition.accepted) {
        throw new Error("expected an accepted transition");
      }
      status = transition.status;
    }

    expect(status).toBe("idle");
  });

  it("rejects a second start as a no-op both while starting and while running", () => {
    expect(transitionAudioLifecycle("starting", "start-requested")).toEqual({
      accepted: false,
      status: "starting",
      reason: "start-already-active",
    });
    expect(transitionAudioLifecycle("running", "start-requested")).toEqual({
      accepted: false,
      status: "running",
      reason: "start-already-active",
    });
  });

  it("does not skip required lifecycle acknowledgements", () => {
    expect(transitionAudioLifecycle("idle", "processor-ready")).toEqual({
      accepted: false,
      status: "idle",
      reason: "invalid-transition",
    });
    expect(transitionAudioLifecycle("starting", "stopped")).toEqual({
      accepted: false,
      status: "starting",
      reason: "invalid-transition",
    });
  });

  it("allows interruption and recovery paths used by the controller", () => {
    expect(transitionAudioLifecycle("starting", "stop-requested")).toEqual({
      accepted: true,
      status: "stopping",
    });
    expect(transitionAudioLifecycle("suspended", "start-requested")).toEqual({
      accepted: true,
      status: "starting",
    });
    expect(transitionAudioLifecycle("error", "start-requested")).toEqual({
      accepted: true,
      status: "starting",
    });
    expect(transitionAudioLifecycle("error", "stop-requested")).toEqual({
      accepted: true,
      status: "stopping",
    });
  });
});

describe("toDisplayableAudioError", () => {
  it("maps processorerror to a recoverable, displayable processor failure", () => {
    expect(toDisplayableAudioError({ type: "processorerror" })).toEqual({
      code: "processor-error",
      message: "The audio processor stopped unexpectedly.",
      recoverable: true,
    });
  });

  it("maps a module-load failure without mislabelling it as a processor failure", () => {
    expect(toDisplayableAudioError({ type: "worklet-load-failed" })).toEqual({
      code: "worklet-load-failed",
      message: "The audio processor could not be loaded.",
      recoverable: true,
    });
  });
});
