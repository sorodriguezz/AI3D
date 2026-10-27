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
  { id: "rounded-plate", name: "Placa redondeada", category: "Perfiles", description: "Placa con esquinas redondeadas y espesor constante.", keywords: ["placa", "base", "redondeada"], printHint: "", checks: noChecks,
    params: [dim("width", "Ancho (X)", 40), dim("depth", "Fondo (Y)", 30), dim("height", "Espesor (Z)", 3), dim("radius", "Radio de esquinas", 4, 0, 100)] },
  { id: "slot", name: "Ranura", category: "Perfiles", description: "Perfil alargado con extremos semicirculares. Úsalo como agujero para crear ranuras de ajuste.", keywords: ["ranura", "oblonga", "ajuste", "ovalada"], printHint: "", checks: noChecks,
    params: [dim("length", "Largo total", 40), dim("diameter", "Diámetro de extremos", 12), dim("height", "Altura", 10)] },
  { id: "profile-l", name: "Perfil L", category: "Perfiles", description: "Perfil angular con dos alas y espesor constante.", keywords: ["perfil", "angular", "ala"], printHint: "", checks: noChecks,
    params: [dim("width", "Ancho (X)", 30), dim("depth", "Fondo (Y)", 30), dim("height", "Longitud (Z)", 40), dim("wall", "Espesor de pared", 3, 0.5, 50)] },
  { id: "profile-u", name: "Perfil U", category: "Perfiles", description: "Canal abierto con dos alas laterales y espesor constante.", keywords: ["perfil", "canal", "guia"], printHint: "", checks: noChecks,
    params: [dim("width", "Ancho (X)", 30), dim("depth", "Fondo (Y)", 20), dim("height", "Longitud (Z)", 40), dim("wall", "Espesor de pared", 3, 0.5, 50)] },
];

// --- Cajas y fijaciones ---

/** Medidas métricas habituales para impresión 3D (con holgura incluida), por métrica. */
export const SCREWS: Record<string, { clearance: number; cboreD: number; cboreDepth: number; cskD: number; nutAF: number; nutDepth: number; insertD: number; insertDepth: number }> = {
  M2: { clearance: 2.4, cboreD: 4.4, cboreDepth: 2.2, cskD: 4.6, nutAF: 4.3, nutDepth: 1.9, insertD: 3.2, insertDepth: 4 },
  "M2.5": { clearance: 2.9, cboreD: 5, cboreDepth: 2.7, cskD: 5.3, nutAF: 5.3, nutDepth: 2.3, insertD: 3.5, insertDepth: 4 },
  M3: { clearance: 3.4, cboreD: 6, cboreDepth: 3.2, cskD: 6.3, nutAF: 5.8, nutDepth: 2.7, insertD: 4, insertDepth: 5 },
  M4: { clearance: 4.5, cboreD: 7.6, cboreDepth: 4.2, cskD: 8.4, nutAF: 7.3, nutDepth: 3.5, insertD: 5.6, insertDepth: 6 },
  M5: { clearance: 5.5, cboreD: 9.2, cboreDepth: 5.2, cskD: 10.4, nutAF: 8.3, nutDepth: 4.3, insertD: 6.4, insertDepth: 7 },
  M6: { clearance: 6.6, cboreD: 11, cboreDepth: 6.2, cskD: 12.6, nutAF: 10.3, nutDepth: 5.3, insertD: 8, insertDepth: 8 },
};

/** Medidas efectivas de un agujero: las de la métrica elegida o las personalizadas. */
export function holeDims(p: Params) {
  const preset = SCREWS[String(p.standard)];
  if (preset) return { diameter: preset.clearance, headD: { counterbore: preset.cboreD, countersink: preset.cskD, nut: preset.nutAF, insert: preset.insertD }[String(p.head)] ?? 0, headDepth: { counterbore: preset.cboreDepth, nut: preset.nutDepth, insert: preset.insertDepth }[String(p.head)] ?? 0 };
  return { diameter: n(p, "diameter"), headD: n(p, "headDiameter"), headDepth: n(p, "headDepth") };
}

/**
 * Distancia desde el origen de la pieza (centro de su base) hasta la superficie donde entra el corte.
 * Los agujeros y rejillas sobresalen 1 mm por encima y, si son pasantes, 1 mm por debajo.
 */
export const entryOffset = (p: Params) => n(p, "depth") + (p.through ? 1 : 0);

/** Medidas exteriores de la caja con tapa. */
export function enclosureOuter(p: Params) {
  const wall = n(p, "wall"), inside = p.sizing === "inner";
  return { length: n(p, "length") + (inside ? 2 * wall : 0), width: n(p, "width") + (inside ? 2 * wall : 0), height: n(p, "height") + (inside ? n(p, "floor") : 0) };
}

const holeHead = (key = "head"): ParamDef => ({
  key, label: "Alojamiento en la entrada", type: "enum", default: "none", group: "Agujero",
  options: [
    { value: "none", label: "Ninguno", description: "Agujero recto." },
    { value: "counterbore", label: "Avellanado recto", description: "Rebaje cilíndrico para la cabeza (tornillo Allen)." },
    { value: "countersink", label: "Avellanado cónico", description: "Cono a 90° para cabeza plana." },
    { value: "nut", label: "Tuerca hexagonal", description: "Alojamiento para una tuerca cautiva." },
    { value: "insert", label: "Inserto térmico", description: "Agujero para inserto roscado de latón." },
  ],
});

export const FASTENERS: TemplateMeta[] = [
  {
    id: "enclosure",
    name: "Caja con tapa",
    category: "Cajas",
    description: "Carcasa vaciada con tapa independiente, labio de encaje con holgura y soportes internos para tornillos.",
    keywords: ["caja", "carcasa", "tapa", "electronica", "proyecto", "gabinete", "enclosure", "contenedor"],
    printHint: "La tapa se genera boca abajo (cara exterior sobre la cama) y la caja con el fondo sobre la cama: ninguna necesita soportes.",
    defaultMode: "solid",
    pieces: { param: "piece", items: [{ value: "box", body: "Caja", name: "Caja" }, { value: "lid", body: "Tapa", name: "Tapa" }] },
    params: [
      { key: "piece", label: "Pieza", type: "enum", default: "box", group: "Pieza", options: [{ value: "box", label: "Caja" }, { value: "lid", label: "Tapa" }] },
      { key: "sizing", label: "Las medidas son", type: "enum", default: "inner", group: "Medidas", options: [{ value: "inner", label: "Interiores", description: "Espacio útil para la electrónica." }, { value: "outer", label: "Exteriores", description: "Tamaño total de la caja cerrada sin tapa." }] },
      { key: "length", label: "Largo (X)", type: "number", min: 10, max: 400, step: 0.5, unit: "mm", default: 100, group: "Medidas", critical: true },
      { key: "width", label: "Ancho (Y)", type: "number", min: 10, max: 400, step: 0.5, unit: "mm", default: 60, group: "Medidas", critical: true },
      { key: "height", label: "Alto (Z)", type: "number", min: 5, max: 300, step: 0.5, unit: "mm", default: 30, group: "Medidas", critical: true, hint: "Altura de la caja sin la tapa." },
      { key: "wall", label: "Grosor de pared", type: "number", min: 1.2, max: 8, step: 0.1, unit: "mm", default: 2, group: "Paredes" },
      { key: "floor", label: "Grosor del fondo", type: "number", min: 0.8, max: 8, step: 0.1, unit: "mm", default: 2, group: "Paredes" },
      { key: "cornerRadius", label: "Radio de esquinas", type: "number", min: 0, max: 30, step: 0.5, unit: "mm", default: 3, group: "Paredes" },
      { key: "lidThickness", label: "Grosor de la tapa", type: "number", min: 1, max: 8, step: 0.1, unit: "mm", default: 2, group: "Tapa" },
      { key: "lipHeight", label: "Altura del labio", type: "number", min: 0, max: 15, step: 0.5, unit: "mm", default: 3, group: "Tapa", hint: "Borde que entra en la caja y centra la tapa. 0 para tapa plana." },
      { key: "clearance", label: "Holgura de encaje", type: "number", min: 0, max: 1.5, step: 0.05, unit: "mm", default: 0.25, group: "Tapa" },
      { key: "screws", label: "Soportes para tornillos", type: "bool", default: true, group: "Tornillos" },
      { key: "standard", label: "Tornillo", type: "enum", default: "M3", group: "Tornillos", visibleIf: (p) => !!p.screws, options: Object.keys(SCREWS).map((value) => ({ value, label: value })) },
      { key: "bossDiameter", label: "Diámetro del soporte", type: "number", min: 4, max: 20, step: 0.5, unit: "mm", default: 7, group: "Tornillos", visibleIf: (p) => !!p.screws },
      { key: "bossHole", label: "Agujero del soporte", type: "enum", default: "tap", group: "Tornillos", visibleIf: (p) => !!p.screws, options: [{ value: "tap", label: "Para autorroscante" }, { value: "insert", label: "Para inserto térmico" }] },
    ],
    checks: (p) => {
      const out = wallChecks(n(p, "wall"));
      out.push(clearanceCheck(n(p, "clearance")));
      const preset = SCREWS[String(p.standard)];
      if (p.screws && preset && n(p, "bossDiameter") < (p.bossHole === "insert" ? preset.insertD : preset.clearance) + 2.4) out.push({ level: "error", title: "Soporte demasiado delgado", detail: "El soporte necesita al menos 1,2 mm de pared alrededor del agujero." });
      return out;
    },
  },
  {
    id: "screw-hole",
    name: "Agujero para tornillo",
    category: "Fijaciones",
    description: "Agujero pasante o ciego con avellanado recto, cónico, alojamiento para tuerca o inserto térmico. Se coloca sobre una cara.",
    keywords: ["agujero", "tornillo", "perforacion", "avellanado", "tuerca", "inserto"],
    printHint: "",
    defaultMode: "hole",
    params: [
      { key: "standard", label: "Métrica", type: "enum", default: "M3", group: "Agujero", options: [...Object.keys(SCREWS).map((value) => ({ value, label: value })), { value: "custom", label: "Personalizada" }] },
      holeHead(),
      { key: "through", label: "Pasante", type: "bool", default: true, group: "Agujero", hint: "Al colocarlo sobre una cara, atraviesa todo el espesor." },
      { key: "depth", label: "Profundidad", type: "number", min: 0.5, max: 300, step: 0.5, unit: "mm", default: 10, group: "Agujero" },
      { key: "diameter", label: "Diámetro", type: "number", min: 0.5, max: 50, step: 0.1, unit: "mm", default: 3.4, group: "Personalizada", visibleIf: (p) => p.standard === "custom" },
      { key: "headDiameter", label: "Diámetro del alojamiento", type: "number", min: 1, max: 80, step: 0.1, unit: "mm", default: 6, group: "Personalizada", visibleIf: (p) => p.standard === "custom" && p.head !== "none", hint: "En tuercas: distancia entre caras planas." },
      { key: "headDepth", label: "Profundidad del alojamiento", type: "number", min: 0.2, max: 50, step: 0.1, unit: "mm", default: 3, group: "Personalizada", visibleIf: (p) => p.standard === "custom" && p.head !== "none" && p.head !== "countersink" },
    ],
    checks: (p) => {
      const d = holeDims(p);
      if (p.head !== "none" && p.head !== "countersink" && d.headDepth >= n(p, "depth")) return [{ level: "warn", title: "Alojamiento más profundo que el agujero" }];
      return [];
    },
  },
  {
    id: "vent",
    name: "Rejilla de ventilación",
    category: "Fijaciones",
    description: "Matriz de ranuras, agujeros o hexágonos para ventilar una carcasa. Se coloca sobre una cara como agujero.",
    keywords: ["ventilacion", "rejilla", "ranuras", "aire", "disipador"],
    printHint: "",
    defaultMode: "hole",
    params: [
      { key: "pattern", label: "Forma", type: "enum", default: "slots", group: "Rejilla", options: [{ value: "slots", label: "Ranuras" }, { value: "round", label: "Agujeros redondos" }, { value: "hex", label: "Hexágonos" }] },
      { key: "countX", label: "Columnas", type: "int", min: 1, max: 40, step: 1, unit: "", default: 6, group: "Rejilla" },
      { key: "countY", label: "Filas", type: "int", min: 1, max: 40, step: 1, unit: "", default: 1, group: "Rejilla" },
      { key: "size", label: "Ancho / diámetro", type: "number", min: 1, max: 30, step: 0.5, unit: "mm", default: 3, group: "Rejilla" },
      { key: "length", label: "Largo de ranura", type: "number", min: 2, max: 200, step: 0.5, unit: "mm", default: 25, group: "Rejilla", visibleIf: (p) => p.pattern === "slots" },
      { key: "spacing", label: "Separación (paso)", type: "number", min: 1.5, max: 60, step: 0.5, unit: "mm", default: 6, group: "Rejilla", hint: "Distancia entre centros." },
      { key: "through", label: "Pasante", type: "bool", default: true, group: "Rejilla" },
      { key: "depth", label: "Profundidad", type: "number", min: 0.5, max: 100, step: 0.5, unit: "mm", default: 3, group: "Rejilla" },
    ],
    checks: (p) => (n(p, "spacing") - n(p, "size") < 1.2 ? [{ level: "warn", title: "Puentes muy delgados", detail: "Deja al menos 1,2 mm entre aberturas." }] : []),
  },
];

// --- Racks (EIA-310) ---

/** 1 U = 44,45 mm. El panel mide 0,79 mm menos para que dos paneles contiguos no se toquen. */
export const RACK_U = 44.45;
export const RACK = {
  "19": { width: 482.6, holeSpacing: 465.1, opening: 450 },
  "10": { width: 254, holeSpacing: 236.525, opening: 222.25 },
} as const;
/** Centros de los tres agujeros de cada U, medidos desde el borde inferior de la U. */
export const RACK_HOLES = [6.35, 22.225, 38.1];

export const rackStandard = (p: Params) => RACK[String(p.standard) === "10" ? "10" : "19"];
export const rackPanelHeight = (units: number) => units * RACK_U - 0.79;

/** Alturas (desde el borde inferior del panel) de los agujeros de montaje. */
export function rackHoleHeights(units: number, layout: string): number[] {
  const out: number[] = [];
  for (let u = 0; u < units; u++) {
    const holes = layout === "all" ? RACK_HOLES : [RACK_HOLES[0], RACK_HOLES[2]];
    for (const h of holes) out.push(+(u * RACK_U + h - 0.395).toFixed(4));
  }
  return out;
}

const rackParams: ParamDef[] = [
  { key: "standard", label: "Rack", type: "enum", default: "10", group: "Rack", options: [{ value: "19", label: "19 pulgadas", description: "482,6 mm de ancho, agujeros a 465,1 mm." }, { value: "10", label: "10 pulgadas", description: "254 mm de ancho, agujeros a 236,5 mm." }] },
  { key: "units", label: "Altura (U)", type: "int", min: 1, max: 8, step: 1, unit: "", default: 1, group: "Rack", hint: "1 U = 44,45 mm." },
  { key: "holeLayout", label: "Agujeros por U", type: "enum", default: "outer", group: "Rack", options: [{ value: "outer", label: "Dos (extremos)" }, { value: "all", label: "Tres (todos)" }] },
  { key: "slotLength", label: "Largo de los ojales", type: "number", min: 6.5, max: 20, step: 0.5, unit: "mm", default: 10, group: "Rack", hint: "Ojales horizontales de 6,5 mm para tornillos M6 o 10-32." },
];

const rackChecks = (p: Params): Check[] => {
  const w = rackStandard(p).width;
  return p.split === "left" || p.split === "right" || w <= 256 ? [] : [{ level: "warn", title: "Panel más ancho que la cama", detail: `Un panel de ${w} mm no cabe en camas de 256 mm: imprímelo en dos mitades (Pieza: mitad izquierda y derecha).` }];
};

export const RACKS: TemplateMeta[] = [
  {
    id: "rack-panel",
    name: "Panel de rack",
    category: "Racks",
    description: "Panel frontal de 10\" o 19\" con ojales EIA-310, abertura opcional para un equipo y división en dos mitades unidas por un solape de 24 mm.",
    keywords: ["rack", "panel", "frontal", "19", "10", "u", "servidor", "switch", "patch"],
    printHint: "Imprime el panel plano. Las dos mitades se unen con dos tornillos M3 en el solape central.",
    params: [
      ...rackParams,
      { key: "thickness", label: "Grosor", type: "number", min: 2, max: 8, step: 0.5, unit: "mm", default: 3, group: "Panel" },
      { key: "split", label: "Pieza", type: "enum", default: "full", group: "Panel", options: [{ value: "full", label: "Panel completo" }, { value: "left", label: "Mitad izquierda" }, { value: "right", label: "Mitad derecha" }] },
      { key: "cutout", label: "Abertura para equipo", type: "bool", default: false, group: "Abertura" },
      { key: "cutoutWidth", label: "Ancho de la abertura", type: "number", min: 10, max: 440, step: 0.5, unit: "mm", default: 120, group: "Abertura", critical: true, visibleIf: (p) => !!p.cutout },
      { key: "cutoutHeight", label: "Alto de la abertura", type: "number", min: 5, max: 340, step: 0.5, unit: "mm", default: 30, group: "Abertura", critical: true, visibleIf: (p) => !!p.cutout },
      { key: "cutoutRadius", label: "Radio de esquinas", type: "number", min: 0, max: 20, step: 0.5, unit: "mm", default: 2, group: "Abertura", visibleIf: (p) => !!p.cutout },
    ],
    checks: (p) => {
      const out = rackChecks(p);
      if (p.cutout && n(p, "cutoutWidth") > rackStandard(p).holeSpacing - 30) out.push({ level: "error", title: "La abertura invade los ojales de montaje" });
      if (p.cutout && n(p, "cutoutHeight") > rackPanelHeight(n(p, "units")) - 6) out.push({ level: "error", title: "La abertura es más alta que el panel" });
      return out;
    },
  },
  {
    id: "rack-shelf",
    name: "Bandeja de rack",
    category: "Racks",
    description: "Bandeja en voladizo con frente de rack, laterales y ranuras de ventilación en la base.",
    keywords: ["rack", "bandeja", "estante", "repisa", "shelf"],
    printHint: "Imprime con la base sobre la cama; el frente queda vertical sin soportes.",
    params: [
      ...rackParams,
      { key: "depth", label: "Fondo", type: "number", min: 40, max: 250, step: 1, unit: "mm", default: 150, group: "Bandeja", critical: true },
      { key: "wallHeight", label: "Altura de los laterales", type: "number", min: 0, max: 80, step: 1, unit: "mm", default: 15, group: "Bandeja" },
      { key: "thickness", label: "Grosor", type: "number", min: 2, max: 6, step: 0.5, unit: "mm", default: 3, group: "Bandeja" },
      { key: "vents", label: "Ranuras de ventilación", type: "bool", default: true, group: "Bandeja" },
    ],
    checks: (p) => {
      const out = rackChecks(p);
      if (n(p, "depth") > 120 && n(p, "thickness") < 3) out.push({ level: "warn", title: "Bandeja larga y delgada", detail: "Con más de 120 mm de fondo conviene un grosor de 3 mm o más." });
      return out;
    },
  },
  {
    id: "rack-ears",
    name: "Orejas para equipo",
    category: "Racks",
    description: "Par de orejas que adaptan un equipo de cualquier ancho al rack: se atornillan a sus laterales y a los rieles.",
    keywords: ["rack", "orejas", "ears", "adaptador", "equipo", "montaje"],
    printHint: "Imprime cada oreja con la placa frontal sobre la cama.",
    params: [
      ...rackParams,
      { key: "equipmentWidth", label: "Ancho del equipo", type: "number", min: 50, max: 445, step: 0.5, unit: "mm", default: 200, group: "Equipo", critical: true },
      { key: "equipmentDepth", label: "Largo de la pestaña lateral", type: "number", min: 15, max: 150, step: 1, unit: "mm", default: 40, group: "Equipo" },
      { key: "sideHoles", label: "Agujeros en el lateral", type: "int", min: 0, max: 4, step: 1, unit: "", default: 2, group: "Equipo" },
      { key: "sideHoleSpacing", label: "Separación entre agujeros", type: "number", min: 5, max: 140, step: 0.5, unit: "mm", default: 20, group: "Equipo", critical: true },
      { key: "sideHoleHeight", label: "Altura de los agujeros", type: "number", min: 3, max: 340, step: 0.5, unit: "mm", default: 15, group: "Equipo", critical: true, hint: "Desde la base del equipo." },
      { key: "sideScrew", label: "Tornillo del equipo", type: "enum", default: "M3", group: "Equipo", options: Object.keys(SCREWS).map((value) => ({ value, label: value })) },
      { key: "thickness", label: "Grosor", type: "number", min: 2, max: 6, step: 0.5, unit: "mm", default: 3, group: "Equipo" },
      { key: "side", label: "Oreja", type: "enum", default: "left", group: "Equipo", options: [{ value: "left", label: "Izquierda" }, { value: "right", label: "Derecha" }] },
    ],
    checks: (p) => {
      const ear = (rackStandard(p).width - n(p, "equipmentWidth")) / 2;
      if (n(p, "equipmentWidth") > rackStandard(p).opening) return [{ level: "error", title: "El equipo no cabe entre los rieles", detail: `El hueco del rack es de ${rackStandard(p).opening} mm.` }];
      if (ear < 16) return [{ level: "warn", title: "Oreja muy estrecha" }];
      return [{ level: "ok", title: `Oreja de ${+ear.toFixed(1)} mm` }];
    },
  },
  {
    id: "adjustable-bracket",
    name: "Soporte ajustable",
    category: "Racks",
    description: "Escuadra con ojales en ambos brazos para ajustar la posición del equipo antes de apretar los tornillos.",
    keywords: ["soporte", "ajustable", "escuadra", "ojal", "regulable", "rack"],
    printHint: "Imprime de lado para que la carga no separe las capas.",
    params: [
      { key: "legA", label: "Brazo vertical", type: "number", min: 20, max: 200, step: 1, unit: "mm", default: 50, group: "Forma" },
      { key: "legB", label: "Brazo horizontal", type: "number", min: 20, max: 200, step: 1, unit: "mm", default: 60, group: "Forma" },
      { key: "width", label: "Ancho", type: "number", min: 12, max: 100, step: 1, unit: "mm", default: 25, group: "Forma" },
      { key: "thickness", label: "Grosor", type: "number", min: 2, max: 10, step: 0.5, unit: "mm", default: 4, group: "Forma" },
      { key: "gusset", label: "Refuerzos laterales", type: "bool", default: true, group: "Forma" },
      { key: "standard", label: "Tornillo", type: "enum", default: "M4", group: "Ajuste", options: Object.keys(SCREWS).map((value) => ({ value, label: value })) },
      { key: "travel", label: "Recorrido de ajuste", type: "number", min: 2, max: 120, step: 1, unit: "mm", default: 20, group: "Ajuste", hint: "Cuánto puede desplazarse el tornillo dentro de cada ojal." },
    ],
    checks: (p) => (n(p, "travel") + 12 > Math.min(n(p, "legA"), n(p, "legB")) ? [{ level: "error", title: "Ojal más largo que el brazo" }] : wallChecks(n(p, "thickness"), "Brazo")),
  },
  {
    id: "cable-pass",
    name: "Pasacables",
    category: "Racks",
    description: "Abertura redondeada para pasar cables. Se coloca sobre una cara como agujero.",
    keywords: ["pasacables", "cables", "abertura", "grommet", "paso"],
    printHint: "",
    defaultMode: "hole",
    params: [
      { key: "width", label: "Ancho", type: "number", min: 4, max: 300, step: 0.5, unit: "mm", default: 40, group: "Abertura" },
      { key: "height", label: "Alto", type: "number", min: 4, max: 300, step: 0.5, unit: "mm", default: 15, group: "Abertura" },
      { key: "radius", label: "Radio de esquinas", type: "number", min: 0, max: 150, step: 0.5, unit: "mm", default: 7.5, group: "Abertura" },
      { key: "through", label: "Pasante", type: "bool", default: true, group: "Abertura" },
      { key: "depth", label: "Profundidad", type: "number", min: 0.5, max: 100, step: 0.5, unit: "mm", default: 3, group: "Abertura" },
    ],
    checks: noChecks,
  },
];

/** Perfil 2D dibujado con cotas y restricciones (se edita en el editor de bocetos). */
export const SKETCH: TemplateMeta = {
  id: "sketch",
  name: "Boceto",
  category: "Bocetos",
  description: "Perfil 2D con cotas y restricciones que se extruye o se revoluciona. Las cotas aceptan fórmulas con las variables del diseño.",
  keywords: ["boceto", "perfil", "extruir", "revolucionar", "dibujo"],
  printHint: "",
  checks: noChecks,
  params: [
    { key: "operation", label: "Operación", type: "enum", default: "extrude", group: "Boceto", options: [{ value: "extrude", label: "Extruir", description: "Da altura al perfil a lo largo de Z." }, { value: "revolve", label: "Revolucionar", description: "Gira el perfil alrededor del eje vertical del boceto (x = 0)." }] },
    { key: "height", label: "Altura de extrusión", type: "number", min: 0.1, max: 500, step: 0.5, unit: "mm", default: 10, group: "Boceto", visibleIf: (p) => p.operation !== "revolve" },
    { key: "angle", label: "Ángulo de revolución", type: "number", min: 1, max: 360, step: 1, unit: "°", default: 360, group: "Boceto", visibleIf: (p) => p.operation === "revolve" },
  ],
};

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
export const SHAPES: TemplateMeta[] = [...PRIMITIVES, ...FASTENERS, SKETCH, ...RACKS, ...TEMPLATES, IMPORTED];

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
