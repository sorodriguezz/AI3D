import { expect, test } from "@playwright/test";

test("custom colors support undo, validation and reopening without rebuilding geometry", async ({ page }) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).cadCalls = [];
    Worker.prototype.postMessage = function (message: any, ...args: any[]) {
      if (message.type === "shape" || message.type === "combine") (window as any).cadCalls.push(message.type);
      return send.call(this, message, ...args as [any]);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Color #/ })).toHaveCount(24);
  const initial = await page.getByRole("textbox", { name: "Código HEX del color" }).inputValue();
  const baseline = await page.evaluate(() => (window as any).cadCalls.length);
  await page.getByRole("button", { name: "Resultado", exact: true }).click();
  const hex = page.getByRole("textbox", { name: "Código HEX del color" });
  await hex.fill("#123abc");
  await hex.press("Enter");
  await expect(page.getByRole("button", { name: /Deshacer/ })).toBeEnabled();
  await expect(hex).toHaveValue("#123abc");
  const color = () => page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    return useStore.getState().doc.parts[0].color;
  });
  await expect.poll(color).toBe("#123abc");
  expect(await page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    return useStore.getState().showResult;
  })).toBe(false);
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect.poll(color).toBe(initial);
  await page.getByRole("button", { name: /Rehacer/ }).click();
  await expect.poll(color).toBe("#123abc");
  await hex.fill("#ZZZZZZ");
  await hex.press("Enter");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  expect(await color()).toBe("#123abc");
  await hex.press("Escape");
  await expect(hex).toHaveValue("#123abc");
  await hex.fill("ABC");
  await hex.press("Enter");
  await expect.poll(color).toBe("#aabbcc");
  if (process.env.AI3D_COLOR_SCREENSHOT) await page.locator("aside").last().screenshot({ path: process.env.AI3D_COLOR_SCREENSHOT });
  // Verify the absence of work after the CAD scene's 250 ms debounce interval.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).cadCalls.length)).toBe(baseline);
  await page.getByRole("button", { name: "Volver a mis diseños" }).click();
  await page.getByText("Diseño sin título", { exact: true }).click();
  await expect.poll(color).toBe("#aabbcc");
  await page.getByRole("button", { name: /^Escena/ }).click();
  await page.getByText("Caja", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Código HEX del color" })).toHaveValue("#aabbcc");
});

test("a continuous native color selection is one undo step", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  const original = await page.getByRole("textbox", { name: "Código HEX del color" }).inputValue();
  const picker = page.getByLabel("Elegir color personalizado");
  await picker.focus();
  await picker.evaluate((input) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const color of ["#df2010", "#374ac0", "#185740"]) {
      set.call(input, color);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect(page.getByRole("textbox", { name: "Código HEX del color" })).toHaveValue("#185740");
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect(page.getByRole("textbox", { name: "Código HEX del color" })).toHaveValue(original);
  await page.getByRole("button", { name: /Rehacer/ }).click();
  await expect(page.getByRole("textbox", { name: "Código HEX del color" })).toHaveValue("#185740");
});
