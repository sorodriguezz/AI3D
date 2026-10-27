import type { Params, Part, Vec3 } from "./types";

/** Mesh and STEP imports scale uniformly; SVG keeps its extrusion height. */
export const hasUniformImportScale = (type: string, params: Params) => type === "imported" && params.format !== "svg";

export const importPreviewScale = (type: string, params: Params) => hasUniformImportScale(type, params) ? Number(params.scale ?? 100) / 100 : 1;

/** Cache imported geometry at its original size, independently of the slider. */
export const previewParams = (type: string, params: Params): Params => hasUniformImportScale(type, params) ? { ...params, scale: 100 } : params;

/** Escala del visor: las piezas con operaciones ya llegan escaladas desde el motor. */
export const partPreviewScale = (part: Part): Vec3 => {
  const scale = part.features?.length ? 1 : importPreviewScale(part.type, part.params);
  return [0, 1, 2].map((axis) => scale * (part.mirror?.[axis] ? -1 : 1)) as Vec3;
};
