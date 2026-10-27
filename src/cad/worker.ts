/// <reference lib="webworker" />
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import Manifold from "manifold-3d";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import { MeshShape, importSTEP, importSTLAsMesh, makeCompound, setManifold, setOC, type Shape3D } from "replicad";
import { ASSETS, BUILDERS, manifoldOf, type AnySolid } from "./builders";
import { applyFeature } from "./features";
import { importPreviewScale, previewParams } from "./importScale";
import type { Loop } from "./importers";
import { build3MF, type ModelObject } from "./threemf";
import { binarySTL, manifoldMesh } from "./meshTools";
import { MAIN_BODY, type ExportFormat, type Feature, type Params, type ScenePart } from "./types";

// Dos motores geométricos:
// · OpenCascade (B-rep exacto) para formas, componentes, STEP y SVG. Exporta también a STEP.
// · Manifold (mallas) para modelos STL/3MF/OBJ/AMF importados: booleanas en milisegundos incluso
//   con cientos de miles de triángulos. Si una escena contiene mallas, se combina entera con Manifold.

export interface ExportOptions {
  /** Escena a exportar; si falta, se usa la última combinada. */
  parts?: ScenePart[];
  /** Exporta solo este cuerpo. */
  body?: string;
  /** Color de cada cuerpo para el 3MF. */
  colors?: Record<string, string>;
}

export type WorkerRequest =
  | { id: number; type: "shape"; shapeType: string; params: Params; features?: Feature[] }
  | { id: number; type: "combine"; parts: ScenePart[] }
  | { id: number; type: "export"; format: ExportFormat; name: string; options?: ExportOptions }
  | { id: number; type: "asset"; assetId: string; kind: "mesh" | "step"; data: ArrayBuffer }
  | { id: number; type: "asset"; assetId: string; kind: "svg"; loops: Loop[]; depth: number[] };

export interface MeshPayload {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volume: number;
  ms: number;
  /** false cuando el resultado es una malla (no exportable a STEP). */
  exact: boolean;
  /** Aristas exactas: [inicio, cantidad] de cada arista, en segmentos de `edges`. */
  edgeGroups?: Uint32Array;
  /** Cuerpos del resultado combinado: rango de triángulos de cada uno. */
  bodies?: BodyInfo[];
}

export interface BodyInfo {
  name: string;
  triStart: number;
  triCount: number;
  volume: number;
  exact: boolean;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export type WorkerResponse =
  | { id: number; type: "ready" }
  | ({ id: number; type: "mesh" } & MeshPayload)
  | { id: number; type: "empty" }
  | { id: number; type: "file"; data: ArrayBuffer }
  | { id: number; type: "asset"; ok: true }
  | { id: number; type: "error"; message: string };

const ready = (async () => {
  const oc = await opencascade({ locateFile: () => wasmUrl });
  setOC(oc as never);
  const mf = await Manifold({ locateFile: () => manifoldWasmUrl });
  mf.setup();
  setManifold(mf as never);
})();

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "number") return "Operación CAD inválida para estas medidas (código OpenCascade " + e + ")";
  return String(e);
}

const isMesh = (s: AnySolid): s is MeshShape => s instanceof MeshShape;

/** Volumen a partir de la malla cerrada (suma de tetraedros con signo), en mm³. */
function meshVolume(v: ArrayLike<number>, t: ArrayLike<number>): number {
  let vol = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return Math.abs(vol / 6);
}

// --- Caché de formas base: cada pieza se construye una vez por combinación de parámetros ---

const cache = new Map<string, AnySolid>();
const MAX_CACHE = 150;
const keyOf = (type: string, params: Params) => type + JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));

/** Construye la forma y la normaliza: centro de la base en el origen. */
function baseShape(type: string, params: Params): AnySolid {
  const key = keyOf(type, params);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const builder = BUILDERS[type];
  if (!builder) throw new Error(`Forma desconocida: ${type}`);
  let shape = builder(params);
  const box = shape.boundingBox;
  const [min, max] = box.bounds;
  box.delete();
  const dx = -(min[0] + max[0]) / 2, dy = -(min[1] + max[1]) / 2, dz = -min[2];
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-6) {
    if (isMesh(shape)) {
      const previous = shape;
      shape = new MeshShape(manifoldOf(previous).translate([dx, dy, dz]) as never);
      previous.delete();
    } else shape = shape.translate(dx, dy, dz) as AnySolid;
  }
  cache.set(key, shape);
  if (cache.size > MAX_CACHE) {
    const [oldKey, old] = cache.entries().next().value as [string, AnySolid];
    cache.delete(oldKey);
    old.delete();
  }
  return shape;
}

/** Forma con sus operaciones aplicadas, ya escalada (se guarda en la misma caché). */
function featuredShape(type: string, params: Params, features: Feature[]): AnySolid {
  const scale = importPreviewScale(type, params);
  const key = keyOf(type, params) + JSON.stringify(features);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const base = baseShape(type, previewParams(type, params));
  let shape: AnySolid = isMesh(base)
    ? new MeshShape(manifoldOf(base).scale(Math.abs(scale - 1) > 1e-6 ? scale : 1) as never)
    : Math.abs(scale - 1) > 1e-6 ? (base.clone().scale(scale) as AnySolid) : (base.clone() as AnySolid);
  try {
    for (const f of features) {
      if (f.suppressed) continue;
      const next = applyFeature(shape, f);
      if (next !== shape) shape.delete();
      shape = next;
    }
  } catch (e) {
    shape.delete();
    throw e;
  }
  cache.set(key, shape);
  if (cache.size > MAX_CACHE) {
    const [oldKey, old] = cache.entries().next().value as [string, AnySolid];
    cache.delete(oldKey);
    old.delete();
  }
  return shape;
}

/** Forma local de una pieza: la base normalizada o, si tiene operaciones, la forma ya escalada y operada. */
const localShape = (type: string, params: Params, features?: Feature[]) =>
  features?.length ? featuredShape(type, params, features) : baseShape(type, previewParams(type, params));

/** Copia transformada (las transformaciones de OpenCascade consumen la forma de origen). */
function placed(p: ScenePart): AnySolid {
  // One base per imported model, not one million-triangle copy per scale value.
  const base = localShape(p.type, p.params, p.features);
  const scale = p.features?.length ? 1 : importPreviewScale(p.type, p.params);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("La escala debe ser un número mayor que cero.");
  if (isMesh(base)) {
    // Mallas: rotación de Manifold (X, luego Y, luego Z, en grados, igual que la app) y traslación directa.
    const original = manifoldOf(base);
    let m = original;
    try {
      if (Math.abs(scale - 1) > 1e-6) m = m.scale(scale);
      for (const axis of [0, 1, 2]) {
        if (!p.mirror?.[axis]) continue;
        const normal: [number, number, number] = [0, 0, 0];
        normal[axis] = 1;
        const reflected = m.mirror(normal);
        if (m !== original) m.delete();
        m = reflected;
      }
      if (p.rotation.some((d) => Math.abs(d) > 1e-6)) {
        const rotated = m.rotate(p.rotation);
        if (m !== original) m.delete();
        m = rotated;
      }
      return new MeshShape(m.translate(p.position) as never);
    } finally {
      // Raw Manifold intermediates are outside replicad's finalization registry.
      if (m !== original) m.delete();
    }
  }
  let s = base.clone() as AnySolid;
  if (Math.abs(scale - 1) > 1e-6) s = s.scale(scale) as AnySolid;
  const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  axes.forEach((axis, i) => { if (p.mirror?.[i]) s = s.mirror(axis, [0, 0, 0]) as AnySolid; });
  p.rotation.forEach((deg, i) => {
    if (Math.abs(deg) > 1e-6) s = s.rotate(deg, [0, 0, 0], axes[i]) as AnySolid;
  });
  if (p.position.some((v) => Math.abs(v) > 1e-9)) s = s.translate(p.position[0], p.position[1], p.position[2]) as AnySolid;
  return s;
}

const toMesh = (s: AnySolid): MeshShape => (isMesh(s) ? s : s.meshShape({ tolerance: 0.02, angularTolerance: 0.1 }));

function meshOf(shape: AnySolid, t0: number): MeshPayload {
  const box = shape.boundingBox;
  const [min, max] = box.bounds;
  box.delete();
  const bbox = { min: min as never, max: max as never };
  if (isMesh(shape)) {
    const m = manifoldMesh(shape);
    return { vertices: m.vertices, normals: m.normals, triangles: m.triangles, edges: m.edges, bbox, volume: meshVolume(m.vertices, m.triangles), ms: performance.now() - t0, exact: false };
  }
  const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
  const e = shape.meshEdges({ tolerance: 0.05, angularTolerance: 0.3 });
  const vertices = new Float32Array(m.vertices);
  const triangles = new Uint32Array(m.triangles);
  // replicad da el inicio y la cantidad de cada arista en vértices de `lines`; se pasan a segmentos.
  const edgeGroups = new Uint32Array(e.edgeGroups.length * 2);
  e.edgeGroups.forEach((g, i) => {
    edgeGroups[i * 2] = g.start / EDGE_UNIT;
    edgeGroups[i * 2 + 1] = g.count / EDGE_UNIT;
  });
  return { vertices, normals: new Float32Array(m.normals), triangles, edges: new Float32Array(e.lines), edgeGroups, bbox, volume: meshVolume(vertices, triangles), ms: performance.now() - t0, exact: true };
}

/** Unidades de `edgeGroups` de replicad por segmento: cuenta vértices, dos por segmento. */
const EDGE_UNIT = 2;

const transfer = (m: MeshPayload) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer, ...(m.edgeGroups ? [m.edgeGroups.buffer] : [])];

/** Une las mallas de varios cuerpos en una sola carga, recordando el rango de cada uno. */
function mergeBodies(list: { name: string; mesh: MeshPayload }[], t0: number): MeshPayload {
  const total = (k: "vertices" | "triangles" | "edges") => list.reduce((s, b) => s + b.mesh[k].length, 0);
  const vertices = new Float32Array(total("vertices")), normals = new Float32Array(total("vertices"));
  const triangles = new Uint32Array(total("triangles")), edges = new Float32Array(total("edges"));
  const bodies: BodyInfo[] = [];
  let v = 0, t = 0, e = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { name, mesh } of list) {
    vertices.set(mesh.vertices, v);
    normals.set(mesh.normals, v);
    for (let i = 0; i < mesh.triangles.length; i++) triangles[t + i] = mesh.triangles[i] + v / 3;
    edges.set(mesh.edges, e);
    bodies.push({ name, triStart: t / 3, triCount: mesh.triangles.length / 3, volume: mesh.volume, exact: mesh.exact, bbox: mesh.bbox });
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], mesh.bbox.min[a]);
      max[a] = Math.max(max[a], mesh.bbox.max[a]);
    }
    v += mesh.vertices.length;
    t += mesh.triangles.length;
    e += mesh.edges.length;
  }
  return { vertices, normals, triangles, edges, bbox: { min, max }, volume: list.reduce((s, b) => s + b.mesh.volume, 0), ms: performance.now() - t0, exact: list.every((b) => b.mesh.exact), bodies };
}

/** Cuerpos de la última escena combinada, en el orden en que aparecen. */
let combined: { name: string; shape: AnySolid }[] = [];
let combinedKey = "";

const freeCombined = () => {
  combined.forEach((b) => b.shape.delete());
  combined = [];
  combinedKey = "";
};

/** Combina por cuerpos: los sólidos de cada cuerpo se unen y se les restan los agujeros que lo recortan. */
function combine(parts: ScenePart[]): { name: string; shape: AnySolid }[] {
  freeCombined();
  // Mesh boolean operations do not consume their operands. Free every
  // temporary deterministically, including conversions and failed builds.
  const temporary = new Set<AnySolid>();
  const own = (shape: AnySolid) => { temporary.add(shape); return shape; };
  try {
    const all = parts.map((p) => ({ p, shape: own(placed(p)) }));
    const names = [...new Set(all.filter((x) => x.p.mode === "solid").map((x) => x.p.body || MAIN_BODY))];
    const out: { name: string; shape: AnySolid }[] = [];
    for (const name of names) {
      const solids = all.filter((x) => x.p.mode === "solid" && (x.p.body || MAIN_BODY) === name);
      const holes = all.filter((x) => x.p.mode === "hole" && (!x.p.cutBodies || x.p.cutBodies.includes(name)));
      const members = [...solids, ...holes];
      // Un cuerpo con alguna malla se combina entero con Manifold.
      const meshMode = members.some((x) => isMesh(x.shape));
      const as = (x: { shape: AnySolid }) => (meshMode ? own(toMesh(x.shape)) : x.shape);
      // fuse/cut de ambos motores tienen la misma firma; se mantiene un solo tipo por cuerpo.
      type Op = { fuse(o: AnySolid): AnySolid; cut(o: AnySolid): AnySolid };
      let result = solids.map(as).reduce((a, b) => own((a as unknown as Op).fuse(b)));
      if (holes.length) result = own((result as unknown as Op).cut(holes.map(as).reduce((a, b) => own((a as unknown as Op).fuse(b)))));
      temporary.delete(result);
      out.push({ name, shape: result });
    }
    return out;
  } finally {
    temporary.forEach((shape) => shape.delete());
  }
}

/** Vértices sin índices extra (Manifold puede guardar propiedades adicionales por vértice). */
function plainMesh(shape: AnySolid, fine: boolean) {
  if (isMesh(shape)) {
    const { indexed } = manifoldMesh(shape);
    const v = indexed.np === 3 ? indexed.P : Float32Array.from({ length: (indexed.P.length / indexed.np) * 3 }, (_, i) => indexed.P[Math.floor(i / 3) * indexed.np + (i % 3)]);
    return { vertices: v, triangles: indexed.T };
  }
  const m = shape.mesh(fine ? { tolerance: 0.01, angularTolerance: 0.1 } : { tolerance: 0.05, angularTolerance: 0.3 });
  return { vertices: m.vertices, triangles: m.triangles };
}

async function exportBodies(format: ExportFormat, name: string, bodies: { name: string; shape: AnySolid }[], colors: Record<string, string> = {}): Promise<ArrayBuffer> {
  if (format === "step") {
    const mesh = bodies.find((b) => isMesh(b.shape));
    if (mesh) throw new Error(`STEP no está disponible porque «${mesh.name}» contiene un modelo de malla importado. Exporta en 3MF o STL.`);
    if (bodies.length === 1) return (bodies[0].shape as Shape3D).blobSTEP().arrayBuffer();
    // El compuesto conserva cada cuerpo como sólido independiente.
    const compound = makeCompound(bodies.map((b) => (b.shape as Shape3D).clone()));
    try {
      return await (compound as Shape3D).blobSTEP().arrayBuffer();
    } finally {
      compound.delete();
    }
  }
  const meshes = bodies.map((b) => ({ name: b.name, color: colors[b.name], ...plainMesh(b.shape, true) }));
  if (format === "3mf") return build3MF(meshes as ModelObject[], name).buffer as ArrayBuffer;
  // STL no tiene objetos: se concatenan todos los cuerpos.
  const offsets = meshes.reduce<number[]>((acc, m, i) => [...acc, (acc[i] ?? 0) + m.vertices.length / 3], []);
  const v = new Float32Array(meshes.reduce((s, m) => s + m.vertices.length, 0));
  const t = new Uint32Array(meshes.reduce((s, m) => s + m.triangles.length, 0));
  let vi = 0, ti = 0;
  meshes.forEach((m, i) => {
    v.set(m.vertices, vi);
    const base = i === 0 ? 0 : offsets[i - 1];
    for (let k = 0; k < m.triangles.length; k++) t[ti + k] = m.triangles[k] + base;
    vi += m.vertices.length;
    ti += m.triangles.length;
  });
  return binarySTL(v, t);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    await ready;
    const t0 = performance.now();
    if (req.type === "asset") {
      if (!ASSETS.has(req.assetId)) {
        if (req.kind === "svg") ASSETS.set(req.assetId, { kind: "svg", loops: req.loops, depth: req.depth });
        else if (req.kind === "step") ASSETS.set(req.assetId, { kind: "solid", shape: (await importSTEP(new Blob([req.data]))) as Shape3D });
        else {
          const notSolid = "La malla no es cerrada (tiene agujeros o caras sueltas), así que no es un sólido imprimible. Repárala (por ejemplo con «Reparar» en Bambu Studio) e impórtala de nuevo.";
          let shape: MeshShape;
          try {
            shape = await importSTLAsMesh(new Blob([req.data]));
          } catch (e) {
            throw new Error(/manifold/i.test(String((e as Error)?.message ?? e)) ? notSolid : errorMessage(e));
          }
          if (manifoldOf(shape).numTri() === 0) {
            shape.delete();
            throw new Error(notSolid);
          }
          ASSETS.set(req.assetId, { kind: "mesh", shape });
        }
      }
      post({ id: req.id, type: "asset", ok: true });
    } else if (req.type === "shape") {
      const m = meshOf(localShape(req.shapeType, req.params, req.features), t0);
      post({ id: req.id, type: "mesh", ...m }, transfer(m));
    } else if (req.type === "combine") {
      const bodies = combine(req.parts);
      if (bodies.length === 0) {
        post({ id: req.id, type: "empty" });
        return;
      }
      combined = bodies;
      combinedKey = JSON.stringify(req.parts);
      const m = mergeBodies(bodies.map((b) => ({ name: b.name, mesh: meshOf(b.shape, t0) })), t0);
      post({ id: req.id, type: "mesh", ...m }, transfer(m));
    } else {
      const options = req.options ?? {};
      // Tras un reinicio del motor la escena se vuelve a combinar antes de exportar.
      if (options.parts && JSON.stringify(options.parts) !== combinedKey) {
        combined = combine(options.parts);
        combinedKey = JSON.stringify(options.parts);
      }
      if (!combined.length) throw new Error("La escena no tiene piezas sólidas para exportar.");
      const bodies = options.body ? combined.filter((b) => b.name === options.body) : combined;
      if (!bodies.length) throw new Error(`El cuerpo «${options.body}» no tiene piezas sólidas visibles.`);
      const data = await exportBodies(req.format, req.name, bodies, options.colors);
      post({ id: req.id, type: "file", data }, [data]);
    }
  } catch (e) {
    post({ id: req.id, type: "error", message: errorMessage(e) });
  }
};

ready.then(() => post({ id: 0, type: "ready" })).catch((e) => post({ id: 0, type: "error", message: errorMessage(e) }));
