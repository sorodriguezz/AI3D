import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, Box, FileUp, Loader2, Check, Circle, Cone, Cpu, Cylinder, Eye, EyeOff, Hammer, Hexagon, ImagePlus, Link2, ListTree, MapPin, Package, Plus, Ruler, Shapes, Sparkles, Triangle, Wand2, X,
} from "lucide-react";
import { readFileAsDataUrl } from "../ai/image";
import { PROVIDERS } from "../ai/llm";
import { ACCEPT_ATTR } from "../cad/importers";
import { PRIMITIVES, TEMPLATES } from "../cad/templates";
import { isMac } from "../lib/platform";
import { pendingMeasurements, useStore, type LeftTab } from "../store";
import { Button, Kbd, Pill, SectionTitle, cx } from "./ui";

export const SHAPE_ICONS: Record<string, typeof Box> = {
  box: Box,
  cylinder: Cylinder,
  tube: Circle,
  sphere: Circle,
  cone: Cone,
  wedge: Triangle,
  prism: Hexagon,
  torus: Circle,
  "marker-holder": Wand2,
  "wall-hook": Link2,
  "pipe-clip": Hammer,
  imported: FileUp,
  "l-bracket": Ruler,
  organizer: Package,
};
export const iconFor = (type: string) => SHAPE_ICONS[type] ?? Package;

// ---------------------------------------------------------------- Insertar

export function ImportButton({ className }: { className?: string }) {
  const importFiles = useStore((s) => s.importFiles);
  const importing = useStore((s) => s.importing);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => (void importFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
      <button
        onClick={() => ref.current?.click()}
        disabled={importing}
        className={cx("flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong p-3 text-left transition-colors hover:border-muted hover:bg-surface-2 disabled:opacity-60 cursor-pointer", className)}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg">{importing ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}</div>
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-fg">{importing ? "Importando…" : "Importar modelo"}</div>
          <div className="text-[11px] text-muted">STL, 3MF, OBJ, AMF, STEP o SVG · o arrástralo al visor</div>
        </div>
      </button>
    </>
  );
}

function ImportErrors() {
  const error = useStore((s) => s.importError);
  if (!error) return null;
  return (
    <div className="mx-4 mt-2 space-y-1 rounded-lg bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
      {error.split("\n").map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

function InsertTab() {
  const addPart = useStore((s) => s.addPart);
  const tile = "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-2/40 py-3 text-[11.5px] text-muted transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg cursor-pointer";
  return (
    <>
      <div className="px-4 pt-4">
        <ImportButton />
      </div>
      <ImportErrors />
      <SectionTitle>Formas básicas</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 px-4">
        {PRIMITIVES.map((t) => {
          const Icon = iconFor(t.id);
          return (
            <button key={t.id} className={tile} onClick={() => addPart(t.id)} title={t.description}>
              <Icon size={20} strokeWidth={1.5} />
              {t.name}
            </button>
          );
        })}
      </div>
      <SectionTitle>Componentes paramétricos</SectionTitle>
      <div className="space-y-1.5 px-4 pb-5">
        {TEMPLATES.map((t) => {
          const Icon = iconFor(t.id);
          return (
            <button key={t.id} onClick={() => addPart(t.id)} className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-surface-2/40 p-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2 cursor-pointer">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg">
                <Icon size={15} />
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-fg">{t.name}</div>
                <div className="line-clamp-2 text-[11.5px] text-muted">{t.description}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="px-4 pb-5 text-[11.5px] text-faint">
        Consejo: cualquier pieza puede ser <span className="text-err">agujero</span> (tecla H) para restar material de las demás.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Escena

function SceneTab() {
  const parts = useStore((s) => s.doc?.parts ?? []);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const updatePart = useStore((s) => s.updatePart);
  const setTab = useStore((s) => s.setLeftTab);

  if (parts.length === 0)
    return (
      <div className="px-4 py-8 text-center">
        <ListTree size={26} strokeWidth={1.3} className="mx-auto text-faint" />
        <div className="mt-2 text-[12.5px] text-muted">Aún no hay piezas.</div>
        <div className="mt-3 flex justify-center gap-2">
          <Button size="sm" onClick={() => setTab("insert")}>
            <Plus size={13} /> Insertar
          </Button>
          <Button size="sm" variant="primary" onClick={() => setTab("ai")}>
            <Sparkles size={13} /> Con IA
          </Button>
        </div>
      </div>
    );

  return (
    <>
      <SectionTitle aside={<span className="text-[11px] text-faint">{parts.length}</span>}>Piezas</SectionTitle>
      <div className="space-y-0.5 px-2 pb-5">
        {parts.map((p) => {
          const Icon = iconFor(p.type);
          const active = p.id === selectedId;
          return (
            <div
              key={p.id}
              onClick={() => select(p.id)}
              className={cx("group flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[12.5px] transition-colors", active ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg", p.hidden && "opacity-50")}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.mode === "hole" ? "transparent" : p.color, border: p.mode === "hole" ? "1.5px dashed var(--err)" : "none" }} />
              <Icon size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.mode === "hole" && <Pill tone="err">Agujero</Pill>}
              {(p.estimated?.length ?? 0) > 0 && <span className="size-1.5 rounded-full bg-warn" title="Medidas por confirmar" />}
              <button
                aria-label={p.hidden ? "Mostrar" : "Ocultar"}
                onClick={(e) => {
                  e.stopPropagation();
                  updatePart(p.id, { hidden: !p.hidden });
                }}
                className={cx("text-faint hover:text-fg cursor-pointer", !p.hidden && "opacity-0 group-hover:opacity-100")}
              >
                {p.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- IA

function PhotoInput() {
  const photo = useStore((s) => s.photo);
  const mark = useStore((s) => s.mark);
  const setPhoto = useStore((s) => s.setPhoto);
  const setMark = useStore((s) => s.setMark);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const accept = async (file?: File | null) => {
    if (file && file.type.startsWith("image/")) setPhoto(await readFileAsDataUrl(file));
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) void accept(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  const input = <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => accept(e.target.files?.[0])} />;

  if (!photo)
    return (
      <div className="px-4">
        {input}
        <button
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void accept(e.dataTransfer.files[0]);
          }}
          className={cx("flex h-24 w-full items-center justify-center gap-3 rounded-xl border border-dashed transition-colors cursor-pointer", drag ? "border-accent bg-accent-soft" : "border-line-strong hover:border-muted hover:bg-surface-2")}
        >
          <ImagePlus size={18} className="text-muted" />
          <div className="text-left">
            <div className="text-[12.5px] text-fg">Foto de referencia (opcional)</div>
            <div className="text-[11px] text-faint">Arrastra, pega o haz clic</div>
          </div>
        </button>
      </div>
    );

  return (
    <div className="px-4">
      {input}
      <div className="relative overflow-hidden rounded-xl border border-line bg-black">
        <img
          src={photo}
          alt="Foto de referencia"
          draggable={false}
          className="block max-h-52 w-full object-contain cursor-crosshair"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMark({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
          }}
        />
        {mark && (
          <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-accent drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}>
            <MapPin size={24} fill="currentColor" stroke="#0b0c0e" strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute right-2 bottom-2 flex gap-1">
          <button onClick={() => fileRef.current?.click()} className="h-7 rounded-md bg-black/60 px-2 text-[11.5px] text-white backdrop-blur hover:bg-black/80 cursor-pointer">
            Cambiar
          </button>
          <button onClick={() => setPhoto(null)} aria-label="Quitar foto" className="flex size-7 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur hover:bg-black/80 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
        <MapPin size={11} /> {mark ? "Ubicación marcada." : "Toca la foto para marcar dónde va la pieza."}
      </div>
    </div>
  );
}

function PromptBox() {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const analyze = useStore((s) => s.analyze);
  const analyzing = useStore((s) => s.analyzing);
  const cancel = useStore((s) => s.cancelAnalyze);
  const status = useStore((s) => s.aiStatus);
  const provider = useStore((s) => s.settings.provider);
  const hasParts = useStore((s) => (s.doc?.parts.length ?? 0) > 0);
  const openSettings = useStore((s) => s.setSettingsOpen);
  const info = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <div className="px-4">
      <div className="rounded-xl border border-line bg-surface-2/60 focus-within:border-line-strong transition-colors">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void analyze();
            }
          }}
          rows={4}
          placeholder={hasParts ? "Pide un cambio: «hazla 10 mm más alta», «agrega dos agujeros para tornillos M4», «redondea los bordes»…" : "Describe la pieza: «un soporte de pared para mi taladro», «una caja con tapa para tarjetas SD»…"}
          className="block w-full resize-none bg-transparent px-3 pt-3 pb-1 text-[13px] text-fg placeholder:text-faint outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <button onClick={() => openSettings(true)} className="flex min-w-0 items-center gap-1.5 rounded-md px-1 text-[11px] text-faint hover:text-fg cursor-pointer" title="Cambiar modelo">
            <span className={cx("size-1.5 shrink-0 rounded-full", status === "online" ? "bg-ok" : status === "offline" ? "bg-warn" : "bg-muted pulse-dot")} />
            {provider === "local" ? <Cpu size={11} /> : null}
            <span className="truncate">{status === "online" ? info.name : `${info.name} no disponible`}</span>
          </button>
          {analyzing ? (
            <Button size="sm" onClick={cancel}>
              Cancelar
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void analyze()} disabled={!prompt.trim()}>
              <Sparkles size={13} /> {hasParts ? "Aplicar" : "Diseñar"} <Kbd>{isMac() ? "⌘↵" : "Ctrl↵"}</Kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentResults() {
  const agent = useStore((s) => s.agent);
  const analyzing = useStore((s) => s.analyzing);
  const error = useStore((s) => s.analyzeError);
  const active = useStore((s) => s.activeProposal);
  const apply = useStore((s) => s.applyProposal);
  const parts = useStore((s) => s.doc?.parts ?? []);
  const select = useStore((s) => s.select);
  const provider = useStore((s) => s.settings.provider);

  if (analyzing)
    return (
      <div className="mx-4 mt-4 overflow-hidden rounded-xl border border-line bg-surface-2/60">
        <div className="shimmer h-0.5" />
        <div className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-fg">
            <Sparkles size={14} className="text-accent-text pulse-dot" /> Diseñando…
          </div>
          <div className="text-[12px] text-faint">{provider === "local" ? "El primer análisis puede tardar mientras el modelo se carga." : "Usando tu suscripción por CLI; puede tardar entre 20 s y 2 min."}</div>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="mx-4 mt-4 rounded-xl border border-err/30 bg-err/8 p-3 text-[12.5px]">
        <div className="flex items-center gap-2 font-medium text-err">
          <AlertTriangle size={14} /> No se pudo completar
        </div>
        <div className="mt-1 break-words text-muted">{error}</div>
      </div>
    );
  if (!agent) return null;

  const pending = pendingMeasurements(parts);

  return (
    <div className="pb-5">
      {(agent.scene || agent.objective) && (
        <div className="mx-4 mt-3 space-y-1 rounded-xl bg-surface-2/60 p-3 text-[12px]">
          {agent.scene && (
            <p className="text-muted">
              <span className="text-faint">Escena · </span>
              {agent.scene}
            </p>
          )}
          {agent.objective && (
            <p className="text-fg">
              <span className="text-faint">Objetivo · </span>
              {agent.objective}
            </p>
          )}
        </div>
      )}
      {agent.proposals.length > 0 && (
        <>
          <SectionTitle aside={<Pill tone={agent.source === "model" ? "accent" : "neutral"}>{agent.source === "model" ? "IA" : "Reglas locales"}</Pill>}>Propuestas</SectionTitle>
          <div className="space-y-2 px-4">
            {agent.proposals.map((p, i) => {
              const sel = active === p.id;
              return (
                <button key={p.id} onClick={() => apply(p)} className={cx("block w-full rounded-xl border p-3 text-left transition-colors cursor-pointer", sel ? "border-accent/60 bg-accent-soft" : "border-line bg-surface-2/40 hover:border-line-strong hover:bg-surface-2")}>
                  <div className="flex items-start gap-2.5">
                    <span className={cx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold", sel ? "bg-accent text-accent-ink" : "bg-surface-3 text-muted")}>{sel ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-fg">{p.title}</div>
                      {p.mechanism && <div className="mt-0.5 text-[12px] text-muted">{p.mechanism}</div>}
                      <div className="mt-1 text-[11px] text-faint">{p.parts.length} pieza{p.parts.length === 1 ? "" : "s"}</div>
                      {sel && p.rationale && <div className="mt-2 text-[12px] text-muted">{p.rationale}</div>}
                      {sel && (p.pros.length > 0 || p.cons.length > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.pros.map((x) => (
                            <Pill key={"+" + x} tone="ok">+ {x}</Pill>
                          ))}
                          {p.cons.map((x) => (
                            <Pill key={"-" + x} tone="warn">− {x}</Pill>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
      {agent.questions.length > 0 && (
        <>
          <SectionTitle>Medidas que necesito</SectionTitle>
          <div className="space-y-0.5 px-4">
            {agent.questions.map((q) => {
              const part = parts.find((p) => p.name === q.part);
              const done = part ? !pending.some((x) => x.part.id === part.id && x.key === q.param) : false;
              return (
                <button key={q.part + q.param + q.question} onClick={() => part && select(part.id, q.param)} className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-2 cursor-pointer">
                  <span className={cx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", done ? "border-ok bg-ok text-bg" : "border-line-strong")}>{done && <Check size={10} strokeWidth={3} />}</span>
                  <span className={cx("flex-1 text-[12.5px]", done ? "text-faint line-through" : "text-fg")}>{q.question}</span>
                  {!done && part && <ArrowRight size={14} className="mt-0.5 text-faint group-hover:text-fg" />}
                </button>
              );
            })}
          </div>
        </>
      )}
      {agent.warnings.length > 0 && (
        <div className="mx-4 mt-3 space-y-1.5">
          {agent.warnings.map((w) => (
            <div key={w} className="flex gap-2 rounded-lg bg-warn/8 px-3 py-2 text-[12px] text-muted">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AiTab() {
  return (
    <>
      <SectionTitle>Describe o pide cambios</SectionTitle>
      <PromptBox />
      <div className="h-3" />
      <PhotoInput />
      <AgentResults />
    </>
  );
}

// ---------------------------------------------------------------- Panel

const TABS: { id: LeftTab; label: string; icon: typeof Box }[] = [
  { id: "insert", label: "Insertar", icon: Shapes },
  { id: "scene", label: "Escena", icon: ListTree },
  { id: "ai", label: "IA", icon: Sparkles },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  const count = useStore((s) => s.doc?.parts.length ?? 0);
  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex gap-1 border-b border-line p-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12.5px] transition-colors cursor-pointer", tab === t.id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg hover:bg-surface-2")}
          >
            <t.icon size={14} className={t.id === "ai" && tab === t.id ? "text-accent-text" : ""} />
            {t.label}
            {t.id === "scene" && count > 0 && <span className="text-[10.5px] text-faint">{count}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === "insert" && <InsertTab />}
        {tab === "scene" && <SceneTab />}
        {tab === "ai" && <AiTab />}
      </div>
    </aside>
  );
}
