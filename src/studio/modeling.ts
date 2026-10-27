import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { MeshPayload } from "../cad/client";
import { partPreviewScale } from "../cad/importScale";
import type { Part, Vec3 } from "../cad/types";
import { uniqueName } from "./parts";

export type Bounds = { min: Vec3; max: Vec3 };
export type Axis = 0 | 1 | 2;
export type Anchor = "min" | "center" | "max";

/** Actual transformed vertices, so rotated or mirrored imports sit on the bed exactly. */
export function worldBounds(part: Part, mesh: MeshPayload): Bounds {
  const [x, y, z] = part.rotation.map((angle) => angle * Math.PI / 180);
  const matrix = new Matrix4().compose(new Vector3(...part.position),
    new Quaternion().setFromEuler(new Euler(x, y, z, "ZYX")), new Vector3(...partPreviewScale(part)));
  const e = matrix.elements, v = mesh.vertices;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = e[axis] * v[i] + e[axis + 4] * v[i + 1] + e[axis + 8] * v[i + 2] + e[axis + 12];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) throw new Error("La geometría de esta pieza aún no está lista.");
  return { min, max };
}

export function alignedPosition(part: Part, source: Bounds, target: Bounds, axes: Axis[], anchor: Anchor): Vec3 {
  const point = (box: Bounds, axis: Axis) => anchor === "center" ? (box.min[axis] + box.max[axis]) / 2 : box[anchor][axis];
  return part.position.map((value, axis) => axes.includes(axis as Axis)
    ? value + point(target, axis as Axis) - point(source, axis as Axis) : value) as Vec3;
}

/** Keep repeated high-resolution imports within a practical geometry budget. */
export const patternLimit = (triangles: number, parts: number) => Math.max(1, Math.min(24, 129 - parts, Math.floor(3_000_000 / Math.max(1, triangles))));

function copies(part: Part, parts: Part[], count: number, position: (i: number) => Vec3, rotation: (i: number) => Vec3): Part[] {
  if (!Number.isInteger(count) || count < 2 || count > 24 || parts.length + count - 1 > 128) throw new Error("El patrón debe tener entre 2 y 24 piezas, hasta un total de 128 en la escena.");
  const next = [...parts];
  for (let i = 1; i < count; i++) {
    next.push({ ...structuredClone(part), id: crypto.randomUUID(), name: uniqueName(next, part.name), position: position(i), rotation: rotation(i) });
  }
  return next;
}

export function linearPattern(part: Part, parts: Part[], axis: Axis, count: number, spacing: number): Part[] {
  if (!Number.isFinite(spacing) || spacing === 0) throw new Error("La separación debe ser distinta de cero.");
  return copies(part, parts, count, (i) => part.position.map((value, a) => value + (a === axis ? i * spacing : 0)) as Vec3, () => [...part.rotation]);
}

export function circularPattern(part: Part, parts: Part[], count: number, center: [number, number], orient: boolean): Part[] {
  const [dx, dy] = [part.position[0] - center[0], part.position[1] - center[1]];
  if (!center.every(Number.isFinite) || Math.hypot(dx, dy) < 0.01) throw new Error("La pieza coincide con el centro del patrón. Cambia el centro X o Y.");
  return copies(part, parts, count, (i) => {
    const angle = 2 * Math.PI * i / count;
    return [center[0] + dx * Math.cos(angle) - dy * Math.sin(angle), center[1] + dx * Math.sin(angle) + dy * Math.cos(angle), part.position[2]];
  }, (i) => [part.rotation[0], part.rotation[1], part.rotation[2] + (orient ? 360 * i / count : 0)]);
}

export function gridPattern(part: Part, parts: Part[], counts: [number, number], spacing: [number, number]): Part[] {
  const [nx, ny] = counts;
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || ny < 1) throw new Error("Las filas y columnas deben ser números enteros positivos.");
  if (!spacing.every((s) => Number.isFinite(s) && s !== 0)) throw new Error("Las separaciones deben ser distintas de cero.");
  return copies(part, parts, nx * ny, (i) => [part.position[0] + (i % nx) * spacing[0], part.position[1] + Math.floor(i / nx) * spacing[1], part.position[2]], () => [...part.rotation]);
}

/** Matriz que lleva el sistema de las operaciones de una pieza al mundo (sin la escala de importación). */
function featureFrame(part: Part) {
  const [x, y, z] = part.rotation.map((angle) => angle * Math.PI / 180);
  const mirror = (part.mirror ?? [false, false, false]).map((m) => (m ? -1 : 1)) as Vec3;
  return { rotation: new Quaternion().setFromEuler(new Euler(x, y, z, "ZYX")), mirror };
}

/**
 * Plano del mundo perpendicular a un eje, expresado en el sistema de las operaciones de la pieza.
 * Conserva el lado `keep` del plano `axis = value`.
 */
export function localPlane(part: Part, axis: Axis, value: number, keep: "below" | "above"): { normal: Vec3; offset: number } {
  const world = new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
  const { rotation, mirror } = featureFrame(part);
  // p_mundo = T + R·M·p_local  ⇒  n_mundo·p_mundo = v  ⇔  (M·Rᵀ·n)·p_local = v − n·T
  const local = world.clone().applyQuaternion(rotation.clone().invert());
  const normal = [local.x * mirror[0], local.y * mirror[1], local.z * mirror[2]].map((v) => +v.toFixed(12)) as Vec3;
  const offset = value - part.position[axis];
  return keep === "below" ? { normal, offset } : { normal: normal.map((v) => -v) as Vec3, offset: -offset };
}

/** Rotación (grados, orden de la app) que orienta el eje +Z local según una normal del mundo. */
export function rotationFromNormal(normal: Vec3): Vec3 {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...normal).normalize());
  const e = new Euler().setFromQuaternion(q, "ZYX");
  return [e.x, e.y, e.z].map((v) => +(v * 180 / Math.PI).toFixed(3)) as Vec3;
}

/** Divide una pieza por un plano del mundo: devuelve la parte inferior y la superior (en otro cuerpo). */
export function splitPart(part: Part, parts: Part[], axis: Axis, value: number, upperBody: string): [Part, Part] {
  const below = localPlane(part, axis, value, "below"), above = localPlane(part, axis, value, "above");
  const lower: Part = { ...part, features: [...(part.features ?? []), { kind: "trim", ...below }] };
  const upper: Part = {
    ...structuredClone(part), id: crypto.randomUUID(), name: uniqueName(parts, `${part.name} (${["X", "Y", "Z"][axis]} > ${+value.toFixed(2)})`),
    features: [...(part.features ?? []), { kind: "trim", ...above }], body: upperBody, link: undefined,
  };
  return [lower, upper];
}
