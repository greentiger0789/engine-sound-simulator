export interface BankSignalRouterCylinder {
  readonly bankId: string;
}

/**
 * A stable, caller-visible bank bus. Its buffers are deliberately owned by
 * the router so a future bank processor can render directly into `output`.
 */
export interface BankSignalRoute {
  readonly bankId: string;
  readonly output: Float32Array;
  readonly eventSampleIndices: Int32Array;
  readonly eventSampleOffsets: Float64Array;
  readonly eventCount: number;
}

class Route implements BankSignalRoute {
  public eventCount = 0;

  public readonly output: Float32Array;
  public readonly eventSampleIndices: Int32Array;
  public readonly eventSampleOffsets: Float64Array;

  public constructor(
    public readonly bankId: string,
    maxFrames: number,
    maxEvents: number,
  ) {
    this.output = new Float32Array(maxFrames);
    this.eventSampleIndices = new Int32Array(maxEvents);
    this.eventSampleOffsets = new Float64Array(maxEvents);
  }
}

/**
 * Bounded, allocation-free routing from cylinder firing events to bank buses.
 * Call `clear()` before rendering a block, then `routeEvents()`, then render
 * each route and call `sumToMono()`.
 */
export class BankSignalRouter {
  public readonly routes: readonly BankSignalRoute[];

  private readonly cylinderRoutes: Int32Array;
  private readonly routeStorage: readonly Route[];
  private readonly routeEventScratch: Int32Array;
  private activeFrames = 0;

  public constructor(
    cylinders: readonly BankSignalRouterCylinder[],
    private readonly maxFrames: number,
    private readonly maxEvents: number,
  ) {
    if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) {
      throw new RangeError("maxFrames must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) {
      throw new RangeError("maxEvents must be a positive safe integer");
    }
    if (cylinders.length === 0) {
      throw new RangeError("at least one cylinder is required");
    }

    const routeList: Route[] = [];
    this.cylinderRoutes = new Int32Array(cylinders.length);
    for (
      let cylinderIndex = 0;
      cylinderIndex < cylinders.length;
      cylinderIndex += 1
    ) {
      const bankId = cylinders[cylinderIndex]?.bankId;
      if (typeof bankId !== "string" || bankId.length === 0) {
        throw new TypeError("cylinder bankId must be a non-empty string");
      }
      let routeIndex = -1;
      for (let index = 0; index < routeList.length; index += 1) {
        if (routeList[index]?.bankId === bankId) {
          routeIndex = index;
          break;
        }
      }
      if (routeIndex === -1) {
        routeIndex = routeList.length;
        routeList.push(new Route(bankId, maxFrames, maxEvents));
      }
      this.cylinderRoutes[cylinderIndex] = routeIndex;
    }
    this.routeStorage = routeList;
    this.routes = routeList;
    this.routeEventScratch = new Int32Array(routeList.length);
  }

  /** Clears only frames active in the current block and resets route counts. */
  public clear(frameCount: number): void {
    this.assertFrameCount(frameCount);
    for (let index = 0; index < this.routeStorage.length; index += 1) {
      const route = this.routeStorage[index]!;
      route.output.fill(0, 0, frameCount);
      route.eventCount = 0;
    }
    this.activeFrames = frameCount;
  }

  /**
   * Routes caller-owned event storage. Inputs are completely validated before
   * any route count or event storage is changed, so rejection is atomic.
   */
  public routeEvents(
    eventSampleIndices: Int32Array,
    eventSampleOffsets: Float64Array,
    eventCylinderIndices: Int32Array,
    eventCount: number,
  ): void {
    if (
      !Number.isSafeInteger(eventCount) ||
      eventCount < 0 ||
      eventCount > this.maxEvents ||
      eventCount > eventSampleIndices.length ||
      eventCount > eventSampleOffsets.length ||
      eventCount > eventCylinderIndices.length
    ) {
      throw new RangeError("event storage must contain a bounded event count");
    }

    this.routeEventScratch.fill(0);
    // Validate first: a bad event must not leave a partly routed block.
    for (let index = 0; index < eventCount; index += 1) {
      const sampleIndex = eventSampleIndices[index]!;
      const sampleOffset = eventSampleOffsets[index]!;
      const cylinderIndex = eventCylinderIndices[index]!;
      if (
        !Number.isSafeInteger(sampleIndex) ||
        sampleIndex < 0 ||
        sampleIndex >= this.activeFrames
      ) {
        throw new RangeError("event sample index must fit the active block");
      }
      if (
        !Number.isFinite(sampleOffset) ||
        sampleOffset < 0 ||
        sampleOffset >= 1
      ) {
        throw new RangeError("event sample offset must be in [0, 1)");
      }
      if (
        !Number.isSafeInteger(cylinderIndex) ||
        cylinderIndex < 0 ||
        cylinderIndex >= this.cylinderRoutes.length
      ) {
        throw new RangeError("event cylinder index is invalid");
      }
      const routeIndex = this.cylinderRoutes[cylinderIndex]!;
      const needed =
        this.routeStorage[routeIndex]!.eventCount +
        this.routeEventScratch[routeIndex]! +
        1;
      if (needed > this.maxEvents) {
        throw new RangeError("route event storage overflow");
      }
      this.routeEventScratch[routeIndex] += 1;
    }

    // No route can overflow: each route has maxEvents slots and eventCount is
    // bounded by maxEvents. This loop itself performs no allocation.
    for (let index = 0; index < eventCount; index += 1) {
      const route =
        this.routeStorage[this.cylinderRoutes[eventCylinderIndices[index]!]!]!;
      const routeEventIndex = route.eventCount;
      route.eventSampleIndices[routeEventIndex] = eventSampleIndices[index]!;
      route.eventSampleOffsets[routeEventIndex] = eventSampleOffsets[index]!;
      route.eventCount = routeEventIndex + 1;
    }
  }

  /** Overwrites a caller-owned mono bus with the sum of active route output. */
  public sumToMono(output: Float32Array, frameCount = this.activeFrames): void {
    this.assertFrameCount(frameCount);
    if (output.length < frameCount) {
      throw new RangeError("output must contain the requested frame count");
    }
    output.fill(0, 0, frameCount);
    for (
      let routeIndex = 0;
      routeIndex < this.routeStorage.length;
      routeIndex += 1
    ) {
      const routeOutput = this.routeStorage[routeIndex]!.output;
      for (let frame = 0; frame < frameCount; frame += 1) {
        output[frame] += routeOutput[frame]!;
      }
    }
  }

  private assertFrameCount(frameCount: number): void {
    if (
      !Number.isSafeInteger(frameCount) ||
      frameCount < 0 ||
      frameCount > this.maxFrames
    ) {
      throw new RangeError("frameCount must be within router capacity");
    }
  }
}
