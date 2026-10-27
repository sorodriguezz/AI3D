import { rectangleSketch } from "../cad/sketch";
import { defaultParams, getTemplate } from "../cad/templates";
import { MAIN_BODY, type Design, type Part, type ScenePart } from "../cad/types";

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
    // Los bocetos empiezan con un rectángulo acotado de 40 × 20 mm.
    params: type === "sketch" ? { ...defaultParams(t), profile: JSON.stringify(rectangleSketch(40, 20)) } : defaultParams(t),
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    mode: t.defaultMode ?? "solid",
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
  parts.filter((p) => !p.hidden).map(({ type, params, position, rotation, mirror, mode, features, body, cutBodies }) =>
    ({ type, params, position, rotation, mirror, mode, ...(features?.length ? { features } : {}), ...(body ? { body } : {}), ...(cutBodies ? { cutBodies } : {}) }));

/** Cuerpos de la escena en orden de aparición (el principal incluido si alguna pieza no tiene cuerpo). */
export const bodiesOf = (parts: Part[]) => [...new Set(parts.filter((p) => p.mode === "solid").map((p) => p.body || MAIN_BODY))];

/** Color de cada cuerpo: el de su primera pieza sólida. */
export function bodyColors(parts: Part[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) if (p.mode === "solid" && !p.hidden && !out[p.body || MAIN_BODY]) out[p.body || MAIN_BODY] = p.color;
  return out;
}

/** Nombre único dentro de la escena: «Caja», «Caja 2», … */
export function uniqueName(parts: Part[], base: string): string {
  const names = new Set(parts.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
