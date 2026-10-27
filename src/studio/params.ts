import { evaluate, resolveVariables, type Variable } from "../cad/expr";
import { parseSketch, sketchReferences, solveSketch } from "../cad/sketch";
import { getTemplate } from "../cad/templates";
import type { Part } from "../cad/types";

// Medidas paramétricas: fórmulas en los parámetros y cotas de bocetos que dependen de variables.

export type ParamErrors = Record<string, Record<string, string>>;

/** Valor de una fórmula para un parámetro, comprobando su rango. */
export function evaluateParam(part: Part, key: string, expr: string, scope: Record<string, number>): number {
  const def = getTemplate(part.type)?.params.find((d) => d.key === key);
  if (!def || (def.type !== "number" && def.type !== "int")) throw new Error("Esta medida no admite fórmulas.");
  let v = evaluate(expr, scope);
  if (def.type === "int") v = Math.round(v);
  if (v < def.min || v > def.max) throw new Error(`El resultado (${+v.toFixed(3)}) está fuera del rango ${def.min}–${def.max}${def.unit ? " " + def.unit : ""}.`);
  return +v.toFixed(4);
}

/**
 * Recalcula las medidas con fórmula y los bocetos acotados con variables.
 * Devuelve las piezas actualizadas (las que no cambian conservan su identidad) y los errores por pieza.
 */
export function resolveParts(parts: Part[], variables: Variable[] = []): { parts: Part[]; errors: ParamErrors } {
  const { values } = resolveVariables(variables);
  const errors: ParamErrors = {};
  const next = parts.map((part) => {
    let params = part.params;
    for (const [key, expr] of Object.entries(part.exprs ?? {})) {
      try {
        const v = evaluateParam(part, key, expr, values);
        if (params[key] !== v) params = { ...params, [key]: v };
      } catch (e) {
        (errors[part.id] ??= {})[key] = e instanceof Error ? e.message : String(e);
      }
    }
    if (part.type === "sketch") {
      const sketch = parseSketch(params.profile);
      if (sketchReferences(sketch).length) {
        const solved = solveSketch(sketch, values);
        Object.entries(solved.dimensionErrors).forEach(([id, msg]) => ((errors[part.id] ??= {})["cota " + id] = msg));
        if (!solved.ok && !Object.keys(solved.dimensionErrors).length) (errors[part.id] ??= {}).profile = "El boceto no puede cumplir todas sus restricciones con estos valores.";
        const profile = JSON.stringify(solved.sketch);
        if (profile !== params.profile) params = { ...params, profile };
      }
    }
    return params === part.params ? part : { ...part, params };
  });
  return { parts: next, errors };
}
