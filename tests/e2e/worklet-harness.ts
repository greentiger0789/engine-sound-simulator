import { loadEngineAudioWorklet } from "../../src/audio/load-worklet";
import { resolveEngineAudioWorkletModuleUrl } from "../../src/audio/worklet-module-url";
import { ENGINE_AUDIO_PROCESSOR_NAME } from "../../src/audio/worklets/contracts";

const startButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="start-worklet"]',
);
const status = document.querySelector<HTMLOutputElement>(
  '[data-testid="worklet-status"]',
);
const moduleUrlOutput = document.querySelector<HTMLOutputElement>(
  '[data-testid="module-url"]',
);

if (!startButton || !status || !moduleUrlOutput) {
  throw new Error("The worklet test harness is missing a required element.");
}

const configuredModuleUrl = new URLSearchParams(window.location.search).get(
  "moduleUrl",
);
const workletModuleUrl =
  configuredModuleUrl ??
  resolveEngineAudioWorkletModuleUrl(window.location.origin).href;

moduleUrlOutput.value = workletModuleUrl;

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.value = "loading";

  const context = new AudioContext();
  await context.resume();

  const loaded = await loadEngineAudioWorklet(context, workletModuleUrl);
  if (!loaded.ok) {
    const detail =
      loaded.error instanceof Error
        ? `${loaded.error.name}:${loaded.error.message}`
        : String(loaded.error);
    status.value = `error:${loaded.type}:${detail}`;
    await context.close();
    return;
  }

  const node = new AudioWorkletNode(context, ENGINE_AUDIO_PROCESSOR_NAME);
  node.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
    if (event.data.type === "ready") {
      status.value = "ready";
    }
  };
});
