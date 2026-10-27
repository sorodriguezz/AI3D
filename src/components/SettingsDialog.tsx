import { useEffect, useState } from "react";
import { Check, Copy, Cpu, RefreshCw, Terminal, X } from "lucide-react";
import { CLI_MODELS, PROVIDERS, type CliId, type ProviderId } from "../ai/llm";
import { VISION_MODELS, accelerationLabel, recommendModel } from "../ai/models";
import { getSystemInfo, isTauri, type SystemInfo } from "../lib/platform";
import { useStore } from "../store";
import { VersionSection } from "./UpdateNotice";
import { Button, IconButton, Pill, cx } from "./ui";

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg select-text">{text}</code>
      <button
        className="text-faint hover:text-fg cursor-pointer"
        aria-label="Copiar"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <span className="text-[11px] text-ok">Copiado</span> : <Copy size={13} />}
      </button>
    </div>
  );
}

const CUSTOM = "__custom__";

/** Selector de modelo con opción «Otro…» para escribir un identificador a mano. */
function ModelSelect({ id, value, onChange }: { id: CliId; value: string; onChange: (v: string) => void }) {
  const options = CLI_MODELS[id];
  const known = options.some((o) => o.value === value);
  const [custom, setCustom] = useState(!known);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[12px] text-muted">Modelo</span>
        <select
          value={custom ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setCustom(true);
            else {
              setCustom(false);
              onChange(e.target.value);
            }
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none focus:border-line-strong cursor-pointer"
        >
          {groups.map((g) =>
            g ? (
              <optgroup key={g} label={g}>
                {options.filter((o) => o.group === g).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ) : (
              options.filter((o) => !o.group).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            ),
          )}
          <option value={CUSTOM}>Otro (escribir identificador)…</option>
        </select>
      </div>
      {custom && (
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Identificador del modelo, p. ej. gpt-5 o gemini-2.5-pro"
          className="ml-16 h-8 w-[calc(100%-4rem)] rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-[12px] outline-none focus:border-line-strong"
          spellCheck={false}
        />
      )}
    </div>
  );
}

function SubscriptionSection() {
  const settings = useStore((s) => s.settings);
  const setProvider = useStore((s) => s.setProvider);
  const setCliModel = useStore((s) => s.setCliModel);
  const clis = useStore((s) => s.clis);
  const check = useStore((s) => s.checkAi);
  const status = useStore((s) => s.aiStatus);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-medium">Tu suscripción</div>
          <div className="text-[12px] text-muted">AI3D usa el CLI oficial con la sesión que ya iniciaste. No pide claves ni contraseñas.</div>
        </div>
        <Button size="sm" onClick={() => void check()}>
          <RefreshCw size={12} className={status === "checking" ? "animate-spin" : ""} /> Detectar
        </Button>
      </div>
      {!isTauri() && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">Las suscripciones por CLI solo funcionan en la app de escritorio.</div>}
      {PROVIDERS.filter((p) => p.id !== "local").map((p) => {
        const id = p.id as CliId;
        const info = clis.find((c) => c.id === id);
        const selected = settings.provider === id;
        return (
          <div key={id} className={cx("rounded-xl border p-3 transition-colors", selected ? "border-accent/50 bg-accent-soft" : "border-line")}>
            <button onClick={() => setProvider(id)} className="flex w-full items-center gap-3 text-left cursor-pointer">
              <span className={cx("flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong")}>{selected && <Check size={10} strokeWidth={3} />}</span>
              <Terminal size={15} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {info?.installed ? <Pill tone="ok">Instalado{info.version ? ` · ${info.version.replace(/\(.*\)/, "").trim()}` : ""}</Pill> : <Pill tone="warn">No instalado</Pill>}
                </div>
                <div className="text-[12px] text-muted">{p.plan}</div>
              </div>
            </button>
            {selected && (
              <div className="mt-3 space-y-2 pl-7">
                <ModelSelect id={id} value={settings.cliModel[id]} onChange={(m) => setCliModel(id, m)} />
                {!info?.installed && (
                  <>
                    <div className="text-[11.5px] text-muted">Instálalo en una terminal:</div>
                    <CopyLine text={p.install} />
                  </>
                )}
                <div className="text-[11.5px] text-muted">Si nunca iniciaste sesión, ejecuta una vez en una terminal y sigue los pasos:</div>
                <CopyLine text={p.login} />
                <div className="text-[11px] text-faint">La foto y tu petición se envían al servicio de tu suscripción. El CLI corre sin poder ejecutar comandos ni modificar archivos.</div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function LocalSection() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const status = useStore((s) => s.aiStatus);
  const models = useStore((s) => s.localModels);
  const [url, setUrl] = useState(settings.baseUrl);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [runtime, setRuntime] = useState<"llama" | "ollama">("llama");
  const selected = settings.provider === "local";
  useEffect(() => void getSystemInfo().then(setInfo), []);
  const rec = info ? recommendModel(info) : null;

  return (
    <section className={cx("rounded-xl border p-3", selected ? "border-accent/50 bg-accent-soft" : "border-line")}>
      <button onClick={() => setSettings({ provider: "local" as ProviderId })} className="flex w-full items-center gap-3 text-left cursor-pointer">
        <span className={cx("flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong")}>{selected && <Check size={10} strokeWidth={3} />}</span>
        <Cpu size={15} className="shrink-0 text-muted" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Modelo local</span>
            {selected && status === "online" && <Pill tone="ok">Conectado</Pill>}
            {selected && status === "offline" && <Pill tone="warn">No responde</Pill>}
          </div>
          <div className="text-[12px] text-muted">100 % sin conexión: llama.cpp, Ollama o LM Studio.</div>
        </div>
      </button>
      {selected && (
        <div className="mt-3 space-y-3 pl-7">
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setSettings({ baseUrl: url })} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-[12px] outline-none focus:border-line-strong" spellCheck={false} />
            <Button size="sm" onClick={() => setSettings({ baseUrl: url })}>
              Probar
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ["llama.cpp", "http://127.0.0.1:8080"],
              ["Ollama", "http://127.0.0.1:11434"],
              ["LM Studio", "http://127.0.0.1:1234"],
            ].map(([name, u]) => (
              <button key={u} onClick={() => (setUrl(u), setSettings({ baseUrl: u }))} className={cx("rounded-md border px-2 py-1 text-[11.5px] cursor-pointer", settings.baseUrl === u ? "border-line-strong bg-surface-3 text-fg" : "border-line text-muted hover:text-fg")}>
                {name}
              </button>
            ))}
          </div>
          {models.length > 0 && (
            <select value={settings.localModel} onChange={(e) => setSettings({ localModel: e.target.value })} className="h-8 w-full rounded-lg border border-line bg-surface-2 px-2 font-mono text-[12px] outline-none">
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          )}
          {info && rec && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11.5px] text-muted">
                <span>
                  {info.os} · {info.arch} · {info.totalMemoryGb.toFixed(0)} GB · {accelerationLabel(info)}
                </span>
                <div className="flex rounded-md border border-line p-0.5">
                  {(["llama", "ollama"] as const).map((r) => (
                    <button key={r} onClick={() => setRuntime(r)} className={cx("h-5 rounded px-1.5 text-[11px] cursor-pointer", runtime === r ? "bg-surface-3 text-fg" : "text-muted")}>
                      {r === "llama" ? "llama.cpp" : "Ollama"}
                    </button>
                  ))}
                </div>
              </div>
              {VISION_MODELS.map((m) => (
                <div key={m.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-faint">{m.size}</span>
                    {m.id === rec.id && <Pill tone="accent">Recomendado</Pill>}
                  </div>
                  <CopyLine text={runtime === "llama" ? m.llamaCpp : m.ollama} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal aria-label="Ajustes" className="flex max-h-full w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold tracking-tight">Ajustes</div>
          <IconButton label="Cerrar" onClick={() => setOpen(false)}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 scroll-thin">
          <SubscriptionSection />
          <div>
            <div className="mb-2 text-[13px] font-medium">O sin conexión</div>
            <LocalSection />
          </div>
          <section className="space-y-2">
            <div className="text-[13px] font-medium">Impresora</div>
            <div className="flex items-center gap-3">
              <span className="text-[12.5px] text-muted">Volumen de impresión</span>
              <select value={settings.buildVolume} onChange={(e) => setSettings({ buildVolume: Number(e.target.value) })} className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none">
                <option value={180}>180 mm · Bambu A1 mini</option>
                <option value={220}>220 mm · Ender 3 / Prusa MINI</option>
                <option value={250}>250 mm · Prusa MK4</option>
                <option value={256}>256 mm · Bambu X1 / P1 / A1</option>
                <option value={350}>350 mm · Voron / gran formato</option>
              </select>
            </div>
          </section>
          {isTauri() && <VersionSection />}
        </div>
      </div>
    </div>
  );
}
