import { defaultParams, getTemplate } from "../cad/templates";
import type { Design, Part, ScenePart } from "../cad/types";

export const PART_COLORS = ["#c8f031", "#60a5fa", "#f472b6", "#fbbf24", "#34d399", "#a78bfa", "#fb923c", "#e5e7eb"];
let colorIndex = 0;
const nextColor = () => PART_COLORS[colorIndex++ % PART_COLORS.length];

export function newPart(type: string, patch: Partial<Part> = {}): Part {
  const t = getTemplate(type);
  if (!t) throw new Error(`Forma desconocida: ${type}`);
  return {
    id: crypto.randomUUID(),
    name: t.name,
    type,
    params: defaultParams(t),
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    mode: "solid",
    color: nextColor(),
    estimated: t.params.filter((d) => d.critical).map((d) => d.key),
    ...patch,
  };
}

export function newDesign(name: string): Design {
  const now = Date.now();
  return { format: "ai3d", version: 1, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, parts: [] };
}

export const toScene = (parts: Part[]): ScenePart[] =>
  parts.filter((p) => !p.hidden).map(({ type, params, position, rotation, mode }) => ({ type, params, position, rotation, mode }));

/** Nombre único dentro de la escena: «Caja», «Caja 2», … */
export function uniqueName(parts: Part[], base: string): string {
  const names = new Set(parts.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
