/** Small deterministic uint32 PRNG for reproducible procedural audio. */
export class SeededRandom {
  private readonly initialState: number;
  private state: number;

  public constructor(seed: number) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError("seed must be a uint32 safe integer");
    }
    this.initialState = seed >>> 0;
    this.state = this.initialState;
  }

  public reset(): void {
    this.state = this.initialState;
  }

  /** Returns a deterministic value in [-1, 1) without allocating. */
  public nextSigned(): number {
    // Mulberry32 accepts every uint32 state, including zero.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    value = (value ^ (value >>> 14)) >>> 0;
    return value / 0x8000_0000 - 1;
  }
}
