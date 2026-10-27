import { expect, test, type Page } from "@playwright/test";

async function cameraState(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name)
      .find((name) => new URL(name).pathname.endsWith("/@react-three_fiber.js"));
    if (!url) throw new Error("R3F module not loaded");
    const { _roots } = await import(/* @vite-ignore */ url);
    const { camera, controls } = _roots.get(document.querySelector("canvas")).store.getState();
    return { position: camera.position.toArray() as number[], target: controls.target.toArray() as number[],
      polar: controls.getPolarAngle() as number, enabled: controls.enabled as boolean };
  });
}

async function drag(page: Page, dx: number, dy: number, button: "left" | "right" = "left") {
  const bounds = await page.locator("canvas").first().boundingBox();
  if (!bounds) throw new Error("Canvas not found");
  const x = bounds.x + bounds.width * 0.25, y = bounds.y + bounds.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up({ button });
}

test("camera can orbit vertically and pan up and down", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const before = await cameraState(page);
  await drag(page, 0, 70);
  await expect.poll(async () => Math.abs((await cameraState(page)).polar - before.polar)).toBeGreaterThan(0.1);
  const after = await cameraState(page);
  await drag(page, 0, -110);
  await expect.poll(async () => (await cameraState(page)).polar).toBeGreaterThan(after.polar + 0.1);
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  const front = await cameraState(page);
  await drag(page, 0, 50, "right");
  await expect.poll(async () => Math.abs((await cameraState(page)).target[2] - front.target[2])).toBeGreaterThan(1);
  const panned = await cameraState(page);
  await drag(page, 0, -80, "right");
  await expect.poll(async () => (await cameraState(page)).target[2]).toBeLessThan(panned.target[2] - 1);
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  const shifted = await cameraState(page);
  await page.keyboard.down("Shift");
  try {
    await drag(page, 0, 50);
  } finally {
    await page.keyboard.up("Shift");
  }
  await expect.poll(async () => Math.abs((await cameraState(page)).target[2] - shifted.target[2])).toBeGreaterThan(1);
});
