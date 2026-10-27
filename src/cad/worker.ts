/// <reference lib="webworker" />
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import Manifold from "manifold-3d";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import { MeshShape, importSTEP, importSTLAsMesh, setManifold, setOC, type Shape3D } from "replicad";
import { ASSETS, BUILDERS, manifoldOf, type AnySolid } from "./builders";
import type { Loop } from "./importers";
import { build3MF } from "./threemf";
import { binarySTL, manifoldMesh } from "./meshTools";
import type { ExportFormat, Params, ScenePart } from "./types";

// Dos motores geométricos:
// · OpenCascade (B-rep exacto) para formas, componentes, STEP y SVG. Exporta también a STEP.
// · Manifold (mallas) para modelos STL/3MF/OBJ/AMF importados: booleanas en milisegundos incluso
//   con cientos de miles de triángulos. Si una escena contiene mallas, se combina entera con Manifold.

export type WorkerRequest =
  | { id: number; type: "shape"; shapeType: string; params: Params }
  | { id: number; type: "combine"; parts: ScenePart[] }
  | { id: number; type: "export"; format: ExportFormat; name: string }
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
  const [min, max] = shape.boundingBox.bounds;
  const dx = -(min[0] + max[0]) / 2, dy = -(min[1] + max[1]) / 2, dz = -min[2];
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-6) shape = isMesh(shape) ? new MeshShape(manifoldOf(shape).translate([dx, dy, dz]) as never) : (shape.translate(dx, dy, dz) as AnySolid);
  cache.set(key, shape);
  if (cache.size > MAX_CACHE) {
    const [oldKey, old] = cache.entries().next().value as [string, AnySolid];
    cache.delete(oldKey);
    old.delete();
  }
  return shape;
}

/** Copia transformada (las transformaciones de OpenCascade consumen la forma de origen). */
function placed(p: ScenePart): AnySolid {
  const base = baseShape(p.type, p.params);
  if (isMesh(base)) {
    // Mallas: rotación de Manifold (X, luego Y, luego Z, en grados, igual que la app) y traslación directa.
    let m = manifoldOf(base);
    if (p.rotation.some((d) => Math.abs(d) > 1e-6)) m = m.rotate(p.rotation) as typeof m;
    return new MeshShape(m.translate(p.position) as never);
  }
  let s = base.clone() as AnySolid;
  const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  p.rotation.forEach((deg, i) => {
    if (Math.abs(deg) > 1e-6) s = s.rotate(deg, [0, 0, 0], axes[i]) as AnySolid;
  });
  if (p.position.some((v) => Math.abs(v) > 1e-9)) s = s.translate(p.position[0], p.position[1], p.position[2]) as AnySolid;
  return s;
}

const toMesh = (s: AnySolid): MeshShape => (isMesh(s) ? s : s.meshShape({ tolerance: 0.02, angularTolerance: 0.1 }));

function meshOf(shape: AnySolid, t0: number): MeshPayload {
  const [min, max] = shape.boundingBox.bounds;
  const bbox = { min: min as never, max: max as never };
  if (isMesh(shape)) {
    const m = manifoldMesh(shape);
    return { vertices: m.vertices, normals: m.normals, triangles: m.triangles, edges: m.edges, bbox, volume: meshVolume(m.vertices, m.triangles), ms: performance.now() - t0, exact: false };
  }
  const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
  const e = shape.meshEdges({ tolerance: 0.05, angularTolerance: 0.3 });
  const vertices = new Float32Array(m.vertices);
  const triangles = new Uint32Array(m.triangles);
  return { vertices, normals: new Float32Array(m.normals), triangles, edges: new Float32Array(e.lines), bbox, volume: meshVolume(vertices, triangles), ms: performance.now() - t0, exact: true };
}

const transfer = (m: MeshPayload) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer];

let combined: AnySolid | null = null;

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
          if (manifoldMesh(shape).triangles.length === 0) {
            shape.delete();
            throw new Error(notSolid);
          }
          ASSETS.set(req.assetId, { kind: "mesh", shape });
        }
      }
      post({ id: req.id, type: "asset", ok: true });
    } else if (req.type === "shape") {
      const m = meshOf(baseShape(req.shapeType, req.params), t0);
      post({ id: req.id, type: "mesh", ...m }, transfer(m));
    } else if (req.type === "combine") {
      const all = req.parts.map((p) => ({ mode: p.mode, shape: placed(p) }));
      combined?.delete();
      combined = null;
      const meshMode = all.some((p) => isMesh(p.shape));
      const shapes = meshMode ? all.map((p) => ({ mode: p.mode, shape: toMesh(p.shape) as AnySolid })) : all;
      const solids = shapes.filter((p) => p.mode === "solid").map((p) => p.shape);
      const holes = shapes.filter((p) => p.mode === "hole").map((p) => p.shape);
      if (solids.length === 0) {
        holes.forEach((h) => h.delete());
        post({ id: req.id, type: "empty" });
        return;
      }
      // fuse/cut de ambos motores tienen la misma firma; se mantiene un solo tipo por escena.
      type Op = { fuse(o: AnySolid): AnySolid; cut(o: AnySolid): AnySolid };
      let result = solids.reduce((a, b) => (a as unknown as Op).fuse(b));
      if (holes.length) result = (result as unknown as Op).cut(holes.reduce((a, b) => (a as unknown as Op).fuse(b)));
      combined = result;
      const m = meshOf(result, t0);
      post({ id: req.id, type: "mesh", ...m }, transfer(m));
    } else {
      if (!combined) throw new Error("La escena no tiene piezas sólidas para exportar.");
      let data: ArrayBuffer;
      if (isMesh(combined)) {
        if (req.format === "step") throw new Error("STEP no está disponible porque la escena contiene un modelo de malla importado. Exporta en 3MF o STL.");
        const { indexed } = manifoldMesh(combined);
        const v = indexed.np === 3 ? indexed.P : Float32Array.from({ length: (indexed.P.length / indexed.np) * 3 }, (_, i) => indexed.P[Math.floor(i / 3) * indexed.np + (i % 3)]);
        data = req.format === "stl" ? binarySTL(v, indexed.T) : (build3MF(v, indexed.T, req.name).buffer as ArrayBuffer);
      } else if (req.format === "stl") data = await combined.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 }).arrayBuffer();
      else if (req.format === "step") data = await combined.blobSTEP().arrayBuffer();
      else {
        const m = combined.mesh({ tolerance: 0.01, angularTolerance: 0.1 });
        data = build3MF(m.vertices, m.triangles, req.name).buffer as ArrayBuffer;
      }
      post({ id: req.id, type: "file", data }, [data]);
    }
  } catch (e) {
    post({ id: req.id, type: "error", message: errorMessage(e) });
  }
};

ready.then(() => post({ id: 0, type: "ready" })).catch((e) => post({ id: 0, type: "error", message: errorMessage(e) }));
