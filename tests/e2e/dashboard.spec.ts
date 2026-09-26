import { expect, test, type Locator, type Page } from "@playwright/test";

async function withinViewport(locator: Locator, page: Page): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `missing box for ${locator}`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function canvasesMatchDisplay(page: Page): Promise<void> {
  for (const testId of ["waveform-canvas", "spectrum-canvas"]) {
    await expect
      .poll(() =>
        page.getByTestId(testId).evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const ratio = Math.max(1, devicePixelRatio);
          return (
            canvas.width === Math.round(canvas.clientWidth * ratio) &&
            canvas.height === Math.round(canvas.clientHeight * ratio)
          );
        }),
      )
      .toBe(true);
  }
}

for (const size of [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`shows the full dashboard at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");

    await expect(page.locator(".configuration-details")).not.toHaveAttribute(
      "open",
    );
    await expect(page.getByTestId("pending-config")).toContainText(
      "No pending",
    );
    for (const locator of [
      page.getByRole("button", { name: "Start audio" }),
      page.getByRole("button", { name: "Stop audio" }),
      page.getByLabel("Volume"),
      page.getByTestId("engine-rpm"),
      page.locator("#throttle"),
      page.getByLabel("Dyno load"),
      page.getByRole("combobox", { name: "Gear", exact: true }),
      page.getByLabel("Clutch engagement"),
      page.getByTestId("vehicle-speed"),
      page.getByLabel("Engine preset"),
      page.getByTestId("firing-event-strip"),
      page.getByTestId("waveform-canvas"),
      page.getByTestId("spectrum-canvas"),
    ]) {
      await withinViewport(locator, page);
    }
    await noHorizontalOverflow(page);
    await canvasesMatchDisplay(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(size.height + 1);
    if (test.info().project.name === "dev") {
      await page.screenshot({
        path: `docs/tickets/evidence/027/desktop-${size.width}.png`,
      });
    }
  });
}

for (const width of [320, 375, 768]) {
  test(`keeps expanded eight-cylinder settings usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/");
    await noHorizontalOverflow(page);
    await canvasesMatchDisplay(page);
    await page.getByText("Configuration details", { exact: true }).click();
    await page.getByLabel("Engine preset").selectOption("even-fire-v8-model");
    await expect(page.getByLabel("Cylinder 8 phase (degrees)")).toBeVisible();
    await page.getByLabel("Cylinder 8 phase (degrees)").fill("630");
    await page.getByRole("button", { name: "Apply for next start" }).click();
    await expect(page.getByTestId("pending-config")).toHaveText(
      "even-fire-v8-model",
    );
    await noHorizontalOverflow(page);
    await page
      .getByLabel("Cylinder 8 phase (degrees)")
      .scrollIntoViewIfNeeded();
    await withinViewport(page.getByLabel("Cylinder 8 phase (degrees)"), page);
    if (width === 320 && test.info().project.name === "dev") {
      await page.screenshot({
        path: "docs/tickets/evidence/027/mobile-320-expanded.png",
        fullPage: true,
      });
    }
  });
}

test("preserves playback and inputs through resize and details toggling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("Volume").fill("0.3");
  await page.getByLabel("Dyno load").fill("2");
  await page.locator("#throttle").fill("0.4");
  await page.getByLabel("Engine preset").selectOption("even-fire-v8-model");
  await page.getByText("Configuration details", { exact: true }).click();
  await page.getByRole("button", { name: "Apply for next start" }).click();
  await expect(page.getByTestId("pending-config")).toHaveText(
    "even-fire-v8-model",
  );
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByTestId("active-config")).toHaveText(
    "even-fire-v8-model",
  );
  await page.setViewportSize({ width: 320, height: 768 });
  await page.getByText("Configuration details", { exact: true }).click();
  await page.getByText("Configuration details", { exact: true }).click();
  await canvasesMatchDisplay(page);
  await expect(page.getByTestId("audio-status")).toHaveText("running");
  await expect(page.getByLabel("Volume")).toHaveValue("0.3");
  await expect(page.getByLabel("Dyno load")).toHaveValue("2");
  await expect(page.locator("#throttle")).toHaveValue("0.4");
  await expect(page.getByTestId("active-config")).toHaveText(
    "even-fire-v8-model",
  );
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByTestId("audio-status")).toHaveText("idle");
  await page.setViewportSize({ width: 768, height: 768 });
  await canvasesMatchDisplay(page);
});

test("releases held accelerator when a touch moves outside the button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 768 });
  await page.goto("/");
  const accelerator = page.getByRole("button", { name: "Hold accelerator" });
  await accelerator.scrollIntoViewIfNeeded();
  const box = await accelerator.boundingBox();
  expect(box).not.toBeNull();
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id: 1 },
    ],
  });
  await expect(page.getByTestId("throttle-value")).toHaveText("100%");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 1, y: 1, id: 1 }],
  });
  await expect(page.getByTestId("throttle-value")).toHaveText("0%");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
});
