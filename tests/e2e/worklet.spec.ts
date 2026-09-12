import { expect, test } from "@playwright/test";

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
