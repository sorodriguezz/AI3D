import { MeshShape, makeBox, type Shape3D } from "replicad";
import { manifoldOf, type AnySolid } from "./builders";
import type { Feature, Vec3 } from "./types";

// Operaciones sobre la geometría de una pieza (solo dentro del worker CAD).
// Vaciado, redondeos y chaflanes necesitan un sólido exacto (figuras nativas o STEP);
// la división por un plano funciona también con mallas.

const exactOnly = (what: string) => `${what} solo está disponible para figuras nativas y modelos STEP. En mallas STL o 3MF usa cortes y operaciones entre piezas.`;

/** Semiespacio n · p ≥ offset como caja grande orientada, para recortar sólidos exactos. */
function halfSpace(shape: Shape3D, normal: Vec3, offset: number): Shape3D {
  const box = shape.boundingBox;
  const [min, max] = box.bounds;
  box.delete();
  const center = min.map((v, i) => (v + max[i]) / 2) as Vec3;
  const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 2 + 20;
  // Punto del plano más cercano al centro de la pieza.
  const d = normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2] - offset;
  const origin = center.map((v, i) => v - d * normal[i]) as Vec3;
  let space = makeBox([-size, -size, 0], [size, size, size]) as Shape3D;
  const axis: Vec3 = [-normal[1], normal[0], 0];
  const angle = Math.acos(Math.max(-1, Math.min(1, normal[2]))) * 180 / Math.PI;
  if (Math.hypot(axis[0], axis[1]) > 1e-9) space = space.rotate(angle, [0, 0, 0], axis);
  else if (normal[2] < 0) space = space.rotate(180, [0, 0, 0], [1, 0, 0]);
  return space.translate(origin[0], origin[1], origin[2]);
}

function trim(shape: AnySolid, normal: Vec3, offset: number): AnySolid {
  const length = Math.hypot(...normal);
  if (!(length > 1e-9) || !Number.isFinite(offset)) throw new Error("El plano de división no es válido.");
  const n = normal.map((v) => v / length) as Vec3;
  const o = offset / length;
  if (shape instanceof MeshShape) {
    // Manifold conserva el lado hacia el que apunta la normal.
    return new MeshShape(manifoldOf(shape).trimByPlane(n.map((v) => -v) as Vec3, -o) as never);
  }
  const space = halfSpace(shape, n, o);
  try {
    return shape.cut(space);
  } finally {
    space.delete();
  }
}

function shell(shape: Shape3D, thickness: number, open: "top" | "bottom"): Shape3D {
  const box = shape.boundingBox;
  const [min, max] = box.bounds;
  box.delete();
  if (!(thickness > 0) || thickness * 2 >= Math.min(max[0] - min[0], max[1] - min[1], max[2] - min[2])) {
    throw new Error("El espesor del vaciado es demasiado grande para esta pieza.");
  }
  const z = open === "top" ? max[2] : min[2];
  try {
    return shape.shell(thickness, (f) => f.inPlane("XY", z));
  } catch {
    throw new Error(`No se pudo vaciar la pieza con ${thickness} mm. Prueba un espesor menor o quita los redondeos pequeños.`);
  }
}

function edgeFinish(shape: Shape3D, kind: "fillet" | "chamfer", size: number, points: Vec3[]): Shape3D {
  if (!(size > 0)) throw new Error("El tamaño del redondeo debe ser mayor que cero.");
  if (!points.length) throw new Error("Selecciona al menos una arista.");
  const pick = (f: Parameters<Parameters<Shape3D["findEdges"]>[0]>[0]) => f.either(points.map((p) => (e: typeof f) => e.near(p, 0.02)));
  if (shape.findEdges(pick).length === 0) throw new Error("Las aristas elegidas ya no existen. Vuelve a seleccionarlas.");
  try {
    return kind === "fillet" ? shape.fillet(size, pick) : shape.chamfer(size, pick);
  } catch {
    throw new Error(`No se pudo aplicar ${kind === "fillet" ? "el redondeo" : "el chaflán"} de ${size} mm. Prueba un tamaño menor que el de las caras vecinas.`);
  }
}

/** Aplica una operación y devuelve una forma nueva (no modifica la de entrada). */
export function applyFeature(shape: AnySolid, f: Feature): AnySolid {
  if (f.kind === "trim") return trim(shape, f.normal, f.offset);
  if (shape instanceof MeshShape) throw new Error(exactOnly(f.kind === "shell" ? "El vaciado" : f.kind === "fillet" ? "El redondeo por arista" : "El chaflán por arista"));
  if (f.kind === "shell") return shell(shape, f.thickness, f.open);
  return edgeFinish(shape, f.kind, f.size, f.edges);
}
