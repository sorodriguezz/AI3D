import { registerAsset } from "../cad/client";
import { formatOf, loopsFromSVG, nestingDepth, toImportable, triangleCountSTL, type ImportFormat, type Loop } from "../cad/importers";

// Modelos importados: se convierten una vez (en el hilo principal, que puede leer XML)
// y se guardan dentro del archivo .ai3d para que el diseño sea autónomo.

export interface StoredAsset {
  name: string;
  format: ImportFormat;
  /** «mesh» = STL binario (desde STL, 3MF, OBJ o AMF) que se procesa con Manifold. */
  kind: "mesh" | "step" | "svg";
  /** STL o STEP en base64. */
  data?: string;
  loops?: Loop[];
  depth?: number[];
  triangles?: number;
}

export const MAX_IMPORT_MB = 60;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function prepareImport(file: File): Promise<StoredAsset> {
  const format = formatOf(file.name);
  if (!format) throw new Error(`Formato no compatible: ${file.name}. Usa STL, 3MF, OBJ, AMF, STEP o SVG.`);
  if (file.size > MAX_IMPORT_MB * 1024 * 1024) throw new Error(`${file.name} pesa más de ${MAX_IMPORT_MB} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.[^.]+$/, "");
  if (format === "svg") {
    const loops = loopsFromSVG(new TextDecoder().decode(bytes));
    return { name, format, kind: "svg", loops, depth: nestingDepth(loops) };
  }
  const { kind, bytes: data } = toImportable(format, bytes);
  return { name, format, kind: kind === "stl" ? "mesh" : "step", data: toBase64(data), triangles: kind === "stl" ? (triangleCountSTL(data) ?? undefined) : undefined };
}

export function loadAsset(id: string, a: StoredAsset): Promise<void> {
  if (a.kind === "svg") return registerAsset(id, { kind: "svg", loops: a.loops ?? [], depth: a.depth ?? [] });
  return registerAsset(id, { kind: a.kind, data: fromBase64(a.data ?? "") });
}
