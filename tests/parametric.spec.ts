import { expect, test } from "@playwright/test";
import { evaluate, references, resolveVariables } from "../src/cad/expr";
import { loopDepths, profileLoops, rectangleSketch, solveSketch, type Sketch } from "../src/cad/sketch";
import { RACK, RACK_U, rackHoleHeights, rackPanelHeight } from "../src/cad/templates";
import { resolveParts } from "../src/studio/params";
import { newPart } from "../src/studio/parts";

// Etapas 6 y 7: fórmulas, bocetos con restricciones, historial y racks.

test("formulas evaluate safely and variables resolve in dependency order", () => {
  expect(evaluate("ancho - 2 * pared", { ancho: 100, pared: 2.5 })).toBe(95);
  expect(evaluate("2^3^2", {})).toBe(512);
  expect(evaluate("-(3 + 4) * 2", {})).toBe(-14);
  expect(evaluate("max(10, alto / 2) + sqrt(16)", { alto: 30 })).toBe(19);
  expect(evaluate("1,5 × 2", {})).toBe(3);
  expect(evaluate("max(1,5)", {})).toBe(5);
  expect(evaluate("máx_año * 2", { "máx_año": 4 })).toBe(8);
  expect(evaluate("cos(60) * 10", {})).toBeCloseTo(5);
  expect(() => evaluate("alert(1)", {})).toThrow(/Función desconocida/);
  expect(() => evaluate("ancho +", { ancho: 1 })).toThrow();
  expect(() => evaluate("x / 0", { x: 1 })).toThrow(/cero/);
  expect(references("max(ancho, alto) * pi")).toEqual(["ancho", "alto"]);

  const { values, errors } = resolveVariables([
    { name: "interior", expr: "exterior - 2 * pared" },
    { name: "exterior", expr: "120" },
    { name: "pared", expr: "2" },
    { name: "a", expr: "b + 1" },
    { name: "b", expr: "a + 1" },
  ]);
  expect(values.interior).toBe(116);
  expect(errors.a).toMatch(/circular|error/);
  expect(errors.b).toMatch(/circular|error/);
});

test("the solver satisfies constraints and formula dimensions drive the sketch", () => {
  const rect = rectangleSketch(40, 20);
  rect.constraints = rect.constraints.map((c) => (c.id === "c4" && "value" in c ? { ...c, value: "ancho" } : c));
  const solved = solveSketch(rect, { ancho: 75 });
  expect(solved.ok).toBe(true);
  const xs = solved.sketch.points.map((p) => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(75, 4);
  // El rectángulo sin anclar conserva 2 grados de libertad (su posición).
  expect(solved.freedom).toBe(2);

  // Triángulo con un ángulo y dos cotas.
  const tri: Sketch = {
    points: [{ id: "a", x: 0, y: 0, fixed: true }, { id: "b", x: 30, y: 1 }, { id: "c", x: 2, y: 25 }],
    entities: [{ id: "ab", kind: "line", a: "a", b: "b" }, { id: "bc", kind: "line", a: "b", b: "c" }, { id: "ca", kind: "line", a: "c", b: "a" }],
    constraints: [
      { id: "h", kind: "horizontal", line: "ab" },
      { id: "d1", kind: "distance", a: "a", b: "b", value: "40" },
      { id: "per", kind: "perpendicular", a: "ab", b: "ca" },
      { id: "d2", kind: "distance", a: "a", b: "c", value: "30" },
    ],
  };
  const t = solveSketch(tri);
  expect(t.ok).toBe(true);
  const p = Object.fromEntries(t.sketch.points.map((q) => [q.id, q]));
  expect(Math.hypot(p.c.x - p.b.x, p.c.y - p.b.y)).toBeCloseTo(50, 4);
  expect(t.freedom).toBe(0);

  // Restricciones imposibles se detectan.
  const bad = { ...tri, constraints: [...tri.constraints, { id: "v", kind: "vertical" as const, line: "ab" }] };
  expect(solveSketch(bad).ok).toBe(false);
});

test("closed loops become solids with holes; open outlines are reported", () => {
  const sketch = rectangleSketch(40, 20);
  sketch.points.push({ id: "c", x: 0, y: 0 });
  sketch.entities.push({ id: "k", kind: "circle", c: "c", r: 4 });
  const loops = profileLoops(sketch);
  expect(loops).toHaveLength(2);
  expect(loopDepths(loops).sort()).toEqual([0, 1]);
  const open = rectangleSketch(10, 10);
  open.entities.pop();
  expect(() => profileLoops(open)).toThrow(/abierto/);
});

test("changing a main variable updates formulas, sketch dimensions and dependent operations", () => {
  const box = newPart("box", { exprs: { width: "ancho", depth: "ancho / 2" }, features: [{ kind: "shell", thickness: 2, open: "top" }] });
  const sketch = newPart("sketch", { exprs: { height: "alto" } });
  const profile = rectangleSketch(40, 20);
  profile.constraints = profile.constraints.map((c) => (c.id === "c4" && "value" in c ? { ...c, value: "ancho - 2 * 3" } : c));
  sketch.params.profile = JSON.stringify(profile);
  const vars = [{ name: "ancho", expr: "80" }, { name: "alto", expr: "12" }];
  const r = resolveParts([box, sketch], vars);
  expect(r.errors).toEqual({});
  expect(r.parts[0].params.width).toBe(80);
  expect(r.parts[0].params.depth).toBe(40);
  expect(r.parts[0].features).toEqual(box.features);
  expect(r.parts[1].params.height).toBe(12);
  const xs = JSON.parse(String(r.parts[1].params.profile)).points.map((p: { x: number }) => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(74, 4);

  const tooBig = resolveParts([box], [{ name: "ancho", expr: "5000" }]);
  expect(tooBig.errors[box.id].width).toMatch(/fuera del rango/);
});

test("rack geometry follows EIA-310", () => {
  expect(rackPanelHeight(1)).toBeCloseTo(43.66, 2);
  expect(rackPanelHeight(2)).toBeCloseTo(88.11, 2);
  // Agujeros de una U: 6,35 / 22,225 / 38,1 mm desde el borde de la U (panel 0,395 mm más arriba).
  expect(rackHoleHeights(1, "all")).toEqual([5.955, 21.83, 37.705]);
  expect(rackHoleHeights(2, "outer")).toEqual([5.955, 37.705, 5.955 + RACK_U, 37.705 + RACK_U].map((v) => +v.toFixed(4)));
  expect(RACK["19"].holeSpacing).toBe(465.1);
  expect(RACK["10"].width).toBe(254);
});

test("engine builds sketches, rack parts and recalculates after a variable change", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const [c, P, S, K] = await Promise.all([import("/src/cad/client.ts" as string), import("/src/studio/parts.ts" as string), import("/src/store.ts" as string), import("/src/cad/sketch.ts" as string)]);
    await c.cadReady;
    const dims = (m: { bbox: { min: number[]; max: number[] } }) => m.bbox.max.map((v, i) => +(v - m.bbox.min[i]).toFixed(2));
    const out: Record<string, unknown> = {};
    const withHole = K.rectangleSketch(40, 20);
    withHole.points.push({ id: "c", x: 0, y: 0 });
    withHole.entities.push({ id: "k", kind: "circle", c: "c", r: 5 });
    const sk = P.newPart("sketch");
    out.hole = (await c.buildShape("sketch", { ...sk.params, profile: JSON.stringify(withHole) })).volume;
    const ring = K.rectangleSketch(10, 20);
    ring.points = ring.points.map((p: { x: number }) => ({ ...p, x: p.x + 15 }));
    out.revolve = (await c.buildShape("sketch", { ...sk.params, operation: "revolve", angle: 360, profile: JSON.stringify(ring) })).volume;
    for (const t of ["rack-panel", "rack-shelf", "rack-ears", "adjustable-bracket", "cable-pass"]) out[t] = dims(await c.buildShape(t, P.newPart(t).params));
    const half = { ...P.newPart("rack-panel").params, standard: "19", split: "left" };
    out.half = dims(await c.buildShape("rack-panel", half));
    out.panel19 = (await c.buildShape("rack-panel", { ...half, split: "full" })).volume;
    out.halves = (await c.buildShape("rack-panel", half)).volume + (await c.buildShape("rack-panel", { ...half, split: "right" })).volume;

    // Variable → fórmula → vaciado: la caja se rehace con la nueva medida.
    const store = S.useStore;
    store.setState({ doc: P.newDesign("Paramétrico"), docPath: null });
    store.getState().setVariables([{ name: "ancho", expr: "60" }]);
    store.getState().addPart("box");
    const id = store.getState().doc.parts[0].id;
    out.exprError = store.getState().setPartExpr(id, "width", "ancho + 10");
    store.getState().updatePart(id, { features: [{ kind: "shell", thickness: 2, open: "top" }] });
    const before = await c.combineScene(P.toScene(store.getState().doc.parts));
    store.getState().setVariables([{ name: "ancho", expr: "90" }]);
    const part = store.getState().doc.parts[0];
    const after = await c.combineScene(P.toScene(store.getState().doc.parts));
    store.getState().undo();
    out.undone = store.getState().doc.parts[0].params.width;
    out.widths = [dims(before)[0], part.params.width, dims(after)[0]];
    return out;
  });
  expect(r.hole as number).toBeCloseTo(8000 - Math.PI * 25 * 10, -1);
  expect(r.revolve as number).toBeCloseTo(Math.PI * (400 - 100) * 20, -2);
  expect(r["rack-panel"]).toEqual([254, 43.66, 3]);
  expect((r["rack-ears"] as number[])[0]).toBe(27);
  expect((r.half as number[])[0]).toBeLessThanOrEqual(256);
  // Las mitades suman el panel completo más el material del solape (menos los agujeros M3).
  expect(r.halves as number).toBeGreaterThan(r.panel19 as number);
  expect(r.exprError).toBeNull();
  expect(r.widths).toEqual([70, 100, 100]);
  expect(r.undone).toBe(70);
});

test("variables panel and sketch editor work from the interface", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^Lienzo en blanco/ }).click();
  await page.getByRole("button", { name: "Boceto", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /Editar boceto/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Guardar boceto" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText(/40 × 20 × 10 mm/)).toBeVisible();
  await page.getByRole("button", { name: /Escena/ }).click();
  await page.getByRole("button", { name: "Añadir variable" }).click();
  await expect(page.getByRole("textbox", { name: "Valor de v1" })).toBeVisible();
  expect(errors).toEqual([]);
});
