import { expect, test } from "@playwright/test";
import { alignedPosition, circularPattern, linearPattern, patternLimit, worldBounds } from "../src/studio/modeling";
import { newPart } from "../src/studio/parts";
import type { MeshPayload } from "../src/cad/client";
import { readFileSync } from "node:fs";

test("patterns preserve the source, orientation, identity and shared asset references", () => {
  const part = newPart("imported", { params: { asset: "shared-model", format: "3mf", scale: 645 },
    position: [10, 0, 5], rotation: [10, 20, 30], mirror: [true, false, false] });
  const line = linearPattern(part, [part], 2, 4, 12);
  expect(line.map((p) => p.position)).toEqual([[10, 0, 5], [10, 0, 17], [10, 0, 29], [10, 0, 41]]);
  expect(new Set(line.map((p) => p.id)).size).toBe(4);
  expect(new Set(line.map((p) => p.name)).size).toBe(4);
  expect(line.every((p) => p.params.asset === "shared-model" && p.params.scale === 645 && p.mirror?.[0])).toBe(true);
  const circle = circularPattern(part, [part], 4, [0, 0], true);
  expect(circle[1].position[0]).toBeCloseTo(0);
  expect(circle[1].position[1]).toBeCloseTo(10);
  expect(circle[1].rotation).toEqual([10, 20, 120]);
  expect(circle[2].position[0]).toBeCloseTo(-10);
  expect(circularPattern(part, [part], 4, [0, 0], false)[1].rotation).toEqual(part.rotation);
  expect(part.position).toEqual([10, 0, 5]);
  expect(() => linearPattern(part, [part], 0, 200, 10)).toThrow();
  expect(() => circularPattern(part, [part], 4, [10, 0], true)).toThrow();
  expect(patternLimit(1_023_026, 1)).toBe(2);
});

test("alignment uses transformed geometry, including imported scale and mirror", () => {
  const part = newPart("imported", { params: { format: "3mf", scale: 200 },
    position: [10, 20, 30], rotation: [0, 0, 90], mirror: [false, false, true] });
  const mesh = { vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 5]) } as MeshPayload;
  const box = worldBounds(part, mesh);
  expect(box.min[0]).toBeCloseTo(-30);
  expect(box.max[1]).toBeCloseTo(40);
  expect(box.min[2]).toBeCloseTo(20);
  const centered = alignedPosition(part, box, { min: [0, 0, 0], max: [0, 0, 0] }, [0, 1], "center");
  expect(centered[0]).toBeCloseTo(20);
  expect(centered[1]).toBeCloseTo(-10);
  expect(centered[2]).toBe(30);
});

test("new profiles produce valid exact solids and STEP exports", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const clientPath = "/src/cad/client.ts", partsPath = "/src/studio/parts.ts";
    const { cadReady, buildShape, combineScene, exportModel } = await import(clientPath);
    const { newPart, toScene } = await import(partsPath);
    await cadReady;
    const output = [];
    for (const type of ["rounded-plate", "slot", "profile-l", "profile-u"]) {
      const part = newPart(type);
      const mesh = await buildShape(type, part.params);
      const combined = await combineScene(toScene([part]));
      const step = new TextDecoder().decode(await exportModel("step", type));
      output.push({ type, exact: mesh.exact, volume: mesh.volume, minZ: mesh.bbox.min[2],
        dims: mesh.bbox.max.map((v: number, i: number) => v - mesh.bbox.min[i]),
        combinedVolume: combined.volume, step: step.startsWith("ISO-10303-21;") });
    }
    return output;
  });
  for (const result of results) {
    expect(result.exact).toBe(true);
    expect(result.step).toBe(true);
    expect(result.minZ).toBeCloseTo(0, 4);
    expect(result.volume).toBeGreaterThan(0);
    expect(result.combinedVolume).toBeCloseTo(result.volume, 2);
  }
  expect(results[0].dims).toEqual([40, 30, 3]);
  expect(results[1].dims).toEqual([40, 12, 10]);
  expect(results[2].volume).toBeCloseTo((30 * 3 + 30 * 3 - 3 * 3) * 40, 2);
  expect(results[3].volume).toBeCloseTo((30 * 3 + 2 * (20 - 3) * 3) * 40, 2);
});

test("mirrored exact and imported solids match their rotated previews and exports", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const clientPath = "/src/cad/client.ts", partsPath = "/src/studio/parts.ts", modelingPath = "/src/studio/modeling.ts";
    const { cadReady, buildShape, combineScene, exportModel, registerAsset } = await import(clientPath);
    const { newPart, toScene } = await import(partsPath);
    const { worldBounds } = await import(modelingPath);
    await cadReady;
    const points = [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, 20]];
    const faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
    const buffer = new ArrayBuffer(284), stl = new DataView(buffer);
    stl.setUint32(80, 4, true);
    faces.forEach((face, i) => face.forEach((v, k) => points[v].forEach((n, axis) => stl.setFloat32(84 + i * 50 + 12 + k * 12 + axis * 4, n, true))));
    await registerAsset("mirror-fixture", { kind: "mesh", data: new Uint8Array(buffer) });
    const parts = [newPart("profile-l"), newPart("imported", { params: { asset: "mirror-fixture", format: "stl", scale: 100 } })];
    const output = [];
    for (const part of parts) {
      const base = await buildShape(part.type, part.params);
      part.position = [5, -7, 11];
      part.rotation = [20, 35, 65];
      part.mirror = [true, false, true];
      if (part.type === "imported") part.params.scale = 645;
      const expected = worldBounds(part, base);
      const actual = await combineScene(toScene([part]));
      const exported = new DataView((await exportModel("stl", "mirrored")).buffer);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < exported.getUint32(80, true); i++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
        const value = exported.getFloat32(84 + i * 50 + 12 + v * 12 + a * 4, true);
        min[a] = Math.min(min[a], value); max[a] = Math.max(max[a], value);
      }
      output.push({ type: part.type, expected, bbox: actual.bbox, exported: { min, max },
        ratio: actual.volume / base.volume, mirror: JSON.parse(JSON.stringify(part)).mirror });
    }
    return output;
  });
  for (const result of results) {
    for (const edge of ["min", "max"] as const) for (let axis = 0; axis < 3; axis++) {
      expect(result.bbox[edge][axis]).toBeCloseTo(result.expected[edge][axis], 3);
      expect(result.exported[edge][axis]).toBeCloseTo(result.expected[edge][axis], 3);
    }
    expect(result.ratio).toBeCloseTo(result.type === "imported" ? 6.45 ** 3 : 1, 3);
    expect(result.mirror).toEqual([true, false, true]);
  }
});

test("editing panel aligns, mirrors and repeats with one undo; examples stay collapsed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  await expect(page.getByRole("button", { name: "Soporte para plumones y borrador" })).toBeHidden();
  await expect(page.getByText("Selecciona una pieza para alinear", { exact: false })).toBeVisible();
  for (const name of ["Perfil L", "Perfil U", "Ranura", "Placa redondeada"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Perfil L", exact: true }).click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  await page.getByRole("button", { name: "Espejo", exact: true }).click();
  await page.getByRole("button", { name: "Espejo en Z", exact: true }).click();
  await expect(page.getByRole("button", { name: "Espejo en Z", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Apoyar", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    return useStore.getState().doc.parts[0].position[2];
  })).toBeCloseTo(40, 3);
  await page.getByRole("button", { name: "Lineal", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Cantidad del patrón" }).fill("4");
  await page.getByRole("spinbutton", { name: "Separación del patrón" }).fill("40");
  await page.getByRole("button", { name: "Crear patrón", exact: true }).click();
  const count = () => page.evaluate(async () => { const path = "/src/store.ts"; const { useStore } = await import(path); return useStore.getState().doc.parts.length; });
  await expect.poll(count).toBe(4);
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect.poll(count).toBe(1);
  await page.getByRole("button", { name: "Circular", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Cantidad del patrón" }).fill("3");
  await page.getByRole("button", { name: "Crear patrón", exact: true }).click();
  await expect.poll(count).toBe(3);
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect.poll(count).toBe(1);
  await page.getByRole("button", { name: "Alinear", exact: true }).click();
  if (process.env.AI3D_SCREENSHOT) await page.screenshot({ path: process.env.AI3D_SCREENSHOT });
  await page.getByRole("button", { name: "Aplicar alineación", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    return useStore.getState().doc.parts[0].position.slice(0, 2);
  })).toEqual([0, 0]);
  await page.getByText("Biblioteca de ejemplos", { exact: false }).click();
  await expect(page.getByRole("button", { name: "Soporte para plumones y borrador", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  const reference = await page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    const state = useStore.getState();
    state.updatePart(state.selectedId, { position: [80, 60, 10], rotation: [10, 0, 45] });
    return state.doc.parts[0].id;
  });
  await page.getByRole("button", { name: "Alinear", exact: true }).click();
  await page.getByRole("combobox", { name: "Referencia de alineación" }).selectOption(reference);
  await page.getByRole("button", { name: "Aplicar alineación", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const storePath = "/src/store.ts", meshesPath = "/src/studio/meshes.ts", modelingPath = "/src/studio/modeling.ts";
    const { useStore } = await import(storePath);
    const { cachedMesh } = await import(meshesPath);
    const { worldBounds } = await import(modelingPath);
    const state = useStore.getState(), part = state.doc.parts.find((p: any) => p.id === state.selectedId);
    const box = worldBounds(part, cachedMesh(part.type, part.params));
    return Math.abs(box.min[0] + box.max[0]) + Math.abs(box.min[1] + box.max[1]);
  })).toBeLessThan(0.001);
});

test("large imported models support mirror and a disjoint pattern without new base copies", async ({ page }) => {
  test.skip(!process.env.AI3D_SAMPLE, "Set AI3D_SAMPLE to a local .ai3d design");
  test.setTimeout(120_000);
  const doc = JSON.parse(readFileSync(process.env.AI3D_SAMPLE!, "utf8"));
  await page.goto("/");
  await page.evaluate(async (design) => {
    const storePath = "/src/store.ts", assetsPath = "/src/studio/assets.ts";
    const { useStore } = await import(storePath);
    const { loadAsset } = await import(assetsPath);
    await Promise.all(Object.entries(design.assets).map(([id, asset]) => loadAsset(id, asset)));
    useStore.setState({ view: "studio", doc: design, docPath: null, selectedId: design.parts[0].id, leftTab: "insert" });
  }, doc);
  await expect(page.getByText(/cm³/)).toBeVisible({ timeout: 60_000 });
  const original = await page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    const result = useStore.getState().result;
    return { width: result.bbox.max[0] - result.bbox.min[0], volume: result.volume, triangles: result.triangles.length / 3 };
  });
  await page.getByRole("button", { name: "Espejo", exact: true }).click();
  await page.getByRole("button", { name: "Espejo en X", exact: true }).click();
  await expect(page.getByRole("button", { name: "Espejo en X", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Lineal", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Cantidad del patrón" })).toHaveValue("2");
  await page.getByRole("button", { name: "Crear patrón", exact: true }).click();
  const state = () => page.evaluate(async () => {
    const path = "/src/store.ts"; const { useStore } = await import(path);
    const { result, buildError } = useStore.getState();
    return { volume: result?.volume ?? 0, triangles: (result?.triangles.length ?? 0) / 3, error: buildError };
  });
  await expect.poll(async () => (await state()).triangles, { timeout: 60_000 }).toBe(original.triangles * 2);
  expect((await state()).volume / original.volume).toBeCloseTo(2, 3);
  expect((await state()).error).toBeNull();
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect.poll(async () => (await state()).triangles, { timeout: 60_000 }).toBe(original.triangles);
});
