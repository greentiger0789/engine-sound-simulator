const HISTOGRAM_BUCKETS = 400;
const LOAD_RATIO_PER_BUCKET = 0.01;

function requirePositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

/**
 * Allocation-free timing accumulator for the production audio callback.
 * Callers supply elapsed wall-clock time so timing can also be tested without
 * reading a clock from the browser-independent DSP module.
 */
export class BlockBudgetMeter {
  private readonly histogram = new Uint32Array(HISTOGRAM_BUCKETS);
  private samples = 0;
  private lastBudgetMs = 0;
  private lastElapsedMs = 0;
  private maximumLoadRatio = 0;

  public record(elapsedMs: number, frames: number, sampleRate: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError("elapsedMs must be a finite non-negative number");
    }
    if (!Number.isSafeInteger(frames) || frames <= 0) {
      throw new RangeError("frames must be a positive safe integer");
    }
    requirePositiveFinite("sampleRate", sampleRate);
    const budgetMs = (frames / sampleRate) * 1_000;
    const loadRatio = elapsedMs / budgetMs;
    if (!Number.isFinite(budgetMs) || !Number.isFinite(loadRatio)) {
      throw new RangeError("block timing produced a non-finite value");
    }
    const bucket = Math.min(
      HISTOGRAM_BUCKETS - 1,
      Math.floor(loadRatio / LOAD_RATIO_PER_BUCKET),
    );
    this.histogram[bucket] += 1;
    this.samples += 1;
    this.lastBudgetMs = budgetMs;
    this.lastElapsedMs = elapsedMs;
    this.maximumLoadRatio = Math.max(this.maximumLoadRatio, loadRatio);
  }

  public getSampleCount(): number {
    return this.samples;
  }

  public getLastBudgetMs(): number {
    return this.lastBudgetMs;
  }

  public getLastElapsedMs(): number {
    return this.lastElapsedMs;
  }

  public getMaximumLoadRatio(): number {
    return this.maximumLoadRatio;
  }

  /** Upper edge of the fixed histogram bucket containing the 99th percentile. */
  public getP99LoadRatio(): number {
    if (this.samples === 0) return 0;
    const target = Math.ceil(this.samples * 0.99);
    let observed = 0;
    for (let bucket = 0; bucket < this.histogram.length; bucket += 1) {
      observed += this.histogram[bucket]!;
      if (observed >= target) return (bucket + 1) * LOAD_RATIO_PER_BUCKET;
    }
    return HISTOGRAM_BUCKETS * LOAD_RATIO_PER_BUCKET;
  }

  public reset(): void {
    this.histogram.fill(0);
    this.samples = 0;
    this.lastBudgetMs = 0;
    this.lastElapsedMs = 0;
    this.maximumLoadRatio = 0;
  }
}
