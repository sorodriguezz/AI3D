import { create } from "zustand";
import { persist } from "zustand/middleware";
import { heuristicAgent, runAgent, type AgentResult, type Proposal } from "./ai/agent";
import { imageForModel } from "./ai/image";
import { cliStatus, listModels, type AiSettings, type CliId, type CliInfo, type ProviderId } from "./ai/llm";
import { cancelCad, type MeshPayload } from "./cad/client";
import { importPreviewScale } from "./cad/importScale";
import { enclosureOuter, getTemplate } from "./cad/templates";
import type { Design, Part, ParamValue } from "./cad/types";
import { newDesign, newPart, uniqueName } from "./studio/parts";
import { evaluateParam, resolveParts, type ParamErrors } from "./studio/params";
import { resolveVariables, type Variable } from "./cad/expr";
import * as ws from "./studio/workspace";
import { loadAsset, prepareImport } from "./studio/assets";
import { cachedPartMesh } from "./studio/meshes";
import { worldBounds } from "./studio/modeling";
import { confirmDialog } from "./lib/platform";

export interface Settings extends AiSettings {
  /** Volumen de impresión en mm (Bambu Lab X1/P1/A1: 256). */
  buildVolume: number;
}

type AiStatus = "checking" | "online" | "offline";
type SaveState = "saved" | "dirty" | "saving" | "error";
export type LeftTab = "insert" | "scene" | "ai";

interface State {
  settings: Settings;
  aiStatus: AiStatus;
  localModels: string[];
  clis: CliInfo[];
  settingsOpen: boolean;

  view: "home" | "studio";
  rootLabel: string;
  folder: string;
  entries: ws.Entry[];
  tree: ws.FolderNode[];
  wsLoading: boolean;
  wsError: string | null;

  doc: Design | null;
  docPath: string | null;
  saveState: SaveState;
  past: Snapshot[];
  future: Snapshot[];
  /** Errores de fórmulas y bocetos por pieza y medida. */
  paramErrors: ParamErrors;
  selectedId: string | null;
  focusParam: string | null;
  leftTab: LeftTab;
  transformMode: "translate" | "rotate";
  snap: boolean;
  showResult: boolean;

  result: MeshPayload | null;
  building: boolean;
  buildError: string | null;
  /** Cambia para volver a combinar la escena sin editarla. */
  buildNonce: number;

  photo: string | null;
  mark: { x: number; y: number } | null;
  prompt: string;
  analyzing: boolean;
  analyzeError: string | null;
  agent: AgentResult | null;
  activeProposal: string | null;

  // Ajustes y proveedores
  setSettings: (s: Partial<Settings>) => void;
  setProvider: (p: ProviderId) => void;
  setCliModel: (id: CliId, model: string) => void;
  checkAi: () => Promise<void>;
  setSettingsOpen: (o: boolean) => void;

  // Espacio de trabajo
  openFolder: (folder: string) => Promise<void>;
  refresh: () => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  createDesign: (opts?: { tab?: LeftTab; parts?: Part[]; name?: string }) => Promise<void>;
  openDesign: (path: string) => Promise<void>;
  renameEntry: (e: ws.Entry, name: string) => Promise<void>;
  duplicateEntry: (e: ws.Entry) => Promise<void>;
  trashEntry: (e: ws.Entry) => Promise<void>;
  moveEntry: (e: ws.Entry, toFolder: string) => Promise<void>;
  deleteForever: (e: ws.Entry) => Promise<void>;
  emptyTrash: () => Promise<void>;
  goHome: () => Promise<void>;

  // Documento
  renameDoc: (name: string) => Promise<void>;
  setParts: (parts: Part[]) => void;
  addPart: (type: string) => void;
  importFiles: (files: File[]) => Promise<void>;
  importError: string | null;
  importing: boolean;
  updatePart: (id: string, patch: Partial<Part>, history?: boolean) => void;
  setPartParam: (id: string, key: string, value: ParamValue) => void;
  /** Define una medida por fórmula (null la vuelve a un valor fijo). Devuelve el error, si lo hay. */
  setPartExpr: (id: string, key: string, expr: string | null) => string | null;
  /** Cambia las variables (y, al renombrar una, las piezas que la usan) en un solo paso deshacible. */
  setVariables: (variables: Variable[], parts?: Part[]) => void;
  confirmParam: (id: string, key: string) => void;
  beginChange: () => void;
  removePart: (id: string) => void;
  duplicatePart: (id: string) => void;
  dropToBed: (id: string) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null, focusParam?: string | null) => void;
  setLeftTab: (t: LeftTab) => void;
  setTransformMode: (m: State["transformMode"]) => void;
  toggleSnap: () => void;
  setShowResult: (v: boolean) => void;
  setResult: (r: MeshPayload | null, error?: string | null) => void;
  setBuilding: (b: boolean) => void;
  retryBuild: () => void;
  cancelBuild: () => void;
  /** Añade piezas ya construidas (herramientas de modelado) y selecciona la última. */
  addParts: (parts: Part[]) => void;
  saveNow: () => Promise<void>;

  // IA
  setPhoto: (p: string | null) => void;
  setMark: (m: { x: number; y: number } | null) => void;
  setPrompt: (p: string) => void;
  analyze: () => Promise<void>;
  cancelAnalyze: () => void;
  applyProposal: (p: Proposal) => void;
}

/** Estado que se deshace y rehace: piezas y variables. */
export interface Snapshot {
  parts: Part[];
  variables?: Variable[];
}

let analyzeAbort: AbortController | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** El visor registra aquí cómo capturar una miniatura del lienzo. */
export const thumbnailHook: { capture: (() => string | null) | null } = { capture: null };

const HISTORY_LIMIT = 100;

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const scheduleSave = () => {
        set({ saveState: "dirty" });
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void get().saveNow(), 800);
      };

      const snapshot = (doc: Design): Snapshot => ({ parts: doc.parts, variables: doc.variables });

      /**
       * Cambia las piezas (y opcionalmente las variables) registrando la versión anterior para deshacer.
       * Las medidas con fórmula y los bocetos acotados se recalculan siempre con las variables vigentes.
       */
      const commit = (parts: Part[], history = true, variables?: Variable[]) => {
        const { doc, past } = get();
        if (!doc) return;
        const vars = variables ?? doc.variables;
        const resolved = resolveParts(parts, vars);
        set({
          doc: { ...doc, parts: resolved.parts, ...(variables ? { variables } : {}) },
          paramErrors: resolved.errors,
          ...(history ? { past: [...past, snapshot(doc)].slice(-HISTORY_LIMIT), future: [] } : {}),
        });
        scheduleSave();
      };

      /** Nada se crea dentro de la Papelera: desde ahí, lo nuevo va a la raíz del espacio de trabajo. */
      const creationFolder = () => {
        const f = get().folder;
        return f === ws.TRASH || f.startsWith(ws.TRASH + "/") ? "" : f;
      };

      /** Ejecuta una operación de archivos, refresca la carpeta y muestra el error si falla. */
      const guard = async (op: () => Promise<unknown>) => {
        try {
          set({ wsError: null });
          await op();
        } catch (e) {
          set({ wsError: `No se pudo completar la operación: ${e instanceof Error ? e.message : String(e)}` });
        }
        await get().refresh();
      };

      const mapPart = (id: string, fn: (p: Part) => Part) => get().doc?.parts.map((p) => (p.id === id ? fn(p) : p)) ?? [];

      return {
        settings: { provider: "claude", baseUrl: "http://127.0.0.1:8080", localModel: "", cliModel: { claude: "", codex: "", gemini: "" }, buildVolume: 256 },
        aiStatus: "checking",
        localModels: [],
        clis: [],
        settingsOpen: false,

        view: "home",
        rootLabel: "",
        folder: "",
        entries: [],
        tree: [],
        wsLoading: false,
        wsError: null,

        doc: null,
        docPath: null,
        saveState: "saved",
        past: [],
        future: [],
        paramErrors: {},
        selectedId: null,
        focusParam: null,
        leftTab: "insert",
        transformMode: "translate",
        snap: true,
        showResult: false,

        importError: null,
        importing: false,

        result: null,
        building: false,
        buildError: null,
        buildNonce: 0,

        photo: null,
        mark: null,
        prompt: "",
        analyzing: false,
        analyzeError: null,
        agent: null,
        activeProposal: null,

        // --- Ajustes ---
        setSettings: (s) => {
          set({ settings: { ...get().settings, ...s } });
          if (s.baseUrl !== undefined || s.provider !== undefined) void get().checkAi();
        },
        setProvider: (provider) => get().setSettings({ provider }),
        setCliModel: (id, model) => set({ settings: { ...get().settings, cliModel: { ...get().settings.cliModel, [id]: model } } }),
        setSettingsOpen: (settingsOpen) => {
          set({ settingsOpen });
          if (settingsOpen) void get().checkAi();
        },
        checkAi: async () => {
          const { settings } = get();
          set({ aiStatus: "checking" });
          if (settings.provider === "local") {
            try {
              const models = await listModels(settings.baseUrl, AbortSignal.timeout(2500));
              const cur = settings.localModel;
              set({ aiStatus: "online", localModels: models, settings: { ...get().settings, localModel: cur && models.includes(cur) ? cur : (models[0] ?? "") } });
            } catch {
              set({ aiStatus: "offline", localModels: [] });
            }
            return;
          }
          const clis = await cliStatus();
          set({ clis, aiStatus: clis.find((c) => c.id === settings.provider)?.installed ? "online" : "offline" });
        },

        // --- Espacio de trabajo ---
        openFolder: async (folder) => {
          set({ folder, wsLoading: true });
          try {
            const [entries, tree, rootLabel] = await Promise.all([ws.listEntries(folder), ws.folderTree(), ws.workspaceRoot()]);
            if (get().folder === folder) set({ entries, tree, rootLabel, wsLoading: false });
          } catch (e) {
            set({ wsLoading: false, wsError: e instanceof Error ? e.message : String(e) });
          }
        },
        refresh: () => get().openFolder(get().folder),
        createFolder: (name) => guard(() => ws.createFolder(creationFolder(), name)),
        createDesign: async (opts = {}) => {
          const path = await ws.uniquePath(creationFolder(), opts.name ?? "Diseño sin título", ws.EXT);
          const doc = { ...newDesign(ws.designTitle(path)), parts: opts.parts ?? [] };
          await ws.writeDesign(path, doc);
          set({
            view: "studio",
            doc,
            docPath: path,
            saveState: "saved",
            past: [],
            future: [],
            paramErrors: {},
            selectedId: null,
            result: null,
            buildError: null,
            leftTab: opts.tab ?? "insert",
            agent: null,
            activeProposal: null,
            prompt: "",
            photo: null,
            mark: null,
          });
        },
        openDesign: async (path) => {
          const doc = await ws.readDesign(path);
          for (const [id, a] of Object.entries(doc.assets ?? {})) void loadAsset(id, a).catch(() => undefined);
          set({ view: "studio", doc, docPath: path, saveState: "saved", past: [], future: [], paramErrors: resolveParts(doc.parts, doc.variables).errors, selectedId: null, result: null, buildError: null, leftTab: doc.parts.length ? "scene" : "insert", agent: null, activeProposal: null, prompt: doc.prompt ?? "", photo: null, mark: null });
        },
        renameEntry: (e, name) =>
          guard(async () => {
            const target = await ws.renameEntry(e.path, name, e.kind);
            if (e.kind === "design") {
              const d = await ws.readDesign(target);
              await ws.writeDesign(target, { ...d, name: ws.designTitle(target) });
            }
          }),
        duplicateEntry: (e) => guard(async () => void (e.kind === "design" && (await ws.duplicateDesign(e.path)))),
        trashEntry: (e) => guard(() => ws.trashEntry(e.path, e.kind)),
        moveEntry: (e, toFolder) => guard(() => ws.moveEntry(e.path, toFolder, e.kind)),
        deleteForever: async (e) => {
          const what = e.kind === "folder" ? `la carpeta «${e.name}» y todo su contenido` : `«${e.name}»`;
          if (await confirmDialog(`¿Eliminar definitivamente ${what}? Esta acción no se puede deshacer.`)) await guard(() => ws.deleteForever(e.path));
        },
        emptyTrash: async () => {
          if (await confirmDialog("¿Vaciar la papelera? Todo su contenido se eliminará definitivamente y no se puede deshacer.")) await guard(() => ws.emptyTrash());
        },
        goHome: async () => {
          if (get().saveState !== "saved") await get().saveNow();
          set({ view: "home", doc: null, docPath: null, result: null, selectedId: null });
          await get().refresh();
        },

        // --- Documento ---
        renameDoc: async (name) => {
          const { doc, docPath } = get();
          if (!doc || !docPath || !name.trim()) return;
          await get().saveNow();
          const target = await ws.renameEntry(docPath, name.trim(), "design");
          set({ docPath: target, doc: { ...doc, name: ws.designTitle(target) } });
          scheduleSave();
        },
        setParts: (parts) => commit(parts),
        addPart: (type) => {
          const doc = get().doc;
          if (!doc) return;
          const t = getTemplate(type)!;
          // Las piezas nuevas se colocan junto a las existentes para no quedar superpuestas.
          const offset = doc.parts.length ? Math.min(120, 10 + doc.parts.length * 8) : 0;
          if (t.pieces) {
            // Plantillas de varias piezas (caja y tapa): comparten medidas y van en cuerpos distintos.
            const link = crypto.randomUUID();
            const first = newPart(type);
            const gap = enclosureOuter(first.params).length + 10;
            const created: Part[] = [];
            t.pieces.items.forEach((item, i) => {
              created.push(newPart(type, {
                name: uniqueName([...doc.parts, ...created], item.name),
                params: { ...first.params, [t.pieces!.param]: item.value },
                estimated: first.estimated,
                position: [offset + i * gap, 0, 0],
                body: uniqueBody(doc.parts, item.body),
                link,
              }));
            });
            commit([...doc.parts, ...created]);
            set({ selectedId: created[0].id });
            return;
          }
          const part = newPart(type, { name: uniqueName(doc.parts, t.name), position: [offset, 0, 0] });
          commit([...doc.parts, part]);
          set({ selectedId: part.id, leftTab: get().leftTab === "insert" ? "insert" : get().leftTab });
        },
        importFiles: async (files) => {
          set({ importing: true, importError: null });
          const errors: string[] = [];
          for (const file of files) {
            try {
              const asset = await prepareImport(file);
              const id = crypto.randomUUID();
              await loadAsset(id, asset);
              const doc = get().doc;
              if (!doc) return;
              const params = { ...newPart("imported").params, asset: id, format: asset.format };
              const offset = doc.parts.length ? Math.min(150, 10 + doc.parts.length * 8) : 0;
              const part = newPart("imported", { name: uniqueName(doc.parts, asset.name), params, position: [offset, 0, 0], estimated: [] });
              set({ doc: { ...doc, assets: { ...(doc.assets ?? {}), [id]: asset } } });
              commit([...get().doc!.parts, part]);
              set({ selectedId: part.id });
              if ((asset.triangles ?? 0) > 1_500_000) errors.push(`${file.name}: modelo muy pesado (${asset.triangles?.toLocaleString("es")} triángulos); la vista puede ir lenta.`);
            } catch (e) {
              errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          set({ importing: false, importError: errors.length ? errors.join("\n") : null });
        },
        updatePart: (id, patch, history = true) => commit(mapPart(id, (p) => ({ ...p, ...patch })), history),
        setPartParam: (id, key, value) => {
          const source = get().doc?.parts.find((p) => p.id === id);
          const pieceParam = source && getTemplate(source.type)?.pieces?.param;
          // Las piezas enlazadas comparten todas las medidas salvo la que las distingue.
          const linked = (p: Part) => p.id === id || (!!source?.link && p.link === source.link && key !== pieceParam);
          // Un valor escrito a mano reemplaza la fórmula de esa medida.
          const withoutExpr = (p: Part) => {
            if (!p.exprs?.[key]) return p.exprs;
            const { [key]: _removed, ...rest } = p.exprs;
            return Object.keys(rest).length ? rest : undefined;
          };
          commit(get().doc?.parts.map((p) => (linked(p) ? { ...p, params: { ...p.params, [key]: value }, exprs: withoutExpr(p), estimated: p.estimated?.filter((k) => k !== key) } : p)) ?? []);
        },
        setPartExpr: (id, key, expr) => {
          const doc = get().doc;
          const source = doc?.parts.find((p) => p.id === id);
          if (!doc || !source) return null;
          const linked = (p: Part) => p.id === id || (!!source.link && p.link === source.link);
          if (expr === null || !expr.trim()) {
            commit(doc.parts.map((p) => {
              if (!linked(p) || !p.exprs?.[key]) return p;
              const { [key]: _removed, ...rest } = p.exprs;
              return { ...p, exprs: Object.keys(rest).length ? rest : undefined };
            }));
            return null;
          }
          try {
            const value = evaluateParam(source, key, expr, resolveVariables(doc.variables).values);
            commit(doc.parts.map((p) => (linked(p) ? { ...p, params: { ...p.params, [key]: value }, exprs: { ...p.exprs, [key]: expr.trim() }, estimated: p.estimated?.filter((k) => k !== key) } : p)));
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        },
        setVariables: (variables, parts) => {
          const doc = get().doc;
          if (doc) commit(parts ?? doc.parts, true, variables);
        },
        confirmParam: (id, key) => {
          const link = get().doc?.parts.find((p) => p.id === id)?.link;
          commit(get().doc?.parts.map((p) => (p.id === id || (link && p.link === link) ? { ...p, estimated: p.estimated?.filter((k) => k !== key) } : p)) ?? []);
        },
        beginChange: () => {
          const { doc, past } = get();
          if (doc) set({ past: [...past, { parts: doc.parts, variables: doc.variables }].slice(-HISTORY_LIMIT), future: [] });
        },
        removePart: (id) => {
          commit(get().doc?.parts.filter((p) => p.id !== id) ?? []);
          if (get().selectedId === id) set({ selectedId: null });
        },
        duplicatePart: (id) => {
          const doc = get().doc;
          const src = doc?.parts.find((p) => p.id === id);
          if (!doc || !src) return;
          const copy: Part = { ...structuredClone(src), id: crypto.randomUUID(), name: uniqueName(doc.parts, src.name), position: [src.position[0] + 10, src.position[1] + 10, src.position[2]] };
          commit([...doc.parts, copy]);
          set({ selectedId: copy.id });
        },
        dropToBed: (id) => commit(mapPart(id, (p) => {
          const mesh = cachedPartMesh(p);
          const bottom = mesh ? worldBounds(p, mesh).min[2] : p.position[2];
          return { ...p, position: [p.position[0], p.position[1], p.position[2] - bottom] };
        })),
        undo: () => {
          const { doc, past, future } = get();
          if (!doc || past.length === 0) return;
          const prev = past[past.length - 1];
          set({ doc: { ...doc, parts: prev.parts, variables: prev.variables }, paramErrors: resolveParts(prev.parts, prev.variables).errors, past: past.slice(0, -1), future: [{ parts: doc.parts, variables: doc.variables }, ...future] });
          scheduleSave();
        },
        redo: () => {
          const { doc, past, future } = get();
          if (!doc || future.length === 0) return;
          const next = future[0];
          set({ doc: { ...doc, parts: next.parts, variables: next.variables }, paramErrors: resolveParts(next.parts, next.variables).errors, past: [...past, { parts: doc.parts, variables: doc.variables }], future: future.slice(1) });
          scheduleSave();
        },
        select: (selectedId, focusParam = null) => set({ selectedId, focusParam }),
        setLeftTab: (leftTab) => set({ leftTab }),
        setTransformMode: (transformMode) => set({ transformMode }),
        toggleSnap: () => set({ snap: !get().snap }),
        setShowResult: (showResult) => set({ showResult }),
        setResult: (result, error = null) => set({ result, buildError: error }),
        setBuilding: (building) => set({ building }),
        retryBuild: () => set({ buildNonce: get().buildNonce + 1, buildError: null }),
        cancelBuild: () => cancelCad(),
        addParts: (parts) => {
          const doc = get().doc;
          if (!doc || !parts.length) return;
          commit([...doc.parts, ...parts]);
          set({ selectedId: parts[parts.length - 1].id });
        },
        saveNow: async () => {
          if (saveTimer) clearTimeout(saveTimer);
          const { doc, docPath, prompt } = get();
          if (!doc || !docPath) return;
          set({ saveState: "saving" });
          const thumbnail = thumbnailHook.capture?.() ?? doc.thumbnail;
          // Solo se guardan los modelos importados que aún usa alguna pieza (incluido el historial de deshacer).
          const used = new Set([doc.parts, ...get().past.map((h) => h.parts), ...get().future.map((h) => h.parts)].flat().map((p) => String(p.params.asset ?? "")));
          const assets = Object.fromEntries(Object.entries(doc.assets ?? {}).filter(([id]) => used.has(id)));
          const next: Design = { ...doc, assets, prompt, updatedAt: Date.now(), thumbnail: thumbnail ?? undefined };
          try {
            await ws.writeDesign(docPath, next);
            if (get().doc?.id === next.id) set({ saveState: get().saveState === "saving" ? "saved" : get().saveState });
          } catch {
            set({ saveState: "error" });
          }
        },

        // --- IA ---
        setPhoto: (photo) => set({ photo, mark: null }),
        setMark: (mark) => set({ mark }),
        setPrompt: (prompt) => set({ prompt }),
        analyze: async () => {
          const { prompt, photo, mark, settings, aiStatus, doc } = get();
          analyzeAbort?.abort();
          analyzeAbort = new AbortController();
          set({ analyzing: true, analyzeError: null });
          const current = doc?.parts ?? [];
          const sizes: Record<string, number[]> = {};
          for (const p of current) {
            const m = p.type === "imported" ? cachedPartMesh(p) : undefined;
            if (m) sizes[p.name] = m.bbox.max.map((v, i) => +((v - m.bbox.min[i]) * (p.features?.length ? 1 : importPreviewScale(p.type, p.params))).toFixed(1));
          }
          try {
            let result: AgentResult;
            if (aiStatus === "online") {
              const image = photo ? await imageForModel(photo, mark) : null;
              result = await runAgent(settings, { prompt, image, mark, current, sizes }, analyzeAbort.signal);
            } else {
              result = heuristicAgent({ prompt, image: photo, mark, current });
            }
            set({ agent: result, analyzing: false });
            if (result.proposals[0]) get().applyProposal(result.proposals[0]);
          } catch (e) {
            if (analyzeAbort?.signal.aborted) {
              set({ analyzing: false });
              return;
            }
            set({ analyzing: false, analyzeError: e instanceof Error ? e.message : String(e) });
          }
        },
        cancelAnalyze: () => {
          analyzeAbort?.abort();
          set({ analyzing: false });
        },
        applyProposal: (p) => {
          commit(structuredClone(p.parts));
          set({ activeProposal: p.id, selectedId: null });
        },
      };
    },
    {
      name: "ai3d",
      version: 2,
      partialize: (s) => ({ settings: s.settings, snap: s.snap }),
      migrate: (persisted) => {
        const old = (persisted ?? {}) as { settings?: Partial<Settings> & { model?: string } };
        const s = old.settings ?? {};
        return {
          settings: {
            provider: s.provider ?? "claude",
            baseUrl: s.baseUrl ?? "http://127.0.0.1:8080",
            localModel: s.localModel ?? s.model ?? "",
            cliModel: s.cliModel ?? { claude: "", codex: "", gemini: "" },
            buildVolume: s.buildVolume ?? 256,
          },
        } as never;
      },
    },
  ),
);

/** Nombre de cuerpo libre: «Tapa», «Tapa 2», … */
export function uniqueBody(parts: Part[], base: string): string {
  const used = new Set(parts.map((p) => p.body).filter(Boolean));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Medidas sin verificar en toda la escena (visibles según cada plantilla). */
export function pendingMeasurements(parts: Part[]) {
  const out: { part: Part; key: string; label: string }[] = [];
  for (const part of parts) {
    const t = getTemplate(part.type);
    if (!t) continue;
    for (const key of part.estimated ?? []) {
      const d = t.params.find((x) => x.key === key);
      if (d && (!d.visibleIf || d.visibleIf(part.params))) out.push({ part, key, label: d.label });
    }
  }
  return out;
}
