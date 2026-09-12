import { expect, test, type Page } from "@playwright/test";

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
}

/**
 * Count graphs and, when requested, inject a failure at the browser API edge.
 * The app still owns the controller and its UI state; this only gives the
 * browser test a deterministic way to cover failure-only Web Audio events.
 */
async function instrumentAudioGraph(
  page: Page,
  { failWorkletLoads = 0 }: AudioGraphInstrumentation = {},
): Promise<void> {
  await page.addInitScript(
    ({ failuresBeforeSuccess }) => {
      const trackedWindow = window as typeof window & {
        __e2eAudioContextCount?: number;
        __e2eAudioWorkletNodeCount?: number;
        __e2eWorkletLoadCount?: number;
        __e2eAudioWorkletNodes?: AudioWorkletNode[];
        __e2eAppMountCount?: number;
        __e2eAppCleanupCount?: number;
      };
      trackedWindow.__e2eAudioContextCount = 0;
      trackedWindow.__e2eAudioWorkletNodeCount = 0;
      trackedWindow.__e2eWorkletLoadCount = 0;
      trackedWindow.__e2eAudioWorkletNodes = [];
      trackedWindow.__e2eAppMountCount = 0;
      trackedWindow.__e2eAppCleanupCount = 0;
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
          const context = Reflect.construct(target, argumentsList, newTarget);
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
          const node = Reflect.construct(target, argumentsList, newTarget);
          trackedWindow.__e2eAudioWorkletNodeCount =
            (trackedWindow.__e2eAudioWorkletNodeCount ?? 0) + 1;
          trackedWindow.__e2eAudioWorkletNodes?.push(node);
          return node;
        },
      });
    },
    { failuresBeforeSuccess: failWorkletLoads },
  );
}

async function audioGraphCount(
  page: Page,
  property: "__e2eAudioContextCount" | "__e2eAudioWorkletNodeCount",
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
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(1);

  await page.getByLabel("Volume").fill("0.35");
  await expect(page.getByLabel("Volume")).toHaveValue("0.35");
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
  }

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
  await expect
    .poll(() => audioGraphCount(page, "__e2eAudioWorkletNodeCount"))
    .toBe(2);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
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
