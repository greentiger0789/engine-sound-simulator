import { expect, test, type Locator, type Page } from "@playwright/test";

type WorkletServer = "dev" | "web";

function workletServer(): WorkletServer {
  return test.info().project.name as WorkletServer;
}

function harnessUrl(server: WorkletServer, query = ""): string {
  const path =
    server === "dev"
      ? "/tests/e2e/worklet-harness.html"
      : "/__e2e__/tests/e2e/worklet-harness.html";
  return `${path}${query}`;
}

interface AudioGraphInstrumentation {
  readonly failWorkletLoads?: number;
  /** Make a specific native worklet initialization reject its supplied config. */
  readonly rejectProcessorConfigOnAttempt?: number;
}

/**
 * Count graphs and, when requested, inject a failure at the browser API edge.
 * The app still owns the controller and its UI state; this only gives the
 * browser test a deterministic way to cover failure-only Web Audio events.
 */
async function instrumentAudioGraph(
  page: Page,
  {
    failWorkletLoads = 0,
    rejectProcessorConfigOnAttempt,
  }: AudioGraphInstrumentation = {},
): Promise<void> {
  await page.addInitScript(
    ({ failuresBeforeSuccess, processorConfigRejectAttempt }) => {
      const trackedWindow = window as typeof window & {
        __e2eAudioContextCount?: number;
        __e2eAudioContextSuspendCount?: number;
        __e2eAudioWorkletNodeCount?: number;
        __e2eWorkletLoadCount?: number;
        __e2eAudioWorkletNodes?: AudioWorkletNode[];
        __e2eAppMountCount?: number;
        __e2eAppCleanupCount?: number;
        __e2eProcessorConfigMutationCount?: number;
        __e2eStaleProcessorMessage?: ((event: MessageEvent) => void) | null;
        __e2eAnalyserDisconnectCount?: number;
        __e2eTimeDomainReadCount?: number;
        __e2eFrequencyReadCount?: number;
        __e2eObservedWaveformSignal?: number;
        __e2eObservedSpectrumSignal?: number;
        __e2eVisibilityListenerAddCount?: number;
        __e2eVisibilityListenerRemoveCount?: number;
        __e2eVisibilityListenerActiveCount?: number;
      };
      trackedWindow.__e2eAudioContextCount = 0;
      trackedWindow.__e2eAudioContextSuspendCount = 0;
      trackedWindow.__e2eAudioWorkletNodeCount = 0;
      trackedWindow.__e2eWorkletLoadCount = 0;
      trackedWindow.__e2eAudioWorkletNodes = [];
      trackedWindow.__e2eAppMountCount = 0;
      trackedWindow.__e2eAppCleanupCount = 0;
      trackedWindow.__e2eProcessorConfigMutationCount = 0;
      trackedWindow.__e2eStaleProcessorMessage = null;
      trackedWindow.__e2eAnalyserDisconnectCount = 0;
      trackedWindow.__e2eTimeDomainReadCount = 0;
      trackedWindow.__e2eFrequencyReadCount = 0;
      trackedWindow.__e2eObservedWaveformSignal = 0;
      trackedWindow.__e2eObservedSpectrumSignal = 0;
      trackedWindow.__e2eVisibilityListenerAddCount = 0;
      trackedWindow.__e2eVisibilityListenerRemoveCount = 0;
      trackedWindow.__e2eVisibilityListenerActiveCount = 0;

      const nativeDocumentAddEventListener = document.addEventListener;
      const nativeDocumentRemoveEventListener = document.removeEventListener;
      const visibilityListeners = new Map<
        EventListenerOrEventListenerObject,
        Set<boolean>
      >();
      const captureValue = (
        options?: boolean | AddEventListenerOptions | EventListenerOptions,
      ) =>
        typeof options === "boolean" ? options : (options?.capture ?? false);
      document.addEventListener = function (
        this: Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === "visibilitychange") {
          const capture = captureValue(options);
          const registrations = visibilityListeners.get(listener) ?? new Set();
          if (!registrations.has(capture)) {
            registrations.add(capture);
            visibilityListeners.set(listener, registrations);
            trackedWindow.__e2eVisibilityListenerAddCount =
              (trackedWindow.__e2eVisibilityListenerAddCount ?? 0) + 1;
            trackedWindow.__e2eVisibilityListenerActiveCount =
              (trackedWindow.__e2eVisibilityListenerActiveCount ?? 0) + 1;
          }
        }
        return nativeDocumentAddEventListener.call(
          this,
          type,
          listener,
          options,
        );
      };
      document.removeEventListener = function (
        this: Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) {
        if (type === "visibilitychange") {
          const capture = captureValue(options);
          const registrations = visibilityListeners.get(listener);
          if (registrations?.delete(capture)) {
            if (registrations.size === 0) visibilityListeners.delete(listener);
            trackedWindow.__e2eVisibilityListenerRemoveCount =
              (trackedWindow.__e2eVisibilityListenerRemoveCount ?? 0) + 1;
            trackedWindow.__e2eVisibilityListenerActiveCount =
              (trackedWindow.__e2eVisibilityListenerActiveCount ?? 0) - 1;
          }
        }
        return nativeDocumentRemoveEventListener.call(
          this,
          type,
          listener,
          options,
        );
      };

      window.addEventListener(
        "engine-simulator:app-lifecycle",
        (event: Event) => {
          const lifecycleEvent = event as CustomEvent<"mounted" | "cleaned-up">;
          if (lifecycleEvent.detail === "mounted") {
            trackedWindow.__e2eAppMountCount =
              (trackedWindow.__e2eAppMountCount ?? 0) + 1;
          } else if (lifecycleEvent.detail === "cleaned-up") {
            trackedWindow.__e2eAppCleanupCount =
              (trackedWindow.__e2eAppCleanupCount ?? 0) + 1;
          }
        },
      );

      const NativeAudioContext = window.AudioContext;
      window.AudioContext = new Proxy(NativeAudioContext, {
        construct(target, argumentsList, newTarget) {
          trackedWindow.__e2eAudioContextCount =
            (trackedWindow.__e2eAudioContextCount ?? 0) + 1;
          const context = Reflect.construct(
            target,
            argumentsList,
            newTarget,
          ) as AudioContext;
          const nativeSuspend = context.suspend.bind(context);
          context.suspend = async () => {
            trackedWindow.__e2eAudioContextSuspendCount =
              (trackedWindow.__e2eAudioContextSuspendCount ?? 0) + 1;
            return nativeSuspend();
          };
          const nativeAddModule = context.audioWorklet.addModule.bind(
            context.audioWorklet,
          );
          context.audioWorklet.addModule = async (moduleUrl: string | URL) => {
            const loadCount = (trackedWindow.__e2eWorkletLoadCount ?? 0) + 1;
            trackedWindow.__e2eWorkletLoadCount = loadCount;
            if (loadCount <= failuresBeforeSuccess) {
              throw new Error("Injected worklet module failure");
            }
            await nativeAddModule(moduleUrl);
          };
          return context;
        },
      });

      const NativeAudioWorkletNode = window.AudioWorkletNode;
      window.AudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
        construct(target, argumentsList, newTarget) {
          const mutationCount =
            trackedWindow.__e2eProcessorConfigMutationCount ?? 0;
          const nodeAttempt =
            (trackedWindow.__e2eAudioWorkletNodeCount ?? 0) + 1;
          if (
            processorConfigRejectAttempt === nodeAttempt &&
            mutationCount === 0
          ) {
            const options = argumentsList[2] as AudioWorkletNodeOptions;
            const config = options.processorOptions?.config as {
              snapshot?: {
                cylinders?: ReadonlyArray<{ firingAngleDeg: number }>;
              };
            };
            const snapshot = config.snapshot;
            const firstCylinder = snapshot?.cylinders?.[0];
            if (firstCylinder) {
              // This changes only the test-side constructor input. The real
              // processor still validates and reports its normal rejection.
              argumentsList[2] = {
                ...options,
                processorOptions: {
                  ...options.processorOptions,
                  config: {
                    ...config,
                    snapshot: {
                      ...snapshot,
                      cylinders: snapshot.cylinders?.map((cylinder, index) =>
                        index === 0
                          ? { ...cylinder, firingAngleDeg: 720 }
                          : cylinder,
                      ),
                    },
                  },
                },
              };
              trackedWindow.__e2eProcessorConfigMutationCount =
                mutationCount + 1;
            }
          }
          const node = Reflect.construct(target, argumentsList, newTarget);
          trackedWindow.__e2eAudioWorkletNodeCount =
            (trackedWindow.__e2eAudioWorkletNodeCount ?? 0) + 1;
          trackedWindow.__e2eAudioWorkletNodes?.push(node);
          return node;
        },
      });
    },
    {
      failuresBeforeSuccess: failWorkletLoads,
      processorConfigRejectAttempt: rejectProcessorConfigOnAttempt ?? 0,
    },
  );
}

async function instrumentLiveAnalyserActivity(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      __e2eAnalyserMethodsInstrumented?: boolean;
      __e2eAnalyserDisconnectCount?: number;
      __e2eTimeDomainReadCount?: number;
      __e2eFrequencyReadCount?: number;
      __e2eObservedWaveformSignal?: number;
      __e2eObservedSpectrumSignal?: number;
    };
    if (trackedWindow.__e2eAnalyserMethodsInstrumented) return;
    trackedWindow.__e2eAnalyserMethodsInstrumented = true;

    const nativeAnalyserDisconnect = AnalyserNode.prototype.disconnect;
    const nativeTimeDomainRead = AnalyserNode.prototype.getByteTimeDomainData;
    const nativeFrequencyRead = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.disconnect = function () {
      trackedWindow.__e2eAnalyserDisconnectCount =
        (trackedWindow.__e2eAnalyserDisconnectCount ?? 0) + 1;
      Reflect.apply(nativeAnalyserDisconnect, this, []);
    };
    AnalyserNode.prototype.getByteTimeDomainData = function (data) {
      trackedWindow.__e2eTimeDomainReadCount =
        (trackedWindow.__e2eTimeDomainReadCount ?? 0) + 1;
      nativeTimeDomainRead.call(this, data);
      if (data.some((sample) => sample !== 128)) {
        trackedWindow.__e2eObservedWaveformSignal = 1;
      }
    };
    AnalyserNode.prototype.getByteFrequencyData = function (data) {
      trackedWindow.__e2eFrequencyReadCount =
        (trackedWindow.__e2eFrequencyReadCount ?? 0) + 1;
      nativeFrequencyRead.call(this, data);
      if (data.some((bin) => bin > 0)) {
        trackedWindow.__e2eObservedSpectrumSignal = 1;
      }
    };
  });
}

type VisualizationCounter =
  | "__e2eAnalyserDisconnectCount"
  | "__e2eTimeDomainReadCount"
  | "__e2eFrequencyReadCount"
  | "__e2eObservedWaveformSignal"
  | "__e2eObservedSpectrumSignal";

async function visualizationCount(
  page: Page,
  property: VisualizationCounter,
): Promise<number> {
  return page.evaluate((countProperty) => {
    const trackedWindow = window as typeof window &
      Partial<Record<VisualizationCounter, number>>;
    return trackedWindow[countProperty] ?? 0;
  }, property);
}

async function canvasHasDrawnSignal(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (!context || element.width === 0 || element.height === 0) return false;
    const pixels = context.getImageData(
      0,
      0,
      element.width,
      element.height,
    ).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] !== 9 ||
        pixels[index + 1] !== 17 ||
        pixels[index + 2] !== 31 ||
        pixels[index + 3] !== 255
      ) {
        return true;
      }
    }
    return false;
  });
}

async function audioGraphCount(
  page: Page,
  property:
    | "__e2eAudioContextCount"
    | "__e2eAudioContextSuspendCount"
    | "__e2eAudioWorkletNodeCount",
): Promise<number | undefined> {
  return page.evaluate((countProperty) => {
    const trackedWindow = window as typeof window &
      Record<typeof countProperty, number | undefined>;
    return trackedWindow[countProperty];
  }, property);
}

async function visibilityListenerCount(
  page: Page,
  property:
    | "__e2eVisibilityListenerAddCount"
    | "__e2eVisibilityListenerRemoveCount"
    | "__e2eVisibilityListenerActiveCount",
): Promise<number | undefined> {
  return page.evaluate((countProperty) => {
    const trackedWindow = window as typeof window &
      Record<typeof countProperty, number | undefined>;
    return trackedWindow[countProperty];
  }, property);
}

async function appLifecycleCount(
  page: Page,
  property: "__e2eAppMountCount" | "__e2eAppCleanupCount",
): Promise<number | undefined> {
  return page.evaluate((countProperty) => {
    const trackedWindow = window as typeof window &
      Record<typeof countProperty, number | undefined>;
    return trackedWindow[countProperty];
  }, property);
}

async function captureCurrentProcessorMessageHandler(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      __e2eAudioWorkletNodes?: AudioWorkletNode[];
      __e2eStaleProcessorMessage?: ((event: MessageEvent) => void) | null;
    };
    trackedWindow.__e2eStaleProcessorMessage =
      trackedWindow.__e2eAudioWorkletNodes?.at(-1)?.port.onmessage ?? null;
  });
}

async function deliverStaleConfigHandshake(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      __e2eStaleProcessorMessage?: ((event: MessageEvent) => void) | null;
    };
    const handler = trackedWindow.__e2eStaleProcessorMessage;
    handler?.({
      data: { type: "config-applied", requestId: "1" },
    } as MessageEvent);
    handler?.({
      data: { type: "ready", requestId: "1", sampleRate: 48_000 },
    } as MessageEvent);
  });
}

test("loads an emitted JavaScript AudioWorklet and receives ready after a click", async ({
  page,
}) => {
  const server = workletServer();
  await page.goto(harnessUrl(server));

  const moduleUrl = await page
    .getByTestId("module-url")
    .evaluate((element: HTMLOutputElement) => element.value);
  if (!moduleUrl) {
    throw new Error("The harness did not resolve a worklet module URL.");
  }

  const expectedPath =
    server === "dev"
      ? "/src/audio/worklets/engine-audio-processor.ts"
      : "/__e2e__/assets/engine-audio-worklet.js";
  expect(new URL(moduleUrl).pathname).toBe(expectedPath);

  // WorkletGlobalScope fetches are not consistently exposed as Page response
  // events. Fetch the exact same-origin URL in the browser before loading it
  // through the real AudioWorklet API.
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url);
    return {
      ok: result.ok,
      contentType: result.headers.get("content-type"),
    };
  }, moduleUrl);

  expect(response.ok).toBe(true);
  expect(response.contentType).toMatch(/(?:text|application)\/javascript/i);

  await page.getByTestId("start-worklet").click();
  await expect
    .poll(() =>
      page
        .getByTestId("worklet-status")
        .evaluate((element: HTMLOutputElement) => element.value),
    )
    .toBe("ready");
});

test("reports a discriminable shared-loader failure for an invalid module URL", async ({
  page,
}) => {
  await page.goto(
    harnessUrl(workletServer(), "?moduleUrl=/missing-worklet.js"),
  );
  await page.getByTestId("start-worklet").click();

  await expect
    .poll(() =>
      page
        .getByTestId("worklet-status")
        .evaluate((element: HTMLOutputElement) => element.value),
    )
    .toContain("error:worklet-load-failed");
});

test("runs the product audio controls without creating audio before the user starts it", async ({
  page,
}) => {
  await instrumentAudioGraph(page);

  await page.goto("/");

  await expect(page.getByTestId("audio-status")).toHaveText("idle");
  await expect(page.getByRole("button", { name: "Stop audio" })).toBeDisabled();
  await expect(page.getByLabel("Mute audio")).not.toBeChecked();
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(0);

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect
    .poll(() => page.getByTestId("engine-rpm").textContent())
    .not.toBe("0");
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(1);

  await page.getByLabel("Volume").fill("0.35");
  await expect(page.getByLabel("Volume")).toHaveValue("0.35");
  await page.getByLabel("Throttle").fill("0.5");
  await expect(page.getByLabel("Throttle")).toHaveValue("0.5");
  await page.getByLabel("Opening percentage").fill("40");
  await expect(page.getByLabel("Throttle")).toHaveValue("0.4");
  const holdThrottle = page.getByRole("button", { name: "Hold accelerator" });
  await holdThrottle.hover();
  await page.mouse.down();
  await expect(page.getByLabel("Throttle")).toHaveValue("1");
  await page.mouse.up();
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await holdThrottle.hover();
  await page.mouse.down();
  await holdThrottle.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await holdThrottle.hover();
  await page.mouse.down();
  await holdThrottle.dispatchEvent("lostpointercapture", { pointerId: 1 });
  await page.mouse.up();
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await holdThrottle.hover();
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await page.getByLabel("Opening percentage").focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await holdThrottle.focus();
  await page.keyboard.down("Space");
  await expect(page.getByLabel("Throttle")).toHaveValue("1");
  await holdThrottle.hover();
  await page.mouse.down();
  await page.getByLabel("Opening percentage").focus();
  await page.keyboard.up("Space");
  await expect(page.getByLabel("Throttle")).toHaveValue("1");
  await page.mouse.up();
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await holdThrottle.focus();
  await page.keyboard.down("Space");
  await holdThrottle.hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByLabel("Throttle")).toHaveValue("1");
  await page.keyboard.up("Space");
  await expect(page.getByLabel("Throttle")).toHaveValue("0");
  await page.getByLabel("Dyno load").fill("12.5");
  await expect(page.getByTestId("dyno-load-value")).toHaveText("12.5 N m");
  await expect(page.getByTestId("effective-throttle")).toContainText("%");
  await page.getByLabel("Mute audio").check();
  await expect(page.getByLabel("Mute audio")).toBeChecked();

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(2);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("updates analyser canvases only for the live graph and cleans up on restart", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  const waveform = page.getByTestId("waveform-canvas");
  const spectrum = page.getByTestId("spectrum-canvas");
  await expect(waveform).toBeVisible();
  await expect(spectrum).toBeVisible();
  expect(await visualizationCount(page, "__e2eTimeDomainReadCount")).toBe(0);

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await instrumentLiveAnalyserActivity(page);
  await expect
    .poll(() => visualizationCount(page, "__e2eTimeDomainReadCount"))
    .toBeGreaterThan(2);
  await expect
    .poll(() => visualizationCount(page, "__e2eFrequencyReadCount"))
    .toBeGreaterThan(2);
  await expect
    .poll(() => visualizationCount(page, "__e2eObservedWaveformSignal"))
    .toBe(1);
  await expect
    .poll(() => visualizationCount(page, "__e2eObservedSpectrumSignal"))
    .toBe(1);
  await expect.poll(() => canvasHasDrawnSignal(waveform)).toBe(true);
  await expect.poll(() => canvasHasDrawnSignal(spectrum)).toBe(true);

  const initialSize = await waveform.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  await page.setViewportSize({ width: 480, height: 900 });
  await expect
    .poll(() =>
      waveform.evaluate((canvas: HTMLCanvasElement) => {
        return (
          canvas.width === Math.round(canvas.clientWidth * devicePixelRatio) &&
          canvas.height === Math.round(canvas.clientHeight * devicePixelRatio)
        );
      }),
    )
    .toBe(true);
  const resized = await waveform.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  expect(resized).not.toEqual(initialSize);
  expect(resized.width).toBeGreaterThan(0);
  expect(resized.height).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
  await expect
    .poll(() => visualizationCount(page, "__e2eAnalyserDisconnectCount"))
    .toBe(1);
  await page.waitForTimeout(100);
  const readsAfterStop = {
    waveform: await visualizationCount(page, "__e2eTimeDomainReadCount"),
    spectrum: await visualizationCount(page, "__e2eFrequencyReadCount"),
  };
  await page.waitForTimeout(150);
  expect(await visualizationCount(page, "__e2eTimeDomainReadCount")).toBe(
    readsAfterStop.waveform,
  );
  expect(await visualizationCount(page, "__e2eFrequencyReadCount")).toBe(
    readsAfterStop.spectrum,
  );

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect
    .poll(() => visualizationCount(page, "__e2eTimeDomainReadCount"))
    .toBeGreaterThan(readsAfterStop.waveform);

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
  await expect
    .poll(() => visualizationCount(page, "__e2eAnalyserDisconnectCount"))
    .toBe(2);
});

test("stages preset phase edits from the keyboard without creating audio", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  const preset = page.getByLabel("Engine preset");
  await preset.focus();
  await page.keyboard.press("End");
  await expect(preset).toHaveValue("evenly-spaced-four-model");
  await expect(page.getByText("燃焼位相（720°周期）")).toBeVisible();
  await expect(page.getByLabel("Cylinder 4 phase (degrees)")).toHaveValue(
    "540",
  );
  await expect(page.getByTestId("firing-event")).toHaveCount(1);
  await expect(page.getByTestId("firing-event-label")).toContainText(
    "cylinder-1: 0°",
  );

  await page.getByLabel("Cylinder 4 phase (degrees)").fill("720");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  const invalidPhase = page.getByLabel("Cylinder 4 phase (degrees)");
  await expect(invalidPhase).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("must be in [0, 720)")).toBeVisible();

  await invalidPhase.fill("540");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(page.getByTestId("pending-config")).toHaveText(
    "evenly-spaced-four-model",
  );
  await expect(page.getByTestId("active-config")).toHaveText(
    "single-cylinder-model",
  );
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(0);
});

test("applies a stopped two-stroke 360-degree configuration and starts it", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  await page
    .getByLabel("Engine preset")
    .selectOption("two-stroke-single-cylinder-model");
  await expect(page.getByText("燃焼位相（360°周期）")).toBeVisible();
  await expect(page.getByTestId("draft-cycle")).toHaveText(
    "2-stroke · 360° cycle",
  );
  const phase = page.getByLabel("Cylinder 1 phase (degrees)");
  await expect(phase).toHaveAttribute("max", "359.999");

  await phase.fill("360");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(phase).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("must be in [0, 360)")).toBeVisible();

  await phase.fill("0");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(page.getByTestId("pending-config")).toHaveText(
    "two-stroke-single-cylinder-model",
  );
  await expect(page.getByRole("button", { name: "Start audio" })).toBeEnabled();

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByTestId("active-config")).toHaveText(
    "two-stroke-single-cylinder-model",
  );
  await expect(
    page.getByRole("region", { name: "360 degree firing events" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "360° firing events" }),
  ).toBeVisible();
  await expect(page.getByTestId("firing-event-strip")).toHaveAttribute(
    "data-cycle-degrees",
    "360",
  );

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("announces multiple invalid phases once and focuses the first invalid field", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  await page
    .getByLabel("Engine preset")
    .selectOption("evenly-spaced-four-model");
  await page.getByLabel("Cylinder 1 phase (degrees)").fill("720");
  await page.getByLabel("Cylinder 2 phase (degrees)").fill("720");
  await page.getByRole("button", { name: "Apply for next start" }).click();

  const validationAlert = page.getByRole("alert");
  await expect(validationAlert).toHaveCount(1);
  await expect(validationAlert).toContainText("2 invalid phases");
  await expect(page.getByLabel("Cylinder 1 phase (degrees)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Cylinder 2 phase (degrees)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("cylinder-phase-1");
});

test("honors reduced motion without changing audio playback", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await instrumentAudioGraph(page);
  await page.goto("/");
  await instrumentLiveAnalyserActivity(page);

  const reducedExplanation = page.locator(".visualization-reduced");
  await expect(reducedExplanation).toBeVisible();
  await expect(reducedExplanation).not.toHaveAttribute("role");
  await expect(page.getByTestId("waveform-canvas")).toHaveCount(0);
  await expect(page.getByTestId("spectrum-canvas")).toHaveCount(0);

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await page.waitForTimeout(150);
  expect(await visualizationCount(page, "__e2eTimeDomainReadCount")).toBe(0);
  expect(await visualizationCount(page, "__e2eFrequencyReadCount")).toBe(0);

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("promotes a stopped four-cylinder pending configuration only after its next native handshake", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await captureCurrentProcessorMessageHandler(page);
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(1);

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");

  await page
    .getByLabel("Engine preset")
    .selectOption("evenly-spaced-four-model");
  await page.getByLabel("Cylinder 4 phase (degrees)").fill("539");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(page.getByTestId("active-config")).toHaveText(
    "single-cylinder-model",
  );
  await expect(page.getByTestId("firing-event")).toHaveCount(1);
  await expect(page.getByTestId("pending-config")).toHaveText(
    "evenly-spaced-four-model",
  );
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(1);

  await deliverStaleConfigHandshake(page);
  await expect(page.getByTestId("active-config")).toHaveText(
    "single-cylinder-model",
  );
  await expect(page.getByTestId("pending-config")).toHaveText(
    "evenly-spaced-four-model",
  );

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByTestId("active-config")).toHaveText(
    "evenly-spaced-four-model",
  );
  await expect(page.getByTestId("pending-config")).toHaveText(
    "No pending configuration",
  );
  await expect(page.getByTestId("firing-event")).toHaveCount(4);
  await expect(page.getByTestId("firing-event-label").nth(0)).toContainText(
    "evenly-spaced-four-cylinder-1",
  );
  await expect(page.getByTestId("firing-event-label").nth(1)).toContainText(
    "180°",
  );
  await expect(page.getByTestId("firing-event-label").nth(2)).toContainText(
    "360°",
  );
  await expect(page.getByTestId("firing-event-label").nth(3)).toContainText(
    "539°",
  );
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(2);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("keeps endpoint and near firing events readable at the supported 320px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1_100 });
  await instrumentAudioGraph(page);
  await page.goto("/");

  await page
    .getByLabel("Engine preset")
    .selectOption("evenly-spaced-four-model");
  await page.getByLabel("Cylinder 2 phase (degrees)").fill("72");
  await page.getByLabel("Cylinder 3 phase (degrees)").fill("648");
  await page.getByLabel("Cylinder 4 phase (degrees)").fill("719");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");

  const markers = page.getByTestId("firing-event");
  await expect(markers).toHaveCount(4);
  expect(
    await markers.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-lane")),
    ),
  ).toEqual(["0", "1", "0", "1"]);

  const layout = await page.evaluate(() => {
    const boxes = (testId: string) =>
      Array.from(document.querySelectorAll(`[data-testid="${testId}"]`)).map(
        (element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          };
        },
      );
    const overlaps = (
      left: ReturnType<typeof boxes>[number],
      right: ReturnType<typeof boxes>[number],
    ) =>
      left.left < right.right &&
      left.right > right.left &&
      left.top < right.bottom &&
      left.bottom > right.top;
    const markerBoxes = boxes("firing-event");
    const labelBoxes = boxes("firing-event-label");
    const allPairsSeparate = (items: ReturnType<typeof boxes>) =>
      items.every((item, index) =>
        items.slice(index + 1).every((other) => !overlaps(item, other)),
      );
    return {
      markerBoxes,
      labelBoxes,
      markersSeparate: allPairsSeparate(markerBoxes),
      labelsSeparate: allPairsSeparate(labelBoxes),
      viewportWidth: window.innerWidth,
    };
  });

  expect(layout.viewportWidth).toBe(320);
  expect(layout.markersSeparate).toBe(true);
  expect(layout.labelsSeparate).toBe(true);
  for (const box of [...layout.markerBoxes, ...layout.labelBoxes]) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(layout.viewportWidth);
  }
  await expect(page.getByTestId("firing-event-label")).toHaveText([
    /evenly-spaced-four-cylinder-1: 0°/,
    /evenly-spaced-four-cylinder-2: 72°/,
    /evenly-spaced-four-cylinder-3: 648°/,
    /evenly-spaced-four-cylinder-4: 719°/,
  ]);

  await page.getByRole("button", { name: "Stop audio" }).click();
});

test("renders each active parallel-twin firing order with live waveform and spectrum data", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");
  await instrumentLiveAnalyserActivity(page);

  const twins = [
    { id: "parallel-twin-360-model", secondAngle: "360°" },
    { id: "parallel-twin-180-model", secondAngle: "180°" },
    { id: "parallel-twin-270-model", secondAngle: "270°" },
  ] as const;

  for (const twin of twins) {
    await page.getByLabel("Engine preset").selectOption(twin.id);
    await page.getByRole("button", { name: "Apply for next start" }).click();
    const readsBeforeStart = await visualizationCount(
      page,
      "__e2eFrequencyReadCount",
    );

    await page.getByRole("button", { name: "Start audio" }).click();
    await expect(page.getByTestId("audio-status")).toHaveText("running");
    await expect(page.getByTestId("active-config")).toHaveText(twin.id);
    await expect(page.getByTestId("firing-event")).toHaveCount(2);
    await expect(page.getByTestId("firing-event-label").nth(0)).toContainText(
      "0°",
    );
    await expect(page.getByTestId("firing-event-label").nth(1)).toContainText(
      twin.secondAngle,
    );
    await expect
      .poll(() => visualizationCount(page, "__e2eFrequencyReadCount"))
      .toBeGreaterThan(readsBeforeStart);

    await page.getByRole("button", { name: "Stop audio" }).click();
    await expect(page.getByTestId("audio-status")).toHaveText("idle");
  }
});

test("covers the product start, stop, rejected reapply, and successful retry flow", async ({
  page,
}) => {
  await instrumentAudioGraph(page, { rejectProcessorConfigOnAttempt: 2 });
  await page.goto("/");

  // A running status is reached only after the native processor has confirmed
  // its initial configuration and sent ready.
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(1);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");

  await page
    .getByLabel("Engine preset")
    .selectOption("parallel-twin-360-model");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(page.getByTestId("pending-config")).toHaveText(
    "parallel-twin-360-model",
  );

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("error");
  await expect(page.getByRole("alert")).toContainText(
    "Audio error (config-rejected)",
  );
  await expect(page.getByTestId("active-config")).toHaveText(
    "single-cylinder-model",
  );
  await expect(page.getByTestId("pending-config")).toHaveText(
    "parallel-twin-360-model",
  );

  // A processor-side rejection returns the editor to the stopped, recoverable
  // state. Correcting and staging a fresh snapshot must clear the error before
  // the next start attempt can promote it.
  await page.getByLabel("Cylinder 2 phase (degrees)").fill("359");
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByTestId("active-config")).toHaveText(
    "parallel-twin-360-model",
  );
  await expect(page.getByTestId("pending-config")).toHaveText(
    "No pending configuration",
  );
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("deduplicates rapid starts and permits lifecycle restart without graph duplication", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  if (workletServer() === "dev") {
    await expect
      .poll(() => appLifecycleCount(page, "__e2eAppMountCount"))
      .toBe(2);
    await expect
      .poll(() => appLifecycleCount(page, "__e2eAppCleanupCount"))
      .toBe(1);
    await expect
      .poll(() =>
        visibilityListenerCount(page, "__e2eVisibilityListenerAddCount"),
      )
      .toBe(2);
    await expect
      .poll(() =>
        visibilityListenerCount(page, "__e2eVisibilityListenerRemoveCount"),
      )
      .toBe(1);
  }
  await expect
    .poll(() =>
      visibilityListenerCount(page, "__e2eVisibilityListenerActiveCount"),
    )
    .toBe(1);

  // The production Nginx project does not perform the development-only
  // StrictMode remount, but exercises the same restart contract. Dispatching
  // twice in the same task keeps the second event ahead of React's
  // disabled-button commit.
  await page.getByRole("button", { name: "Start audio" }).evaluate((button) => {
    const startButton = button as HTMLButtonElement;
    startButton.click();
    startButton.click();
  });
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(1);
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(1);

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(
    page.getByRole("button", { name: "Apply for next start" }),
  ).toBeDisabled();
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(2);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
  await expect(
    page.getByRole("button", { name: "Apply for next start" }),
  ).toBeEnabled();
});

test("displays a typed worklet load error and recovers on a later product start", async ({
  page,
}) => {
  await instrumentAudioGraph(page, { failWorkletLoads: 1 });
  await page.goto("/");

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("error");
  await expect(page.getByRole("alert")).toContainText(
    "Audio error (worklet-load-failed)",
  );
  await expect(page.getByRole("button", { name: "Stop audio" })).toBeDisabled();

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(1);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("displays a typed processor error and recreates the product graph on retry", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      __e2eAudioWorkletNodes?: AudioWorkletNode[];
    };
    trackedWindow.__e2eAudioWorkletNodes
      ?.at(-1)
      ?.onprocessorerror?.(new ErrorEvent("processorerror"));
  });

  await expect(page.getByTestId("audio-status")).toHaveText("error");
  await expect(page.getByRole("alert")).toContainText(
    "Audio error (processor-error)",
  );

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(2);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
});

test("supports keyboard controls, explicit visibility resume, and processor recovery", async ({
  page,
}) => {
  await instrumentAudioGraph(page);
  await page.goto("/");

  // Configure without a pointer. This also verifies native labels provide the
  // programmatic names keyboard and assistive-technology users depend on.
  const preset = page.getByLabel("Engine preset");
  await preset.focus();
  await page.keyboard.press("End");
  await expect(preset).toHaveValue("evenly-spaced-four-model");
  const phase = page.getByLabel("Cylinder 4 phase (degrees)");
  await phase.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("539");
  const apply = page.getByRole("button", { name: "Apply for next start" });
  await apply.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pending-config")).toHaveText(
    "evenly-spaced-four-model",
  );

  const start = page.getByRole("button", { name: "Start audio" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-status")).toHaveText("running");

  const throttle = page.getByLabel("Throttle");
  await throttle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(throttle).toHaveValue("0.01");
  const mute = page.getByLabel("Mute audio");
  await mute.focus();
  await page.keyboard.press("Space");
  await expect(mute).toBeChecked();

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("audio-status")).toHaveText("suspended");
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextSuspendCount"))
    .toBe(1);
  await expect(page.locator(".suspension-notice")).toContainText(
    "Select Start audio to resume",
  );

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("audio-status")).toHaveText("suspended");
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-status")).toHaveText("running");

  await page.evaluate(() => {
    const trackedWindow = window as typeof window & {
      __e2eAudioWorkletNodes?: AudioWorkletNode[];
    };
    trackedWindow.__e2eAudioWorkletNodes
      ?.at(-1)
      ?.onprocessorerror?.(new ErrorEvent("processorerror"));
  });
  await expect(page.getByRole("alert")).toContainText(
    "Audio error (processor-error)",
  );
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-status")).toHaveText("running");

  const stop = page.getByRole("button", { name: "Stop audio" });
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioContextCount"))
    .toBe(2);
});
