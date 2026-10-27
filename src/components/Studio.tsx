import { ArrowUpCircle, ChevronLeft, Cloud, CloudOff, Loader2, Redo2, Settings2, Undo2 } from "lucide-react";
import { useUpdates } from "../lib/updates";
import { PROVIDERS } from "../ai/llm";
import { isMac, isTauri } from "../lib/platform";
import { useSceneResult } from "../studio/meshes";
import { parentOf } from "../studio/workspace";
import { useStore } from "../store";
import { Inspector } from "./Inspector";
import { LeftPanel } from "./LeftPanel";
import { StudioViewport } from "./StudioViewport";
import { IconButton, InlineEdit, Logo, cx } from "./ui";

function SaveIndicator() {
  const state = useStore((s) => s.saveState);
  const label = { saved: "Guardado", dirty: "Sin guardar", saving: "Guardando…", error: "Error al guardar" }[state];
  const Icon = state === "saving" ? Loader2 : state === "error" ? CloudOff : Cloud;
  return (
    <span className={cx("flex items-center gap-1.5 text-[11.5px]", state === "error" ? "text-err" : "text-faint")}>
      <Icon size={13} className={state === "saving" ? "animate-spin" : ""} /> {label}
    </span>
  );
}

function AiChip() {
  const status = useStore((s) => s.aiStatus);
  const provider = useStore((s) => s.settings.provider);
  const open = useStore((s) => s.setSettingsOpen);
  const info = PROVIDERS.find((p) => p.id === provider)!;
  return (
    <button onClick={() => open(true)} className="flex h-7 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg cursor-pointer" title="Elegir modelo de IA">
      <span className={cx("size-1.5 rounded-full", status === "online" ? "bg-ok" : status === "offline" ? "bg-warn" : "bg-muted pulse-dot")} />
      {info.name}
    </button>
  );
}

function UpdateChip() {
  const phase = useUpdates((s) => s.phase);
  const version = useUpdates((s) => s.update?.version);
  const open = useStore((s) => s.setSettingsOpen);
  if (phase !== "available" && phase !== "downloading") return null;
  return (
    <button onClick={() => open(true)} className="flex h-7 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[12px] font-medium text-accent-text cursor-pointer" title="Ver actualización">
      <ArrowUpCircle size={13} /> {phase === "downloading" ? "Descargando…" : `Actualizar a ${version}`}
    </button>
  );
}

function StudioHeader() {
  const doc = useStore((s) => s.doc)!;
  const docPath = useStore((s) => s.docPath);
  const goHome = useStore((s) => s.goHome);
  const renameDoc = useStore((s) => s.renameDoc);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const openSettings = useStore((s) => s.setSettingsOpen);
  const folder = docPath ? parentOf(docPath) : "";
  const inset = isTauri() && isMac();
  const mod = isMac() ? "⌘" : "Ctrl+";

  return (
    <header data-tauri-drag-region className={cx("flex h-11 items-center gap-2 border-b border-line bg-surface pr-2", inset ? "pl-[84px]" : "pl-3")}>
      <button onClick={() => void goHome()} className="flex h-7 items-center gap-1 rounded-lg pr-2 pl-1 text-muted hover:bg-surface-2 hover:text-fg cursor-pointer" title="Volver a mis diseños">
        <ChevronLeft size={16} />
        <Logo className="size-4 text-accent-text" />
      </button>
      <span className="truncate text-[12.5px] text-faint">{folder || "Diseños"}</span>
      <span className="text-faint">/</span>
      <InlineEdit value={doc.name} onCommit={(n) => void renameDoc(n)} className="w-56 text-[13px] font-medium" />
      <SaveIndicator />
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <IconButton label={`Deshacer (${mod}Z)`} disabled={!canUndo} onClick={undo} className="disabled:opacity-30">
        <Undo2 size={16} />
      </IconButton>
      <IconButton label={`Rehacer (${mod}⇧Z)`} disabled={!canRedo} onClick={redo} className="disabled:opacity-30">
        <Redo2 size={16} />
      </IconButton>
      <div className="mx-1 h-5 w-px bg-line" />
      <UpdateChip />
      <AiChip />
      <IconButton label="Ajustes" onClick={() => openSettings(true)}>
        <Settings2 size={16} />
      </IconButton>
    </header>
  );
}

export function Studio() {
  useSceneResult();
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <StudioHeader />
      <main className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)_320px]">
        <LeftPanel />
        <StudioViewport />
        <Inspector />
      </main>
    </div>
  );
}
