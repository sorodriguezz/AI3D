import { create } from "zustand";
import type { Params, Vec3 } from "../cad/types";
import { measureOne, measureTwo, type Dimension, type Pick, type PickKind } from "./measure";

// Herramientas que usan clics en el visor: medir, colocar perforaciones sobre una cara
// y elegir aristas para redondear o achaflanar.

export type ToolMode =
  | { kind: "measure"; target: PickKind }
  | { kind: "place"; type: string; params: Params }
  | { kind: "edges"; partId: string };

/** Arista elegida: un punto exacto sobre ella (sistema local de la pieza) y su grupo en la malla. */
export interface EdgeChoice {
  point: Vec3;
  group: number;
}

interface ToolsState {
  mode: ToolMode | null;
  picks: Pick[];
  dims: Dimension[];
  edges: EdgeChoice[];
  /** Último aviso de la herramienta activa (por ejemplo, «haz clic sobre una cara»). */
  hint: string | null;
  setMode: (mode: ToolMode | null) => void;
  addPick: (p: Pick) => void;
  removeDim: (id: string) => void;
  clearDims: () => void;
  toggleEdge: (e: EdgeChoice) => void;
  setHint: (hint: string | null) => void;
}

export const useTools = create<ToolsState>((set, get) => ({
  mode: null,
  picks: [],
  dims: [],
  edges: [],
  hint: null,
  setMode: (mode) => set({ mode, picks: [], hint: null, ...(mode?.kind === "edges" && get().mode?.kind === "edges" && (get().mode as { partId: string }).partId === mode.partId ? {} : { edges: [] }) }),
  addPick: (p) => {
    const { picks, dims } = get();
    if (picks.length === 0) {
      // Una arista ya se puede medir sola (longitud o diámetro); se guarda para una segunda selección.
      const single = measureOne(p);
      set({ picks: [p], dims: single ? [...dims, single] : dims });
      return;
    }
    set({ picks: [], dims: [...dims, measureTwo(picks[0], p)] });
  },
  removeDim: (id) => set({ dims: get().dims.filter((d) => d.id !== id) }),
  clearDims: () => set({ dims: [], picks: [] }),
  toggleEdge: (e) => {
    const edges = get().edges;
    set({ edges: edges.some((x) => x.group === e.group) ? edges.filter((x) => x.group !== e.group) : [...edges, e] });
  },
  setHint: (hint) => set({ hint }),
}));
