import { useEffect } from "react";
import { Home } from "./components/Home";
import { SettingsDialog } from "./components/SettingsDialog";
import { Studio } from "./components/Studio";
import { useUpdates } from "./lib/updates";
import { useStore } from "./store";

export default function App() {
  const view = useStore((s) => s.view);
  const checkAi = useStore((s) => s.checkAi);

  useEffect(() => {
    // Actualizaciones: al abrir y cada 6 h, sin molestar si no hay conexión.
    const check = () => void useUpdates.getState().checkNow(true);
    const first = setTimeout(check, 3000);
    const every = setInterval(check, 6 * 60 * 60 * 1000);
    return () => (clearTimeout(first), clearInterval(every));
  }, []);

  useEffect(() => {
    void checkAi();
    const t = setInterval(() => {
      const s = useStore.getState();
      if (s.aiStatus !== "online" && s.settings.provider === "local") void s.checkAi();
    }, 15000);
    const onUnload = () => void useStore.getState().saveNow();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [checkAi]);

  return (
    <div className="h-full">
      {view === "home" ? <Home /> : <Studio />}
      <SettingsDialog />
    </div>
  );
}
