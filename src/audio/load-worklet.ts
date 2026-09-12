/** The minimum AudioContext surface the loader needs. */
export interface AudioContextLike {
  readonly audioWorklet: {
    addModule(moduleUrl: string | URL): Promise<void>;
  };
}

export type LoadWorkletResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly type: "worklet-load-failed";
      readonly error: unknown;
    };

/**
 * Installs a worklet in an already-owned context. Lifecycle stays with the
 * caller: this function never creates, resumes, suspends, or closes a context.
 */
export async function loadEngineAudioWorklet(
  context: AudioContextLike,
  moduleUrl: string | URL,
): Promise<LoadWorkletResult> {
  try {
    await context.audioWorklet.addModule(moduleUrl);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, type: "worklet-load-failed", error };
  }
}
