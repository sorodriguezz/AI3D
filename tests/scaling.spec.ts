import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function resultStats(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    const { result, buildError } = useStore.getState();
    return { width: result ? result.bbox.max[0] - result.bbox.min[0] : 0,
      volume: result?.volume ?? 0, triangles: (result?.triangles.length ?? 0) / 3, error: buildError };
  });
}

test("scaled previews, final geometry and STL export agree across repeated edits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  const vertices = [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, 20]];
  const triangles = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((tri, t) => tri.forEach((v, k) => vertices[v].forEach((n, axis) => buffer.writeFloatLE(n, 84 + t * 50 + 12 + k * 12 + axis * 4))));
  await page.locator('input[type="file"]').first().setInputFiles({ name: "tetra.stl", mimeType: "application/sla", buffer });
  await expect.poll(async () => (await resultStats(page)).width).toBeCloseTo(20, 4);
  const original = await resultStats(page);
  for (const scale of [645, 75, 200, 100]) {
    const input = page.getByRole("spinbutton", { name: "Escala", exact: true });
    await input.fill(String(scale));
    await input.press("Enter");
    await expect.poll(async () => (await resultStats(page)).width).toBeCloseTo(20 * scale / 100, 4);
    const stats = await resultStats(page);
    expect(stats.error).toBeNull();
    expect(stats.triangles).toBe(4);
    expect(stats.volume / original.volume).toBeCloseTo((scale / 100) ** 3, 3);
    const previewWidth = await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map((entry) => entry.name)
        .find((name) => new URL(name).pathname.endsWith("/@react-three_fiber.js"));
      const { _roots } = await import(/* @vite-ignore */ url!);
      const { scene } = _roots.get(document.querySelector("canvas")).store.getState();
      const part = scene.children.find((group: any) => group.children.some((child: any) => child.isMesh));
      const mesh = part.children.find((child: any) => child.isMesh);
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      return box.max.x - box.min.x;
    });
    expect(previewWidth).toBeCloseTo(stats.width, 4);
    const exported = await page.evaluate(async () => {
      const path = "/src/cad/client.ts";
      const { exportModel } = await import(path);
      return Array.from(await exportModel("stl", "scaled")) as number[];
    });
    const stl = Buffer.from(exported);
    expect(stl.readUInt32LE(80)).toBe(4);
    const xs = Array.from({ length: 12 }, (_, i) => stl.readFloatLE(84 + Math.floor(i / 3) * 50 + 12 + i % 3 * 12));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(stats.width, 4);
  }
  // Mixed OpenCascade/Manifold booleans must retain valid operands after cleanup.
  await page.getByRole("button", { name: "Insertar", exact: true }).click();
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  await expect.poll(async () => (await resultStats(page)).volume).toBeGreaterThan(original.volume);
  expect((await resultStats(page)).error).toBeNull();
  await page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    const state = useStore.getState();
    state.updatePart(state.selectedId, { mode: "hole", position: [0, 0, 10] });
  });
  await expect.poll(async () => (await resultStats(page)).volume).toBeCloseTo(original.volume * 7 / 8, 2);
  expect((await resultStats(page)).error).toBeNull();
  const signature = await page.evaluate(async () => {
    const path = "/src/cad/client.ts";
    const { exportModel } = await import(path);
    return Array.from((await exportModel("3mf", "cut-model")).slice(0, 4));
  });
  expect(signature).toEqual([0x50, 0x4b, 0x03, 0x04]);
});

test("rapid scale edits reuse the imported model instead of queuing full copies", async ({ page }) => {
  test.skip(!process.env.AI3D_SAMPLE, "Set AI3D_SAMPLE to a local .ai3d design");
  test.setTimeout(120_000);
  const design = JSON.parse(readFileSync(process.env.AI3D_SAMPLE!, "utf8"));
  design.parts[0].params.scale = 100;
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).shapeRequests = [];
    Worker.prototype.postMessage = function (message: any, ...args: any[]) {
      if (message.type === "shape") (window as any).shapeRequests.push(message.params.scale);
      return send.call(this, message, ...args as [any]);
    };
  });
  await page.goto("/");
  await page.evaluate(async (doc) => {
    const storePath = "/src/store.ts", assetsPath = "/src/studio/assets.ts";
    const { useStore } = await import(storePath);
    const { loadAsset } = await import(assetsPath);
    await Promise.all(Object.entries(doc.assets ?? {}).map(([id, asset]) => loadAsset(id, asset)));
    useStore.setState({ view: "studio", doc, docPath: null, selectedId: doc.parts[0].id, leftTab: "scene" });
  }, design);
  await expect(page.getByText(/cm³/)).toBeVisible({ timeout: 60_000 });
  const original = await resultStats(page);
  const baseline = await page.evaluate(() => (window as any).shapeRequests.length);
  await page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    for (const scale of [110, 125, 150, 175, 200, 250, 300, 400, 500, 600, 625, 645]) {
      const state = useStore.getState();
      state.setPartParam(state.selectedId, "scale", scale);
      await new Promise((resolve) => setTimeout(resolve, 32));
    }
  });
  const requests = await page.evaluate((start) => (window as any).shapeRequests.slice(start), baseline);
  console.log("Full geometry rebuilds while changing scale:", requests);
  expect(requests.length).toBe(0);
  await expect(page.getByRole("spinbutton", { name: "Escala", exact: true })).toHaveValue("645");
  await expect.poll(async () => (await resultStats(page)).width, { timeout: 60_000 }).toBeCloseTo(original.width * 6.45, 2);
  expect((await resultStats(page)).triangles).toBe(original.triangles);
  // Distinct settled scales must also avoid accumulating native cached copies.
  for (const scale of [100, 350, 900, 645]) {
    await page.evaluate(async (value) => {
      const path = "/src/store.ts";
      const { useStore } = await import(path);
      const state = useStore.getState();
      state.setPartParam(state.selectedId, "scale", value);
    }, scale);
    await expect.poll(async () => (await resultStats(page)).width, { timeout: 60_000 }).toBeCloseTo(original.width * scale / 100, 2);
    expect((await resultStats(page)).triangles).toBe(original.triangles);
  }
  await expect(page.getByText("Calculando", { exact: true })).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText("No se pudo combinar la escena")).toBeHidden();
  await expect(page.getByText(/cm³/)).toBeVisible();
});
