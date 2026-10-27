export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

interface ParamBase {
  key: string;
  label: string;
  group?: string;
  hint?: string;
  /** Medida que una foto no revela: debe confirmarla el usuario antes de fabricar. */
  critical?: boolean;
  /** Solo se muestra si la condición se cumple. */
  visibleIf?: (p: Params) => boolean;
}

export interface NumberParam extends ParamBase {
  type: "number" | "int";
  min: number;
  max: number;
  step: number;
  unit?: "mm" | "°" | "";
  default: number;
}

export interface BoolParam extends ParamBase {
  type: "bool";
  default: boolean;
}

export interface EnumParam extends ParamBase {
  type: "enum";
  options: { value: string; label: string; description?: string }[];
  default: string;
}

export type ParamDef = NumberParam | BoolParam | EnumParam;

export type CheckLevel = "ok" | "warn" | "error";

export interface Check {
  level: CheckLevel;
  title: string;
  detail?: string;
}

export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Palabras clave para el modo sin modelo y para orientar al agente. */
  keywords: string[];
  params: ParamDef[];
  /** Orientación de impresión recomendada. */
  printHint: string;
  checks: (p: Params) => Check[];
  /** Modo con el que se inserta (los agujeros y rejillas recortan). */
  defaultMode?: "solid" | "hole";
  /** Plantillas que se insertan como varias piezas enlazadas, una por valor del parámetro. */
  pieces?: { param: string; items: { value: string; body: string; name: string }[] };
}

/** Estado de cada medida: confirmada por el usuario, estimada por la IA o valor por defecto. */
export type ParamStatus = "confirmed" | "estimated" | "default";

export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volume: number;
}

export type ExportFormat = "stl" | "step" | "3mf";

export type Vec3 = [number, number, number];
export type MirrorAxes = [boolean, boolean, boolean];

/**
 * Operaciones aplicadas a la geometría de una pieza, en orden, en su sistema local
 * (ya escalado, antes de espejar, rotar y trasladar).
 */
export type Feature = (
  /** Vaciado con pared de espesor constante, abierto por la cara superior o inferior. */
  | { kind: "shell"; thickness: number; open: "top" | "bottom" }
  /** Redondeo o chaflán de las aristas que pasan por los puntos indicados. */
  | { kind: "fillet" | "chamfer"; size: number; edges: Vec3[] }
  /** Conserva solo el semiespacio normal · p ≤ offset (división por un plano). */
  | { kind: "trim"; normal: Vec3; offset: number }
) & {
  /** Operación desactivada temporalmente: se conserva en el historial pero no se aplica. */
  suppressed?: boolean;
};

/** Cuerpo al que pertenecen las piezas sin cuerpo asignado. */
export const MAIN_BODY = "Cuerpo principal";

/** Una pieza de la escena. Su forma viene del catálogo (básica o componente paramétrico). */
export interface Part {
  id: string;
  name: string;
  type: string;
  params: Params;
  /** Posición del origen de la pieza (centro de su base), en mm. */
  position: Vec3;
  /** Rotación en grados, aplicada en X, luego Y, luego Z (ejes del mundo). */
  rotation: Vec3;
  /** Reflexiones sobre los ejes locales, antes de rotar y trasladar. */
  mirror?: MirrorAxes;
  /** Las piezas «hole» se restan de las sólidas al combinar. */
  mode: "solid" | "hole";
  color: string;
  hidden?: boolean;
  /** Medidas aún sin verificar (estimadas por la IA o críticas sin confirmar). */
  estimated?: string[];
  features?: Feature[];
  /** Los sólidos de un mismo cuerpo se unen; cada cuerpo se exporta como objeto aparte. */
  body?: string;
  /** Agujeros: cuerpos que recortan (sin definir, todos). */
  cutBodies?: string[];
  /** Piezas creadas juntas (caja y tapa) que comparten sus medidas. */
  link?: string;
  /** Medidas definidas por fórmula (clave del parámetro → fórmula con variables del diseño). */
  exprs?: Record<string, string>;
}

export interface Design {
  format: "ai3d";
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  parts: Part[];
  prompt?: string;
  thumbnail?: string;
  /** Modelos importados que usan las piezas «imported» (ver studio/assets.ts). */
  assets?: Record<string, import("../studio/assets").StoredAsset>;
  /** Variables del diseño, usadas en fórmulas de medidas y cotas de bocetos. */
  variables?: import("./expr").Variable[];
}

/** Pieza transformada que se envía al worker para combinar. */
export interface ScenePart {
  type: string;
  params: Params;
  position: Vec3;
  rotation: Vec3;
  mirror?: MirrorAxes;
  mode: "solid" | "hole";
  features?: Feature[];
  body?: string;
  cutBodies?: string[];
}
