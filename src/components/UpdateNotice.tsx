import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { RELEASES_URL, formatBytes, formatEta, useUpdates } from "../lib/updates";
import { Button, cx } from "./ui";

async function openReleases() {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(RELEASES_URL);
}

/** Aviso compacto para la barra lateral de inicio. Solo aparece si hay algo que hacer. */
export function UpdateNotice() {
  const { phase, update, downloaded, total, bytesPerSec, etaSeconds, error, install, checkNow } = useUpdates();
  if (phase === "available" && update)
    return (
      <div className="rounded-xl border border-accent/40 bg-accent-soft p-3">
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
          <ArrowUpCircle size={15} className="text-accent-text" /> AI3D {update.version} disponible
        </div>
        {update.body && <div className="mt-1 line-clamp-3 text-[11.5px] text-muted">{update.body}</div>}
        <Button variant="primary" size="sm" className="mt-2 w-full" onClick={() => void install()}>
          Actualizar y reiniciar
        </Button>
      </div>
    );
  if (phase === "downloading" || phase === "installing") {
    const pct = total ? Math.min(100, (downloaded / total) * 100) : 0;
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2 text-[12px] text-fg">
          <Loader2 size={13} className="animate-spin" /> {phase === "installing" ? "Instalando…" : "Descargando actualización"}
        </div>
        {phase === "downloading" && (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-faint">
              <span>{total ? `${formatBytes(downloaded)} de ${formatBytes(total)}` : formatBytes(downloaded)}</span>
              <span>{bytesPerSec ? `${formatBytes(bytesPerSec)}/s · ${formatEta(etaSeconds)}` : ""}</span>
            </div>
          </>
        )}
      </div>
    );
  }
  if (phase === "error" && error)
    return (
      <div className="rounded-xl border border-warn/30 bg-warn/8 p-3 text-[11.5px] text-muted">
        {error}
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" onClick={() => void checkNow()}>
            <RefreshCw size={12} /> Reintentar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void openReleases()}>
            Descargar
          </Button>
        </div>
      </div>
    );
  return null;
}

/** Sección «Versión» de Ajustes: versión instalada y comprobación manual. */
export function VersionSection() {
  const { current, phase, update, checkNow } = useUpdates();
  return (
    <section className="space-y-2">
      <div className="text-[13px] font-medium">Versión</div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[12.5px] text-fg">AI3D {current || "—"}</span>
        <span className={cx("text-[12px]", phase === "none" ? "text-ok" : "text-muted")}>
          {phase === "checking" ? "Buscando…" : phase === "none" ? "Tienes la última versión" : phase === "available" && update ? `Nueva versión ${update.version} disponible` : ""}
        </span>
        <div className="flex-1" />
        <Button size="sm" disabled={phase === "checking" || phase === "downloading" || phase === "installing"} onClick={() => void checkNow()}>
          <RefreshCw size={12} className={phase === "checking" ? "animate-spin" : ""} /> Buscar actualizaciones
        </Button>
      </div>
      <UpdateNotice />
    </section>
  );
}
