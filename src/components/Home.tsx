import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronRight, Copy, FileUp, Folder, FolderInput, FolderOpen, FolderPlus, HardDrive, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Settings2, Shapes, Sparkles, Trash2 } from "lucide-react";
import { ACCEPT_ATTR } from "../cad/importers";
import { TEMPLATES } from "../cad/templates";
import { isMac, isTauri } from "../lib/platform";
import { newPart } from "../studio/parts";
import { TRASH, type Entry, type FolderNode } from "../studio/workspace";
import { useStore } from "../store";
import { UpdateNotice } from "./UpdateNotice";
import { Button, IconButton, Logo, cx } from "./ui";

function FolderTreeItem({ node, depth }: { node: FolderNode; depth: number }) {
  const folder = useStore((s) => s.folder);
  const open = useStore((s) => s.openFolder);
  const active = folder === node.path;
  const expanded = folder === node.path || folder.startsWith(node.path + "/");
  return (
    <>
      <button
        onClick={() => open(node.path)}
        className={cx("flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12.5px] transition-colors cursor-pointer", active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <ChevronRight size={12} className={cx("shrink-0 text-faint transition-transform", expanded && node.children.length > 0 && "rotate-90", node.children.length === 0 && "opacity-0")} />
        {active ? <FolderOpen size={14} className="shrink-0" /> : <Folder size={14} className="shrink-0" />}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children.map((c) => <FolderTreeItem key={c.path} node={c} depth={depth + 1} />)}
    </>
  );
}

function flatten(nodes: FolderNode[], out: FolderNode[] = []) {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

function EntryMenu({ entry, onRename, onClose }: { entry: Entry; onRename: () => void; onClose: () => void }) {
  const duplicate = useStore((s) => s.duplicateEntry);
  const trash = useStore((s) => s.trashEntry);
  const move = useStore((s) => s.moveEntry);
  const deleteForever = useStore((s) => s.deleteForever);
  const tree = useStore((s) => s.tree);
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const targets = [{ name: "Inicio", path: "" }, ...flatten(tree)].filter((f) => f.path !== entry.path && !f.path.startsWith(entry.path + "/"));
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-fg hover:bg-surface-3 cursor-pointer";

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} className="absolute top-9 right-2 z-30 w-52 rounded-xl border border-line bg-surface p-1 shadow-2xl shadow-black/40">
      {moving ? (
        <div className="max-h-64 overflow-y-auto scroll-thin">
          <div className="px-2.5 py-1.5 text-[11px] text-faint">Mover a…</div>
          {targets.map((f) => (
            <button key={f.path} className={item} onClick={() => (onClose(), move(entry, f.path))}>
              <Folder size={13} /> <span className="truncate">{f.path || "Inicio"}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {!entry.path.startsWith(TRASH + "/") && (
          <>
          <button className={item} onClick={() => (onClose(), onRename())}>
            <Pencil size={13} /> Renombrar
          </button>
          {entry.kind === "design" && (
            <button className={item} onClick={() => (onClose(), duplicate(entry))}>
              <Copy size={13} /> Duplicar
            </button>
          )}
          <button className={item} onClick={() => setMoving(true)}>
            <FolderInput size={13} /> Mover a…
          </button>
          <div className="my-1 h-px bg-line" />
          </>
          )}
          {entry.path.startsWith(TRASH + "/") ? (
            <>
              <button className={item} onClick={() => (onClose(), move(entry, ""))}>
                <RotateCcw size={13} /> Restaurar
              </button>
              <button className={cx(item, "text-err")} onClick={() => (onClose(), deleteForever(entry))}>
                <Trash2 size={13} /> Eliminar definitivamente
              </button>
            </>
          ) : (
            <button className={cx(item, "text-err")} onClick={() => (onClose(), trash(entry))}>
              <Trash2 size={13} /> Mover a la papelera
            </button>
          )}
        </>
      )}
    </div>
  );
}

function EntryCard({ entry }: { entry: Entry }) {
  const openDesign = useStore((s) => s.openDesign);
  const openFolder = useStore((s) => s.openFolder);
  const rename = useStore((s) => s.renameEntry);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const open = () => (entry.kind === "folder" ? openFolder(entry.path) : openDesign(entry.path));

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={open}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && !editing && open()}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-all hover:border-line-strong hover:shadow-xl hover:shadow-black/20 focus-visible:ring-2 focus-visible:ring-accent/50 outline-none"
    >
      <div className="relative aspect-[4/3] bg-surface-2">
        {entry.kind === "folder" ? (
          <div className="flex h-full items-center justify-center text-faint">
            <Folder size={44} strokeWidth={1.2} />
          </div>
        ) : entry.thumbnail ? (
          <img src={entry.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-faint">
            <Box size={40} strokeWidth={1.2} />
          </div>
        )}
        <button
          aria-label="Opciones"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(!menu);
          }}
          className={cx("absolute top-2 right-2 flex size-7 items-center justify-center rounded-lg bg-surface/90 text-muted backdrop-blur hover:text-fg cursor-pointer", menu ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
        >
          <MoreHorizontal size={15} />
        </button>
        {menu && <EntryMenu entry={entry} onRename={() => setEditing(true)} onClose={() => setMenu(false)} />}
      </div>
      <div className="px-3 py-2.5" onClick={(e) => editing && e.stopPropagation()}>
        {editing ? (
          <input
            autoFocus
            defaultValue={entry.name}
            onBlur={(e) => {
              setEditing(false);
              if (e.target.value.trim() && e.target.value !== entry.name) void rename(entry, e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded-md bg-surface-2 px-1.5 py-0.5 text-[13px] outline-none ring-1 ring-line-strong"
          />
        ) : (
          <div className="truncate text-[13px] font-medium text-fg">{entry.name}</div>
        )}
        <div className="mt-0.5 text-[11.5px] text-faint">
          {entry.kind === "folder"
            ? "Carpeta"
            : `${entry.parts ?? 0} pieza${entry.parts === 1 ? "" : "s"} · ${entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}`}
        </div>
      </div>
    </div>
  );
}

function StartCard({ icon: Icon, title, desc, onClick, primary }: { icon: typeof Box; title: string; desc: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors cursor-pointer",
        primary ? "border-accent/40 bg-accent-soft hover:border-accent/70" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <div className={cx("flex size-9 shrink-0 items-center justify-center rounded-xl", primary ? "bg-accent text-accent-ink" : "bg-surface-3 text-fg")}>
        <Icon size={17} />
      </div>
      <div>
        <div className="text-[13.5px] font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-[12px] text-muted">{desc}</div>
      </div>
    </button>
  );
}

export function Home() {
  const { folder, entries, tree, wsLoading, wsError, rootLabel } = useStore();
  const openFolder = useStore((s) => s.openFolder);
  const createFolder = useStore((s) => s.createFolder);
  const createDesign = useStore((s) => s.createDesign);
  const openSettings = useStore((s) => s.setSettingsOpen);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const inTrash = folder === TRASH || folder.startsWith(TRASH + "/");
  const [query, setQuery] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const importFiles = useStore((s) => s.importFiles);
  const importRef = useRef<HTMLInputElement>(null);
  const importNew = async (files: File[]) => {
    if (!files.length) return;
    await createDesign({ tab: "scene", name: files[0].name.replace(/\.[^.]+$/, "") });
    await importFiles(files);
  };

  useEffect(() => {
    void openFolder(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())), [entries, query]);
  const crumbs = folder ? folder.split("/") : [];
  const insetForTrafficLights = isTauri() && isMac();

  return (
    <div className="grid h-full grid-cols-[248px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div data-tauri-drag-region className={cx("flex h-12 items-center gap-2 px-4", insetForTrafficLights && "pt-6 h-16")}>
          <Logo className="size-[18px] text-accent-text" />
          <span className="text-[15px] font-semibold tracking-tight">AI3D</span>
          <span className="ml-auto rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted">Studio</span>
        </div>
        <div className="px-3 pt-2">
          <Button variant="primary" className="w-full" onClick={() => createDesign({ tab: "ai" })}>
            <Plus size={15} /> Nuevo diseño
          </Button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 scroll-thin">
          <div className="px-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">Espacio de trabajo</div>
          <button
            onClick={() => openFolder("")}
            className={cx("flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12.5px] cursor-pointer", folder === "" ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}
          >
            <HardDrive size={14} /> Todos los diseños
          </button>
          {tree.map((n) => (
            <FolderTreeItem key={n.path} node={n} depth={0} />
          ))}
          <button
            onClick={() => openFolder(TRASH)}
            className={cx("mt-2 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12.5px] cursor-pointer", folder === TRASH ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}
          >
            <Trash2 size={14} /> Papelera
          </button>
        </div>
        <div className="px-3 pb-2">
          <UpdateNotice />
        </div>
        <div className="border-t border-line p-2">
          <button onClick={() => openSettings(true)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-fg cursor-pointer">
            <Settings2 size={14} /> Ajustes e IA
          </button>
          <div className="truncate px-2 pt-1 text-[10.5px] text-faint" title={rootLabel}>
            {rootLabel}
          </div>
        </div>
      </aside>

      <main className="flex min-h-0 flex-col">
        <div data-tauri-drag-region className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <nav className="flex min-w-0 items-center gap-1 text-[14px]">
            <button onClick={() => openFolder("")} className={cx("rounded-md px-1.5 py-0.5 cursor-pointer", crumbs.length ? "text-muted hover:text-fg" : "font-semibold text-fg")}>
              Diseños
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <ChevronRight size={14} className="text-faint" />
                <button onClick={() => openFolder(crumbs.slice(0, i + 1).join("/"))} className={cx("truncate rounded-md px-1.5 py-0.5 cursor-pointer", i === crumbs.length - 1 ? "font-semibold text-fg" : "text-muted hover:text-fg")}>
                  {c}
                </button>
              </span>
            ))}
          </nav>
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          <label className="flex h-8 w-64 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-line-strong">
            <Search size={14} className="text-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en esta carpeta" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
          {inTrash ? (
            <Button variant="secondary" size="sm" disabled={entries.length === 0} onClick={() => void emptyTrash()} className="text-err">
              <Trash2 size={13} /> Vaciar papelera
            </Button>
          ) : (
            <IconButton label="Nueva carpeta" onClick={() => createFolder("Nueva carpeta")}>
              <FolderPlus size={16} />
            </IconButton>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scroll-thin">
          {inTrash ? (
            <div className="max-w-5xl rounded-xl bg-surface-2/70 px-4 py-3 text-[12.5px] text-muted">
              Los elementos de la papelera siguen en tu disco. Restáuralos desde su menú «…» o elimínalos definitivamente.
            </div>
          ) : (
          <div className="grid grid-cols-4 gap-3 max-w-6xl">
            <StartCard primary icon={Sparkles} title="Diseñar con IA" desc="Describe la pieza o sube una foto; la IA compone un modelo editable." onClick={() => createDesign({ tab: "ai" })} />
            <StartCard icon={Shapes} title="Lienzo en blanco" desc="Modela con formas básicas, agujeros y transformaciones." onClick={() => createDesign({ tab: "insert" })} />
            <StartCard icon={Box} title="Desde un componente" desc="Parte de una pieza paramétrica lista para ajustar." onClick={() => setShowTemplates(!showTemplates)} />
            <StartCard icon={FileUp} title="Importar modelo" desc="Abre un STL, 3MF, OBJ, AMF, STEP o SVG para modificarlo." onClick={() => importRef.current?.click()} />
            <input ref={importRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => (void importNew([...(e.target.files ?? [])]), (e.target.value = ""))} />
          </div>
          )}
          {showTemplates && !inTrash && (
            <div className="mt-3 flex max-w-5xl flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => createDesign({ tab: "scene", name: t.name, parts: [newPart(t.id)] })}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] text-fg hover:border-line-strong hover:bg-surface-2 cursor-pointer"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <div className="mt-8 mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-fg">{folder ? crumbs[crumbs.length - 1] : "Todos los diseños"}</h2>
            <span className="text-[12px] text-faint">{wsLoading ? "Cargando…" : `${filtered.length} elemento${filtered.length === 1 ? "" : "s"}`}</span>
          </div>
          {wsError && <div className="mb-4 rounded-xl border border-err/30 bg-err/8 p-3 text-[12.5px] text-err">{wsError}</div>}
          {!wsLoading && filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong py-16 text-center">
              <Folder size={32} strokeWidth={1.3} className="text-faint" />
              <div className="mt-3 text-[13.5px] text-fg">{query ? "Nada coincide con la búsqueda" : folder === TRASH ? "La papelera está vacía" : "Esta carpeta está vacía"}</div>
              <div className="mt-1 text-[12px] text-muted">{folder === TRASH ? "Lo que elimines aparece aquí y puedes restaurarlo." : "Crea un diseño o una carpeta para organizar tus piezas."}</div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {filtered.map((e) => (
                <EntryCard key={e.path} entry={e} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
