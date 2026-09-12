/**
 * AudioWorkletGlobalScope declarations are not included in TypeScript's DOM
 * library. This file is type-only and is not part of the emitted worklet.
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

declare const sampleRate: number;

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;
