import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Download, Eye, EyeOff, Info, Layers, Minus, PenTool, Plus, Printer, X, XCircle } from "lucide-react";
import { exportModel } from "../cad/client";
import { getTemplate } from "../cad/templates";
import { MAIN_BODY, type Check as CheckItem, type ExportFormat, type Feature, type NumberParam, type ParamDef, type Part } from "../cad/types";
import { bodiesOf, bodyColors, toScene } from "../studio/parts";
import { saveFile } from "../lib/platform";
import { pendingMeasurements, useStore } from "../store";
import { iconFor } from "./LeftPanel";
import { InlineEdit, Pill, SectionTitle, cx } from "./ui";
import { PartColorPicker } from "./PartColorPicker";
import { useSketchEditor } from "./SketchEditor";

// ---------------------------------------------------------------- Controles

function NumberField({ value, onChange, unit, step = 0.5, min, max, label }: { value: number; onChange: (v: number) => void; unit?: string; step?: number; min?: number; max?: number; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(",", "."));
    if (Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
    setDraft(null);
  };
  return (
    <label className="flex h-7 min-w-0 items-center rounded-md border border-line bg-surface-2 pr-1.5 focus-within:border-line-strong">
      <input
        type="number"
        aria-label={label}
        className="w-full min-w-0 bg-transparent pl-2 font-mono text-[12px] text-fg outline-none"
        value={draft ?? String(+value.toFixed(2))}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
      />
      {unit && <span className="text-[10.5px] text-faint">{unit}</span>}
    </label>
  );
}

function ParamControl({ part, def }: { part: Part; def: ParamDef }) {
  const setParam = useStore((s) => s.setPartParam);
  const value = part.params[def.key];
  const set = (v: Part["params"][string]) => setParam(part.id, def.key, v);

  if (def.type === "bool")
    return (
      <button role="switch" aria-checked={!!value} aria-label={def.label} onClick={() => set(!value)} className={cx("relative h-5 w-9 rounded-full transition-colors cursor-pointer", value ? "bg-accent" : "bg-surface-3")}>
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", value ? "left-[18px]" : "left-0.5")} />
      </button>
    );
  if (def.type === "enum")
    return (
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${def.options.length}, minmax(0, 1fr))` }}>
        {def.options.map((o) => (
          <button key={o.value} title={o.description} onClick={() => set(o.value)} className={cx("h-7 truncate rounded-md border px-1.5 text-[11.5px] transition-colors cursor-pointer", value === o.value ? "border-accent/60 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg")}>
            {o.label}
          </button>
        ))}
      </div>
    );
  const d = def as NumberParam;
  const v = Number(value);
  if (d.type === "int")
    return (
      <div className="flex h-7 w-fit items-center rounded-md border border-line bg-surface-2">
        <button aria-label="Menos" disabled={v <= d.min} onClick={() => set(v - 1)} className="flex size-7 items-center justify-center text-muted hover:text-fg disabled:opacity-30 cursor-pointer">
          <Minus size={13} />
        </button>
        <span className="w-8 text-center font-mono text-[12px]">{v}</span>
        <button aria-label="Más" disabled={v >= d.max} onClick={() => set(v + 1)} className="flex size-7 items-center justify-center text-muted hover:text-fg disabled:opacity-30 cursor-pointer">
          <Plus size={13} />
        </button>
      </div>
    );
  // El deslizador cubre un rango cómodo alrededor del valor; el campo numérico acepta todo el rango.
  const sliderMax = Math.min(d.max, Math.max(v * 2, d.default * 3, d.min + 20));
  const fill = Math.min(100, ((v - d.min) / (sliderMax - d.min)) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <input type="range" className="slider min-w-0 flex-1" min={d.min} max={sliderMax} step={d.step} value={Math.min(v, sliderMax)} style={{ ["--fill" as string]: `${fill}%` }} onChange={(e) => set(parseFloat(e.target.value))} aria-label={d.label} />
      <div className="w-[84px] shrink-0">
        <NumberField value={v} onChange={(x) => set(d.type === "number" ? x : Math.round(x))} unit={d.unit} step={d.step} min={d.min} max={d.max} label={d.label} />
      </div>
    </div>
  );
}

function ParamRow({ part, def }: { part: Part; def: ParamDef }) {
  const confirm = useStore((s) => s.confirmParam);
  const focusParam = useStore((s) => s.focusParam);
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const pending = part.estimated?.includes(def.key);
  const numeric = def.type === "number" || def.type === "int";
  const expr = part.exprs?.[def.key];
  const [editing, setEditing] = useState(false);
  const formula = numeric && (expr !== undefined || editing);

  useEffect(() => {
    if (focusParam !== def.key) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current?.querySelector<HTMLInputElement>("input[type=number]")?.focus({ preventScroll: true });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    useStore.setState({ focusParam: null });
    return () => clearTimeout(t);
  }, [focusParam, def.key]);

  return (
    <div ref={ref} className={cx("rounded-lg px-4 py-2 transition-colors", flash && "bg-accent-soft")}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] text-fg">
          {def.label}
          {numeric && (
            <button
              aria-label={`Fórmula para ${def.label}`}
              aria-pressed={formula}
              title={formula ? "Volver a un valor fijo" : "Definir con una fórmula (variables del diseño)"}
              onClick={() => (formula ? (useStore.getState().setPartExpr(part.id, def.key, null), setEditing(false)) : setEditing(true))}
              className={cx("rounded px-1 font-mono text-[10px] italic cursor-pointer", formula ? "bg-accent-soft text-accent-text" : "text-faint hover:text-fg")}
            >
              fx
            </button>
          )}
        </span>
        {pending ? (
          <button onClick={() => confirm(part.id, def.key)} className="cursor-pointer" title="Marcar como medida verificada">
            <Pill tone="warn" className="hover:brightness-125">Por medir · confirmar</Pill>
          </button>
        ) : def.critical ? (
          <Pill tone="ok">
            <Check size={10} strokeWidth={3} /> Medida
          </Pill>
        ) : null}
      </div>
      {formula ? <FormulaField part={part} def={def} onDone={() => setEditing(false)} /> : <ParamControl part={part} def={def} />}
      {def.hint && <p className="mt-1 text-[11px] text-faint">{def.hint}</p>}
    </div>
  );
}

/** Fórmula de una medida: se aplica al pulsar Intro o al salir del campo. */
function FormulaField({ part, def, onDone }: { part: Part; def: ParamDef; onDone: () => void }) {
  const setExpr = useStore((s) => s.setPartExpr);
  const stored = useStore((s) => s.paramErrors[part.id]?.[def.key]);
  const saved = part.exprs?.[def.key] ?? "";
  const [draft, setDraft] = useState(saved || String(part.params[def.key]));
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (draft.trim() === saved) return;
    const message = setExpr(part.id, def.key, draft);
    setError(message);
    if (!message && !draft.trim()) onDone();
  };
  const unit = "unit" in def ? def.unit : "";
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          aria-label={`Fórmula de ${def.label}`}
          autoFocus={!saved}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] text-fg outline-none focus:border-line-strong"
          value={draft}
          placeholder="ancho - 2 * pared"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        <span className="shrink-0 font-mono text-[11.5px] text-muted">= {+Number(part.params[def.key]).toFixed(3)}{unit ? ` ${unit}` : ""}</span>
      </div>
      {(error ?? stored) && <p role="alert" className="mt-1 text-[11px] text-err">{error ?? stored}</p>}
    </div>
  );
}

const AXES = ["X", "Y", "Z"] as const;
const AXIS_COLORS = ["text-[#f87171]", "text-[#4ade80]", "text-[#60a5fa]"];

function VecRow({ label, value, unit, onChange }: { label: string; value: [number, number, number]; unit: string; onChange: (v: [number, number, number]) => void }) {
  return (
    <div className="px-4 py-1.5">
      <div className="mb-1 text-[12px] text-fg">{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {AXES.map((a, i) => (
          <div key={a} className="flex items-center gap-1">
            <span className={cx("w-2.5 text-[10.5px] font-semibold", AXIS_COLORS[i])}>{a}</span>
            <NumberField
              label={`${label} ${a}`}
              value={value[i]}
              unit={unit}
              step={unit === "°" ? 15 : 1}
              onChange={(v) => {
                const next = [...value] as [number, number, number];
                next[i] = v;
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportedInfo({ part }: { part: Part }) {
  const asset = useStore((s) => s.doc?.assets?.[String(part.params.asset)]);
  if (!asset) return <div className="mx-4 mt-3 rounded-lg bg-err/10 px-3 py-2 text-[12px] text-err">Falta la geometría importada de esta pieza.</div>;
  return (
    <div className="mx-4 mt-3 rounded-xl bg-surface-2/70 px-3 py-2.5 text-[12px]">
      <div className="text-fg">
        {asset.name}.<span className="uppercase">{asset.format}</span>
      </div>
      <div className="mt-0.5 text-muted">
        {asset.format === "step" ? "Sólido CAD exacto" : asset.format === "svg" ? "Contornos 2D extruidos" : `Malla de ${asset.triangles?.toLocaleString("es") ?? "?"} triángulos · se exporta a 3MF o STL`}
      </div>
      <div className="mt-1.5 text-[11px] text-faint">Combínalo con otras piezas: agrega formas como agujero para recortarlo o como sólido para ampliarlo.</div>
    </div>
  );
}

function PartInspector({ part }: { part: Part }) {
  const update = useStore((s) => s.updatePart);
  const sketchErrors = useStore((s) => s.paramErrors[part.id]);
  const t = getTemplate(part.type);
  const Icon = iconFor(part.type);
  if (!t) return <div className="p-4 text-err">Forma desconocida: {part.type}</div>;
  const visible = t.params.filter((d) => !d.visibleIf || d.visibleIf(part.params));
  const groups = [...new Set(visible.map((d) => d.group ?? "Medidas"))];

  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3">
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <InlineEdit value={part.name} onCommit={(name) => update(part.id, { name })} className="w-full text-[14px] font-semibold" />
          <div className="px-1.5 text-[11px] text-faint">{t.name}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 px-4">
        {(["solid", "hole"] as const).map((m) => (
          <button
            key={m}
            onClick={() => update(part.id, { mode: m })}
            className={cx("h-8 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer", part.mode === m ? (m === "hole" ? "border-err/50 bg-err/12 text-err" : "border-accent/60 bg-accent-soft text-fg") : "border-line text-muted hover:text-fg")}
          >
            {m === "solid" ? "Sólido" : "Agujero"}
          </button>
        ))}
      </div>
      {part.mode === "solid" && <PartColorPicker part={part} />}
      <BodyControl part={part} />

      {part.type === "imported" && <ImportedInfo part={part} />}
      {part.type === "sketch" && (
        <div className="mx-4 mt-3">
          <button onClick={() => useSketchEditor.getState().open(part.id)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/50 bg-accent-soft text-[12.5px] font-medium text-fg hover:brightness-105 cursor-pointer">
            <PenTool size={13} /> Editar boceto
          </button>
          {Object.entries(sketchErrors ?? {}).filter(([k]) => k === "profile" || k.startsWith("cota")).map(([k, v]) => <p key={k} role="alert" className="mt-1 text-[11px] text-err">{v}</p>)}
        </div>
      )}
      <FeatureList part={part} />

      <SectionTitle>Transformación</SectionTitle>
      <VecRow label="Posición" unit="mm" value={part.position} onChange={(position) => update(part.id, { position })} />
      <VecRow label="Rotación" unit="°" value={part.rotation} onChange={(rotation) => update(part.id, { rotation })} />

      {groups.map((g) => (
        <div key={g}>
          <SectionTitle>{g}</SectionTitle>
          {visible
            .filter((d) => (d.group ?? "Medidas") === g)
            .map((d) => (
              <ParamRow key={d.key} part={part} def={d} />
            ))}
        </div>
      ))}
      {t.printHint && (
        <div className="mx-4 my-4 flex gap-2 rounded-xl bg-surface-2/60 p-3 text-[12px] text-muted">
          <Printer size={14} className="mt-0.5 shrink-0 text-faint" />
          {t.printHint}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Cuerpos y operaciones

const featureLabel = (f: Feature) =>
  f.kind === "shell" ? "Vaciado"
  : f.kind === "trim" ? "División por plano"
  : `${f.kind === "fillet" ? "Redondeo" : "Chaflán"} · ${f.edges.length} ${f.edges.length === 1 ? "arista" : "aristas"}`;

/** Cuerpo de una pieza sólida, o cuerpos que recorta un agujero. */
function BodyControl({ part }: { part: Part }) {
  const parts = useStore((s) => s.doc?.parts ?? []);
  const update = useStore((s) => s.updatePart);
  const bodies = bodiesOf(parts);
  const [draft, setDraft] = useState("");
  const field = "h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-[12px] text-fg outline-none";
  if (part.mode === "hole") {
    const all = !part.cutBodies;
    const toggle = (b: string) => {
      const current = part.cutBodies ?? bodies;
      const next = current.includes(b) ? current.filter((x) => x !== b) : [...current, b];
      update(part.id, { cutBodies: next.length === bodies.length && bodies.every((x) => next.includes(x)) ? undefined : next });
    };
    return (
      <div className="mx-4 mt-3 space-y-1.5 text-[11.5px] text-muted">
        <div className="flex items-center gap-1.5"><Layers size={12} /> Recorta a</div>
        <div className="flex flex-wrap gap-1">
          {bodies.map((b) => {
            const on = all || part.cutBodies!.includes(b);
            return <button key={b} aria-pressed={on} onClick={() => toggle(b)} className={cx("rounded-md border px-2 py-0.5 cursor-pointer", on ? "border-err/40 bg-err/10 text-err" : "border-line text-faint")}>{b}</button>;
          })}
        </div>
      </div>
    );
  }
  const current = part.body || MAIN_BODY;
  return (
    <div className="mx-4 mt-3 flex items-center gap-1.5 text-[11.5px] text-muted">
      <Layers size={12} className="shrink-0" />
      <select aria-label="Cuerpo" className={field} value={current} onChange={(e) => (e.target.value === "__new" ? setDraft(" ") : update(part.id, { body: e.target.value === MAIN_BODY ? undefined : e.target.value }))}>
        {[...new Set([current, ...bodies])].map((b) => <option key={b} value={b}>{b}</option>)}
        <option value="__new">Nuevo cuerpo…</option>
      </select>
      {draft && (
        <input autoFocus aria-label="Nombre del cuerpo nuevo" className={field} placeholder="Nombre" value={draft.trim()} onChange={(e) => setDraft(e.target.value || " ")}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { update(part.id, { body: draft.trim() }); setDraft(""); } else if (e.key === "Escape") setDraft(""); }}
          onBlur={() => { if (draft.trim()) update(part.id, { body: draft.trim() }); setDraft(""); }} />
      )}
    </div>
  );
}

/** Historial de operaciones de la pieza: se puede cambiar cada valor, suprimir o quitar una operación. */
function FeatureList({ part }: { part: Part }) {
  const update = useStore((s) => s.updatePart);
  if (!part.features?.length) return null;
  const features = part.features;
  const change = (i: number, patch: Partial<Feature>) => update(part.id, { features: features.map((f, j) => (j === i ? ({ ...f, ...patch } as Feature) : f)) });
  const num = "h-6 w-16 rounded border border-line bg-surface-2 px-1.5 text-right font-mono text-[11.5px] text-fg outline-none focus:border-line-strong";
  return (
    <>
      <SectionTitle>Operaciones</SectionTitle>
      <div className="space-y-0.5 px-2">
        {features.map((f, i) => (
          <div key={i} className={cx("group rounded-lg px-2 py-1 text-[12px] text-fg hover:bg-surface-2", f.suppressed && "opacity-50")}>
            <div className="flex items-center justify-between gap-2">
              <span className={cx("min-w-0 truncate", f.suppressed && "line-through")}>{i + 1}. {featureLabel(f)}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button aria-label={f.suppressed ? "Activar operación" : "Suprimir operación"} title={f.suppressed ? "Activar" : "Suprimir sin borrarla"} onClick={() => change(i, { suppressed: !f.suppressed || undefined })} className="text-faint hover:text-fg cursor-pointer">{f.suppressed ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                <button aria-label={`Quitar ${featureLabel(f)}`} onClick={() => update(part.id, { features: features.filter((_, j) => j !== i) })} className="text-faint hover:text-err cursor-pointer"><X size={12} /></button>
              </span>
            </div>
            {f.kind !== "trim" && !f.suppressed && (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                <span>{f.kind === "shell" ? "Espesor" : f.kind === "fillet" ? "Radio" : "Distancia"}</span>
                <FeatureNumber value={f.kind === "shell" ? f.thickness : f.size} className={num} onCommit={(v) => change(i, f.kind === "shell" ? { thickness: v } : { size: v })} />
                <span>mm</span>
                {f.kind === "shell" && (
                  <select aria-label="Cara abierta" value={f.open} onChange={(e) => change(i, { open: e.target.value as "top" | "bottom" })} className="h-6 rounded border border-line bg-surface-2 px-1 text-[11px] text-fg">
                    <option value="top">abierta arriba</option>
                    <option value="bottom">abierta abajo</option>
                  </select>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="px-4 pt-1 text-[10.5px] text-faint">Al cambiar un valor se recalculan las operaciones siguientes. Si alguna deja de encajar, el resultado muestra el error y puedes suprimirla.</p>
    </>
  );
}

function FeatureNumber({ value, className, onCommit }: { value: number; className: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(draft.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return <input aria-label="Valor de la operación" className={className} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

// ---------------------------------------------------------------- Diseño

const CHECK_ICON = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle };
const CHECK_TONE = { ok: "text-ok", warn: "text-warn", error: "text-err" };

function designChecks(parts: Part[], result: ReturnType<typeof useStore.getState>["result"], buildVolume: number): CheckItem[] {
  const out: CheckItem[] = [];
  const visible = parts.filter((p) => !p.hidden);
  if (visible.length === 0) return [{ level: "error", title: "La escena está vacía" }];
  if (!visible.some((p) => p.mode === "solid")) out.push({ level: "error", title: "Solo hay agujeros", detail: "Agrega al menos una pieza sólida." });
  if (result) {
    const dims = result.bbox.max.map((v, i) => v - result.bbox.min[i]);
    out.push(dims.some((d) => d > buildVolume) ? { level: "error", title: "No cabe en la impresora", detail: `Supera ${buildVolume} mm.` } : { level: "ok", title: `Cabe en ${buildVolume} mm³` });
    if (result.bbox.min[2] < -0.01) out.push({ level: "warn", title: "Hay geometría bajo la cama", detail: "Usa «Apoyar en la cama» (B) o sube las piezas." });
    if (result.bbox.min[2] > 0.5) out.push({ level: "warn", title: "La pieza flota sobre la cama", detail: "Necesitará soportes; bájala a Z = 0." });
  }
  for (const p of visible) {
    const t = getTemplate(p.type);
    if (!t || p.mode === "hole") continue;
    for (const c of t.checks(p.params)) if (c.level !== "ok") out.push({ ...c, title: `${p.name}: ${c.title}` });
  }
  return out;
}

const FORMATS: { id: ExportFormat; label: string; desc: string }[] = [
  { id: "3mf", label: "3MF", desc: "Bambu Studio" },
  { id: "stl", label: "STL", desc: "Cualquier slicer" },
  { id: "step", label: "STEP", desc: "CAD editable" },
];

function DesignInspector() {
  const doc = useStore((s) => s.doc)!;
  const result = useStore((s) => s.result);
  const building = useStore((s) => s.building);
  const buildVolume = useStore((s) => s.settings.buildVolume);
  const select = useStore((s) => s.select);
  const renameDoc = useStore((s) => s.renameDoc);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [body, setBody] = useState("");
  const bodies = result?.bodies?.map((b) => b.name) ?? [];
  const chosen = bodies.includes(body) ? body : "";
  const exactChoice = chosen ? result?.bodies?.find((b) => b.name === chosen)?.exact : result?.exact;
  const checks = designChecks(doc.parts, result, buildVolume).sort((a, b) => ({ error: 0, warn: 1, ok: 2 })[a.level] - ({ error: 0, warn: 1, ok: 2 })[b.level]);
  const pending = pendingMeasurements(doc.parts);

  const doExport = async (f: ExportFormat) => {
    setBusy(f);
    setMessage(null);
    try {
      const name = chosen ? `${doc.name} - ${chosen}` : doc.name;
      const data = await exportModel(f, name, { parts: toScene(doc.parts), body: chosen || undefined, colors: bodyColors(doc.parts) });
      const path = await saveFile(data, `${name}.${f}`, f.toUpperCase(), f);
      if (path) setMessage({ tone: "ok", text: `Exportado: ${path}` });
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="px-3 pt-3">
        <InlineEdit value={doc.name} onCommit={(n) => void renameDoc(n)} className="w-full text-[15px] font-semibold" />
        <div className="mt-1 flex items-center gap-1.5 px-1.5 text-[11.5px] text-faint">
          <Info size={12} /> Selecciona una pieza para editarla.
        </div>
      </div>

      <SectionTitle>Validación</SectionTitle>
      <div className="space-y-0.5 px-2">
        {checks.map((c) => {
          const Icon = CHECK_ICON[c.level];
          return (
            <div key={c.title} className="flex gap-2.5 rounded-lg px-2 py-1.5">
              <Icon size={14} className={cx("mt-0.5 shrink-0", CHECK_TONE[c.level])} />
              <div className="min-w-0">
                <div className="text-[12.5px] text-fg">{c.title}</div>
                {c.detail && <div className="text-[11.5px] text-muted">{c.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-warn/30 bg-warn/8 p-3 text-[12px]">
          <div className="flex items-center gap-1.5 font-medium text-warn">
            <AlertTriangle size={13} /> {pending.length === 1 ? "1 medida por confirmar" : `${pending.length} medidas por confirmar`}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {pending.map((m) => (
              <button key={m.part.id + m.key} onClick={() => select(m.part.id, m.key)} className="rounded-md bg-surface-3 px-2 py-0.5 text-[11.5px] text-fg hover:bg-line-strong cursor-pointer">
                {m.part.name} · {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <SectionTitle>Exportar</SectionTitle>
      <div className="space-y-2 px-4 pb-5">
        {bodies.length > 1 && (
          <select aria-label="Cuerpo a exportar" value={chosen} onChange={(e) => setBody(e.target.value)} className="h-8 w-full rounded-md border border-line bg-surface-2 px-2 text-[12px] text-fg outline-none">
            <option value="">Todos los cuerpos ({bodies.length})</option>
            {bodies.map((b) => <option key={b} value={b}>Solo {b}</option>)}
          </select>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              disabled={!result || building || busy !== null || (f.id === "step" && !exactChoice)}
              title={f.id === "step" && result && !exactChoice ? "No disponible: contiene un modelo de malla importado." : undefined}
              onClick={() => doExport(f.id)}
              className={cx("flex flex-col items-center gap-0.5 rounded-xl border py-2.5 transition-colors disabled:opacity-40 cursor-pointer", f.id === "3mf" ? "border-accent/50 bg-accent text-accent-ink hover:brightness-95" : "border-line bg-surface-2 text-fg hover:bg-surface-3")}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Download size={13} className={busy === f.id ? "animate-bounce" : ""} /> {f.label}
              </span>
              <span className={cx("text-[10.5px]", f.id === "3mf" ? "text-accent-ink/70" : "text-faint")}>{f.desc}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">Cada cuerpo se combina por separado (sólidos unidos menos sus agujeros) y en 3MF se guarda como un objeto con su color. Las piezas ocultas no se incluyen.</p>
        {message && <div className={cx("break-all rounded-lg px-3 py-2 text-[11.5px]", message.tone === "ok" ? "bg-ok/10 text-ok" : "bg-err/10 text-err")}>{message.text}</div>}
      </div>
    </>
  );
}

export function Inspector() {
  const part = useStore((s) => s.doc?.parts.find((p) => p.id === s.selectedId) ?? null);
  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{part ? <PartInspector key={part.id} part={part} /> : <DesignInspector />}</div>
    </aside>
  );
}
