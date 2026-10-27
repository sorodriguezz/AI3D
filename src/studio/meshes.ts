import { useEffect } from "react";
import { create } from "zustand";
import { buildShape, cadReady, combineScene, type MeshPayload } from "../cad/client";
import type { Params } from "../cad/types";
import { useStore } from "../store";
import { toScene } from "./parts";

// Mallas por forma (coordenadas locales): mover o rotar una pieza no reconstruye nada,
// solo cambiar sus medidas.

type Entry = { mesh?: MeshPayload; error?: string };
const useMeshes = create<{ map: Record<string, Entry> }>(() => ({ map: {} }));
const inflight = new Set<string>();

/** Malla ya calculada de una forma, si existe (sin pedirla al motor). */
export const cachedMesh = (type: string, params: Params) => useMeshes.getState().map[shapeKey(type, params)]?.mesh;

export const shapeKey = (type: string, params: Params) => type + JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));

export function usePartMesh(type: string, params: Params): Entry | undefined {
  const key = shapeKey(type, params);
  const entry = useMeshes((s) => s.map[key]);
  useEffect(() => {
    if (entry || inflight.has(key)) return;
    inflight.add(key);
    cadReady
      .then(() => buildShape(type, params))
      .then((mesh) => useMeshes.setState((s) => ({ map: { ...s.map, [key]: { mesh } } })))
      .catch((e) => useMeshes.setState((s) => ({ map: { ...s.map, [key]: { error: e instanceof Error ? e.message : String(e) } } })))
      .finally(() => inflight.delete(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entry]);
  return entry;
}

/** Recalcula la pieza final (sólidos − agujeros) cuando cambia la escena; alimenta medidas, validación y exportación. */
export function useSceneResult() {
  const parts = useStore((s) => s.doc?.parts);
  const setResult = useStore((s) => s.setResult);
  const setBuilding = useStore((s) => s.setBuilding);
  useEffect(() => {
    if (!parts) return;
    let alive = true;
    const t = setTimeout(async () => {
      setBuilding(true);
      try {
        await cadReady;
        const r = await combineScene(toScene(parts));
        if (alive) setResult(r, null);
      } catch (e) {
        if (alive) setResult(null, e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setBuilding(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [parts, setResult, setBuilding]);
}
