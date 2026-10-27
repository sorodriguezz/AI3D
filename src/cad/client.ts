import type { Loop } from "./importers";
import type { ExportFormat, Feature, Params, ScenePart } from "./types";
import type { BodyInfo, ExportOptions, MeshPayload, WorkerRequest, WorkerResponse } from "./worker";

// Puente con el worker CAD: una promesa por petición.
// Si un cálculo se cancela o el motor falla (por ejemplo, sin memoria), el worker se
// reinicia y los modelos importados se vuelven a registrar; el diseño no se toca.

export type { BodyInfo, MeshPayload };
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type AssetPayload = { kind: "mesh" | "step"; data: Uint8Array } | { kind: "svg"; loops: Loop[]; depth: number[] };

/** Petición interrumpida por una cancelación o un reinicio del motor: no es un error del diseño. */
export class CadInterrupted extends Error {}

let worker: Worker;
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
let seq = 1;
let readyResolve: () => void;
let readyReject: (e: Error) => void;
export let cadReady: Promise<void>;

const assetPayloads = new Map<string, AssetPayload>();
// Los modelos importados deben estar registrados en el worker antes de construir piezas que los usan.
const assetJobs = new Map<string, Promise<void>>();
const assetsReady = () => Promise.all(assetJobs.values());

const listeners = new Set<() => void>();
/** Avisa cuando el motor se reinicia, para volver a pedir las mallas interrumpidas. */
export function onCadRestart(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Errores tras los que el estado de WebAssembly ya no es fiable. */
const FATAL = /out of memory|memory access out of bounds|unreachable|RuntimeError|Aborted|abort\(/i;

function start() {
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  cadReady = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  cadReady.catch(() => undefined);
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    if (msg.id === 0) {
      if (msg.type === "ready") readyResolve();
      else if (msg.type === "error") readyReject(new Error(msg.message));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type !== "error") return p.resolve(msg);
    if (FATAL.test(msg.message)) {
      p.reject(new Error("El motor CAD se quedó sin recursos con esta operación y se reinició. Tu diseño está intacto; prueba con medidas más simples o una malla más ligera."));
      restartCad("El motor CAD se reinició.");
    } else p.reject(new Error(msg.message));
  };
  worker.onerror = (ev) => {
    ev.preventDefault();
    restartCad("El motor CAD se detuvo inesperadamente y se reinició. Tu diseño está intacto.");
  };
  assetJobs.clear();
  for (const [id, payload] of assetPayloads) queueAsset(id, payload);
}

function request(req: DistributiveOmit<WorkerRequest, "id">): Promise<WorkerResponse> {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...req, id });
  });
}

/** Detiene el motor, rechaza lo pendiente y arranca uno nuevo. */
export function restartCad(reason = "Cálculo cancelado.") {
  worker.terminate();
  const interrupted = [...pending.values()];
  pending.clear();
  start();
  interrupted.forEach((p) => p.reject(new CadInterrupted(reason)));
  listeners.forEach((fn) => fn());
}

/** Cancela los cálculos en curso (por ejemplo, una combinación muy larga). */
export const cancelCad = () => restartCad("Cálculo cancelado.");

const strip = (r: WorkerResponse): MeshPayload => {
  if (r.type !== "mesh") throw new Error("Respuesta inesperada del motor CAD");
  const { vertices, normals, triangles, edges, edgeGroups, bbox, volume, ms, exact, bodies } = r;
  return { vertices, normals, triangles, edges, edgeGroups, bbox, volume, ms, exact, bodies };
};

function queueAsset(assetId: string, payload: AssetPayload) {
  const job = cadReady
    .then(() =>
      request(
        payload.kind === "svg"
          ? { type: "asset", assetId, kind: "svg", loops: payload.loops, depth: payload.depth }
          : { type: "asset", assetId, kind: payload.kind, data: payload.data.slice().buffer as ArrayBuffer },
      ),
    )
    .then(() => undefined);
  job.catch(() => assetJobs.get(assetId) === job && assetJobs.delete(assetId));
  assetJobs.set(assetId, job);
  return job;
}

export function registerAsset(assetId: string, payload: AssetPayload): Promise<void> {
  const existing = assetJobs.get(assetId);
  if (existing) return existing;
  assetPayloads.set(assetId, payload);
  const job = queueAsset(assetId, payload);
  job.catch(() => assetPayloads.delete(assetId));
  return job;
}

/** Malla de una forma en coordenadas locales (centro de la base en el origen, o la forma operada). */
export async function buildShape(shapeType: string, params: Params, features?: Feature[]): Promise<MeshPayload> {
  await assetsReady().catch(() => undefined);
  return strip(await request({ type: "shape", shapeType, params, ...(features?.length ? { features } : {}) }));
}

/** Combina la escena por cuerpos (sólidos unidos menos agujeros). Devuelve null si no hay sólidos. */
export async function combineScene(parts: ScenePart[]): Promise<MeshPayload | null> {
  await assetsReady().catch(() => undefined);
  const r = await request({ type: "combine", parts });
  return r.type === "empty" ? null : strip(r);
}

export async function exportModel(format: ExportFormat, name: string, options?: ExportOptions): Promise<Uint8Array> {
  await assetsReady().catch(() => undefined);
  const r = await request({ type: "export", format, name, options });
  if (r.type !== "file") throw new Error("Respuesta inesperada del motor CAD");
  return new Uint8Array(r.data);
}

start();
