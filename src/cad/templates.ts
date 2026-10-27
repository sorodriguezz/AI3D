import type { Check, ParamDef, Params, TemplateMeta } from "./types";

// Metadatos de las plantillas. No importa replicad: se usa en la UI y en el agente.
// La geometría vive en ./builders.ts y solo se ejecuta dentro del worker CAD.

const n = (p: Params, k: string) => Number(p[k]);

function wallChecks(wall: number, label = "Pared"): Check[] {
  if (wall < 1.2) return [{ level: "error", title: `${label} demasiado delgada`, detail: `${wall} mm es menos que 3 perímetros con boquilla 0,4 mm.` }];
  if (wall < 1.6) return [{ level: "warn", title: `${label} justa`, detail: "Con menos de 1,6 mm la pieza puede quebrarse con carga lateral." }];
  return [{ level: "ok", title: `${label} de ${wall} mm` }];
}

function clearanceCheck(c: number): Check {
  if (c < 0.2) return { level: "warn", title: "Holgura muy ajustada", detail: "Por debajo de 0,2 mm las piezas suelen no entrar. Imprime una prueba." };
  if (c > 1.2) return { level: "warn", title: "Holgura amplia", detail: "Los objetos quedarán sueltos." };
  return { level: "ok", title: `Holgura de ${c} mm` };
}

const mountParam = (options: ("clip" | "adhesive" | "screw")[], def: string): ParamDef => ({
  key: "mount",
  label: "Mecanismo de montaje",
  type: "enum",
  group: "Montaje",
  default: def,
  options: [
    { value: "clip", label: "Clip de borde", description: "Se engancha al marco sin perforarlo." },
    { value: "adhesive", label: "Adhesivo", description: "Placa trasera para cinta doble faz (VHB)." },
    { value: "screw", label: "Atornillado", description: "Placa con agujeros y rebaje para la cabeza del tornillo." },
  ].filter((o) => options.includes(o.value as never)),
});

const screwParams: ParamDef[] = [
  { key: "screwDiameter", label: "Diámetro del tornillo", type: "number", min: 2, max: 6, step: 0.5, unit: "mm", default: 4, group: "Montaje", critical: true, visibleIf: (p) => p.mount === "screw" },
];

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "marker-holder",
    name: "Soporte para plumones y borrador",
    category: "Organización",
    description: "Bandeja con alojamientos cilíndricos para plumones y uno rectangular para el borrador. Se monta con clip al marco, adhesivo o tornillos.",
    keywords: ["plumon", "plumones", "marcador", "marcadores", "borrador", "pizarra", "pizarron", "lapiz", "lapices", "boligrafo", "rotulador", "whiteboard", "tiza"],
    printHint: "Imprime de espaldas (placa trasera sobre la cama) para que el clip no necesite soportes.",
    params: [
      mountParam(["clip", "adhesive", "screw"], "clip"),
      { key: "markerCount", label: "Cantidad de plumones", type: "int", min: 0, max: 8, step: 1, unit: "", default: 2, group: "Contenido" },
      { key: "markerDiameter", label: "Diámetro del plumón", type: "number", min: 8, max: 30, step: 0.5, unit: "mm", default: 18, group: "Contenido", critical: true, hint: "Mide el cuerpo más ancho, incluida la tapa." },
      { key: "eraser", label: "Incluir borrador", type: "bool", default: true, group: "Contenido" },
      { key: "eraserWidth", label: "Largo del borrador", type: "number", min: 20, max: 160, step: 1, unit: "mm", default: 50, group: "Contenido", critical: true, visibleIf: (p) => !!p.eraser },
      { key: "eraserDepth", label: "Ancho del borrador", type: "number", min: 15, max: 70, step: 1, unit: "mm", default: 30, group: "Contenido", critical: true, visibleIf: (p) => !!p.eraser },
      { key: "trayHeight", label: "Altura de la bandeja", type: "number", min: 15, max: 90, step: 1, unit: "mm", default: 35, group: "Forma" },
      { key: "wall", label: "Grosor de pared", type: "number", min: 1.2, max: 5, step: 0.1, unit: "mm", default: 2.4, group: "Forma" },
      { key: "clearance", label: "Holgura", type: "number", min: 0.1, max: 2, step: 0.05, unit: "mm", default: 0.6, group: "Forma" },
      { key: "frameThickness", label: "Grosor del marco", type: "number", min: 4, max: 45, step: 0.5, unit: "mm", default: 18, group: "Montaje", critical: true, hint: "Distancia de adelante hacia atrás del borde donde se engancha.", visibleIf: (p) => p.mount === "clip" },
      { key: "hookDepth", label: "Profundidad del gancho trasero", type: "number", min: 4, max: 40, step: 0.5, unit: "mm", default: 12, group: "Montaje", visibleIf: (p) => p.mount === "clip" },
      { key: "clipRise", label: "Separación bajo el borde", type: "number", min: 0, max: 60, step: 1, unit: "mm", default: 8, group: "Montaje", hint: "Distancia entre el tope de la bandeja y el borde superior del marco.", visibleIf: (p) => p.mount === "clip" },
      { key: "plateExtra", label: "Placa extra para adhesivo", type: "number", min: 0, max: 60, step: 1, unit: "mm", default: 12, group: "Montaje", visibleIf: (p) => p.mount === "adhesive" },
      ...screwParams,
    ],
    checks: (p) => {
      const out: Check[] = [...wallChecks(n(p, "wall")), clearanceCheck(n(p, "clearance"))];
      if (n(p, "markerCount") === 0 && !p.eraser) out.push({ level: "error", title: "La bandeja está vacía", detail: "Agrega al menos un plumón o el borrador." });
      if (p.mount === "clip") {
        if (n(p, "hookDepth") < 6) out.push({ level: "warn", title: "Gancho corto", detail: "Con menos de 6 mm el clip puede soltarse al sacar un plumón." });
        out.push({ level: "warn", title: "Verifica el marco", detail: "El clip necesita una pestaña accesible detrás del marco." });
      }
      if (p.mount === "adhesive") {
        const area = (n(p, "trayHeight") + n(p, "plateExtra")) * 40;
        out.push(area < 1500 ? { level: "warn", title: "Poca superficie adhesiva", detail: "Aumenta la placa extra para repartir el peso." } : { level: "ok", title: "Superficie adhesiva suficiente" });
      }
      return out;
    },
  },
  {
    id: "wall-hook",
    name: "Gancho de pared",
    category: "Colgar",
    description: "Placa trasera con brazo y punta elevada para colgar llaves, audífonos, bolsos o herramientas.",
    keywords: ["gancho", "colgar", "colgador", "llaves", "audifonos", "bolso", "toalla", "perchero", "percha", "chaqueta"],
    printHint: "Imprime de lado (perfil sobre la cama) para que las capas no queden en la dirección de la carga.",
    params: [
      mountParam(["adhesive", "screw"], "screw"),
      { key: "plateWidth", label: "Ancho de la placa", type: "number", min: 12, max: 100, step: 1, unit: "mm", default: 30, group: "Forma" },
      { key: "plateHeight", label: "Alto de la placa", type: "number", min: 25, max: 150, step: 1, unit: "mm", default: 60, group: "Forma" },
      { key: "plateThickness", label: "Grosor de la placa", type: "number", min: 2, max: 10, step: 0.5, unit: "mm", default: 4, group: "Forma" },
      { key: "hookReach", label: "Alcance del brazo", type: "number", min: 10, max: 100, step: 1, unit: "mm", default: 32, group: "Gancho", critical: true, hint: "Debe superar el grosor de lo que vas a colgar." },
      { key: "hookRise", label: "Altura de la punta", type: "number", min: 4, max: 50, step: 1, unit: "mm", default: 12, group: "Gancho" },
      { key: "armThickness", label: "Grosor del brazo", type: "number", min: 3, max: 20, step: 0.5, unit: "mm", default: 7, group: "Gancho" },
      ...screwParams,
    ],
    checks: (p) => {
      const out = wallChecks(n(p, "armThickness"), "Brazo");
      const ratio = n(p, "hookReach") / n(p, "armThickness");
      if (ratio > 8) out.push({ level: "warn", title: "Brazo esbelto", detail: "El brazo es largo para su grosor; podría doblarse con peso." });
      return out;
    },
  },
  {
    id: "pipe-clip",
    name: "Abrazadera para tubo o cable",
    category: "Fijación",
    description: "Anillo en C a presión sobre una base, para fijar tubos, varillas o cables a una superficie.",
    keywords: ["tubo", "cable", "cables", "abrazadera", "varilla", "manguera", "caneria", "clip", "sujetar", "barra"],
    printHint: "Imprime con la base sobre la cama; el anillo se imprime sin soportes si la apertura mira hacia arriba.",
    params: [
      mountParam(["adhesive", "screw"], "screw"),
      { key: "pipeDiameter", label: "Diámetro del tubo", type: "number", min: 3, max: 80, step: 0.5, unit: "mm", default: 20, group: "Tubo", critical: true },
      { key: "clipWall", label: "Grosor del anillo", type: "number", min: 1.2, max: 8, step: 0.1, unit: "mm", default: 3, group: "Forma" },
      { key: "clipWidth", label: "Ancho de la abrazadera", type: "number", min: 5, max: 60, step: 1, unit: "mm", default: 14, group: "Forma" },
      { key: "opening", label: "Apertura del clip", type: "number", min: 50, max: 95, step: 1, unit: "", default: 78, group: "Tubo", hint: "Porcentaje del diámetro que queda abierto arriba." },
      { key: "clearance", label: "Holgura", type: "number", min: 0, max: 1.5, step: 0.05, unit: "mm", default: 0.3, group: "Tubo" },
      ...screwParams,
    ],
    checks: (p) => {
      const out = [...wallChecks(n(p, "clipWall"), "Anillo"), clearanceCheck(n(p, "clearance"))];
      if (n(p, "opening") > 90) out.push({ level: "warn", title: "Apertura grande", detail: "El tubo podría salirse con facilidad." });
      if (n(p, "opening") < 60) out.push({ level: "warn", title: "Apertura pequeña", detail: "Puede costar insertar el tubo sin romper el anillo." });
      return out;
    },
  },
  {
    id: "l-bracket",
    name: "Escuadra / soporte en L",
    category: "Fijación",
    description: "Escuadra con refuerzos laterales y agujeros para tornillos, para repisas o uniones a 90°.",
    keywords: ["escuadra", "repisa", "estante", "soporte", "angulo", "esquinero", "union", "90", "repisas", "mensula"],
    printHint: "Imprime de lado para que los refuerzos queden en el plano de las capas.",
    params: [
      { key: "legA", label: "Brazo vertical", type: "number", min: 20, max: 200, step: 1, unit: "mm", default: 60, group: "Forma" },
      { key: "legB", label: "Brazo horizontal", type: "number", min: 20, max: 200, step: 1, unit: "mm", default: 60, group: "Forma", critical: true, hint: "Profundidad de la repisa que va a sostener." },
      { key: "width", label: "Ancho", type: "number", min: 12, max: 100, step: 1, unit: "mm", default: 28, group: "Forma" },
      { key: "thickness", label: "Grosor", type: "number", min: 2, max: 15, step: 0.5, unit: "mm", default: 5, group: "Forma" },
      { key: "gusset", label: "Refuerzos laterales", type: "bool", default: true, group: "Forma" },
      { key: "holes", label: "Agujeros por brazo", type: "int", min: 0, max: 4, step: 1, unit: "", default: 2, group: "Montaje" },
      { key: "screwDiameter", label: "Diámetro del tornillo", type: "number", min: 2, max: 8, step: 0.5, unit: "mm", default: 4, group: "Montaje", critical: true },
    ],
    checks: (p) => {
      const out = wallChecks(n(p, "thickness"), "Brazo");
      if (!p.gusset && n(p, "legB") > 80) out.push({ level: "warn", title: "Sin refuerzo", detail: "Con brazos largos conviene activar los refuerzos laterales." });
      if (n(p, "screwDiameter") + 4 > n(p, "width")) out.push({ level: "error", title: "Tornillo más ancho que la escuadra" });
      return out;
    },
  },
  {
    id: "organizer",
    name: "Caja organizadora",
    category: "Organización",
    description: "Caja con esquinas redondeadas y divisiones internas configurables.",
    keywords: ["caja", "organizador", "organizadora", "cajon", "bandeja", "contenedor", "divisiones", "tornillos", "piezas", "gaveta"],
    printHint: "Imprime con la base sobre la cama, sin soportes.",
    params: [
      { key: "length", label: "Largo", type: "number", min: 20, max: 250, step: 1, unit: "mm", default: 120, group: "Forma", critical: true },
      { key: "width", label: "Ancho", type: "number", min: 20, max: 250, step: 1, unit: "mm", default: 80, group: "Forma", critical: true },
      { key: "height", label: "Alto", type: "number", min: 8, max: 150, step: 1, unit: "mm", default: 40, group: "Forma" },
      { key: "wall", label: "Grosor de pared", type: "number", min: 1.2, max: 5, step: 0.1, unit: "mm", default: 2, group: "Forma" },
      { key: "floor", label: "Grosor del fondo", type: "number", min: 0.8, max: 5, step: 0.1, unit: "mm", default: 1.6, group: "Forma" },
      { key: "cornerRadius", label: "Radio de esquinas", type: "number", min: 0, max: 20, step: 0.5, unit: "mm", default: 5, group: "Forma" },
      { key: "divX", label: "Divisiones a lo largo", type: "int", min: 0, max: 8, step: 1, unit: "", default: 2, group: "Divisiones" },
      { key: "divY", label: "Divisiones a lo ancho", type: "int", min: 0, max: 8, step: 1, unit: "", default: 0, group: "Divisiones" },
    ],
    checks: (p) => wallChecks(n(p, "wall")),
  },
];

const dim = (key: string, label: string, def: number, min = 0.5, max = 500, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: "number", min, max, step: 0.5, unit: "mm", default: def, group: "Medidas", ...extra }) as ParamDef;

const noChecks = () => [];

/** Formas básicas para modelar libremente. Su origen está en el centro de la base (Z = 0). */
export const PRIMITIVES: TemplateMeta[] = [
  { id: "box", name: "Caja", category: "Básicas", description: "Prisma rectangular con bordes opcionalmente redondeados.", keywords: ["caja", "cubo", "bloque", "placa"], printHint: "", checks: noChecks,
    params: [dim("width", "Ancho (X)", 20), dim("depth", "Fondo (Y)", 20), dim("height", "Alto (Z)", 20), dim("radius", "Redondeo de bordes", 0, 0, 50)] },
  { id: "cylinder", name: "Cilindro", category: "Básicas", description: "Cilindro vertical.", keywords: ["cilindro", "barra", "disco", "pasador"], printHint: "", checks: noChecks,
    params: [dim("diameter", "Diámetro", 20), dim("height", "Alto", 20)] },
  { id: "tube", name: "Tubo", category: "Básicas", description: "Cilindro hueco.", keywords: ["tubo", "anillo", "buje", "casquillo"], printHint: "", checks: noChecks,
    params: [dim("diameter", "Diámetro exterior", 20, 2), dim("wall", "Pared", 2, 0.4, 100), dim("height", "Alto", 20)] },
  { id: "sphere", name: "Esfera", category: "Básicas", description: "Esfera apoyada sobre la cama.", keywords: ["esfera", "bola", "pomo"], printHint: "", checks: noChecks,
    params: [dim("diameter", "Diámetro", 20)] },
  { id: "cone", name: "Cono", category: "Básicas", description: "Cono o tronco de cono.", keywords: ["cono", "embudo", "punta", "tronco"], printHint: "", checks: noChecks,
    params: [dim("bottomDiameter", "Diámetro inferior", 20), dim("topDiameter", "Diámetro superior", 0, 0), dim("height", "Alto", 20)] },
  { id: "wedge", name: "Cuña", category: "Básicas", description: "Prisma triangular (rampa).", keywords: ["cuña", "rampa", "triangulo", "refuerzo"], printHint: "", checks: noChecks,
    params: [dim("width", "Ancho (X)", 20), dim("depth", "Fondo (Y)", 20), dim("height", "Alto (Z)", 20)] },
  { id: "prism", name: "Prisma poligonal", category: "Básicas", description: "Prisma con base de polígono regular (hexágono por defecto).", keywords: ["hexagono", "prisma", "poligono", "tuerca"], printHint: "", checks: noChecks,
    params: [{ key: "sides", label: "Lados", type: "int", min: 3, max: 12, step: 1, unit: "", default: 6, group: "Medidas" }, dim("diameter", "Diámetro (vértices)", 20), dim("height", "Alto", 10)] },
  { id: "torus", name: "Toroide", category: "Básicas", description: "Anillo de sección circular.", keywords: ["toroide", "dona", "anillo", "aro"], printHint: "", checks: noChecks,
    params: [dim("diameter", "Diámetro exterior", 30, 3), dim("thickness", "Grosor", 6, 1)] },
];

/** Modelo traído de un archivo (STL, 3MF, OBJ, AMF, STEP o SVG). Su geometría se guarda dentro del diseño. */
export const IMPORTED: TemplateMeta = {
  id: "imported",
  name: "Modelo importado",
  category: "Importado",
  description: "Geometría importada de un archivo. Se puede escalar, mover, rotar, usar como agujero y combinar con otras piezas.",
  keywords: [],
  printHint: "",
  checks: noChecks,
  params: [
    { key: "scale", label: "Escala", type: "number", min: 1, max: 2000, step: 1, unit: "", default: 100, group: "Importado", hint: "Porcentaje del tamaño original." },
    { key: "height", label: "Altura de extrusión", type: "number", min: 0.2, max: 300, step: 0.2, unit: "mm", default: 3, group: "Importado", visibleIf: (p) => p.format === "svg" },
  ],
};

/** Todo lo que puede existir en una escena: formas básicas, componentes paramétricos y modelos importados. */
export const SHAPES: TemplateMeta[] = [...PRIMITIVES, ...TEMPLATES, IMPORTED];

export const getTemplate = (id: string) => SHAPES.find((t) => t.id === id);

export function defaultParams(t: TemplateMeta): Params {
  return Object.fromEntries(t.params.map((d) => [d.key, d.default]));
}

/** Ajusta un valor arbitrario (por ejemplo, propuesto por la IA) al rango permitido. */
export function coerceParam(def: ParamDef, raw: unknown): Params[string] | undefined {
  if (def.type === "bool") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === 1) return true;
    if (raw === "false" || raw === 0) return false;
    return undefined;
  }
  if (def.type === "enum") return def.options.some((o) => o.value === raw) ? String(raw) : undefined;
  const v = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(v)) return undefined;
  const clamped = Math.min(def.max, Math.max(def.min, v));
  return def.type === "int" ? Math.round(clamped) : Math.round(clamped / def.step) * def.step;
}

/** Valida un conjunto completo de parámetros contra la plantilla. */
export function sanitizeParams(t: TemplateMeta, input: Record<string, unknown>, base?: Params): Params {
  const out: Params = { ...(base ?? defaultParams(t)) };
  for (const def of t.params) {
    if (!(def.key in input)) continue;
    const v = coerceParam(def, input[def.key]);
    if (v !== undefined) out[def.key] = typeof v === "number" ? +v.toFixed(3) : v;
  }
  return out;
}
