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
  /** Las piezas «hole» se restan de las sólidas al combinar. */
  mode: "solid" | "hole";
  color: string;
  hidden?: boolean;
  /** Medidas aún sin verificar (estimadas por la IA o críticas sin confirmar). */
  estimated?: string[];
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
}

/** Pieza transformada que se envía al worker para combinar. */
export interface ScenePart {
  type: string;
  params: Params;
  position: Vec3;
  rotation: Vec3;
  mode: "solid" | "hole";
}
