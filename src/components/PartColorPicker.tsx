import { useEffect, useId, useRef, useState } from "react";
import type { Part } from "../cad/types";
import { PART_COLORS } from "../studio/parts";
import { useStore } from "../store";
import { cx } from "./ui";

const SWATCHES = [...PART_COLORS, "#ffffff", "#111827", "#6b7280", "#ef4444", "#991b1b", "#f97316", "#fde047", "#166534", "#14b8a6", "#06b6d4", "#1d4ed8", "#1e3a8a", "#7c3aed", "#d946ef", "#92400e", "#f5deb3"];

function hexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return "#" + hex.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) return "#" + [...hex].map((c) => c + c).join("").toLowerCase();
  return null;
}

export function PartColorPicker({ part }: { part: Part }) {
  const [draft, setDraft] = useState(part.color);
  const [invalid, setInvalid] = useState(false);
  const changing = useRef(false);
  const errorId = useId();
  useEffect(() => { setDraft(part.color); setInvalid(false); }, [part.color]);

  const choose = (color: string, history = true) => {
    const state = useStore.getState();
    const current = state.doc?.parts.find((p) => p.id === part.id);
    if (!current || current.color.toLowerCase() === color) return;
    state.updatePart(part.id, { color }, history);
    // The combined preview uses one material; show the individual pieces so
    // the chosen color is immediately visible.
    state.setShowResult(false);
  };
  const commit = (value: string) => {
    const color = hexColor(value);
    setInvalid(!color);
    if (!color) return;
    setDraft(color);
    choose(color);
  };

  return (
    <div className="mx-4 mt-3 space-y-2">
      <div className="text-[11.5px] font-medium text-muted">Color de la pieza</div>
      <div className="grid grid-cols-8 gap-1.5">
        {SWATCHES.map((color) => <button key={color} type="button" aria-label={`Color ${color}`} aria-pressed={part.color.toLowerCase() === color}
          title={color.toUpperCase()} onClick={() => choose(color)}
          className={cx("size-6 justify-self-center rounded-full border-2 cursor-pointer transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", part.color.toLowerCase() === color ? "border-fg" : "border-line")}
          style={{ background: color }} />)}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 p-2">
        <input type="color" aria-label="Elegir color personalizado" title="Abrir selector de color" value={hexColor(part.color) ?? "#c8f031"}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-0.5"
          onPointerDown={() => { changing.current = false; }} onFocus={() => { changing.current = false; }} onBlur={() => { changing.current = false; }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") changing.current = false; }}
          onChange={(e) => {
            const color = e.target.value.toLowerCase();
            const current = useStore.getState().doc?.parts.find((p) => p.id === part.id)?.color;
            if (current?.toLowerCase() === color) return;
            choose(color, !changing.current);
            changing.current = true;
          }} />
        <label className="min-w-0 flex-1">
          <span className="mb-0.5 block text-[10.5px] text-faint">Personalizado · HEX</span>
          <input type="text" aria-label="Código HEX del color" aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
            value={draft} maxLength={7} spellCheck={false} autoComplete="off" placeholder="#2563EB"
            className={cx("h-6 w-full min-w-0 rounded border bg-surface px-1.5 font-mono text-[12px] text-fg outline-none", invalid ? "border-err" : "border-line focus:border-line-strong")}
            onChange={(e) => { setDraft(e.target.value); setInvalid(false); }} onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value); }
              if (e.key === "Escape") { e.preventDefault(); setDraft(part.color); setInvalid(false); }
            }} />
        </label>
      </div>
      {invalid && <p id={errorId} role="alert" className="text-[11px] text-err">Usa un color HEX válido, como #2563EB o #ABC.</p>}
    </div>
  );
}
