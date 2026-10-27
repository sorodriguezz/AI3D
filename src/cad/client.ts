import type { Loop } from "./importers";
import type { ExportFormat, Params, ScenePart } from "./types";
import type { MeshPayload, WorkerRequest, WorkerResponse } from "./worker";

// Puente con el worker CAD: una promesa por petición.

export type { MeshPayload };
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
let seq = 1;
let readyResolve: () => void;
let readyReject: (e: Error) => void;
export const cadReady = new Promise<void>((res, rej) => {
  readyResolve = res;
  readyReject = rej;
});

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
  if (msg.type === "error") p.reject(new Error(msg.message));
  else p.resolve(msg);
};

function request(req: DistributiveOmit<WorkerRequest, "id">): Promise<WorkerResponse> {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...req, id });
  });
}

const strip = (r: WorkerResponse): MeshPayload => {
  if (r.type !== "mesh") throw new Error("Respuesta inesperada del motor CAD");
  const { vertices, normals, triangles, edges, bbox, volume, ms, exact } = r;
  return { vertices, normals, triangles, edges, bbox, volume, ms, exact };
};

// Los modelos importados deben estar registrados en el worker antes de construir piezas que los usan.
const assetJobs = new Map<string, Promise<void>>();
const assetsReady = () => Promise.all(assetJobs.values());

export function registerAsset(assetId: string, payload: { kind: "mesh" | "step"; data: Uint8Array } | { kind: "svg"; loops: Loop[]; depth: number[] }): Promise<void> {
  const existing = assetJobs.get(assetId);
  if (existing) return existing;
  const job = cadReady
    .then(() =>
      request(
        payload.kind === "svg"
          ? { type: "asset", assetId, kind: "svg", loops: payload.loops, depth: payload.depth }
          : { type: "asset", assetId, kind: payload.kind, data: payload.data.slice().buffer as ArrayBuffer },
      ),
    )
    .then(() => undefined);
  job.catch(() => assetJobs.delete(assetId));
  assetJobs.set(assetId, job);
  return job;
}

/** Malla de una forma en coordenadas locales (centro de la base en el origen). */
export async function buildShape(shapeType: string, params: Params): Promise<MeshPayload> {
  await assetsReady().catch(() => undefined);
  return strip(await request({ type: "shape", shapeType, params }));
}

/** Combina la escena (sólidos unidos menos agujeros). Devuelve null si no hay sólidos. */
export async function combineScene(parts: ScenePart[]): Promise<MeshPayload | null> {
  await assetsReady().catch(() => undefined);
  const r = await request({ type: "combine", parts });
  return r.type === "empty" ? null : strip(r);
}

export async function exportModel(format: ExportFormat, name: string): Promise<Uint8Array> {
  const r = await request({ type: "export", format, name });
  if (r.type !== "file") throw new Error("Respuesta inesperada del motor CAD");
  return new Uint8Array(r.data);
}
