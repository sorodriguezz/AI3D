import { useEffect, useRef } from "react";
import { create } from "zustand";
import { CadInterrupted, buildShape, cadReady, combineScene, onCadRestart, type MeshPayload } from "../cad/client";
import { previewParams } from "../cad/importScale";
import type { Feature, Params, Part, ScenePart } from "../cad/types";
import { useStore } from "../store";
import { toScene } from "./parts";

// Mallas por forma (coordenadas locales): mover o rotar una pieza no reconstruye nada,
// solo cambiar sus medidas.

type Entry = { mesh?: MeshPayload; error?: string };
const useMeshes = create<{ map: Record<string, Entry>; generation: number }>(() => ({ map: {}, generation: 0 }));
const inflight = new Set<string>();

// Tras un reinicio del motor se vuelven a pedir las mallas que quedaron a medias.
onCadRestart(() => {
  inflight.clear();
  useMeshes.setState((s) => ({ generation: s.generation + 1 }));
});

/**
 * Malla local ya calculada. Sin operaciones, los modelos importados se guardan al 100 %;
 * con operaciones, la malla ya incluye la escala.
 */
export const cachedMesh = (type: string, params: Params, features?: Feature[]) => useMeshes.getState().map[shapeKey(type, params, features)]?.mesh;
export const cachedPartMesh = (part: Part) => cachedMesh(part.type, part.params, part.features);

export const shapeKey = (type: string, params: Params, features?: Feature[]) =>
  type + JSON.stringify(Object.entries(features?.length ? params : previewParams(type, params)).sort(([a], [b]) => a.localeCompare(b))) + (features?.length ? JSON.stringify(features) : "");

/** Pide al motor la malla local de una forma (o la devuelve de la caché). */
export async function partMesh(part: Pick<Part, "type" | "params" | "features">): Promise<MeshPayload> {
  const cached = cachedMesh(part.type, part.params, part.features);
  if (cached) return cached;
  await cadReady;
  return buildShape(part.type, part.features?.length ? part.params : previewParams(part.type, part.params), part.features);
}

export function usePartMesh(type: string, params: Params, features?: Feature[]): Entry | undefined {
  const key = shapeKey(type, params, features);
  const entry = useMeshes((s) => s.map[key]);
  const generation = useMeshes((s) => s.generation);
  useEffect(() => {
    if (entry || inflight.has(key)) return;
    inflight.add(key);
    partMesh({ type, params, features })
      .then((mesh) => useMeshes.setState((s) => ({ map: { ...s.map, [key]: { mesh } } })))
      .catch((e) => {
        if (e instanceof CadInterrupted) return;
        useMeshes.setState((s) => ({ map: { ...s.map, [key]: { error: e instanceof Error ? e.message : String(e) } } }));
      })
      .finally(() => inflight.delete(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entry, generation]);
  return entry;
}

/** Recalcula la pieza final (sólidos − agujeros) cuando cambia la escena; alimenta medidas, validación y exportación. */
export function useSceneResult() {
  const previousBuild = useRef<Promise<void>>(Promise.resolve());
  const parts = useStore((s) => s.doc?.parts);
  // Color, names and measurement confirmations do not change the CAD scene.
  const sceneKey = parts ? JSON.stringify(toScene(parts)) : null;
  const setResult = useStore((s) => s.setResult);
  const setBuilding = useStore((s) => s.setBuilding);
  const retry = useStore((s) => s.buildNonce);
  useEffect(() => {
    if (sceneKey === null) return;
    const scene = JSON.parse(sceneKey) as ScenePart[];
    let alive = true;
    const t = setTimeout(() => {
      // Wait for the current build before submitting another. Superseded edits
      // are skipped instead of filling the CAD worker's queue while dragging.
      previousBuild.current = previousBuild.current.then(async () => {
        if (!alive) return;
        setBuilding(true);
        try {
          await cadReady;
          if (!alive) return;
          const r = await combineScene(scene);
          if (alive) setResult(r, null);
        } catch (e) {
          // Al cancelar se conserva el último resultado válido.
          if (alive) setResult(e instanceof CadInterrupted ? useStore.getState().result : null, e instanceof Error ? e.message : String(e));
        } finally {
          if (alive) setBuilding(false);
        }
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [sceneKey, setResult, setBuilding, retry]);
}
