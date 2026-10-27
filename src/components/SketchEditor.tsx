import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Circle, Lock, MousePointer2, Redo2, Slash, Spline, Square, Trash2, Undo2, X } from "lucide-react";
import { resolveVariables } from "../cad/expr";
import { parseSketch, profileLoops, sid, solveSketch, type Constraint, type Sketch, type SketchEntity, type SketchPoint } from "../cad/sketch";
import { useStore } from "../store";
import { create } from "zustand";
import { Button, cx } from "./ui";

// Editor de bocetos: dibujo 2D con restricciones y cotas. Y hacia arriba, en mm.

export const useSketchEditor = create<{ partId: string | null; open: (id: string | null) => void }>((set) => ({ partId: null, open: (partId) => set({ partId }) }));

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type Tool = "select" | "line" | "rect" | "circle" | "arc";
type Vec = [number, number];
type View = { cx: number; cy: number; scale: number };

const TOOLS: { id: Tool; label: string; icon: typeof Slash; help: string }[] = [
  { id: "select", label: "Seleccionar", icon: MousePointer2, help: "Clic para elegir puntos, líneas o curvas (Mayús para varios). Arrastra un punto para moverlo respetando las restricciones." },
  { id: "line", label: "Línea", icon: Slash, help: "Clic en cada vértice. Termina en el primer punto para cerrar el contorno, o pulsa Esc." },
  { id: "rect", label: "Rectángulo", icon: Square, help: "Clic en dos esquinas opuestas." },
  { id: "circle", label: "Círculo", icon: Circle, help: "Clic en el centro y luego en un punto del borde." },
  { id: "arc", label: "Arco", icon: Spline, help: "Clic en el centro, el inicio y el final (sentido antihorario)." },
];

const fmt = (v: number) => (+v.toFixed(2)).toLocaleString("es");
const SNAP_PX = 9;

function constraintLabel(c: Constraint): string {
  switch (c.kind) {
    case "horizontal": return "Horizontal";
    case "vertical": return "Vertical";
    case "parallel": return "Paralelas";
    case "perpendicular": return "Perpendiculares";
    case "equal": return "Iguales";
    case "coincident": return "Coincidentes";
    case "tangent": return "Tangente";
    case "distance": return "Distancia";
    case "hdistance": return "Distancia horizontal";
    case "vdistance": return "Distancia vertical";
    case "radius": return "Radio";
    case "diameter": return "Diámetro";
    case "angle": return "Ángulo (°)";
  }
}

const refsOf = (c: Constraint): string[] =>
  "line" in c && "curve" in c ? [c.line, c.curve] : "line" in c ? [c.line] : "entity" in c ? [c.entity] : [c.a, c.b];

export function SketchEditor() {
  const partId = useSketchEditor((s) => s.partId);
  const part = useStore((s) => s.doc?.parts.find((p) => p.id === partId));
  if (!partId || !part) return null;
  return <Editor key={partId} partId={partId} initial={parseSketch(part.params.profile)} name={part.name} />;
}

function Editor({ partId, initial, name }: { partId: string; initial: Sketch; name: string }) {
  const close = () => useSketchEditor.getState().open(null);
  const variables = useStore((s) => s.doc?.variables);
  const scope = useMemo(() => resolveVariables(variables).values, [variables]);
  const [sketch, setSketch] = useState(initial);
  const [history, setHistory] = useState<{ past: Sketch[]; future: Sketch[] }>({ past: [], future: [] });
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [construction, setConstruction] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>(() => fitView(initial, 800, 600));
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ point?: string; pan?: { x: number; y: number; view: View }; before?: Sketch } | null>(null);

  const solved = useMemo(() => solveSketch(sketch, scope), [sketch, scope]);
  const pts = useMemo(() => new Map(sketch.points.map((p) => [p.id, p])), [sketch]);
  let profileError: string | null = null;
  try {
    profileLoops(prune(sketch));
  } catch (e) {
    profileError = e instanceof Error ? e.message : String(e);
  }

  useLayoutEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    setView(fitView(initial, r.width, r.height));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toScreen = ([x, y]: Vec): Vec => [(x - view.cx) * view.scale + size.w / 2, (view.cy - y) * view.scale + size.h / 2];
  const toWorld = (sx: number, sy: number): Vec => [view.cx + (sx - size.w / 2) / view.scale, view.cy - (sy - size.h / 2) / view.scale];
  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const grid = gridStep(view.scale);
  const snap = (v: Vec): Vec => [Math.round(v[0] / grid) * grid, Math.round(v[1] / grid) * grid];

  /** Aplica un cambio, lo resuelve y lo guarda en el historial del editor. */
  const apply = (next: Sketch, pinned?: Set<string>, record = true) => {
    const result = solveSketch(next, scope, pinned);
    if (record) setHistory({ past: [...history.past, sketch].slice(-100), future: [] });
    setSketch(result.sketch);
    return result;
  };

  const nearestPoint = (s: Vec, except?: string) => {
    let best: SketchPoint | null = null, bestD = SNAP_PX;
    for (const p of sketch.points) {
      if (p.id === except) continue;
      const [x, y] = toScreen([p.x, p.y]);
      const d = Math.hypot(x - s[0], y - s[1]);
      if (d < bestD) [best, bestD] = [p, d];
    }
    return best;
  };

  const nearestEntity = (s: Vec) => {
    const w = toWorld(...s);
    let best: SketchEntity | null = null, bestD = 7 / view.scale;
    for (const e of sketch.entities) {
      const d = entityDistance(e, w, pts);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best;
  };

  /** Punto existente bajo el cursor o uno nuevo en la cuadrícula. */
  const pointAt = (s: Vec, draft: Sketch): [string, Sketch] => {
    const hit = nearestPoint(s);
    if (hit) return [hit.id, draft];
    const [x, y] = snap(toWorld(...s));
    const id = sid("p");
    return [id, { ...draft, points: [...draft.points, { id, x, y }] }];
  };

  const addLine = (draft: Sketch, a: string, b: string): Sketch => {
    const id = sid("l");
    const constraints = [...draft.constraints];
    const pa = draft.points.find((p) => p.id === a)!, pb = draft.points.find((p) => p.id === b)!;
    const angle = Math.abs((Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI);
    // Las líneas casi horizontales o verticales quedan restringidas así automáticamente.
    if (angle < 2 || angle > 178) constraints.push({ id: sid("c"), kind: "horizontal", line: id });
    else if (Math.abs(angle - 90) < 2) constraints.push({ id: sid("c"), kind: "vertical", line: id });
    return { ...draft, entities: [...draft.entities, { id, kind: "line", a, b, ...(construction ? { construction: true } : {}) }], constraints };
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = local(e);
    setMessage(null);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      drag.current = { pan: { x: s[0], y: s[1], view } };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (tool === "select") {
      const p = nearestPoint(s);
      const ent = p ? null : nearestEntity(s);
      const id = p?.id ?? ent?.id ?? null;
      if (!id) {
        if (!e.shiftKey) setSelection([]);
        drag.current = { pan: { x: s[0], y: s[1], view } };
      } else {
        setSelection(e.shiftKey ? (selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]) : selection.includes(id) ? selection : [id]);
        if (p && !p.fixed) drag.current = { point: p.id, before: sketch };
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    let draft = sketch;
    let id: string;
    [id, draft] = pointAt(s, draft);
    if (tool === "line") {
      if (!chain.length) return setChain([id]), setSketch(draft);
      const prev = chain[chain.length - 1];
      if (prev === id) return;
      draft = addLine(draft, prev, id);
      apply(draft);
      // Cerrar sobre el primer punto termina el contorno.
      setChain(id === chain[0] ? [] : [...chain, id]);
    } else if (tool === "rect") {
      if (!chain.length) return setChain([id]), setSketch(draft);
      const a = draft.points.find((p) => p.id === chain[0])!, c = draft.points.find((p) => p.id === id)!;
      if (Math.abs(a.x - c.x) < 1e-6 || Math.abs(a.y - c.y) < 1e-6) return setMessage("Las esquinas deben estar en diagonal.");
      const b = { id: sid("p"), x: c.x, y: a.y }, d = { id: sid("p"), x: a.x, y: c.y };
      draft = { ...draft, points: [...draft.points, b, d] };
      for (const [u, v] of [[a.id, b.id], [b.id, c.id], [c.id, d.id], [d.id, a.id]]) draft = addLine(draft, u, v);
      apply(draft);
      setChain([]);
    } else if (tool === "circle") {
      if (!chain.length) return setChain([id]), setSketch(draft);
      // El punto del borde no se guarda: el círculo solo usa su centro.
      const c = sketch.points.find((p) => p.id === chain[0])!;
      const rim = nearestPoint(s);
      const w = rim ? [rim.x, rim.y] : snap(toWorld(...s));
      const r = Math.hypot(w[0] - c.x, w[1] - c.y);
      if (r < 1e-6) return;
      apply({ ...sketch, entities: [...sketch.entities, { id: sid("k"), kind: "circle", c: c.id, r: +r.toFixed(3), ...(construction ? { construction: true } : {}) }] });
      setChain([]);
    } else if (tool === "arc") {
      if (chain.length < 2) return setChain([...chain, id]), setSketch(draft);
      const [c, a] = [draft.points.find((p) => p.id === chain[0])!, draft.points.find((p) => p.id === chain[1])!];
      const r = Math.hypot(a.x - c.x, a.y - c.y);
      // El final se proyecta sobre la circunferencia salvo que sea un punto existente.
      let b = draft.points.find((p) => p.id === id)!;
      if (!sketch.points.some((p) => p.id === id)) {
        const ang = Math.atan2(b.y - c.y, b.x - c.x);
        b = { ...b, x: +(c.x + r * Math.cos(ang)).toFixed(4), y: +(c.y + r * Math.sin(ang)).toFixed(4) };
        draft = { ...draft, points: draft.points.map((p) => (p.id === id ? b : p)) };
      }
      apply({ ...draft, entities: [...draft.entities, { id: sid("a"), kind: "arc", c: c.id, a: a.id, b: b.id, ...(construction ? { construction: true } : {}) }] });
      setChain([]);
    }
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = local(e);
    const d = drag.current;
    if (d?.pan) {
      setView({ ...d.pan.view, cx: d.pan.view.cx - (s[0] - d.pan.x) / view.scale, cy: d.pan.view.cy + (s[1] - d.pan.y) / view.scale });
      return;
    }
    if (d?.point) {
      const [x, y] = e.shiftKey ? toWorld(...s) : snap(toWorld(...s));
      const moved = { ...sketch, points: sketch.points.map((p) => (p.id === d.point ? { ...p, x, y } : p)) };
      apply(moved, new Set([d.point]), false);
      return;
    }
    const hit = nearestPoint(s);
    setCursor(hit ? [hit.x, hit.y] : snap(toWorld(...s)));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.point && d.before) {
      // Al soltar, el punto deja de estar fijado y el boceto se vuelve a resolver.
      setHistory({ past: [...history.past, d.before].slice(-100), future: [] });
      setSketch(solveSketch(sketch, scope).sketch);
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const s = local(e);
    const before = toWorld(...s);
    const scale = Math.min(200, Math.max(0.2, view.scale * Math.exp(-e.deltaY * 0.0015)));
    // El punto bajo el cursor se mantiene en su sitio.
    setView({ scale, cx: before[0] - (s[0] - size.w / 2) / scale, cy: before[1] + (s[1] - size.h / 2) / scale });
  };

  const undo = () => {
    if (!history.past.length) return;
    setHistory({ past: history.past.slice(0, -1), future: [sketch, ...history.future] });
    setSketch(history.past[history.past.length - 1]);
  };
  const redo = () => {
    if (!history.future.length) return;
    setHistory({ past: [...history.past, sketch], future: history.future.slice(1) });
    setSketch(history.future[0]);
  };

  const remove = () => {
    if (!selection.length) return;
    const sel = new Set(selection);
    // Al borrar un punto se van las curvas que lo usan; los puntos sin uso desaparecen.
    const entities = sketch.entities.filter((e) => !sel.has(e.id) && !("a" in e && (sel.has(e.a) || sel.has(e.b))) && !(e.kind !== "line" && sel.has(e.c)));
    const kept = new Set(entities.flatMap((e) => (e.kind === "circle" ? [e.c] : e.kind === "arc" ? [e.c, e.a, e.b] : [e.a, e.b])));
    const points = sketch.points.filter((p) => kept.has(p.id));
    const alive = new Set([...points.map((p) => p.id), ...entities.map((e) => e.id)]);
    const constraints = sketch.constraints.filter((c) => !sel.has(c.id) && refsOf(c).every((r) => alive.has(r)));
    apply({ points, entities, constraints });
    setSelection([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      e.stopPropagation();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        if (chain.length) (setChain([]), setSketch(prune(sketch)));
        else if (tool !== "select") setTool("select");
        else setSelection([]);
      } else if (mod && e.key.toLowerCase() === "z") (e.preventDefault(), e.shiftKey ? redo() : undo());
      else if (e.key === "Delete" || e.key === "Backspace") (e.preventDefault(), remove());
      else if (!mod && e.key === "l") setTool("line");
      else if (!mod && e.key === "r") setTool("rect");
      else if (!mod && e.key === "c") setTool("circle");
      else if (!mod && e.key === "a") setTool("arc");
      else if (!mod && e.key === "s") setTool("select");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // --- Restricciones posibles según la selección ---
  const selPoints = selection.map((id) => pts.get(id)).filter(Boolean) as SketchPoint[];
  const selEntities = selection.map((id) => sketch.entities.find((e) => e.id === id)).filter(Boolean) as SketchEntity[];
  const lines = selEntities.filter((e) => e.kind === "line") as Extract<SketchEntity, { kind: "line" }>[];
  const curves = selEntities.filter((e) => e.kind !== "line") as Extract<SketchEntity, { kind: "circle" | "arc" }>[];
  const only = (p: number, l: number, c: number) => selPoints.length === p && lines.length === l && curves.length === c;
  const len = (l: { a: string; b: string }) => Math.hypot(pts.get(l.b)!.x - pts.get(l.a)!.x, pts.get(l.b)!.y - pts.get(l.a)!.y);
  const radiusOf = (e: Extract<SketchEntity, { kind: "circle" | "arc" }>) => (e.kind === "circle" ? e.r : Math.hypot(pts.get(e.a)!.x - pts.get(e.c)!.x, pts.get(e.a)!.y - pts.get(e.c)!.y));
  const lineAngle = (a: { a: string; b: string }, b: { a: string; b: string }) => {
    const u = [pts.get(a.b)!.x - pts.get(a.a)!.x, pts.get(a.b)!.y - pts.get(a.a)!.y], v = [pts.get(b.b)!.x - pts.get(b.a)!.x, pts.get(b.b)!.y - pts.get(b.a)!.y];
    return Math.abs((Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) / Math.PI);
  };
  const add = (c: DistributiveOmit<Constraint, "id">) => {
    const constraint = { ...c, id: sid("c") } as Constraint;
    const result = apply({ ...sketch, constraints: [...sketch.constraints, constraint] });
    if (!result.ok && !Object.keys(result.dimensionErrors).length) setMessage("La restricción entra en conflicto con otras: revisa o elimina alguna.");
    setSelection([constraint.id]);
  };
  const actions: { label: string; run: () => void }[] = [];
  if (only(0, 1, 0)) actions.push({ label: "Horizontal", run: () => add({ kind: "horizontal", line: lines[0].id }) }, { label: "Vertical", run: () => add({ kind: "vertical", line: lines[0].id }) }, { label: "Cota de longitud", run: () => add({ kind: "distance", a: lines[0].a, b: lines[0].b, value: fmtValue(len(lines[0])) }) });
  if (only(0, 2, 0)) actions.push({ label: "Paralelas", run: () => add({ kind: "parallel", a: lines[0].id, b: lines[1].id }) }, { label: "Perpendiculares", run: () => add({ kind: "perpendicular", a: lines[0].id, b: lines[1].id }) }, { label: "Misma longitud", run: () => add({ kind: "equal", a: lines[0].id, b: lines[1].id }) }, { label: "Cota de ángulo", run: () => add({ kind: "angle", a: lines[0].id, b: lines[1].id, value: fmtValue(lineAngle(lines[0], lines[1])) }) });
  if (only(2, 0, 0)) {
    const [a, b] = selPoints;
    actions.push(
      { label: "Coincidentes", run: () => add({ kind: "coincident", a: a.id, b: b.id }) },
      { label: "Cota", run: () => add({ kind: "distance", a: a.id, b: b.id, value: fmtValue(Math.hypot(b.x - a.x, b.y - a.y)) }) },
      { label: "Cota horizontal", run: () => add({ kind: "hdistance", a: a.id, b: b.id, value: fmtValue(Math.abs(b.x - a.x)) }) },
      { label: "Cota vertical", run: () => add({ kind: "vdistance", a: a.id, b: b.id, value: fmtValue(Math.abs(b.y - a.y)) }) },
    );
  }
  if (only(0, 0, 1)) actions.push(curves[0].kind === "circle" ? { label: "Cota de diámetro", run: () => add({ kind: "diameter", entity: curves[0].id, value: fmtValue(2 * radiusOf(curves[0])) }) } : { label: "Cota de radio", run: () => add({ kind: "radius", entity: curves[0].id, value: fmtValue(radiusOf(curves[0])) }) });
  if (only(0, 0, 2)) actions.push({ label: "Mismo radio", run: () => add({ kind: "equal", a: curves[0].id, b: curves[1].id }) });
  if (only(0, 1, 1)) actions.push({ label: "Tangente", run: () => add({ kind: "tangent", line: lines[0].id, curve: curves[0].id }) });
  if (only(1, 0, 0)) actions.push({ label: selPoints[0].fixed ? "Soltar punto" : "Fijar punto", run: () => apply({ ...sketch, points: sketch.points.map((p) => (p.id === selPoints[0].id ? { ...p, fixed: !p.fixed } : p)) }) });
  if (selEntities.length) actions.push({ label: selEntities.every((e) => e.construction) ? "Geometría normal" : "Construcción", run: () => {
    const on = !selEntities.every((e) => e.construction);
    apply({ ...sketch, entities: sketch.entities.map((e) => (selection.includes(e.id) ? { ...e, construction: on || undefined } : e)) });
  } });

  const setValue = (id: string, value: string) => apply({ ...sketch, constraints: sketch.constraints.map((c) => (c.id === id && "value" in c ? { ...c, value } : c)) });

  const save = () => {
    if (profileError) return setMessage(profileError);
    useStore.getState().setPartParam(partId, "profile", JSON.stringify(solveSketch(prune(sketch), scope).sketch));
    close();
  };

  const status = Object.keys(solved.dimensionErrors).length ? { tone: "err", text: Object.values(solved.dimensionErrors)[0] }
    : !solved.ok ? { tone: "err", text: "Restricciones en conflicto: no se pueden cumplir todas." }
    : solved.freedom === 0 ? { tone: "ok", text: "Totalmente restringido" }
    : { tone: "muted", text: `${solved.freedom} ${solved.freedom === 1 ? "grado de libertad" : "grados de libertad"} sin restringir` };

  const isSel = (id: string) => selection.includes(id);
  const stroke = (e: SketchEntity) => (isSel(e.id) ? "var(--accent-text)" : e.construction ? "var(--faint, #8b8f98)" : "var(--text)");
  const hRule = 50;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur" role="dialog" aria-label={`Editar boceto ${name}`}>
      <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <span className="mr-2 text-[13px] font-semibold text-fg">Boceto · {name}</span>
        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {TOOLS.map((t) => (
            <button key={t.id} aria-pressed={tool === t.id} title={`${t.label} (${t.id === "select" ? "S" : t.id === "rect" ? "R" : t.id[0].toUpperCase()})`} onClick={() => (setTool(t.id), setChain([]))} className={cx("flex h-7 items-center gap-1 rounded-md px-2 text-[12px] cursor-pointer", tool === t.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
        <label className="ml-1 flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" checked={construction} onChange={(e) => setConstruction(e.target.checked)} /> Construcción</label>
        <div className="mx-1 h-5 w-px bg-line" />
        <button aria-label="Deshacer" disabled={!history.past.length} onClick={undo} className="text-muted hover:text-fg disabled:opacity-30 cursor-pointer"><Undo2 size={15} /></button>
        <button aria-label="Rehacer" disabled={!history.future.length} onClick={redo} className="text-muted hover:text-fg disabled:opacity-30 cursor-pointer"><Redo2 size={15} /></button>
        <button aria-label="Eliminar selección" disabled={!selection.length} onClick={remove} className="text-muted hover:text-err disabled:opacity-30 cursor-pointer"><Trash2 size={15} /></button>
        <div className="flex-1" />
        <Button size="sm" onClick={close}>Cancelar</Button>
        <Button size="sm" variant="primary" onClick={save}>Guardar boceto</Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ background: "var(--viewport)" }}>
          <svg
            ref={svgRef}
            width={size.w}
            height={size.h}
            className={cx("block select-none", tool === "select" ? "cursor-default" : "cursor-crosshair")}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setCursor(null)}
            onWheel={onWheel}
            onContextMenu={(e) => (e.preventDefault(), setChain([]), setSketch(prune(sketch)))}
            onDoubleClick={() => (setChain([]), setSketch(prune(sketch)))}
          >
            <Grid view={view} size={size} step={grid} />
            {/* Ejes del boceto: el eje Y es el de revolución. */}
            <line x1={toScreen([0, 0])[0]} y1={0} x2={toScreen([0, 0])[0]} y2={size.h} stroke="#4ade80" strokeOpacity={0.5} />
            <line x1={0} y1={toScreen([0, 0])[1]} x2={size.w} y2={toScreen([0, 0])[1]} stroke="#f87171" strokeOpacity={0.5} />
            {sketch.entities.map((e) => {
              const dash = e.construction ? "6 4" : undefined;
              const width = isSel(e.id) ? 2.5 : 1.6;
              if (e.kind === "line") {
                const [a, b] = [toScreen([pts.get(e.a)!.x, pts.get(e.a)!.y]), toScreen([pts.get(e.b)!.x, pts.get(e.b)!.y])];
                return <line key={e.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke(e)} strokeWidth={width} strokeDasharray={dash} />;
              }
              const c = pts.get(e.c)!;
              const [cx2, cy2] = toScreen([c.x, c.y]);
              if (e.kind === "circle") return <circle key={e.id} cx={cx2} cy={cy2} r={e.r * view.scale} fill="none" stroke={stroke(e)} strokeWidth={width} strokeDasharray={dash} />;
              const [a, b] = [pts.get(e.a)!, pts.get(e.b)!];
              const r = Math.hypot(a.x - c.x, a.y - c.y) * view.scale;
              const [sa, sb] = [toScreen([a.x, a.y]), toScreen([b.x, b.y])];
              let sweep = Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
              if (sweep <= 0) sweep += 2 * Math.PI;
              // En pantalla Y crece hacia abajo: el sentido antihorario se dibuja con sweep-flag 0.
              return <path key={e.id} d={`M ${sa[0]} ${sa[1]} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${sb[0]} ${sb[1]}`} fill="none" stroke={stroke(e)} strokeWidth={width} strokeDasharray={dash} />;
            })}
            {sketch.constraints.map((c) => <ConstraintMark key={c.id} c={c} sketch={sketch} toScreen={toScreen} selected={isSel(c.id)} onSelect={() => setSelection([c.id])} />)}
            {sketch.points.map((p) => {
              const [x, y] = toScreen([p.x, p.y]);
              return <rect key={p.id} x={x - 3.5} y={y - 3.5} width={7} height={7} rx={p.fixed ? 0 : 3.5} fill={isSel(p.id) ? "var(--accent-text)" : p.fixed ? "var(--text)" : "var(--surface)"} stroke={isSel(p.id) ? "var(--accent-text)" : "var(--text)"} strokeWidth={1.2} />;
            })}
            {/* Vista previa de la herramienta activa. */}
            {cursor && chain.length > 0 && (() => {
              const first = pts.get(chain[0]);
              const last = pts.get(chain[chain.length - 1]);
              if (!first || !last) return null;
              const [a, c] = [toScreen([last.x, last.y]), toScreen(cursor)];
              if (tool === "line") return <line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} stroke="var(--accent-text)" strokeDasharray="4 3" />;
              if (tool === "rect") {
                const f = toScreen([first.x, first.y]);
                return <rect x={Math.min(f[0], c[0])} y={Math.min(f[1], c[1])} width={Math.abs(c[0] - f[0])} height={Math.abs(c[1] - f[1])} fill="none" stroke="var(--accent-text)" strokeDasharray="4 3" />;
              }
              const f = toScreen([first.x, first.y]);
              return <circle cx={f[0]} cy={f[1]} r={Math.hypot(c[0] - f[0], c[1] - f[1])} fill="none" stroke="var(--accent-text)" strokeDasharray="4 3" />;
            })()}
            {cursor && tool !== "select" && (() => {
              const [x, y] = toScreen(cursor);
              return <circle cx={x} cy={y} r={3} fill="var(--accent-text)" />;
            })()}
          </svg>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-line bg-surface/90 px-2.5 py-1.5 font-mono text-[11px] text-muted">
            {cursor ? `${fmt(cursor[0])}, ${fmt(cursor[1])} mm` : "—"} · cuadrícula {fmt(grid)} mm · rueda: zoom · Alt/clic derecho + arrastrar: mover
          </div>
          <svg className="pointer-events-none absolute bottom-3 right-3" width={hRule + 30} height={20}>
            <line x1={5} y1={14} x2={5 + hRule} y2={14} stroke="var(--muted)" />
            <text x={5} y={9} fontSize={10} fill="var(--muted)">{fmt(hRule / view.scale)} mm</text>
          </svg>
        </div>
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-3 text-[12px] scroll-thin">
          <p className="text-muted">{TOOLS.find((t) => t.id === tool)!.help}</p>
          <div className={cx("rounded-lg px-2.5 py-1.5", status.tone === "ok" ? "bg-ok/10 text-ok" : status.tone === "err" ? "bg-err/10 text-err" : "bg-surface-2 text-muted")}>{status.text}</div>
          {(profileError || message) && <p role="alert" className="text-warn">{message ?? profileError}</p>}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Restringir selección</div>
            {actions.length ? (
              <div className="flex flex-wrap gap-1">{actions.map((a) => <button key={a.label} onClick={a.run} className="rounded-md border border-line px-2 py-1 text-fg hover:bg-surface-2 cursor-pointer">{a.label}</button>)}</div>
            ) : <p className="text-faint">Elige una línea, dos líneas, dos puntos, un círculo o una línea y una curva.</p>}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Restricciones y cotas</div>
            {sketch.constraints.length === 0 && <p className="text-faint">Sin restricciones.</p>}
            <div className="space-y-1">
              {sketch.constraints.map((c) => (
                <div key={c.id} onClick={() => setSelection([c.id])} className={cx("group flex items-center gap-1.5 rounded-md px-1.5 py-1 cursor-pointer", isSel(c.id) ? "bg-accent-soft" : "hover:bg-surface-2")}>
                  <span className="min-w-0 flex-1 truncate text-fg">{constraintLabel(c)}</span>
                  {"value" in c && <ValueInput value={c.value} error={solved.dimensionErrors[c.id]} onCommit={(v) => setValue(c.id, v)} />}
                  <button aria-label={`Quitar ${constraintLabel(c)}`} onClick={(e) => (e.stopPropagation(), apply({ ...sketch, constraints: sketch.constraints.filter((x) => x.id !== c.id) }))} className="text-faint opacity-0 hover:text-err group-hover:opacity-100 cursor-pointer"><X size={12} /></button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-faint">Las cotas aceptan fórmulas con las variables del diseño, por ejemplo <span className="font-mono">ancho - 2 * pared</span>.</p>
          </div>
          <div className="mt-auto flex items-center gap-1.5 text-[11px] text-faint"><Lock size={11} /> Los puntos cuadrados están fijos.</div>
        </aside>
      </div>
    </div>
  );
}

function ValueInput({ value, error, onCommit }: { value: string; error?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft.trim() && draft !== value && onCommit(draft.trim());
  return (
    <input
      aria-label="Valor de la cota"
      title={error}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      className={cx("h-6 w-24 rounded border bg-surface-2 px-1.5 text-right font-mono text-[11.5px] text-fg outline-none", error ? "border-err/60" : "border-line focus:border-line-strong")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** Marca de una restricción sobre el dibujo: cotas con su valor y letras para las geométricas. */
function ConstraintMark({ c, sketch, toScreen, selected, onSelect }: { c: Constraint; sketch: Sketch; toScreen: (v: Vec) => Vec; selected: boolean; onSelect: () => void }) {
  const pts = new Map(sketch.points.map((p) => [p.id, p]));
  const ents = new Map(sketch.entities.map((e) => [e.id, e]));
  const mid = (e?: SketchEntity): Vec | null => {
    if (!e) return null;
    if (e.kind === "line") return [(pts.get(e.a)!.x + pts.get(e.b)!.x) / 2, (pts.get(e.a)!.y + pts.get(e.b)!.y) / 2];
    const c0 = pts.get(e.c)!;
    const r = e.kind === "circle" ? e.r : Math.hypot(pts.get(e.a)!.x - c0.x, pts.get(e.a)!.y - c0.y);
    return [c0.x + r * Math.SQRT1_2, c0.y + r * Math.SQRT1_2];
  };
  let at: Vec | null = null, text = "";
  const color = selected ? "var(--accent-text)" : "#f59e0b";
  if ("value" in c) {
    if (c.kind === "radius" || c.kind === "diameter") at = mid(ents.get(c.entity));
    else if (c.kind === "angle") at = mid(ents.get(c.a));
    else if ("a" in c && pts.get(c.a) && pts.get(c.b)) at = [(pts.get(c.a)!.x + pts.get(c.b)!.x) / 2, (pts.get(c.a)!.y + pts.get(c.b)!.y) / 2];
    text = `${c.kind === "diameter" ? "Ø" : c.kind === "radius" ? "R" : c.kind === "hdistance" ? "↔ " : c.kind === "vdistance" ? "↕ " : ""}${c.value}${c.kind === "angle" ? "°" : ""}`;
  } else if (c.kind === "horizontal" || c.kind === "vertical") {
    at = mid(ents.get(c.line));
    text = c.kind === "horizontal" ? "H" : "V";
  } else if (c.kind === "tangent") {
    at = mid(ents.get(c.line));
    text = "T";
  } else if (c.kind === "parallel" || c.kind === "perpendicular" || c.kind === "equal") {
    at = mid(ents.get(c.a));
    text = c.kind === "parallel" ? "∥" : c.kind === "perpendicular" ? "⊥" : "=";
  }
  if (!at) return null;
  const [x, y] = toScreen(at);
  const w = Math.max(14, text.length * 6.6 + 8);
  const dy = "value" in c ? -12 : 10;
  return (
    <g onPointerDown={(e) => (e.stopPropagation(), onSelect())} className="cursor-pointer">
      <rect x={x - w / 2} y={y + dy - 8} width={w} height={16} rx={4} fill="var(--surface)" stroke={color} strokeWidth={1} />
      <text x={x} y={y + dy + 4} textAnchor="middle" fontSize={10.5} fontFamily="var(--font-mono, monospace)" fill={color}>{text}</text>
    </g>
  );
}

function Grid({ view, size, step }: { view: View; size: { w: number; h: number }; step: number }) {
  const lines: React.ReactNode[] = [];
  const x0 = Math.floor((view.cx - size.w / 2 / view.scale) / step) * step;
  const y0 = Math.floor((view.cy - size.h / 2 / view.scale) / step) * step;
  for (let x = x0; (x - view.cx) * view.scale < size.w / 2; x += step) {
    const sx = (x - view.cx) * view.scale + size.w / 2;
    lines.push(<line key={"x" + x} x1={sx} y1={0} x2={sx} y2={size.h} stroke="var(--grid)" strokeOpacity={Math.round(x / step) % 5 === 0 ? 1 : 0.45} />);
  }
  for (let y = y0; (y - view.cy) * view.scale < size.h / 2; y += step) {
    const sy = (view.cy - y) * view.scale + size.h / 2;
    lines.push(<line key={"y" + y} x1={0} y1={sy} x2={size.w} y2={sy} stroke="var(--grid)" strokeOpacity={Math.round(y / step) % 5 === 0 ? 1 : 0.45} />);
  }
  return <g>{lines}</g>;
}

/** Paso de cuadrícula legible para el zoom actual (1, 2, 5, 10… mm). */
function gridStep(scale: number) {
  const target = 14 / scale;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  return [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= target) ?? 10 * pow;
}

function fitView(sketch: Sketch, w: number, h: number): View {
  if (!sketch.points.length) return { cx: 0, cy: 0, scale: 4 };
  const xs = sketch.points.map((p) => p.x), ys = sketch.points.map((p) => p.y);
  for (const e of sketch.entities) if (e.kind === "circle") {
    const c = sketch.points.find((p) => p.id === e.c)!;
    xs.push(c.x - e.r, c.x + e.r);
    ys.push(c.y - e.r, c.y + e.r);
  }
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(40, (0.6 * Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY))));
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };
}

function entityDistance(e: SketchEntity, [x, y]: Vec, pts: Map<string, SketchPoint>): number {
  if (e.kind === "line") {
    const a = pts.get(e.a)!, b = pts.get(e.b)!;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
  }
  const c = pts.get(e.c)!;
  if (e.kind === "circle") return Math.abs(Math.hypot(x - c.x, y - c.y) - e.r);
  const a = pts.get(e.a)!, b = pts.get(e.b)!;
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const ang = (v: number) => (v < 0 ? v + 2 * Math.PI : v);
  const [t, t0, t1] = [Math.atan2(y - c.y, x - c.x), Math.atan2(a.y - c.y, a.x - c.x), Math.atan2(b.y - c.y, b.x - c.x)].map(ang);
  const within = t1 > t0 ? t >= t0 && t <= t1 : t >= t0 || t <= t1;
  return within ? Math.abs(Math.hypot(x - c.x, y - c.y) - r) : Math.min(Math.hypot(x - a.x, y - a.y), Math.hypot(x - b.x, y - b.y));
}

const fmtValue = (v: number) => String(+v.toFixed(2));

/** Quita los puntos sueltos que dejó una herramienta sin terminar. */
function prune(sketch: Sketch): Sketch {
  const used = new Set(sketch.entities.flatMap((e) => (e.kind === "circle" ? [e.c] : e.kind === "arc" ? [e.c, e.a, e.b] : [e.a, e.b])));
  for (const c of sketch.constraints) if (c.kind === "coincident" || c.kind === "distance" || c.kind === "hdistance" || c.kind === "vdistance") used.add(c.a), used.add(c.b);
  const points = sketch.points.filter((p) => used.has(p.id));
  return points.length === sketch.points.length ? sketch : { ...sketch, points };
}
