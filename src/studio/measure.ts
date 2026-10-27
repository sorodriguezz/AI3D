import type { Vec3 } from "../cad/types";

// Medición sobre el modelo: todo en coordenadas del mundo, en mm.

export type PickKind = "point" | "face" | "edge";

export interface Circle {
  center: Vec3;
  normal: Vec3;
  radius: number;
  /** true si la arista forma una circunferencia completa. */
  closed: boolean;
}

export type Pick =
  | { kind: "point"; point: Vec3 }
  | { kind: "face"; point: Vec3; normal: Vec3 }
  | { kind: "edge"; point: Vec3; a: Vec3; b: Vec3; length: number; circle?: Circle };

export interface Dimension {
  id: string;
  label: string;
  /** Segmento que se dibuja en el visor (la etiqueta va en su punto medio). */
  from: Vec3;
  to: Vec3;
  /** Detalle adicional para el panel (componentes, ángulo, etc.). */
  detail?: string;
  circle?: Circle;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
export const distance = (a: Vec3, b: Vec3) => len(sub(a, b));

export const fmtMm = (v: number) => `${v.toLocaleString("es", { maximumFractionDigits: 2 })} mm`;
const fmtDeg = (v: number) => `${v.toLocaleString("es", { maximumFractionDigits: 1 })}°`;

/** Ángulo entre dos direcciones, en grados (0–180). */
export function angleBetween(a: Vec3, b: Vec3) {
  return Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180 / Math.PI;
}

/** Circunferencia que pasa por tres puntos, o null si están alineados. */
export function circleFrom3(a: Vec3, b: Vec3, c: Vec3): Circle | null {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-12) return null;
  const center = add(a, mul(add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab))), 1 / (2 * n2)));
  return { center, normal: unit(n), radius: distance(center, a), closed: false };
}

/**
 * Detecta si una cadena de puntos (una arista teselada) es un arco o una circunferencia.
 * Exige al menos 6 puntos coplanarios a la misma distancia del centro.
 */
export function fitCircle(points: Vec3[]): Circle | null {
  if (points.length < 6) return null;
  const closed = distance(points[0], points[points.length - 1]) < 1e-3 * Math.max(1, distance(points[0], points[Math.floor(points.length / 2)]));
  const pts = closed ? points.slice(0, -1) : points;
  const k = pts.length;
  const circle = circleFrom3(pts[0], pts[Math.floor(k / 3)], pts[Math.floor((2 * k) / 3)]);
  if (!circle || circle.radius > 1e4) return null;
  const tol = Math.max(0.01, circle.radius * 0.02);
  for (const p of pts) {
    if (Math.abs(distance(p, circle.center) - circle.radius) > tol) return null;
    if (Math.abs(dot(sub(p, circle.center), circle.normal)) > tol) return null;
  }
  return { ...circle, closed };
}

/**
 * Une los segmentos que comparten extremos con el segmento `start`, hasta cerrarse o bifurcarse.
 * `segments` es una lista plana [ax, ay, az, bx, by, bz, …]. Devuelve los puntos en orden.
 */
export function chainFrom(segments: ArrayLike<number>, start: number, limit = 4096): Vec3[] {
  const key = (i: number) => `${Math.round(segments[i] * 1e3)},${Math.round(segments[i + 1] * 1e3)},${Math.round(segments[i + 2] * 1e3)}`;
  const at = new Map<string, number[]>();
  const count = Math.floor(segments.length / 6);
  for (let s = 0; s < count; s++) {
    for (const end of [0, 3]) {
      const k = key(s * 6 + end);
      const list = at.get(k);
      if (list) list.push(s);
      else at.set(k, [s]);
    }
  }
  const point = (i: number): Vec3 => [segments[i], segments[i + 1], segments[i + 2]];
  const used = new Set([start]);
  const walk = (fromOffset: number) => {
    const out: Vec3[] = [];
    let current = start, offset = fromOffset;
    while (out.length < limit) {
      const tip = current * 6 + offset;
      const next = (at.get(key(tip)) ?? []).filter((s) => !used.has(s));
      // Una bifurcación indica que no es una arista simple: se corta ahí.
      if (next.length !== 1 || (at.get(key(tip)) ?? []).length > 2) break;
      const s = next[0];
      used.add(s);
      const startsHere = key(s * 6) === key(tip);
      out.push(point(s * 6 + (startsHere ? 3 : 0)));
      current = s;
      offset = startsHere ? 3 : 0;
    }
    return out;
  };
  const forward = walk(3);
  const backward = walk(0);
  return [...backward.reverse(), point(start * 6), point(start * 6 + 3), ...forward];
}

/** Longitud de una polilínea. */
export const polylineLength = (pts: Vec3[]) => pts.slice(1).reduce((s, p, i) => s + distance(p, pts[i]), 0);

const dimension = (label: string, from: Vec3, to: Vec3, detail?: string, circle?: Circle): Dimension => ({ id: crypto.randomUUID(), label, from, to, detail, circle });

/** Cota de una sola selección (aristas: longitud, diámetro o radio). Null si no basta con una. */
export function measureOne(p: Pick): Dimension | null {
  if (p.kind !== "edge") return null;
  const c = p.circle;
  if (c) {
    // La cota del diámetro cruza el centro en la dirección del punto elegido.
    const dir = unit(sub(p.point, c.center));
    const a = add(c.center, mul(dir, c.radius)), b = add(c.center, mul(dir, -c.radius));
    return c.closed
      ? dimension(`Ø ${fmtMm(2 * c.radius)}`, a, b, `Radio ${fmtMm(c.radius)} · perímetro ${fmtMm(2 * Math.PI * c.radius)}`, c)
      : dimension(`R ${fmtMm(c.radius)}`, c.center, a, `Arco de ${fmtMm(p.length)}`, c);
  }
  return dimension(fmtMm(p.length), p.a, p.b, "Longitud de la arista");
}

/** Cota entre dos selecciones. */
export function measureTwo(p: Pick, q: Pick): Dimension {
  // Dos caras paralelas: separación o espesor entre los planos.
  if (p.kind === "face" && q.kind === "face") {
    const angle = angleBetween(p.normal, q.normal);
    if (angle < 0.5 || angle > 179.5) {
      const gap = dot(sub(q.point, p.point), p.normal);
      return dimension(fmtMm(Math.abs(gap)), p.point, add(p.point, mul(p.normal, gap)), "Distancia entre caras paralelas");
    }
    return dimension(fmtDeg(180 - angle), p.point, q.point, `Ángulo entre caras · normales a ${fmtDeg(angle)}`);
  }
  // Punto (o arista) y cara: distancia al plano.
  if (p.kind === "face" || q.kind === "face") {
    const [face, other] = (p.kind === "face" ? [p, q] : [q, p]) as [Extract<Pick, { kind: "face" }>, Pick];
    const from = other.kind === "edge" && other.circle ? other.circle.center : other.point;
    const gap = dot(sub(from, face.point), face.normal);
    return dimension(fmtMm(Math.abs(gap)), from, sub(from, mul(face.normal, gap)), "Distancia al plano de la cara");
  }
  // Dos aristas: ángulo si son rectas no paralelas; distancia entre centros si son circulares.
  if (p.kind === "edge" && q.kind === "edge") {
    if (p.circle && q.circle) {
      return dimension(fmtMm(distance(p.circle.center, q.circle.center)), p.circle.center, q.circle.center, "Distancia entre centros");
    }
    if (!p.circle && !q.circle) {
      const angle = angleBetween(sub(p.b, p.a), sub(q.b, q.a));
      const a = Math.min(angle, 180 - angle);
      if (a > 0.5) return dimension(fmtDeg(a), p.point, q.point, "Ángulo entre aristas");
      // Paralelas: distancia perpendicular entre las rectas.
      const d = unit(sub(p.b, p.a));
      const w = sub(q.point, p.point);
      const foot = add(p.point, mul(d, dot(w, d)));
      return dimension(fmtMm(distance(q.point, foot)), foot, q.point, "Distancia entre aristas paralelas");
    }
  }
  const from = p.kind === "edge" && p.circle ? p.circle.center : p.point;
  const to = q.kind === "edge" && q.circle ? q.circle.center : q.point;
  const d = sub(to, from);
  return dimension(fmtMm(len(d)), from, to, `ΔX ${fmtMm(Math.abs(d[0]))} · ΔY ${fmtMm(Math.abs(d[1]))} · ΔZ ${fmtMm(Math.abs(d[2]))}`);
}
