import type {
  ControllerToProcessorMessage,
  ProcessorToControllerMessage,
} from "./contracts";
import { ENGINE_AUDIO_PROCESSOR_NAME } from "./contracts";

/**
 * Minimal worklet for establishing the real-time boundary. It deliberately
 * produces silence until the synthesis tickets supply combustion events.
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

  constructor() {
    super();
    this.port.onmessage = this.handleControllerMessage;

    const ready: ProcessorToControllerMessage = {
      type: "ready",
      sampleRate,
    };
    this.port.postMessage(ready);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (let outputIndex = 0; outputIndex < outputs.length; outputIndex += 1) {
      const output = outputs[outputIndex];
      for (
        let channelIndex = 0;
        channelIndex < output.length;
        channelIndex += 1
      ) {
        const channel = output[channelIndex];
        channel.fill(0);
        this.framesRendered += channel.length;
      }
    }

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
