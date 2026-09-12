import { expect, test, type Page } from "@playwright/test";

import { ENGINE_AUDIO_PROCESSOR_NAME } from "../../src/audio/worklets/contracts";

type WorkletServer = "dev" | "web";

function workletServer(): WorkletServer {
  return test.info().project.name as WorkletServer;
}

function workletUrl(baseUrl: string): string {
  return new URL("assets/engine-audio-worklet.js", `${baseUrl}/`).href;
}

async function installProductionHarness(
  page: Page,
  moduleUrl: string,
): Promise<void> {
  await page.evaluate(
    ([url, processorName]) => {
      document.body.innerHTML = [
        '<button type="button" data-testid="start-worklet">Start worklet</button>',
        '<output data-testid="worklet-status">idle</output>',
      ].join("");

      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="start-worklet"]',
      );
      const status = document.querySelector<HTMLOutputElement>(
        '[data-testid="worklet-status"]',
      );

      if (!button || !status) {
        throw new Error("Unable to install the production worklet harness.");
      }

      button.addEventListener("click", async () => {
        button.disabled = true;
        status.value = "loading";
        const context = new AudioContext();
        try {
          await context.resume();
          await context.audioWorklet.addModule(url);
          const node = new AudioWorkletNode(context, processorName);
          node.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
            if (event.data.type === "ready") {
              status.value = "ready";
            }
          };
        } catch (error: unknown) {
          status.value =
            error instanceof Error
              ? `error:${error.name}:${error.message}`
              : `error:${String(error)}`;
        }
      });
    },
    [moduleUrl, ENGINE_AUDIO_PROCESSOR_NAME],
  );
}

test("loads an emitted JavaScript AudioWorklet and receives ready after a click", async ({
  page,
}) => {
  const baseUrl = test.info().project.use.baseURL;
  if (typeof baseUrl !== "string") {
    test.skip(true, "This project needs a base URL.");
    return;
  }

  let moduleUrl: string;
  if (workletServer() === "dev") {
    await page.goto("/tests/e2e/worklet-harness.html");
    moduleUrl = await page
      .getByTestId("module-url")
      .evaluate((element: HTMLOutputElement) => element.value);
    if (!moduleUrl) {
      throw new Error("The dev harness did not resolve a worklet module URL.");
    }
  } else {
    await page.goto("/");
    moduleUrl = workletUrl(baseUrl);
    await installProductionHarness(page, moduleUrl);
  }

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
  test.skip(
    workletServer() !== "dev",
    "The shared loader is exercised by the dev harness.",
  );

  await page.goto(
    "/tests/e2e/worklet-harness.html?moduleUrl=/missing-worklet.js",
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
