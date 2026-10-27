import { PRIMITIVES, SHAPES, TEMPLATES, getTemplate, sanitizeParams } from "../cad/templates";
import type { ParamDef, Part, TemplateMeta, Vec3 } from "../cad/types";
import { newPart } from "../studio/parts";
import { complete, extractJson, type AiSettings } from "./llm";

// Agente de diseño. El modelo NO escribe código ni geometría libre:
// compone una escena con piezas del catálogo (formas básicas y componentes paramétricos),
// cada una con medidas, posición, rotación y modo sólido/agujero. AI3D valida y acota todo.

export interface Proposal {
  id: string;
  title: string;
  mechanism: string;
  rationale: string;
  pros: string[];
  cons: string[];
  parts: Part[];
}

export interface AgentResult {
  source: "model" | "heuristic";
  scene: string;
  objective: string;
  proposals: Proposal[];
  questions: { part: string; param: string; question: string }[];
  warnings: string[];
}

export interface AgentInput {
  prompt: string;
  image?: string | null;
  mark?: { x: number; y: number } | null;
  current: Part[];
  /** Medidas actuales (mm) de cada pieza por nombre, para que la IA conozca el tamaño de modelos importados. */
  sizes?: Record<string, number[]>;
}

const MAX_PARTS = 60;

function describeParam(d: ParamDef): string {
  const crit = d.critical ? " [CRÍTICA]" : "";
  if (d.type === "bool") return `${d.key}: booleano (def. ${d.default})${crit}`;
  if (d.type === "enum") return `${d.key}: ${d.options.map((o) => `"${o.value}"`).join("|")} (def. "${d.default}")${crit}`;
  return `${d.key}: ${d.type === "int" ? "entero" : "número"} ${d.min}–${d.max}${d.unit ? " " + d.unit : ""} (def. ${d.default}) — ${d.label}${crit}`;
}

const describeShape = (t: TemplateMeta) => `- ${t.id} (${t.name}): ${t.description}\n    ${t.params.map(describeParam).join("\n    ")}`;

export const agentSystemPrompt = () => `Eres el agente de diseño de AI3D, un estudio de modelado 3D para impresión FDM.
Diseñas piezas funcionales componiendo una ESCENA de piezas del catálogo. No escribes código.

Convenciones:
- Unidades en milímetros. Z hacia arriba. La cama de impresión es el plano Z = 0.
- El origen de cada pieza es el centro de su base. "position" [x,y,z] coloca ese origen.
- "rotation" [rx,ry,rz] en grados, aplicada sobre el origen de la pieza: primero X, luego Y, luego Z.
- "mode": "solid" suma material; "hole" resta material de todas las piezas sólidas (agujeros, ranuras, rebajes).
- El resultado final es la unión de los sólidos menos la unión de los agujeros. Haz que los sólidos se solapen al menos 0,5 mm para que queden unidos.
- Para agujeros pasantes, haz la pieza hueca 1–2 mm más larga que el material que atraviesa.
- Paredes de al menos 1,6 mm. Holguras de 0,2–0,6 mm para encajes.

Catálogo — formas básicas:
${PRIMITIVES.map(describeShape).join("\n")}

Catálogo — componentes paramétricos (piezas completas ya resueltas):
${TEMPLATES.map(describeShape).join("\n")}

Modelos importados (tipo "imported"): vienen de archivos del usuario. No puedes crear nuevos; si están en la escena actual,
consérvalos con el mismo "name" y modifícalos solo con "scale" (porcentaje), "position", "rotation" o "mode". Para recortarlos o ampliarlos,
añade formas básicas como "hole" o "solid" alrededor. Su campo "size" indica sus medidas actuales en mm (X, Y, Z).

Reglas:
1. Usa solo tipos y claves del catálogo.
2. Propón de 1 a 3 alternativas que difieran en el mecanismo o el enfoque, de mejor a peor.
3. Cada propuesta es la ESCENA COMPLETA resultante. Si el usuario pide modificar la escena actual, conserva las piezas que no cambian (mismo "name") y aplica solo lo pedido.
4. Nombra cada pieza de forma descriptiva y única ("Base", "Ranura borrador", "Agujero tornillo 1").
5. Una foto no revela espesores ni medidas ocultas. Lo que sea suposición va en "estimated" como "Nombre de pieza.clave", y pregunta por lo crítico en "questions".
6. Advierte en "warnings" sobre cargas, voladizos o superficies inadecuadas.
7. Responde en español y SOLO con un objeto JSON:
{
  "scene": "qué ves en la foto (vacío si no hay foto)",
  "objective": "qué pieza necesita el usuario",
  "proposals": [
    {
      "title": "nombre corto", "mechanism": "cómo funciona o se sujeta", "rationale": "por qué sirve",
      "pros": ["..."], "cons": ["..."],
      "parts": [ { "name": "Base", "type": "box", "params": { "width": 60 }, "position": [0,0,0], "rotation": [0,0,0], "mode": "solid" } ],
      "estimated": ["Base.width"]
    }
  ],
  "questions": [ { "part": "Base", "param": "width", "question": "¿Cuánto mide...?" } ],
  "warnings": ["..."]
}`;

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);
const strList = (v: unknown, max = 6) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : []);
const clamp = (v: unknown, lim: number) => {
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(x) ? Math.max(-lim, Math.min(lim, +x.toFixed(3))) : 0;
};
const vec = (v: unknown, lim: number): Vec3 => (Array.isArray(v) ? [clamp(v[0], lim), clamp(v[1], lim), clamp(v[2], lim)] : [0, 0, 0]);

function scenePartsFromModel(raw: unknown, estimated: string[], current: Part[]): Part[] {
  const items = Array.isArray(raw) ? raw.slice(0, MAX_PARTS) : [];
  const parts: Part[] = [];
  const usedNames = new Set<string>();
  for (const it of items) {
    const r = (it ?? {}) as Record<string, unknown>;
    const t = getTemplate(str(r.type));
    if (!t) continue;
    let name = str(r.name, t.name).slice(0, 48) || t.name;
    for (let i = 2; usedNames.has(name); i++) name = `${str(r.name, t.name)} ${i}`;
    usedNames.add(name);
    const prev = current.find((p) => p.name === name && p.type === t.id);
    // Los modelos importados no se pueden crear desde la IA: solo se conservan y transforman.
    if (t.id === "imported" && !prev) continue;
    const params = sanitizeParams(t, (r.params && typeof r.params === "object" ? r.params : {}) as Record<string, unknown>, prev?.params);
    const part = newPart(t.id, {
      name,
      params,
      position: vec(r.position, 2000),
      rotation: vec(r.rotation, 360),
      mode: r.mode === "hole" ? "hole" : "solid",
      ...(prev ? { id: prev.id, color: prev.color } : {}),
    });
    const keys = new Set(t.params.map((d) => d.key));
    const fromAi = estimated.filter((e) => e.startsWith(name + ".")).map((e) => e.slice(name.length + 1)).filter((k) => keys.has(k));
    part.estimated = [...new Set([...((prev ? prev.estimated : part.estimated) ?? []), ...fromAi])];
    parts.push(part);
  }
  return parts;
}

export function sanitizeResult(raw: unknown, current: Part[]): AgentResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const proposals: Proposal[] = [];
  for (const [i, item] of (Array.isArray(r.proposals) ? r.proposals : []).slice(0, 3).entries()) {
    const p = (item ?? {}) as Record<string, unknown>;
    const parts = scenePartsFromModel(p.parts, strList(p.estimated, 100), current);
    if (parts.length === 0) continue;
    proposals.push({ id: `m${Date.now()}-${i}`, title: str(p.title, `Propuesta ${i + 1}`), mechanism: str(p.mechanism), rationale: str(p.rationale), pros: strList(p.pros), cons: strList(p.cons), parts });
  }
  const questions = (Array.isArray(r.questions) ? r.questions : [])
    .map((q) => (q ?? {}) as Record<string, unknown>)
    .map((q) => ({ part: str(q.part), param: str(q.param), question: str(q.question) }))
    .filter((q) => q.question)
    .slice(0, 8);
  return { source: "model", scene: str(r.scene), objective: str(r.objective), proposals, questions, warnings: strList(r.warnings) };
}

function sceneForPrompt(parts: Part[], sizes?: Record<string, number[]>): string {
  if (parts.length === 0) return "La escena actual está vacía.";
  const slim = parts.map(({ name, type, params, position, rotation, mode }) => {
    if (type !== "imported") return { name, type, params, position, rotation, mode };
    const { asset: _a, format: _f, ...visible } = params;
    return { name, type, params: visible, position, rotation, mode, ...(sizes?.[name] ? { size: sizes[name] } : {}) };
  });
  return "Escena actual:\n" + JSON.stringify(slim);
}

export async function runAgent(settings: AiSettings, input: AgentInput, signal?: AbortSignal): Promise<AgentResult> {
  const mark = input.mark ? `\nEl usuario marcó en la foto la ubicación deseada con un círculo rojo (≈${Math.round(input.mark.x * 100)}% desde la izquierda, ${Math.round(input.mark.y * 100)}% desde arriba).` : "";
  const user = `${sceneForPrompt(input.current, input.sizes)}\n\nPetición del usuario: «${input.prompt.trim() || "Diseña una pieza útil para esta escena."}»${mark}`;
  const { text, warnings } = await complete(settings, agentSystemPrompt(), user, input.image ?? null, signal);
  const result = sanitizeResult(extractJson(text), input.current);
  result.warnings.unshift(...warnings);
  if (result.proposals.length === 0) throw new Error("El modelo no propuso ninguna pieza válida del catálogo. Reformula la petición o prueba otro modelo.");
  return result;
}

// ---------------------------------------------------------------------------
// Sin modelo configurado: reglas locales para elegir un componente del catálogo.

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };

function countBefore(text: string, nouns: string[]): number | undefined {
  const m = text.match(new RegExp(`(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:\\w+\\s+)?(?:${nouns.join("|")})`));
  return m ? (NUMBER_WORDS[m[1]] ?? parseInt(m[1], 10)) : undefined;
}

export function heuristicAgent(input: AgentInput): AgentResult {
  const text = normalize(input.prompt);
  const ranked = SHAPES.map((t) => ({ t, s: t.keywords.reduce((s, k) => s + (new RegExp(`\\b${normalize(k)}`).test(text) ? 1 : 0), 0) })).sort((a, b) => b.s - a.s);
  if (ranked[0].s === 0)
    return {
      source: "heuristic",
      scene: "",
      objective: "",
      proposals: [],
      questions: [],
      warnings: ["Sin un modelo conectado solo reconozco piezas del catálogo por palabras clave. Conecta tu suscripción o un modelo local en Ajustes para diseñar cualquier pieza."],
    };
  const t = ranked[0].t;
  const overrides: Record<string, unknown> = {};
  const mm = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*mm/g)].map((m) => parseFloat(m[1].replace(",", ".")));
  if (t.id === "marker-holder") {
    const markers = countBefore(text, ["plumon", "marcador", "lapi", "rotulador", "boligrafo"]);
    if (markers !== undefined) overrides.markerCount = markers;
    overrides.eraser = /sin borrador/.test(text) ? false : /borrador/.test(text) || markers === undefined;
  }
  if (t.id === "pipe-clip" && mm[0]) overrides.pipeDiameter = mm[0];
  const base = sanitizeParams(t, overrides);
  const critical = t.params.filter((d) => d.critical).map((d) => d.key);
  const mount = t.params.find((d) => d.key === "mount");
  const variants = mount && mount.type === "enum" ? mount.options.map((o) => ({ label: o.label, desc: o.description ?? "", params: { ...base, mount: o.value } })) : [{ label: t.name, desc: t.description, params: base }];
  return {
    source: "heuristic",
    scene: "",
    objective: t.name,
    proposals: variants.map((v, i) => ({
      id: `h${Date.now()}-${i}`,
      title: mount ? `${t.name} · ${v.label}` : t.name,
      mechanism: v.desc,
      rationale: "Elegido por palabras clave de tu petición.",
      pros: [],
      cons: [],
      parts: [{ ...newPart(t.id, { name: t.name, params: v.params }), estimated: critical }],
    })),
    questions: t.params.filter((d) => d.critical && !(d.key in overrides)).map((d) => ({ part: t.name, param: d.key, question: `¿Cuánto mide ${d.label.toLowerCase()}?${d.hint ? " " + d.hint : ""}` })),
    warnings: ["Sin modelo conectado: propuestas con reglas locales. Conecta tu suscripción (Claude, ChatGPT o Gemini) en Ajustes para diseñar libremente."],
  };
}
