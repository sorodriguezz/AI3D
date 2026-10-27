import { useState } from "react";
import { Plus, Variable as VariableIcon, X } from "lucide-react";
import { VARIABLE_NAME, resolveVariables, type Variable } from "../cad/expr";
import { parseSketch } from "../cad/sketch";
import type { Part } from "../cad/types";
import { useStore } from "../store";
import { SectionTitle, cx } from "./ui";

// Variables del diseño: medidas con nombre que usan las fórmulas y las cotas de los bocetos.

const field = "h-7 min-w-0 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] text-fg outline-none focus:border-line-strong";

function VariableRow({ variable, index, list, error, value }: { variable: Variable; index: number; list: Variable[]; error?: string; value?: number }) {
  const setVariables = useStore((s) => s.setVariables);
  const [name, setName] = useState(variable.name);
  const [expr, setExpr] = useState(variable.expr);
  const save = () => {
    if (name === variable.name && expr === variable.expr) return;
    const renamed = name.trim();
    if (renamed === variable.name) return setVariables(list.map((v, i) => (i === index ? { name: renamed, expr: expr.trim() || "0" } : v)));
    // Al renombrar, las fórmulas que la usan pasan a apuntar al nombre nuevo.
    const swap = (src: string) => renameInParts([{ exprs: { x: src } } as unknown as Part], variable.name, renamed)[0].exprs!.x;
    const parts = useStore.getState().doc?.parts ?? [];
    setVariables(list.map((v, i) => (i === index ? { name: renamed, expr: swap(expr.trim() || "0") } : { ...v, expr: swap(v.expr) })), renameInParts(parts, variable.name, renamed));
  };
  return (
    <div className="group px-4 py-1">
      <div className="flex items-center gap-1.5">
        <input aria-label="Nombre de la variable" className={cx(field, "w-24", !VARIABLE_NAME.test(name) && "border-err/60")} value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
        <span className="text-faint">=</span>
        <input aria-label={`Valor de ${variable.name}`} className={cx(field, "flex-1")} value={expr} onChange={(e) => setExpr(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button aria-label={`Eliminar ${variable.name}`} onClick={() => setVariables(list.filter((_, i) => i !== index))} className="text-faint opacity-0 hover:text-err group-hover:opacity-100 cursor-pointer"><X size={12} /></button>
      </div>
      {error ? <p className="mt-0.5 text-[10.5px] text-err">{error}</p> : expr.trim() !== String(value) && value !== undefined && <p className="mt-0.5 text-right font-mono text-[10.5px] text-faint">= {+value.toFixed(4)}</p>}
    </div>
  );
}

/** Fórmulas de las piezas y cotas de bocetos con una variable renombrada. */
function renameInParts(parts: Part[], from: string, to: string): Part[] {
  const swap = (src: string) => src.replace(new RegExp(`(^|[^A-Za-z0-9_\u00C0-\u024F])${from}(?![A-Za-z0-9_\u00C0-\u024F])`, "g"), `$1${to}`);
  return parts.map((p) => {
    const exprs = p.exprs && Object.fromEntries(Object.entries(p.exprs).map(([k, v]) => [k, swap(v)]));
    if (p.type !== "sketch") return exprs ? { ...p, exprs } : p;
    const sketch = parseSketch(p.params.profile);
    const constraints = sketch.constraints.map((c) => ("value" in c ? { ...c, value: swap(c.value) } : c));
    return { ...p, ...(exprs ? { exprs } : {}), params: { ...p.params, profile: JSON.stringify({ ...sketch, constraints }) } };
  });
}

const NONE: Variable[] = [];

export function VariablesPanel() {
  const variables = useStore((s) => s.doc?.variables ?? NONE);
  const setVariables = useStore((s) => s.setVariables);
  const { values, errors } = resolveVariables(variables);
  const add = () => {
    let i = variables.length + 1;
    while (variables.some((v) => v.name === `v${i}`)) i++;
    setVariables([...variables, { name: `v${i}`, expr: "10" }]);
  };
  return (
    <>
      <SectionTitle aside={<button aria-label="Añadir variable" onClick={add} className="text-faint hover:text-fg cursor-pointer"><Plus size={13} /></button>}>Variables</SectionTitle>
      {variables.length === 0 ? (
        <button onClick={add} className="mx-4 flex w-[calc(100%-2rem)] items-start gap-2 rounded-xl border border-dashed border-line p-3 text-left text-[11.5px] text-muted hover:text-fg cursor-pointer">
          <VariableIcon size={14} className="mt-0.5 shrink-0" />
          <span>Crea variables como <span className="font-mono">ancho = 120</span> y úsalas en medidas (botón <span className="font-mono italic">fx</span>) y cotas de bocetos. Al cambiarlas se actualiza todo lo que depende de ellas.</span>
        </button>
      ) : (
        variables.map((v, i) => <VariableRow key={`${i}:${v.name}:${v.expr}`} variable={v} index={i} list={variables} error={errors[v.name]} value={values[v.name]} />)
      )}
    </>
  );
}
