import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { angleBetween, chainFrom, fitCircle, measureOne, measureTwo } from "../src/studio/measure";
import { gridPattern, localPlane, rotationFromNormal } from "../src/studio/modeling";
import { newPart } from "../src/studio/parts";
import type { Vec3 } from "../src/cad/types";

// Etapas 1–5: recuperación del motor, medición, cuerpos, cajas y fijaciones.

const ring = (r: number, n: number, z = 0): Vec3[] => Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n) + 5, r * Math.sin((2 * Math.PI * i) / n), z]);

test("measurement recognises circles, parallel faces, plane distances and edge angles", () => {
  const circle = fitCircle(ring(4, 32))!;
  expect(circle.radius).toBeCloseTo(4, 3);
  expect(circle.closed).toBe(true);
  expect(circle.center[0]).toBeCloseTo(5, 3);
  expect(fitCircle([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 0], [5, 0, 0]])).toBeNull();

  const segments = ring(4, 32).slice(0, -1).flatMap((p, i, all) => [...p, ...all[(i + 1) % all.length]]);
  const chain = chainFrom(segments, 5);
  expect(chain.length).toBeGreaterThanOrEqual(32);
  expect(fitCircle(chain)!.radius).toBeCloseTo(4, 3);

  const hole = measureOne({ kind: "edge", point: [9, 0, 0], a: [0, 0, 0], b: [1, 0, 0], length: 25.1, circle })!;
  expect(hole.label).toBe("Ø 8 mm");

  const wall = measureTwo({ kind: "face", point: [0, 0, 0], normal: [0, -1, 0] }, { kind: "face", point: [3, 2.4, 7], normal: [0, 1, 0] });
  expect(wall.label).toBe("2,4 mm");
  const toPlane = measureTwo({ kind: "point", point: [1, 2, 13] }, { kind: "face", point: [0, 0, 3], normal: [0, 0, 1] });
  expect(toPlane.label).toBe("10 mm");
  const corner = measureTwo({ kind: "edge", point: [0, 0, 0], a: [0, 0, 0], b: [10, 0, 0], length: 10 }, { kind: "edge", point: [0, 0, 0], a: [0, 0, 0], b: [10, 10, 0], length: 14 });
  expect(corner.label).toBe("45°");
  const points = measureTwo({ kind: "point", point: [0, 0, 0] }, { kind: "point", point: [3, 4, 0] });
  expect(points.label).toBe("5 mm");
  expect(angleBetween([1, 0, 0], [0, 0, 1])).toBeCloseTo(90);
});

test("planes, normals and grids follow each part's transform", () => {
  const part = newPart("box", { position: [10, 20, 30], rotation: [0, 0, 90], mirror: [true, false, false] });
  // Plano del mundo x = 15 → en local, tras rotar 90° en Z y espejar X.
  const plane = localPlane(part, 0, 15, "below");
  const local: Vec3 = [0, -5, 0];
  // Comprobación directa: el punto local (0, −5, 0) cae en x = 10 + 5 = 15 del mundo.
  expect(plane.normal[0] * local[0] + plane.normal[1] * local[1] + plane.normal[2] * local[2]).toBeCloseTo(plane.offset);
  const above = localPlane(part, 0, 15, "above");
  expect(above.offset).toBeCloseTo(-plane.offset);

  for (const n of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 0, -1], [0.6, 0, 0.8]] as Vec3[]) {
    const [rx, ry, rz] = rotationFromNormal(n).map((d) => (d * Math.PI) / 180);
    // Rz·Ry·Rx aplicado a +Z.
    const x = Math.cos(rz) * Math.sin(ry) * Math.cos(rx) + Math.sin(rz) * Math.sin(rx);
    const y = Math.sin(rz) * Math.sin(ry) * Math.cos(rx) - Math.cos(rz) * Math.sin(rx);
    const z = Math.cos(ry) * Math.cos(rx);
    expect([x, y, z].map((v, i) => Math.abs(v - n[i]) < 1e-4)).toEqual([true, true, true]);
  }

  const grid = gridPattern(part, [part], [3, 2], [5, 7]);
  expect(grid).toHaveLength(6);
  expect(grid[5].position).toEqual([20, 27, 30]);
});

test("engine builds shells, edge finishes, splits, holes and enclosures", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const [c, P, M] = await Promise.all([import("/src/cad/client.ts" as string), import("/src/studio/parts.ts" as string), import("/src/studio/modeling.ts" as string)]);
    await c.cadReady;
    const box = { width: 40, depth: 30, height: 20, radius: 0 };
    const plain = await c.buildShape("box", box);
    const groups = Array.from(plain.edgeGroups as Uint32Array);
    const shell = await c.buildShape("box", box, [{ kind: "shell", thickness: 2, open: "top" }]);
    const fillet = await c.buildShape("box", box, [{ kind: "fillet", size: 3, edges: [[20, 15, 10]] }]);
    const chamfer = await c.buildShape("box", box, [{ kind: "chamfer", size: 2, edges: [[0, 15, 20]] }]);
    let missing = "";
    try { await c.buildShape("box", box, [{ kind: "fillet", size: 3, edges: [[5, 5, 5]] }]); } catch (e) { missing = (e as Error).message; }

    // Malla: tetraedro de 20 mm dividido a media altura.
    const pts = [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, 20]], faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
    const buffer = new ArrayBuffer(284), stl = new DataView(buffer);
    stl.setUint32(80, 4, true);
    faces.forEach((f, i) => f.forEach((v, k) => pts[v].forEach((n, a) => stl.setFloat32(84 + i * 50 + 12 + k * 12 + a * 4, n, true))));
    await c.registerAsset("tetra", { kind: "mesh", data: new Uint8Array(buffer) });
    const tetra = P.newPart("imported", { params: { asset: "tetra", format: "stl", scale: 100 } });
    const [low, high] = M.splitPart(tetra, [tetra], 2, 10, "Tapa");
    const meshSplit = [(await c.buildShape(low.type, low.params, low.features)).volume, (await c.buildShape(high.type, high.params, high.features)).volume];
    let meshShell = "";
    try { await c.buildShape(tetra.type, tetra.params, [{ kind: "shell", thickness: 1, open: "top" }]); } catch (e) { meshShell = (e as Error).message; }

    const holes: Record<string, number[]> = {};
    for (const head of ["none", "counterbore", "countersink", "nut", "insert"]) {
      const h = await c.buildShape("screw-hole", { ...P.newPart("screw-hole").params, head, through: false, depth: 8 });
      holes[head] = h.bbox.max.map((v: number, i: number) => +(v - h.bbox.min[i]).toFixed(2));
    }
    const enclosure = P.newPart("enclosure");
    const shellBox = await c.buildShape("enclosure", enclosure.params);
    const lid = await c.buildShape("enclosure", { ...enclosure.params, piece: "lid" });
    return {
      segments: plain.edges.length / 6, groupSegments: groups.filter((_, i) => i % 2).reduce((a, b) => a + b, 0), groupCount: groups.length / 2,
      shell: shell.volume, fillet: fillet.volume, chamfer: chamfer.volume, missing, meshSplit, meshShell, holes,
      box: shellBox.bbox.max.map((v: number, i: number) => +(v - shellBox.bbox.min[i]).toFixed(2)),
      lid: lid.bbox.max.map((v: number, i: number) => +(v - lid.bbox.min[i]).toFixed(2)),
    };
  });
  expect(r.groupCount).toBe(12);
  expect(r.groupSegments).toBe(r.segments);
  expect(r.shell).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 18, 0);
  expect(r.fillet).toBeCloseTo(24000 - (9 - (Math.PI * 9) / 4) * 20, 0);
  expect(r.chamfer).toBeCloseTo(24000 - 2 * 40, 0);
  expect(r.missing).toMatch(/ya no existen/);
  expect(r.meshSplit[0]).toBeCloseTo(8000 / 6 - 1000 / 6, 1);
  expect(r.meshSplit[1]).toBeCloseTo(1000 / 6, 1);
  expect(r.meshShell).toMatch(/figuras nativas y modelos STEP/);
  expect(r.holes.none).toEqual([3.4, 3.4, 9]);
  expect(r.holes.counterbore).toEqual([6, 6, 9]);
  expect(r.holes.countersink).toEqual([6.3, 6.3, 9]);
  expect(r.holes.nut[0]).toBe(5.8);
  expect(r.holes.insert).toEqual([4, 4, 9]);
  // 100 × 60 × 30 interiores con paredes de 2 y fondo de 2.
  expect(r.box).toEqual([104, 64, 32]);
  expect(r.lid[0]).toBe(104);
  expect(r.lid[2]).toBeCloseTo(5, 1);
});

test("electronics enclosure: linked box and lid, vents and screw holes cut only their body, exports keep bodies", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const [c, P, S, T] = await Promise.all([import("/src/cad/client.ts" as string), import("/src/studio/parts.ts" as string), import("/src/store.ts" as string), import("/src/cad/templates.ts" as string)]);
    await c.cadReady;
    const store = S.useStore;
    store.setState({ doc: P.newDesign("Prueba"), docPath: null });
    store.getState().addPart("enclosure");
    const [box, lid] = store.getState().doc.parts;
    store.getState().setPartParam(box.id, "length", 120);
    const linked = store.getState().doc.parts.map((p: { params: { length: number; piece: string }; body: string }) => [p.params.length, p.params.piece, p.body]);
    // Rejilla en la pared frontal (y mínima) de la caja, pasante, solo en el cuerpo «Caja».
    const outer = T.enclosureOuter(store.getState().doc.parts[0].params);
    const vent = P.newPart("vent", { params: { ...P.newPart("vent").params, depth: 2 }, cutBodies: ["Caja"], estimated: [] });
    vent.rotation = [90, 0, 0];
    vent.position = [0, -outer.width / 2 + T.entryOffset(vent.params), 16];
    const holeOnLid = P.newPart("screw-hole", { cutBodies: ["Tapa"], position: [lid.position[0] + 20, 0, -1], estimated: [] });
    store.getState().addParts([vent, holeOnLid]);
    const parts = store.getState().doc.parts;
    const before = await c.combineScene(P.toScene(parts.slice(0, 2)));
    const after = await c.combineScene(P.toScene(parts));
    const vol = (m: { bodies: { name: string; volume: number }[] }, name: string) => m.bodies.find((b) => b.name === name)!.volume;
    const file = await c.exportModel("3mf", "Caja", { parts: P.toScene(parts), colors: P.bodyColors(parts) });
    const onlyLid = await c.exportModel("stl", "Tapa", { parts: P.toScene(parts), body: "Tapa" });
    const everything = await c.exportModel("stl", "Todo", { parts: P.toScene(parts) });
    return {
      linked, bodies: after.bodies.map((b: { name: string }) => b.name),
      boxCut: vol(before, "Caja") - vol(after, "Caja"), lidCut: vol(before, "Tapa") - vol(after, "Tapa"),
      file: Array.from(file as Uint8Array),
      lidTriangles: new DataView(onlyLid.buffer).getUint32(80, true), allTriangles: new DataView(everything.buffer).getUint32(80, true),
    };
  });
  expect(r.linked).toEqual([[120, "box", "Caja"], [120, "lid", "Tapa"]]);
  expect(r.bodies).toEqual(["Caja", "Tapa"]);
  // 6 ranuras de 3 × 25 mm en una pared de 2 mm.
  expect(r.boxCut).toBeGreaterThan(6 * (3 * 22 + Math.PI * 2.25) * 2 * 0.95);
  expect(r.lidCut).toBeGreaterThan(0);
  const xml = strFromU8(unzipSync(Uint8Array.from(r.file))["3D/3dmodel.model"]);
  expect(xml.match(/<object /g)).toHaveLength(2);
  expect(xml.match(/displaycolor=/g)).toHaveLength(2);
  expect([...xml.matchAll(/<object [^>]*name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Caja", "Tapa"]);
  expect(r.lidTriangles).toBeGreaterThan(0);
  expect(r.lidTriangles).toBeLessThan(r.allTriangles);
});

test("a cancelled calculation restarts the engine and keeps imported models available", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const [c, P] = await Promise.all([import("/src/cad/client.ts" as string), import("/src/studio/parts.ts" as string)]);
    await c.cadReady;
    const pts = [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, 20]], faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
    const buffer = new ArrayBuffer(284), stl = new DataView(buffer);
    stl.setUint32(80, 4, true);
    faces.forEach((f, i) => f.forEach((v, k) => pts[v].forEach((n, a) => stl.setFloat32(84 + i * 50 + 12 + k * 12 + a * 4, n, true))));
    await c.registerAsset("restart-tetra", { kind: "mesh", data: new Uint8Array(buffer) });
    const heavy = Array.from({ length: 24 }, (_, i) => P.newPart("torus", { position: [i * 3, 0, 0] }));
    const pending = c.combineScene(P.toScene(heavy)).then(() => "done", (e: Error) => (e instanceof c.CadInterrupted ? "interrupted" : e.message));
    await new Promise((resolve) => setTimeout(resolve, 50));
    c.cancelCad();
    const outcome = await pending;
    await c.cadReady;
    const tetra = P.newPart("imported", { params: { asset: "restart-tetra", format: "stl", scale: 100 } });
    const after = await c.combineScene(P.toScene([tetra]));
    return { outcome, volume: after.volume };
  });
  expect(r.outcome).toBe("interrupted");
  expect(r.volume).toBeCloseTo(8000 / 6, 1);
});
