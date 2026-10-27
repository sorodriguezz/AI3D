import { evaluate, references } from "./expr";

// Bocetos 2D con restricciones. El boceto se guarda dentro de los parámetros de la pieza
// («profile», JSON). Se resuelve en la interfaz; el motor CAD solo lee las posiciones ya resueltas.

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  fixed?: boolean;
}

export type SketchEntity =
  | { id: string; kind: "line"; a: string; b: string; construction?: boolean }
  /** Circunferencia completa de centro `c`. */
  | { id: string; kind: "circle"; c: string; r: number; construction?: boolean }
  /** Arco antihorario de centro `c` desde `a` hasta `b`. */
  | { id: string; kind: "arc"; c: string; a: string; b: string; construction?: boolean };

export type Constraint =
  | { id: string; kind: "horizontal" | "vertical"; line: string }
  | { id: string; kind: "parallel" | "perpendicular" | "equal"; a: string; b: string }
  | { id: string; kind: "coincident"; a: string; b: string }
  | { id: string; kind: "tangent"; line: string; curve: string }
  /** Distancia entre dos puntos, o su componente horizontal / vertical. */
  | { id: string; kind: "distance" | "hdistance" | "vdistance"; a: string; b: string; value: string }
  | { id: string; kind: "radius" | "diameter"; entity: string; value: string }
  | { id: string; kind: "angle"; a: string; b: string; value: string };

export interface Sketch {
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: Constraint[];
}

export const parseSketch = (raw: unknown): Sketch => {
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (s && Array.isArray(s.points) && Array.isArray(s.entities) && Array.isArray(s.constraints)) return s as Sketch;
  } catch {
    // Se devuelve un boceto vacío.
  }
  return { points: [], entities: [], constraints: [] };
};

let counter = 0;
export const sid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Rectángulo acotado centrado en el origen, el boceto inicial. */
export function rectangleSketch(width: number, height: number): Sketch {
  const p = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]].map(([x, y], i) => ({ id: `p${i}`, x, y }));
  const lines = [0, 1, 2, 3].map((i) => ({ id: `l${i}`, kind: "line" as const, a: `p${i}`, b: `p${(i + 1) % 4}` }));
  return {
    points: p,
    entities: lines,
    constraints: [
      { id: "c0", kind: "horizontal", line: "l0" }, { id: "c1", kind: "horizontal", line: "l2" },
      { id: "c2", kind: "vertical", line: "l1" }, { id: "c3", kind: "vertical", line: "l3" },
      { id: "c4", kind: "hdistance", a: "p0", b: "p1", value: String(width) },
      { id: "c5", kind: "vdistance", a: "p1", b: "p2", value: String(height) },
    ],
  };
}

/** Valores de las cotas: fórmulas evaluadas con las variables del diseño. */
export function dimensionValues(sketch: Sketch, scope: Record<string, number>) {
  const out: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const c of sketch.constraints) {
    if (!("value" in c)) continue;
    try {
      const v = evaluate(c.value, scope);
      if (c.kind !== "angle" && v < 0) throw new Error("La cota debe ser positiva.");
      out[c.id] = v;
    } catch (e) {
      errors[c.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return { values: out, errors };
}

export const sketchReferences = (sketch: Sketch) => [...new Set(sketch.constraints.flatMap((c) => ("value" in c ? references(c.value) : [])))];

// ---------------------------------------------------------------- Resolvedor

type Vars = { index: Map<string, number>; x: number[] };

function unknowns(sketch: Sketch, pinned: Set<string>): Vars {
  const index = new Map<string, number>();
  const x: number[] = [];
  for (const p of sketch.points) {
    if (p.fixed || pinned.has(p.id)) continue;
    index.set(p.id, x.length);
    x.push(p.x, p.y);
  }
  for (const e of sketch.entities) if (e.kind === "circle") (index.set("r:" + e.id, x.length), x.push(e.r));
  return { index, x };
}

/**
 * Ecuaciones (residuos) de las restricciones; cero cuando se cumplen.
 * `ref` conserva el signo de las cotas orientadas (horizontales, verticales y ángulos).
 */
function residuals(sketch: Sketch, vars: Vars, x: number[], values: Record<string, number>, ref: Map<string, number>): number[] {
  const points = new Map(sketch.points.map((p) => [p.id, p]));
  const entities = new Map(sketch.entities.map((e) => [e.id, e]));
  const P = (id: string): [number, number] => {
    const i = vars.index.get(id);
    if (i !== undefined) return [x[i], x[i + 1]];
    const p = points.get(id)!;
    return [p.x, p.y];
  };
  const radius = (e: SketchEntity): number => {
    if (e.kind === "circle") {
      const i = vars.index.get("r:" + e.id);
      return i !== undefined ? x[i] : e.r;
    }
    if (e.kind === "arc") {
      const [c, a] = [P(e.c), P(e.a)];
      return Math.hypot(a[0] - c[0], a[1] - c[1]);
    }
    const [a, b] = [P(e.a), P(e.b)];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const dir = (id: string): [number, number] => {
    const e = entities.get(id);
    if (!e || e.kind !== "line") return [1, 0];
    const [a, b] = [P(e.a), P(e.b)];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const out: number[] = [];
  // Los arcos mantienen el mismo radio en ambos extremos.
  for (const e of sketch.entities) {
    if (e.kind !== "arc") continue;
    const [c, a, b] = [P(e.c), P(e.a), P(e.b)];
    out.push(Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1]));
  }
  for (const c of sketch.constraints) {
    switch (c.kind) {
      case "horizontal":
      case "vertical": {
        const e = entities.get(c.line);
        if (!e || e.kind !== "line") break;
        const [a, b] = [P(e.a), P(e.b)];
        out.push(c.kind === "horizontal" ? b[1] - a[1] : b[0] - a[0]);
        break;
      }
      case "coincident": {
        const [a, b] = [P(c.a), P(c.b)];
        out.push(a[0] - b[0], a[1] - b[1]);
        break;
      }
      case "parallel":
      case "perpendicular": {
        const [u, v] = [dir(c.a), dir(c.b)];
        const n = Math.hypot(...u) * Math.hypot(...v) || 1;
        out.push(c.kind === "parallel" ? (u[0] * v[1] - u[1] * v[0]) / n : (u[0] * v[0] + u[1] * v[1]) / n);
        break;
      }
      case "equal": {
        const [a, b] = [entities.get(c.a), entities.get(c.b)];
        if (a && b) out.push(radius(a) - radius(b));
        break;
      }
      case "tangent": {
        const [line, curve] = [entities.get(c.line), entities.get(c.curve)];
        if (!line || line.kind !== "line" || !curve || curve.kind === "line") break;
        const [a, b, center] = [P(line.a), P(line.b), P(curve.c)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        out.push(Math.abs((b[0] - a[0]) * (center[1] - a[1]) - (b[1] - a[1]) * (center[0] - a[0])) / len - radius(curve));
        break;
      }
      case "distance": {
        if (values[c.id] === undefined) break;
        const [a, b] = [P(c.a), P(c.b)];
        out.push(Math.hypot(b[0] - a[0], b[1] - a[1]) - values[c.id]);
        break;
      }
      case "hdistance":
      case "vdistance": {
        if (values[c.id] === undefined) break;
        const k = c.kind === "hdistance" ? 0 : 1;
        const [a, b] = [P(c.a), P(c.b)];
        out.push(b[k] - a[k] - (ref.get(c.id) ?? 1) * values[c.id]);
        break;
      }
      case "radius":
      case "diameter": {
        const e = entities.get(c.entity);
        if (!e || values[c.id] === undefined) break;
        out.push(radius(e) - (c.kind === "diameter" ? values[c.id] / 2 : values[c.id]));
        break;
      }
      case "angle": {
        if (values[c.id] === undefined) break;
        const [u, v] = [dir(c.a), dir(c.b)];
        const angle = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
        out.push(Math.abs(angle) - (values[c.id] * Math.PI) / 180);
        break;
      }
    }
  }
  return out;
}

/** Resuelve A·d = b (matriz simétrica definida positiva) por eliminación gaussiana. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f) for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export interface SolveResult {
  sketch: Sketch;
  ok: boolean;
  /** Error residual máximo, en mm. */
  error: number;
  /** Grados de libertad aproximados que quedan sin restringir. */
  freedom: number;
  /** Errores de fórmulas en las cotas. */
  dimensionErrors: Record<string, string>;
}

/**
 * Ajusta los puntos para cumplir todas las restricciones, moviéndolos lo menos posible
 * (Levenberg–Marquardt con jacobiano numérico). `pinned` mantiene quietos los puntos que se arrastran.
 */
export function solveSketch(sketch: Sketch, scope: Record<string, number> = {}, pinned: Set<string> = new Set()): SolveResult {
  const { values, errors } = dimensionValues(sketch, scope);
  const vars = unknowns(sketch, pinned);
  // Las cotas orientadas conservan el sentido actual del dibujo.
  const ref = new Map<string, number>();
  const at = new Map(sketch.points.map((p) => [p.id, p]));
  for (const c of sketch.constraints) {
    if (c.kind === "hdistance" || c.kind === "vdistance") {
      const k = c.kind === "hdistance" ? "x" : "y";
      ref.set(c.id, (at.get(c.b)?.[k] ?? 0) - (at.get(c.a)?.[k] ?? 0) < 0 ? -1 : 1);
    }
  }
  let x = vars.x.slice();
  const n = x.length;
  let r = residuals(sketch, vars, x, values, ref);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  for (let iter = 0; iter < 200 && cost > 1e-16 && n > 0; iter++) {
    const m = r.length;
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j]));
      const xp = x.slice();
      xp[j] += h;
      const rp = residuals(sketch, vars, xp, values, ref);
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      // Amortiguación más un término pequeño que favorece el desplazamiento mínimo.
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (1 + v) + 1e-9 : v)));
      const d = solveLinear(A, Jtr.map((v) => -v));
      if (!d) {
        lambda *= 10;
        continue;
      }
      const xn = x.map((v, i) => v + d[i]);
      const rn = residuals(sketch, vars, xn, values, ref);
      const cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) {
        [x, r, cost] = [xn, rn, cn];
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  const solved: Sketch = {
    ...sketch,
    points: sketch.points.map((p) => {
      const i = vars.index.get(p.id);
      return i === undefined ? p : { ...p, x: +x[i].toFixed(6), y: +x[i + 1].toFixed(6) };
    }),
    entities: sketch.entities.map((e) => {
      const i = vars.index.get("r:" + e.id);
      return i === undefined || e.kind !== "circle" ? e : { ...e, r: +Math.abs(x[i]).toFixed(6) };
    }),
  };
  const error = r.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
  return { sketch: solved, ok: error < 1e-4 && !Object.keys(errors).length, error, freedom: Math.max(0, n - rankOf(sketch, vars, x, values, ref)), dimensionErrors: errors };
}

/** Rango numérico del jacobiano: cuántas ecuaciones independientes hay. */
function rankOf(sketch: Sketch, vars: Vars, x: number[], values: Record<string, number>, ref: Map<string, number>): number {
  const n = x.length;
  if (!n) return 0;
  const r = residuals(sketch, vars, x, values, ref);
  const J = r.map(() => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const xp = x.slice();
    xp[j] += 1e-6;
    const rp = residuals(sketch, vars, xp, values, ref);
    for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - r[i]) / 1e-6;
  }
  let rank = 0;
  const rows = J.map((row) => row.slice());
  for (let col = 0; col < n && rank < rows.length; col++) {
    let pivot = rank;
    for (let i = rank + 1; i < rows.length; i++) if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i;
    if (Math.abs(rows[pivot][col]) < 1e-7) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    for (let i = rank + 1; i < rows.length; i++) {
      const f = rows[i][col] / rows[rank][col];
      for (let k = col; k < n; k++) rows[i][k] -= f * rows[rank][k];
    }
    rank++;
  }
  return rank;
}

// ---------------------------------------------------------------- Contornos

export type ProfileSegment = { kind: "line"; to: [number, number] } | { kind: "arc"; to: [number, number]; mid: [number, number] };
export type ProfileLoop = { start: [number, number]; segments: ProfileSegment[]; circle?: { c: [number, number]; r: number } };

/** Punto medio de un arco antihorario de centro c entre a y b. */
function arcMid(c: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  if (a1 <= a0) a1 += 2 * Math.PI;
  const m = (a0 + a1) / 2;
  return [c[0] + r * Math.cos(m), c[1] + r * Math.sin(m)];
}

/**
 * Contornos cerrados del boceto (las líneas de construcción no cuentan).
 * Lanza un error si queda algún extremo suelto.
 */
export function profileLoops(sketch: Sketch): ProfileLoop[] {
  const pts = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as [number, number]]));
  // Los puntos coincidentes por restricción se tratan como uno solo.
  const alias = new Map<string, string>();
  const root = (id: string): string => (alias.has(id) ? root(alias.get(id)!) : id);
  for (const c of sketch.constraints) if (c.kind === "coincident" && root(c.a) !== root(c.b)) alias.set(root(c.b), root(c.a));
  const loops: ProfileLoop[] = [];
  const edges = sketch.entities.filter((e) => !e.construction && e.kind !== "circle") as Extract<SketchEntity, { kind: "line" | "arc" }>[];
  for (const e of sketch.entities) if (e.kind === "circle" && !e.construction && e.r > 1e-6) loops.push({ start: pts.get(e.c)!, segments: [], circle: { c: pts.get(e.c)!, r: e.r } });
  const byPoint = new Map<string, typeof edges>();
  for (const e of edges) for (const p of [root(e.a), root(e.b)]) byPoint.set(p, [...(byPoint.get(p) ?? []), e]);
  for (const list of byPoint.values()) if (list.length !== 2) throw new Error(list.length < 2 ? "El boceto tiene un contorno abierto: une los extremos sueltos." : "El boceto tiene líneas que se cruzan en un mismo punto; separa los contornos.");
  const used = new Set<string>();
  for (const first of edges) {
    if (used.has(first.id)) continue;
    const start = root(first.a);
    const loop: ProfileLoop = { start: pts.get(first.a)!, segments: [] };
    let edge = first, from = start;
    for (let guard = 0; guard <= edges.length; guard++) {
      used.add(edge.id);
      const forward = root(edge.a) === from;
      const to = forward ? root(edge.b) : root(edge.a);
      const end = pts.get(forward ? edge.b : edge.a)!;
      if (edge.kind === "line") loop.segments.push({ kind: "line", to: end });
      else {
        const [c, a, b] = [pts.get(edge.c)!, pts.get(edge.a)!, pts.get(edge.b)!];
        loop.segments.push({ kind: "arc", to: end, mid: arcMid(c, a, b) });
      }
      from = to;
      if (from === start) break;
      const next = byPoint.get(from)!.find((e) => !used.has(e.id));
      if (!next) break;
      edge = next;
    }
    if (from !== start) throw new Error("El boceto tiene un contorno abierto: une los extremos sueltos.");
    if (loop.segments.length < 2 && loop.segments[0]?.kind !== "arc") throw new Error("Un contorno necesita al menos tres lados.");
    loops.push(loop);
  }
  if (!loops.length) throw new Error("El boceto no tiene contornos cerrados.");
  return loops;
}

/** Polígono aproximado de un contorno, para saber qué contornos quedan dentro de otros. */
export function loopPolygon(loop: ProfileLoop): [number, number][] {
  if (loop.circle) return Array.from({ length: 32 }, (_, i) => [loop.circle!.c[0] + loop.circle!.r * Math.cos((i / 32) * 2 * Math.PI), loop.circle!.c[1] + loop.circle!.r * Math.sin((i / 32) * 2 * Math.PI)]);
  const out: [number, number][] = [loop.start];
  for (const s of loop.segments) {
    if (s.kind === "arc") out.push(s.mid);
    out.push(s.to);
  }
  return out;
}

export function pointInPolygon([x, y]: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Profundidad de anidamiento de cada contorno: los pares son material y los impares, huecos. */
export function loopDepths(loops: ProfileLoop[]): number[] {
  const polys = loops.map(loopPolygon);
  return polys.map((poly, i) => {
    const probe: [number, number] = loops[i].circle ? [loops[i].circle!.c[0] + loops[i].circle!.r, loops[i].circle!.c[1]] : poly[0];
    return polys.filter((other, j) => j !== i && pointInPolygon(probe, other)).length;
  });
}
