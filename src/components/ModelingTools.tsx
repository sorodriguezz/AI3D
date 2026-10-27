import { useEffect, useState } from "react";
import { AlignCenter, ArrowDownToLine, Box, Copy, Drill, FlipHorizontal2, Grid2x2, Grid3x3, RotateCw, Scissors, Spline } from "lucide-react";
import { defaultParams, getTemplate } from "../cad/templates";
import type { Feature, MirrorAxes, Params, Part } from "../cad/types";
import { partMesh, usePartMesh } from "../studio/meshes";
import { alignedPosition, circularPattern, gridPattern, linearPattern, patternLimit, splitPart, worldBounds, type Anchor, type Axis } from "../studio/modeling";
import { useTools } from "../studio/tools";
import { uniqueBody, useStore } from "../store";
import { Button, SectionTitle, cx } from "./ui";

type Tool = "align" | "mirror" | "linear" | "circular" | "grid" | "shell" | "split" | "edges";
const field = "h-8 w-full min-w-0 rounded-md border border-line bg-surface px-2 text-[12px] text-fg outline-none focus:border-line-strong";
const axisNames = ["X", "Y", "Z"];

const geometry = (part: Part) => partMesh(part);

function SelectedTools({ part }: { part: Part }) {
  const parts = useStore((s) => s.doc?.parts ?? []);
  const update = useStore((s) => s.updatePart);
  const duplicate = useStore((s) => s.duplicatePart);
  const drop = useStore((s) => s.dropToBed);
  const entry = usePartMesh(part.type, part.params, part.features);
  const [tool, setTool] = useState<Tool | null>(null);
  const [grid, setGrid] = useState<[number, number, number, number]>([3, 2, 30, 30]);
  const [thickness, setThickness] = useState(2);
  const [open, setOpen] = useState<"top" | "bottom">("top");
  const [splitAxis, setSplitAxis] = useState<Axis>(2);
  const [splitAt, setSplitAt] = useState(10);
  const [finish, setFinish] = useState<"fillet" | "chamfer">("fillet");
  const [finishSize, setFinishSize] = useState(1);
  const edges = useTools((s) => s.edges);
  const setToolMode = useTools((s) => s.setMode);
  // La selección de aristas en el visor solo vive mientras la herramienta está abierta.
  useEffect(() => {
    if (tool === "edges") setToolMode({ kind: "edges", partId: part.id });
    else if (useTools.getState().mode?.kind === "edges") setToolMode(null);
  }, [tool, part.id, setToolMode]);
  useEffect(() => () => {
    if (useTools.getState().mode?.kind === "edges") useTools.getState().setMode(null);
  }, []);
  const exact = entry?.mesh?.exact !== false;
  const [target, setTarget] = useState("origin");
  const [axes, setAxes] = useState<Axis[]>([0, 1]);
  const [anchor, setAnchor] = useState<Anchor>("center");
  const [axis, setAxis] = useState<Axis>(0);
  const [quantity, setQuantity] = useState(3);
  const [spacing, setSpacing] = useState(30);
  const [centerX, setCenterX] = useState(part.position[0] - 30);
  const [centerY, setCenterY] = useState(part.position[1]);
  const [orient, setOrient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = patternLimit((entry?.mesh?.triangles.length ?? 0) / 3, parts.length);
  const count = Math.min(quantity, limit);
  const choose = (next: Tool) => {
    if (busy) return;
    if (tool !== next && entry?.mesh && (next === "linear" || next === "circular" || next === "grid" || next === "split")) {
      const box = worldBounds(part, entry.mesh);
      if (next === "linear") setSpacing(Math.ceil(box.max[axis] - box.min[axis]) + 5);
      else if (next === "grid") setGrid([grid[0], grid[1], Math.ceil(box.max[0] - box.min[0]) + 5, Math.ceil(box.max[1] - box.min[1]) + 5]);
      else if (next === "split") setSplitAt(+(box.max[splitAxis] - Math.min(5, (box.max[splitAxis] - box.min[splitAxis]) / 4)).toFixed(1));
      else {
        const radius = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) + 10;
        setCenterX(part.position[0] - radius);
        setCenterY(part.position[1]);
      }
    }
    setTool(tool === next ? null : next);
    setError(null);
  };
  const button = "flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[11px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default";
  const toolButton = (value: Tool) => cx(button, tool === value ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line text-muted hover:bg-surface-3 hover:text-fg");
  const apply = async () => {
    setBusy(true);
    setError(null);
    const state = useStore.getState(), doc = state.doc;
    if (!doc) { setBusy(false); return; }
    try {
      const mesh = await geometry(part);
      let position = part.position;
      let next = doc.parts;
      if (tool === "align") {
        if (!axes.length) throw new Error("Selecciona al menos un eje.");
        const reference = doc.parts.find((p) => p.id === target);
        if (target !== "origin" && !reference) throw new Error("Selecciona una referencia disponible.");
        const bounds = reference ? worldBounds(reference, await geometry(reference)) : { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] };
        position = alignedPosition(part, worldBounds(part, mesh), bounds, axes, anchor);
      } else if (tool === "linear" || tool === "circular") {
        if (count > patternLimit(mesh.triangles.length / 3, doc.parts.length)) throw new Error("Reduce la cantidad de piezas del patrón.");
        next = tool === "linear" ? linearPattern(part, doc.parts, axis, count, spacing)
          : circularPattern(part, doc.parts, count, [centerX, centerY], orient);
      } else if (tool === "grid") {
        if (grid[0] * grid[1] > patternLimit(mesh.triangles.length / 3, doc.parts.length)) throw new Error("Reduce las filas o columnas de la rejilla.");
        next = gridPattern(part, doc.parts, [grid[0], grid[1]], [grid[2], grid[3]]);
      } else if (tool === "split") {
        const box = worldBounds(part, mesh);
        if (!(splitAt > box.min[splitAxis] && splitAt < box.max[splitAxis])) throw new Error(`El plano debe cortar la pieza: entre ${box.min[splitAxis].toFixed(1)} y ${box.max[splitAxis].toFixed(1)} mm.`);
        const [lower, upper] = splitPart(part, doc.parts, splitAxis, splitAt, uniqueBody(doc.parts, "Tapa"));
        next = [...doc.parts.map((p) => (p.id === part.id ? lower : p)), upper];
      } else {
        let feature: Feature;
        if (tool === "shell") feature = { kind: "shell", thickness, open };
        else {
          if (!edges.length) throw new Error("Elige al menos una arista en el visor.");
          feature = { kind: finish, size: finishSize, edges: edges.map((e) => e.point) };
        }
        const features = [...(part.features ?? []), feature];
        // Se comprueba en el motor antes de aplicarla, para no dejar la pieza rota.
        await partMesh({ type: part.type, params: part.params, features });
        next = doc.parts.map((p) => (p.id === part.id ? { ...p, features } : p));
      }
      const latest = useStore.getState();
      if (latest.doc?.parts !== doc.parts || latest.selectedId !== part.id) throw new Error("La selección cambió. Vuelve a aplicar la herramienta.");
      if (tool === "align") latest.updatePart(part.id, { position });
      else latest.setParts(next);
      setTool(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-4 rounded-xl border border-line bg-surface-2/30 p-2.5">
      <p className="mb-2 truncate text-[11px] text-muted">Pieza: <span className="font-medium text-fg">{part.name}</span></p>
      <div className="grid grid-cols-3 gap-1">
        <button className={toolButton("align")} onClick={() => choose("align")}><AlignCenter size={13} /> Alinear</button>
        <button className={cx(button, "border-line text-muted hover:bg-surface-3")} disabled={busy || !entry?.mesh} onClick={() => drop(part.id)}><ArrowDownToLine size={13} /> Apoyar</button>
        <button className={cx(button, "border-line text-muted hover:bg-surface-3")} disabled={busy} onClick={() => duplicate(part.id)}><Copy size={13} /> Duplicar</button>
        <button className={toolButton("mirror")} onClick={() => choose("mirror")}><FlipHorizontal2 size={13} /> Espejo</button>
        <button className={toolButton("linear")} disabled={limit < 2} onClick={() => choose("linear")}><Grid2x2 size={13} /> Lineal</button>
        <button className={toolButton("circular")} disabled={limit < 2} onClick={() => choose("circular")}><RotateCw size={13} /> Circular</button>
        <button className={toolButton("grid")} disabled={limit < 2} onClick={() => choose("grid")}><Grid3x3 size={13} /> Rejilla</button>
        <button className={toolButton("split")} disabled={!entry?.mesh} onClick={() => choose("split")}><Scissors size={13} /> Dividir</button>
        <button className={toolButton("shell")} disabled={!exact || part.mode === "hole"} title={exact ? undefined : "Solo figuras nativas y STEP"} onClick={() => choose("shell")}><Box size={13} /> Vaciar</button>
        <button className={cx(toolButton("edges"), "col-span-3")} disabled={!exact} title={exact ? undefined : "Solo figuras nativas y STEP"} onClick={() => choose("edges")}><Spline size={13} /> Redondear o achaflanar aristas</button>
      </div>
      {tool && (
        <fieldset disabled={busy} className="mt-3 space-y-2 border-t border-line pt-3 text-[11.5px] text-muted">
          {tool === "align" && <>
            <label className="block space-y-1"><span>Alinear con</span><select aria-label="Referencia de alineación" className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="origin">Origen de la escena</option>
              {parts.filter((p) => p.id !== part.id && !p.hidden).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label className="block space-y-1"><span>Punto de la pieza</span><select aria-label="Punto de alineación" className={field} value={anchor} onChange={(e) => setAnchor(e.target.value as Anchor)}>
              <option value="center">Centro</option><option value="min">Extremo mínimo</option><option value="max">Extremo máximo</option>
            </select></label>
            <div className="flex items-center gap-1.5"><span className="mr-1">Ejes</span>{axisNames.map((name, i) => <button key={name} aria-label={`Alinear eje ${name}`} aria-pressed={axes.includes(i as Axis)} onClick={() => setAxes(axes.includes(i as Axis) ? axes.filter((a) => a !== i) : [...axes, i as Axis])} className={cx("h-7 flex-1 rounded-md border", axes.includes(i as Axis) ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line")}>{name}</button>)}</div>
          </>}
          {tool === "mirror" && <>
            <p>Refleja la pieza sobre sus ejes locales.</p>
            <div className="flex gap-1">{axisNames.map((name, i) => <button key={name} aria-label={`Espejo en ${name}`} aria-pressed={!!part.mirror?.[i]} onClick={() => {
              const mirror = [...(part.mirror ?? [false, false, false])] as MirrorAxes;
              mirror[i] = !mirror[i];
              update(part.id, { mirror });
            }} className={cx("h-8 flex-1 rounded-md border", part.mirror?.[i] ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line")}>{name}</button>)}</div>
            <p className="text-faint">Para crear una versión simétrica aparte, duplica primero la pieza.</p>
          </>}
          {(tool === "linear" || tool === "circular") && <>
            <label className="block space-y-1"><span>Cantidad total</span><input aria-label="Cantidad del patrón" type="number" min={2} max={limit} step={1} className={field} value={count} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
            <p className="text-[10.5px] text-faint">Incluye la pieza original. Máximo: {limit} para esta geometría.</p>
            {tool === "linear" ? <>
              <label className="block space-y-1"><span>Dirección</span><select aria-label="Eje del patrón" className={field} value={axis} onChange={(e) => setAxis(Number(e.target.value) as Axis)}>{axisNames.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
              <label className="block space-y-1"><span>Separación entre orígenes (mm)</span><input aria-label="Separación del patrón" type="number" step={1} className={field} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} /></label>
            </> : <>
              <p>Repetición de 360° alrededor del eje Z.</p>
              <div className="grid grid-cols-2 gap-2">{[{ axis: "X", value: centerX, set: setCenterX }, { axis: "Y", value: centerY, set: setCenterY }].map(({ axis: name, value, set }) => <label key={name} className="space-y-1"><span>Centro {name} (mm)</span><input aria-label={`Centro ${name} del patrón`} type="number" step={1} className={field} value={value} onChange={(e) => set(Number(e.target.value))} /></label>)}</div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={orient} onChange={(e) => setOrient(e.target.checked)} /> Rotar también las copias</label>
            </>}
          </>}
          {tool === "grid" && <>
            <div className="grid grid-cols-2 gap-2">
              {(["Columnas (X)", "Filas (Y)", "Paso X (mm)", "Paso Y (mm)"] as const).map((label, i) => (
                <label key={label} className="space-y-1"><span>{label}</span><input aria-label={label} type="number" step={i < 2 ? 1 : 0.5} min={i < 2 ? 1 : undefined} className={field} value={grid[i]} onChange={(e) => setGrid(grid.map((v, j) => (j === i ? Number(e.target.value) : v)) as typeof grid)} /></label>
              ))}
            </div>
            <p className="text-[10.5px] text-faint">{grid[0] * grid[1]} piezas en total, incluida la original. Máximo: {limit}.</p>
          </>}
          {tool === "shell" && <>
            <label className="block space-y-1"><span>Espesor de pared (mm)</span><input aria-label="Espesor del vaciado" type="number" min={0.4} step={0.2} className={field} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} /></label>
            <label className="block space-y-1"><span>Cara abierta</span><select aria-label="Cara abierta" className={field} value={open} onChange={(e) => setOpen(e.target.value as "top" | "bottom")}><option value="top">Superior</option><option value="bottom">Inferior</option></select></label>
            <p className="text-faint">Las paredes crecen hacia dentro: las medidas exteriores no cambian.</p>
          </>}
          {tool === "split" && <>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1"><span>Plano</span><select aria-label="Eje del plano de división" className={field} value={splitAxis} onChange={(e) => setSplitAxis(Number(e.target.value) as Axis)}>{axisNames.map((name, i) => <option key={name} value={i}>{name} constante</option>)}</select></label>
              <label className="space-y-1"><span>Posición (mm)</span><input aria-label="Posición del plano" type="number" step={0.5} className={field} value={splitAt} onChange={(e) => setSplitAt(Number(e.target.value))} /></label>
            </div>
            <p className="text-faint">Crea dos piezas: la parte superior pasa a un cuerpo nuevo para exportarla por separado.</p>
          </>}
          {tool === "edges" && <>
            <div className="flex gap-1">{(["fillet", "chamfer"] as const).map((k) => <button key={k} aria-pressed={finish === k} onClick={() => setFinish(k)} className={cx("h-7 flex-1 rounded-md border", finish === k ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line")}>{k === "fillet" ? "Redondeo" : "Chaflán"}</button>)}</div>
            <label className="block space-y-1"><span>{finish === "fillet" ? "Radio" : "Distancia"} (mm)</span><input aria-label="Tamaño del acabado" type="number" min={0.1} step={0.1} className={field} value={finishSize} onChange={(e) => setFinishSize(Number(e.target.value))} /></label>
            <p>{edges.length ? `${edges.length} ${edges.length === 1 ? "arista elegida" : "aristas elegidas"}.` : "Haz clic en el visor cerca de las aristas."}</p>
          </>}
          {tool !== "mirror" && <Button size="sm" variant="primary" className="w-full" disabled={busy || (tool === "edges" && !edges.length)} onClick={() => void apply()}>{busy ? "Calculando…" : ({ align: "Aplicar alineación", linear: "Crear patrón", circular: "Crear patrón", grid: "Crear rejilla", shell: "Vaciar pieza", split: "Dividir pieza", edges: finish === "fillet" ? "Redondear aristas" : "Achaflanar aristas" } as Record<Tool, string>)[tool]}</Button>}
        </fieldset>
      )}
      {error && <p role="alert" className="mt-2 text-[11px] text-err">{error}</p>}
    </div>
  );
}

const PLACEABLE = ["screw-hole", "vent", "cable-pass"];

/** Campos genéricos de una plantilla (para preparar una perforación antes de colocarla). */
function TemplateFields({ type, params, onChange }: { type: string; params: Params; onChange: (p: Params) => void }) {
  const t = getTemplate(type)!;
  return (
    <div className="grid grid-cols-2 gap-2">
      {t.params.filter((d) => !d.visibleIf || d.visibleIf(params)).map((d) => (
        <label key={d.key} className={cx("space-y-1", d.type === "enum" && "col-span-2")}>
          {d.type === "bool" ? (
            <span className="flex h-8 items-center gap-2"><input type="checkbox" checked={!!params[d.key]} onChange={(e) => onChange({ ...params, [d.key]: e.target.checked })} /> {d.label}</span>
          ) : <>
            <span>{d.label}{d.type !== "enum" && d.unit ? ` (${d.unit})` : ""}</span>
            {d.type === "enum" ? (
              <select aria-label={d.label} className={field} value={String(params[d.key])} onChange={(e) => onChange({ ...params, [d.key]: e.target.value })}>{d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            ) : (
              <input aria-label={d.label} type="number" min={d.min} max={d.max} step={d.step} className={field} value={Number(params[d.key])} onChange={(e) => onChange({ ...params, [d.key]: Number(e.target.value) })} />
            )}
          </>}
        </label>
      ))}
    </div>
  );
}

/** Perforaciones y rejillas que se colocan haciendo clic sobre una cara. */
function PlaceTools() {
  const mode = useTools((s) => s.mode);
  const setMode = useTools((s) => s.setMode);
  const [type, setType] = useState("screw-hole");
  const [params, setParams] = useState<Record<string, Params>>(() => Object.fromEntries(PLACEABLE.map((t) => [t, defaultParams(getTemplate(t)!)])));
  const active = mode?.kind === "place";
  const change = (next: Params) => {
    setParams({ ...params, [type]: next });
    if (active) setMode({ kind: "place", type, params: next });
  };
  return (
    <div className="mx-4 mt-2 rounded-xl border border-line bg-surface-2/30 p-2.5 text-[11.5px] text-muted">
      <div className="mb-2 flex gap-1">
        {PLACEABLE.map((t) => (
          <button key={t} aria-pressed={type === t} onClick={() => { setType(t); if (active) setMode({ kind: "place", type: t, params: params[t] }); }} className={cx("h-7 flex-1 rounded-md border cursor-pointer", type === t ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line hover:text-fg")}>
            {t === "screw-hole" ? "Agujero" : t === "vent" ? "Ventilación" : "Pasacables"}
          </button>
        ))}
      </div>
      <TemplateFields type={type} params={params[type]} onChange={change} />
      <Button size="sm" variant={active ? "secondary" : "primary"} className="mt-2 w-full" onClick={() => setMode(active ? null : { kind: "place", type, params: params[type] })}>
        <Drill size={13} /> {active ? "Terminar de colocar" : "Colocar sobre una cara"}
      </Button>
    </div>
  );
}

export function ModelingTools() {
  const part = useStore((s) => s.doc?.parts.find((p) => p.id === s.selectedId));
  return <>
    <SectionTitle>Herramientas de edición</SectionTitle>
    {part ? <SelectedTools key={part.id} part={part} />
      : <p className="mx-4 rounded-xl border border-dashed border-line p-3 text-[11.5px] text-muted">Selecciona una pieza para alinear, espejar, crear patrones, dividirla, vaciarla o redondear sus aristas.</p>}
    <SectionTitle>Perforar</SectionTitle>
    <PlaceTools />
  </>;
}
