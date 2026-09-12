import type {
  ControllerToProcessorMessage,
  ProcessorToControllerMessage,
} from "./contracts";
import { ENGINE_AUDIO_PROCESSOR_NAME } from "./contracts";

/**
 * A deliberately modest analytical reference signal. It establishes the
 * real-time output boundary without depending on recorded audio or on the
 * future combustion model.
 */
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

  private framesRendered = 0;
  private phase = 0;

  constructor() {
    super();
    this.port.onmessage = this.handleControllerMessage;

    const ready: ProcessorToControllerMessage = {
      type: "ready",
      sampleRate,
    };
    this.port.postMessage(ready);
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const frameCount = outputs.reduce(
      (largest, output) =>
        Math.max(
          largest,
          output.reduce((size, channel) => Math.max(size, channel.length), 0),
        ),
      0,
    );
    const gain = parameters.gain;

    for (let frame = 0; frame < frameCount; frame += 1) {
      // Keep the reference well below full scale. The second harmonic makes it
      // easy to distinguish from accidental silence while remaining finite.
      const reference =
        0.04 * (Math.sin(this.phase) + 0.25 * Math.sin(this.phase * 2));
      const requestedGain =
        gain === undefined ? 1 : (gain[Math.min(frame, gain.length - 1)] ?? 1);
      const sample = Number.isFinite(requestedGain)
        ? reference * Math.min(1, Math.max(0, requestedGain))
        : 0;

      for (const output of outputs) {
        for (const channel of output) {
          if (frame < channel.length) {
            channel[frame] = sample;
          }
        }
      }

      this.phase += (2 * Math.PI * 110) / sampleRate;
      if (this.phase >= 2 * Math.PI) {
        this.phase -= 2 * Math.PI;
      }
    }

    this.framesRendered += frameCount;

    return true;
  }

  private handleControllerMessage = (
    event: MessageEvent<ControllerToProcessorMessage>,
  ): void => {
    switch (event.data.type) {
      case "replace-config":
        // Reserved for the model replacement contract; no frame-time work here.
        return;
    }
  };
}

registerProcessor(ENGINE_AUDIO_PROCESSOR_NAME, EngineAudioProcessor);
