const developmentWorkletPath = "src/audio/worklets/engine-audio-processor.ts";
const productionWorkletPath = "assets/engine-audio-worklet.js";

/** Resolves the independently served Worklet entry for the active Vite mode. */
export function resolveEngineAudioWorkletModuleUrl(
  origin: string | URL = globalThis.location.origin,
): URL {
  const workletPath = import.meta.env.DEV
    ? developmentWorkletPath
    : productionWorkletPath;

  return new URL(`${import.meta.env.BASE_URL}${workletPath}`, origin);
}
