import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "../lib/platform";

// Dos formas de usar un modelo:
// · Local: servidor compatible con OpenAI en localhost (llama.cpp, Ollama, LM Studio).
// · Suscripción: el CLI oficial con tu sesión iniciada (Claude Code, Codex CLI, Gemini CLI).

export type CliId = "claude" | "codex" | "gemini";
export type ProviderId = "local" | CliId;

export interface AiSettings {
  provider: ProviderId;
  baseUrl: string;
  localModel: string;
  cliModel: Record<CliId, string>;
}

export const PROVIDERS: { id: ProviderId; name: string; plan: string; login: string; install: string }[] = [
  { id: "local", name: "Modelo local", plan: "Gratis, sin conexión", login: "", install: "" },
  { id: "claude", name: "Claude Code", plan: "Suscripción Claude Pro / Max", login: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" },
  { id: "codex", name: "Codex CLI", plan: "Suscripción ChatGPT Plus / Pro", login: "codex login", install: "npm install -g @openai/codex" },
  { id: "gemini", name: "Gemini CLI", plan: "Cuenta de Google (Gemini)", login: "gemini", install: "npm install -g @google/gemini-cli" },
];

/**
 * Modelos por CLI. Vacío = el predeterminado de tu plan.
 * En Claude Code, «opus», «sonnet» y «haiku» son alias que siempre apuntan a la versión más reciente;
 * los identificadores completos fijan una versión concreta.
 */
export const CLI_MODELS: Record<CliId, { value: string; label: string; group?: string }[]> = {
  claude: [
    { value: "", label: "Predeterminado de tu plan" },
    { value: "opus", label: "Opus · siempre el último (hoy 5.5)", group: "Siempre la última versión" },
    { value: "sonnet", label: "Sonnet · siempre el último (hoy 5.5)", group: "Siempre la última versión" },
    { value: "haiku", label: "Haiku · siempre el último (hoy 5.5)", group: "Siempre la última versión" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5 — más capaz", group: "Versión fija" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — equilibrado", group: "Versión fija" },
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 — rápido", group: "Versión fija" },
  ],
  codex: [{ value: "", label: "Predeterminado de tu plan" }],
  gemini: [{ value: "", label: "Predeterminado de tu cuenta" }],
};

export interface CliInfo {
  id: CliId;
  installed: boolean;
  path: string | null;
  version: string | null;
}

export async function cliStatus(): Promise<CliInfo[]> {
  if (!isTauri()) return (["claude", "codex", "gemini"] as CliId[]).map((id) => ({ id, installed: false, path: null, version: null }));
  return invoke<CliInfo[]>("cli_status");
}

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: Content;
}

const doFetch: typeof fetch = (input, init) => (isTauri() ? tauriFetch(input, init) : fetch(input, init));
const root = (url: string) => url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");

function assertLocal(url: string) {
  const host = new URL(root(url)).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) throw new Error("El modo local solo se conecta a servidores en localhost.");
}

export async function listModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  assertLocal(baseUrl);
  const res = await doFetch(`${root(baseUrl)}/v1/models`, { signal });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  const json = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; model?: string }[] };
  if (json.data) return json.data.map((m) => m.id);
  return (json.models ?? []).map((m) => m.model ?? m.name ?? "").filter(Boolean);
}

async function chatLocal(s: AiSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  assertLocal(s.baseUrl);
  const body: Record<string, unknown> = { model: s.localModel || undefined, messages, temperature: 0.2, max_tokens: 4096, stream: false, response_format: { type: "json_object" } };
  const send = () => doFetch(`${root(s.baseUrl)}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  let res = await send();
  if (!res.ok && res.status === 400) {
    delete body.response_format; // algunos servidores no lo aceptan
    res = await send();
  }
  if (!res.ok) throw new Error(`El modelo local respondió ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Una consulta de una sola vuelta. `image` es una data URL JPEG.
 * Devuelve el texto de la respuesta y avisos (por ejemplo, si se descartó la imagen).
 */
export async function complete(s: AiSettings, system: string, user: string, image: string | null, signal?: AbortSignal): Promise<{ text: string; warnings: string[] }> {
  if (s.provider !== "local") {
    if (!isTauri()) throw new Error("Las suscripciones por CLI solo funcionan en la app de escritorio.");
    const run = invoke<string>("cli_run", {
      provider: s.provider,
      system,
      prompt: user,
      imageJpegBase64: image ? image.split(",")[1] : null,
      model: s.cliModel[s.provider] || null,
    });
    // El proceso no se puede interrumpir desde aquí; al cancelar solo se ignora su respuesta.
    const aborted = new Promise<never>((_, rej) => signal?.addEventListener("abort", () => rej(new DOMException("Cancelado", "AbortError"))));
    return { text: await Promise.race([run, aborted]), warnings: [] };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user },
  ];
  try {
    return { text: await chatLocal(s, messages, signal), warnings: [] };
  } catch (e) {
    if (!image || signal?.aborted || !/image|vision|multimodal|mmproj/i.test(String(e))) throw e;
    const text = await chatLocal(s, [messages[0], { role: "user", content: user }], signal);
    return { text, warnings: ["El modelo local no acepta imágenes; se analizó solo el texto."] };
  }
}

/** Extrae el primer objeto JSON de una respuesta que puede venir con texto o bloques ```json. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("El modelo no devolvió un JSON válido.");
  }
}
