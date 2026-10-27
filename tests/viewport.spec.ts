import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function newDesign(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  await expect(page.getByRole("button", { name: "Caja", exact: true })).toBeVisible();
}

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("Browser error:", e.message.slice(0, 300));
  });
  return errors;
}

async function resizeAndInteract(page: Page) {
  for (const [width, height] of [[2560, 1440], [3840, 2160], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "Frente", exact: true }).click();
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(page.locator("canvas").first()).toBeVisible();
  }
}

test("creating and editing selected shapes stays responsive through Retina resizes", async ({ page }) => {
  const errors = captureErrors(page);
  await newDesign(page);
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  const width = page.getByRole("spinbutton", { name: "Ancho (X)", exact: true });
  await width.fill("35");
  await width.press("Enter");
  await page.getByRole("button", { name: "Cilindro", exact: true }).click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  await resizeAndInteract(page);
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await page.getByRole("button", { name: /Rehacer/ }).click();
  expect(errors).toEqual([]);
});

test("importing, selecting and reopening an STL stays responsive", async ({ page }) => {
  const errors = captureErrors(page);
  await newDesign(page);
  const vertices = [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, 20]];
  const triangles = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((tri, t) => tri.forEach((v, k) => vertices[v].forEach((n, axis) => buffer.writeFloatLE(n, 84 + t * 50 + 12 + k * 12 + axis * 4))));
  await page.locator('input[type="file"]').first().setInputFiles({ name: "tetra.stl", mimeType: "application/sla", buffer });
  await expect(page.getByText(/cm³/)).toBeVisible({ timeout: 30_000 });
  await resizeAndInteract(page);
  await page.getByRole("button", { name: "Volver a mis diseños" }).click();
  await expect(page.locator('img[src^="data:image/jpeg"]')).toBeVisible();
  await page.getByText("Diseño sin título", { exact: true }).click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  expect(errors).toEqual([]);
});

// Optional local stress fixture; never copy a user's design into the repository.
test("large existing design remains interactive at Retina window sizes", async ({ page }) => {
  test.skip(!process.env.AI3D_SAMPLE, "Set AI3D_SAMPLE to a local .ai3d design");
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  const design = JSON.parse(readFileSync(process.env.AI3D_SAMPLE!, "utf8"));
  await page.goto("/");
  await page.evaluate(async (doc) => {
    const storePath = "/src/store.ts", assetsPath = "/src/studio/assets.ts";
    const { useStore } = await import(storePath);
    const { loadAsset } = await import(assetsPath);
    for (const [id, asset] of Object.entries(doc.assets ?? {})) void loadAsset(id, asset);
    // No document path: this fixture is read-only and cannot autosave the source.
    useStore.setState({ view: "studio", doc, docPath: null, selectedId: doc.parts[0]?.id ?? null, leftTab: "scene" });
  }, design);
  await expect(page.getByText(/cm³/)).toBeVisible({ timeout: 120_000 });
  const stats = await page.evaluate(async () => {
    const storePath = "/src/store.ts", meshesPath = "/src/studio/meshes.ts";
    const { useStore } = await import(storePath);
    const { cachedMesh } = await import(meshesPath);
    const part = useStore.getState().doc.parts[0];
    const mesh = cachedMesh(part.type, part.params);
    return { triangles: mesh.triangles.length / 3, vertices: mesh.vertices.length / 3,
      bytes: mesh.vertices.byteLength + mesh.normals.byteLength + mesh.triangles.byteLength,
      expandedBytes: mesh.triangles.length / 3 * 84 };
  });
  console.log("Imported mesh buffers:", stats);
  expect(stats.bytes).toBeLessThan(stats.expandedBytes);
  await resizeAndInteract(page);
  await page.getByRole("button", { name: "Resultado", exact: true }).click();
  await page.getByRole("button", { name: "Piezas", exact: true }).click();
  expect(errors).toEqual([]);
});
