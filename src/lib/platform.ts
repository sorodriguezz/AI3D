import { invoke } from "@tauri-apps/api/core";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

export interface SystemInfo {
  os: string;
  arch: string;
  totalMemoryGb: number;
  cpuCount: number;
  cpuBrand: string;
}

/** En navegador (modo desarrollo sin Tauri) se aproxima con lo que expone la web. */
export async function getSystemInfo(): Promise<SystemInfo> {
  if (isTauri()) return invoke<SystemInfo>("system_info");
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    os: isMac() ? "macos" : /Win/i.test(navigator.userAgent) ? "windows" : "linux",
    arch: "desconocida",
    totalMemoryGb: nav.deviceMemory ?? 8,
    cpuCount: navigator.hardwareConcurrency ?? 4,
    cpuBrand: "",
  };
}

/** Guarda un archivo: diálogo nativo en Tauri, descarga en navegador. */
export async function saveFile(data: Uint8Array, defaultName: string, filterName: string, ext: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
    if (!path) return null;
    await writeFile(path, data);
    return path;
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}

/** Confirmación nativa (diálogo del sistema en la app de escritorio). */
export async function confirmDialog(message: string, title = "AI3D"): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel: "Eliminar", cancelLabel: "Cancelar" });
  }
  return window.confirm(message);
}
