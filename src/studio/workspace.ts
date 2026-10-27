import type { Design } from "../cad/types";
import { isTauri } from "../lib/platform";

// Espacio de trabajo: carpetas reales con archivos .ai3d (JSON) que también se ven en Finder/Explorador.
// Lo eliminado se mueve a la carpeta «Papelera» del espacio de trabajo; nada se borra definitivamente.
// En navegador (desarrollo sin Tauri) se usa un sistema de archivos simulado en localStorage.

export const EXT = ".ai3d";
/** Carpeta visible: el permiso de archivos de Tauri no cubre rutas que empiezan con punto. */
export const TRASH = "Papelera";

export interface Entry {
  kind: "folder" | "design";
  name: string;
  /** Ruta relativa a la raíz, separada por «/». */
  path: string;
  updatedAt?: number;
  thumbnail?: string;
  parts?: number;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

interface Backend {
  root(): Promise<string>;
  list(rel: string): Promise<{ name: string; isDir: boolean }[]>;
  read(rel: string): Promise<string>;
  write(rel: string, text: string): Promise<void>;
  mkdir(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
  remove(rel: string): Promise<void>;
}

const join = (...p: string[]) => p.filter(Boolean).join("/");
export const parentOf = (rel: string) => rel.split("/").slice(0, -1).join("/");
export const baseName = (rel: string) => rel.split("/").pop() ?? rel;
export const designTitle = (rel: string) => baseName(rel).replace(/\.ai3d$/, "");

let customRoot: string | null = null;
export const setWorkspaceRoot = (r: string | null) => (customRoot = r);

function tauriBackend(): Backend {
  let rootCache: string | null = null;
  const fs = () => import("@tauri-apps/plugin-fs");
  const abs = async (rel: string) => join(await b.root(), rel);
  const b: Backend = {
    async root() {
      if (customRoot) return customRoot;
      if (rootCache) return rootCache;
      const { documentDir } = await import("@tauri-apps/api/path");
      rootCache = join((await documentDir()).replace(/[\\/]+$/, ""), "AI3D");
      const { mkdir, exists } = await fs();
      if (!(await exists(rootCache))) await mkdir(rootCache, { recursive: true });
      const trash = join(rootCache, TRASH);
      if (!(await exists(trash))) await mkdir(trash, { recursive: true });
      return rootCache;
    },
    async list(rel) {
      const { readDir, exists } = await fs();
      const path = await abs(rel);
      if (!(await exists(path))) return []; // carpeta movida o borrada desde fuera: se muestra vacía
      return (await readDir(path)).map((e) => ({ name: e.name, isDir: e.isDirectory }));
    },
    read: async (rel) => (await fs()).readTextFile(await abs(rel)),
    write: async (rel, text) => (await fs()).writeTextFile(await abs(rel), text),
    mkdir: async (rel) => (await fs()).mkdir(await abs(rel), { recursive: true }),
    rename: async (from, to) => (await fs()).rename(await abs(from), await abs(to)),
    exists: async (rel) => (await fs()).exists(await abs(rel)),
    remove: async (rel) => (await fs()).remove(await abs(rel), { recursive: true }),
  };
  return b;
}

function memoryBackend(): Backend {
  const KEY = "ai3d-fs";
  const load = (): { files: Record<string, string>; dirs: string[] } => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "") ?? { files: {}, dirs: [] };
    } catch {
      return { files: {}, dirs: [] };
    }
  };
  const save = (s: ReturnType<typeof load>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* sin almacenamiento disponible */
    }
  };
  return {
    root: async () => "Navegador (simulado)",
    async list(rel) {
      const s = load();
      const prefix = rel ? rel + "/" : "";
      const out = new Map<string, boolean>();
      for (const p of [...Object.keys(s.files), ...s.dirs.map((d) => d + "/")]) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest) continue;
        const [head, ...tail] = rest.split("/");
        out.set(head, out.get(head) || tail.length > 0);
      }
      return [...out].map(([name, isDir]) => ({ name, isDir }));
    },
    async read(rel) {
      const v = load().files[rel];
      if (v === undefined) throw new Error("No existe: " + rel);
      return v;
    },
    async write(rel, text) {
      const s = load();
      s.files[rel] = text;
      save(s);
    },
    async mkdir(rel) {
      const s = load();
      if (!s.dirs.includes(rel)) s.dirs.push(rel);
      save(s);
    },
    async rename(from, to) {
      const s = load();
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.files)) files[k === from || k.startsWith(from + "/") ? to + k.slice(from.length) : k] = v;
      s.files = files;
      s.dirs = s.dirs.map((d) => (d === from || d.startsWith(from + "/") ? to + d.slice(from.length) : d));
      save(s);
    },
    async remove(rel) {
      const s = load();
      for (const k of Object.keys(s.files)) if (k === rel || k.startsWith(rel + "/")) delete s.files[k];
      s.dirs = s.dirs.filter((d) => d !== rel && !d.startsWith(rel + "/"));
      save(s);
    },
    async exists(rel) {
      const s = load();
      return rel in s.files || s.dirs.some((d) => d === rel || d.startsWith(rel + "/")) || Object.keys(s.files).some((k) => k.startsWith(rel + "/"));
    },
  };
}

const backend: Backend = isTauri() ? tauriBackend() : memoryBackend();

export const workspaceRoot = () => backend.root();

export async function listEntries(folder: string): Promise<Entry[]> {
  const items = await backend.list(folder);
  const out: Entry[] = [];
  for (const it of items) {
    if (it.name.startsWith(".") || (!folder && it.name === TRASH)) continue;
    const path = join(folder, it.name);
    if (it.isDir) out.push({ kind: "folder", name: it.name, path });
    else if (it.name.endsWith(EXT)) {
      try {
        const d = JSON.parse(await backend.read(path)) as Design;
        out.push({ kind: "design", name: designTitle(path), path, updatedAt: d.updatedAt, thumbnail: d.thumbnail, parts: d.parts?.length ?? 0 });
      } catch {
        out.push({ kind: "design", name: designTitle(path), path });
      }
    }
  }
  return out.sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.kind === "folder" ? a.name.localeCompare(b.name) : (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
}

export async function folderTree(folder = "", depth = 0): Promise<FolderNode[]> {
  if (depth > 6) return [];
  const items = (await backend.list(folder)).filter((i) => i.isDir && !i.name.startsWith(".") && !(!folder && i.name === TRASH));
  items.sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(items.map(async (i) => ({ name: i.name, path: join(folder, i.name), children: await folderTree(join(folder, i.name), depth + 1) })));
}

const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Sin título";

/** Ruta libre dentro de la carpeta: «Nombre», «Nombre 2», … */
export async function uniquePath(folder: string, name: string, ext = ""): Promise<string> {
  const base = sanitizeName(name);
  for (let i = 1; ; i++) {
    const candidate = join(folder, (i === 1 ? base : `${base} ${i}`) + ext);
    if (!(await backend.exists(candidate))) return candidate;
  }
}

export async function readDesign(path: string): Promise<Design> {
  const d = JSON.parse(await backend.read(path)) as Design;
  if (d.format !== "ai3d" || !Array.isArray(d.parts)) throw new Error("El archivo no es un diseño de AI3D válido.");
  return d;
}

export const writeDesign = (path: string, d: Design) => backend.write(path, JSON.stringify(d));

export async function createFolder(parent: string, name: string): Promise<string> {
  const path = await uniquePath(parent, name);
  await backend.mkdir(path);
  return path;
}

/** Renombra un diseño o carpeta conservando la extensión. Devuelve la nueva ruta. */
export async function renameEntry(path: string, newName: string, kind: Entry["kind"]): Promise<string> {
  const ext = kind === "design" ? EXT : "";
  if (sanitizeName(newName) + ext === baseName(path)) return path;
  const target = await uniquePath(parentOf(path), newName, ext);
  await backend.rename(path, target);
  return target;
}

export async function moveEntry(path: string, toFolder: string, kind: Entry["kind"]): Promise<string> {
  const name = kind === "design" ? designTitle(path) : baseName(path);
  const target = await uniquePath(toFolder, name, kind === "design" ? EXT : "");
  await backend.rename(path, target);
  return target;
}

/** No se borra nada definitivamente: se mueve a la Papelera del espacio de trabajo. */
export async function trashEntry(path: string, kind: Entry["kind"]): Promise<void> {
  await backend.mkdir(TRASH);
  await moveEntry(path, TRASH, kind);
}

/** Borrado definitivo: solo se permite para elementos que ya están en la Papelera. */
export async function deleteForever(path: string): Promise<void> {
  if (!path.startsWith(TRASH + "/")) throw new Error("Solo se puede eliminar definitivamente desde la Papelera.");
  await backend.remove(path);
}

export async function emptyTrash(): Promise<number> {
  const items = await backend.list(TRASH);
  for (const it of items) await backend.remove(join(TRASH, it.name));
  return items.length;
}

export async function duplicateDesign(path: string): Promise<string> {
  const d = await readDesign(path);
  const target = await uniquePath(parentOf(path), designTitle(path) + " copia", EXT);
  const now = Date.now();
  await writeDesign(target, { ...d, id: crypto.randomUUID(), name: designTitle(target), createdAt: now, updatedAt: now });
  return target;
}
