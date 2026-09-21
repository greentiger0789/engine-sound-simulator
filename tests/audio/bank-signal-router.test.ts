import { describe, expect, it } from "vitest";

import { BankSignalRouter } from "../../src/audio/dsp/bank-signal-router";

const cylinders = [
  { bankId: "left" },
  { bankId: "right" },
  { bankId: "left" },
] as const;

describe("BankSignalRouter", () => {
  it("keeps first-seen bank order and routes coincident events by cylinder", () => {
    const router = new BankSignalRouter(cylinders, 8, 4);
    router.clear(4);
    router.routeEvents(
      Int32Array.from([1, 1, 3]),
      Float64Array.from([0.25, 0.5, 0]),
      Int32Array.from([0, 1, 2]),
      3,
    );

    expect(router.routes.map((route) => route.bankId)).toEqual([
      "left",
      "right",
    ]);
    expect(router.routes[0]!.eventCount).toBe(2);
    expect(router.routes[0]!.eventSampleIndices.slice(0, 2)).toEqual(
      Int32Array.from([1, 3]),
    );
    expect(router.routes[0]!.eventSampleOffsets.slice(0, 2)).toEqual(
      Float64Array.from([0.25, 0]),
    );
    expect(router.routes[1]!.eventCount).toBe(1);
    expect(router.routes[1]!.eventSampleIndices[0]).toBe(1);
    expect(router.routes[1]!.eventSampleOffsets[0]).toBe(0.5);
  });

  it("preserves the exact single-bank mono sum", () => {
    const router = new BankSignalRouter([{ bankId: "single" }], 8, 2);
    router.clear(4);
    router.routes[0]!.output.set([0.25, -0.5, 1, 0.125]);
    const mono = new Float32Array(4).fill(99);

    router.sumToMono(mono);

    expect(mono).toEqual(router.routes[0]!.output.subarray(0, 4));
  });

  it("clears active output and event counts between variable-sized blocks", () => {
    const router = new BankSignalRouter(cylinders, 8, 4);
    router.clear(6);
    router.routes[0]!.output[5] = 0.75;
    router.routeEvents(
      Int32Array.from([5]),
      Float64Array.from([0]),
      Int32Array.from([0]),
      1,
    );

    router.clear(3);

    expect(router.routes[0]!.eventCount).toBe(0);
    expect(router.routes[0]!.output.slice(0, 3)).toEqual(new Float32Array(3));
    expect(router.routes[0]!.output[5]).toBe(0.75);

    router.routes[0]!.output.set([1, 2, 3]);
    router.routes[1]!.output.set([0.5, 0.25, -1]);
    const mono = new Float32Array(8).fill(77);
    router.sumToMono(mono, 3);
    expect(mono.slice(0, 3)).toEqual(Float32Array.from([1.5, 2.25, 2]));
    expect(mono[3]).toBe(77);
  });

  it("rejects invalid cylinder indices and route-storage overflow atomically", () => {
    const router = new BankSignalRouter(cylinders, 4, 2);
    router.clear(4);
    router.routeEvents(
      Int32Array.from([0]),
      Float64Array.from([0]),
      Int32Array.from([0]),
      1,
    );
    const left = router.routes[0]!;

    expect(() =>
      router.routeEvents(
        Int32Array.from([1]),
        Float64Array.from([0]),
        Int32Array.from([99]),
        1,
      ),
    ).toThrow("event cylinder index is invalid");
    expect(left.eventCount).toBe(1);
    expect(left.eventSampleIndices[0]).toBe(0);

    expect(() =>
      router.routeEvents(
        Int32Array.from([1, 2]),
        Float64Array.from([0, 0]),
        Int32Array.from([0, 2]),
        2,
      ),
    ).toThrow("route event storage overflow");
    expect(left.eventCount).toBe(1);
    expect(left.eventSampleIndices[0]).toBe(0);
  });

  it("validates bounded construction and runtime inputs before changing state", () => {
    expect(() => new BankSignalRouter([], 8, 2)).toThrow(
      "at least one cylinder",
    );
    expect(() => new BankSignalRouter([{ bankId: "" }], 8, 2)).toThrow(
      "non-empty string",
    );
    const router = new BankSignalRouter(cylinders, 4, 2);
    router.clear(4);
    expect(() =>
      router.routeEvents(
        Int32Array.from([4]),
        Float64Array.from([0]),
        Int32Array.from([0]),
        1,
      ),
    ).toThrow("active block");
    expect(router.routes[0]!.eventCount).toBe(0);
    expect(() => router.sumToMono(new Float32Array(2), 3)).toThrow("output");
  });
});
