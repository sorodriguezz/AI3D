import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { useStore } from "../store";
import { isTauri } from "./platform";

// Actualizaciones: la app lee latest.json de la última Release de GitHub, descarga el paquete
// de su sistema, verifica la firma ed25519 y se reinicia.

type Phase = "idle" | "checking" | "available" | "none" | "downloading" | "installing" | "error";

interface UpdateState {
  current: string;
  phase: Phase;
  update: Update | null;
  downloaded: number;
  total: number;
  bytesPerSec: number;
  etaSeconds: number | null;
  error: string | null;
  checkNow: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

export const RELEASES_URL = "https://github.com/sorodriguezz/AI3D/releases/latest";

export const useUpdates = create<UpdateState>((set, get) => ({
  current: "",
  phase: "idle",
  update: null,
  downloaded: 0,
  total: 0,
  bytesPerSec: 0,
  etaSeconds: null,
  error: null,

  checkNow: async (silent = false) => {
    if (!isTauri()) return;
    const busy = get().phase;
    if (busy === "downloading" || busy === "installing") return;
    set({ phase: "checking", error: null, current: await getVersion() });
    try {
      const update = await check();
      set({ update, phase: update ? "available" : "none" });
    } catch (e) {
      // Sin releases todavía o sin conexión: la comprobación automática no molesta.
      console.warn("update check failed", e);
      set({ phase: silent ? "idle" : "error", error: updateError(e) });
    }
  },

  install: async () => {
    const { update } = get();
    if (!update) return;
    set({ phase: "downloading", downloaded: 0, total: 0, etaSeconds: null, error: null });
    let windowStart = performance.now();
    let windowBytes = 0;
    let ema = 0;
    try {
      await update.download((ev) => {
        if (ev.event === "Started") set({ total: ev.data.contentLength ?? 0 });
        else if (ev.event === "Progress") {
          windowBytes += ev.data.chunkLength;
          const downloaded = get().downloaded + ev.data.chunkLength;
          const dt = (performance.now() - windowStart) / 1000;
          if (dt >= 1) {
            const inst = windowBytes / dt;
            ema = ema ? 0.8 * ema + 0.2 * inst : inst;
            windowStart = performance.now();
            windowBytes = 0;
          }
          const total = get().total;
          set({ downloaded, bytesPerSec: ema, etaSeconds: ema && total ? (total - downloaded) / ema : null });
        }
      });
      // No se pierde trabajo: se espera a la IA y se guarda el diseño abierto antes de reemplazar la app.
      while (useStore.getState().analyzing) await new Promise((r) => setTimeout(r, 1000));
      await useStore.getState().saveNow();
      set({ phase: "installing" });
      await update.install();
      await relaunch();
    } catch (e) {
      console.warn("update install failed", e);
      set({ phase: "error", error: updateError(e) });
    }
  },
}));

/** Traduce los errores del plugin a algo accionable. */
function updateError(e: unknown): string {
  const msg = String(e).toLowerCase();
  // Cada plataforma se publica al terminar su compilación: durante unos minutos latest.json puede no incluir este sistema.
  if (msg.includes("platform") || msg.includes("404")) return "La nueva versión aún se está publicando para tu sistema. Vuelve a intentarlo en unos minutos.";
  if (msg.includes("signature")) return "La firma de la actualización no es válida; no se instaló por seguridad.";
  if (/network|dns|connect|timed? ?out|sending request|offline/.test(msg)) return "Sin conexión con GitHub. Revisa tu internet.";
  return "No se pudo actualizar. Puedes descargar la última versión manualmente.";
}

export const formatBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
export const formatEta = (s: number | null) => (s == null ? "" : s < 60 ? `${Math.ceil(s)} s` : `${Math.ceil(s / 60)} min`);
