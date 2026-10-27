import { strFromU8, unzipSync } from "fflate";

// Lectores de formatos de intercambio. Todos los formatos de malla se convierten a STL binario,
// que OpenCascade transforma en un sólido; STEP se lee directamente; SVG se convierte en contornos 2D.

export type ImportFormat = "stl" | "3mf" | "obj" | "amf" | "step" | "svg";

export const IMPORT_EXTENSIONS: Record<string, ImportFormat> = {
  stl: "stl",
  "3mf": "3mf",
  obj: "obj",
  amf: "amf",
  step: "step",
  stp: "step",
  svg: "svg",
};

export const ACCEPT_ATTR = Object.keys(IMPORT_EXTENSIONS)
  .map((e) => "." + e)
  .join(",");

export function formatOf(fileName: string): ImportFormat | null {
  return IMPORT_EXTENSIONS[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

type Tri = [number, number, number, number, number, number, number, number, number];

function binarySTL(tris: Tri[]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2];
    const vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const v of [nx, ny, nz, ...t]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

/** Matriz 3MF «m00 m01 m02 m10 … m32» aplicada a un vértice. */
function applyTransform(m: number[] | null, x: number, y: number, z: number): [number, number, number] {
  if (!m) return [x, y, z];
  return [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("El archivo XML está dañado.");
  return doc;
}

const byLocal = (root: Document | Element, name: string) => [...root.getElementsByTagNameNS("*", name)];

function trianglesFrom3MF(bytes: Uint8Array): Tri[] {
  const files = unzipSync(bytes);
  const modelKeys = Object.keys(files).filter((k) => k.toLowerCase().endsWith(".model"));
  if (modelKeys.length === 0) throw new Error("El 3MF no contiene modelos.");
  const meshes = new Map<string, { verts: number[][]; tris: number[][]; components: { id: string; m: number[] | null }[] }>();
  const builds: { id: string; m: number[] | null }[] = [];
  const parseM = (s: string | null) => (s ? s.trim().split(/\s+/).map(Number) : null);
  for (const key of modelKeys) {
    const doc = parseXml(strFromU8(files[key]));
    for (const obj of byLocal(doc, "object")) {
      const id = obj.getAttribute("id") ?? "";
      const verts = byLocal(obj, "vertex").map((v) => ["x", "y", "z"].map((a) => parseFloat(v.getAttribute(a) ?? "0")));
      const tris = byLocal(obj, "triangle").map((t) => ["v1", "v2", "v3"].map((a) => parseInt(t.getAttribute(a) ?? "0", 10)));
      const components = byLocal(obj, "component").map((c) => ({ id: c.getAttribute("objectid") ?? "", m: parseM(c.getAttribute("transform")) }));
      meshes.set(id, { verts, tris, components });
    }
    for (const item of byLocal(doc, "item")) builds.push({ id: item.getAttribute("objectid") ?? "", m: parseM(item.getAttribute("transform")) });
  }
  const out: Tri[] = [];
  const emit = (id: string, m: number[] | null, depth = 0) => {
    const mesh = meshes.get(id);
    if (!mesh || depth > 8) return;
    for (const [a, b, c] of mesh.tris) {
      const p = [a, b, c].map((i) => applyTransform(m, mesh.verts[i][0], mesh.verts[i][1], mesh.verts[i][2]));
      out.push([...p[0], ...p[1], ...p[2]] as Tri);
    }
    // Las transformaciones de componentes anidados se ignoran salvo la del elemento de construcción.
    for (const c of mesh.components) emit(c.id, c.m ?? m, depth + 1);
  };
  if (builds.length) builds.forEach((b) => emit(b.id, b.m));
  else meshes.forEach((_, id) => emit(id, null));
  return out;
}

function trianglesFromAMF(bytes: Uint8Array): Tri[] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const text = isZip ? strFromU8(Object.values(unzipSync(bytes))[0]) : strFromU8(bytes);
  const doc = parseXml(text);
  const out: Tri[] = [];
  for (const obj of byLocal(doc, "object")) {
    const verts = byLocal(obj, "vertex").map((v) => ["x", "y", "z"].map((a) => parseFloat(byLocal(v, a)[0]?.textContent ?? "0")));
    for (const t of byLocal(obj, "triangle")) {
      const idx = ["v1", "v2", "v3"].map((a) => parseInt(byLocal(t, a)[0]?.textContent ?? "0", 10));
      out.push([...verts[idx[0]], ...verts[idx[1]], ...verts[idx[2]]] as Tri);
    }
  }
  return out;
}

function trianglesFromOBJ(text: string): Tri[] {
  const verts: number[][] = [];
  const out: Tri[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) verts.push(line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number));
    else if (line.startsWith("f ")) {
      const idx = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const i = parseInt(tok.split("/")[0], 10);
          return i < 0 ? verts.length + i : i - 1;
        });
      for (let k = 1; k + 1 < idx.length; k++) out.push([...verts[idx[0]], ...verts[idx[k]], ...verts[idx[k + 1]]] as Tri);
    }
  }
  return out;
}

/** Convierte cualquier formato de malla a STL binario. STL y STEP se devuelven tal cual. */
export function toImportable(format: ImportFormat, bytes: Uint8Array): { kind: "stl" | "step"; bytes: Uint8Array } {
  if (format === "stl" || format === "step") return { kind: format, bytes };
  const tris = format === "3mf" ? trianglesFrom3MF(bytes) : format === "amf" ? trianglesFromAMF(bytes) : format === "obj" ? trianglesFromOBJ(strFromU8(bytes)) : [];
  if (tris.length === 0) throw new Error("No se encontraron triángulos en el archivo.");
  return { kind: "stl", bytes: binarySTL(tris) };
}

export function triangleCountSTL(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 84) return null;
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
  return 84 + n * 50 === bytes.byteLength ? n : null; // null = STL de texto
}

// ---------------------------------------------------------------- SVG

/** Contornos cerrados en milímetros (1 unidad SVG = 1 mm), con Y hacia arriba. */
export type Loop = [number, number][];

function flattenPath(d: string): Loop[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const loops: Loop[] = [];
  let cur: Loop = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let cmd = "";
  let lastCtrl: [number, number] | null = null;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const close = () => {
    if (cur.length > 2) loops.push(cur);
    cur = [];
  };
  const bezier = (pts: [number, number][], steps = 16) => {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      let p = pts.map((q) => [...q] as [number, number]);
      while (p.length > 1) p = p.slice(1).map((q, k) => [p[k][0] + (q[0] - p[k][0]) * t, p[k][1] + (q[1] - p[k][1]) * t]);
      cur.push(p[0]);
    }
  };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
        close();
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        cur.push([x, y]);
        cmd = rel ? "l" : "L";
        break;
      case "L":
        x = ox + num();
        y = oy + num();
        cur.push([x, y]);
        break;
      case "H":
        x = (rel ? x : 0) + num();
        cur.push([x, y]);
        break;
      case "V":
        y = (rel ? y : 0) + num();
        cur.push([x, y]);
        break;
      case "C": {
        const c1: [number, number] = [ox + num(), oy + num()];
        const c2: [number, number] = [ox + num(), oy + num()];
        const e: [number, number] = [ox + num(), oy + num()];
        bezier([[x, y], c1, c2, e]);
        lastCtrl = c2;
        [x, y] = e;
        continue;
      }
      case "S": {
        const c1: [number, number] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const c2: [number, number] = [ox + num(), oy + num()];
        const e: [number, number] = [ox + num(), oy + num()];
        bezier([[x, y], c1, c2, e]);
        lastCtrl = c2;
        [x, y] = e;
        continue;
      }
      case "Q": {
        const c: [number, number] = [ox + num(), oy + num()];
        const e: [number, number] = [ox + num(), oy + num()];
        bezier([[x, y], c, e]);
        lastCtrl = c;
        [x, y] = e;
        continue;
      }
      case "T": {
        const c: [number, number] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const e: [number, number] = [ox + num(), oy + num()];
        bezier([[x, y], c, e]);
        lastCtrl = c;
        [x, y] = e;
        continue;
      }
      case "A": {
        // Arco aproximado por líneas: radios, rotación y banderas se leen pero se usa interpolación circular simple.
        const rx = num(), ry = num();
        num();
        const large = num(), sweep = num();
        const ex = ox + num(), ey = oy + num();
        const r = Math.max(rx, ry, Math.hypot(ex - x, ey - y) / 2);
        const mx = (x + ex) / 2, my = (y + ey) / 2;
        const half = Math.hypot(ex - x, ey - y) / 2;
        const h = Math.sqrt(Math.max(r * r - half * half, 0)) * (large === sweep ? -1 : 1);
        const dx = (ey - y) / (2 * half || 1), dy = -(ex - x) / (2 * half || 1);
        const cx = mx + h * dx, cy = my + h * dy;
        let a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ey - cy, ex - cx);
        if (sweep && a1 < a0) a1 += Math.PI * 2;
        if (!sweep && a1 > a0) a1 -= Math.PI * 2;
        for (let s = 1; s <= 24; s++) {
          const a = a0 + ((a1 - a0) * s) / 24;
          cur.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        x = ex;
        y = ey;
        a0 = a1;
        break;
      }
      case "Z":
        x = sx;
        y = sy;
        close();
        break;
      default:
        i++;
    }
    lastCtrl = null;
  }
  close();
  return loops;
}

const area = (l: Loop) => l.reduce((s, p, k) => s + p[0] * l[(k + 1) % l.length][1] - l[(k + 1) % l.length][0] * p[1], 0) / 2;

export function loopsFromSVG(text: string): Loop[] {
  const doc = parseXml(text);
  const loops: Loop[] = [];
  for (const el of byLocal(doc, "path")) loops.push(...flattenPath(el.getAttribute("d") ?? ""));
  const n = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? "0");
  for (const el of byLocal(doc, "rect")) {
    const [x, y, w, h] = [n(el, "x"), n(el, "y"), n(el, "width"), n(el, "height")];
    loops.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  }
  for (const el of [...byLocal(doc, "circle"), ...byLocal(doc, "ellipse")]) {
    const cx = n(el, "cx"), cy = n(el, "cy");
    const rx = el.localName === "circle" ? n(el, "r") : n(el, "rx");
    const ry = el.localName === "circle" ? n(el, "r") : n(el, "ry");
    loops.push(Array.from({ length: 48 }, (_, k) => [cx + rx * Math.cos((k / 48) * Math.PI * 2), cy + ry * Math.sin((k / 48) * Math.PI * 2)] as [number, number]));
  }
  for (const el of byLocal(doc, "polygon")) {
    const v = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
    const pts: Loop = [];
    for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    if (pts.length > 2) loops.push(pts);
  }
  // Quitar puntos repetidos consecutivos y contornos degenerados; invertir Y (SVG crece hacia abajo).
  const clean = loops
    .map((l) => l.filter((p, k) => k === 0 || Math.hypot(p[0] - l[k - 1][0], p[1] - l[k - 1][1]) > 1e-4).map(([px, py]) => [px, -py] as [number, number]))
    .map((l) => (Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1e-4 ? l.slice(0, -1) : l))
    .filter((l) => l.length > 2 && Math.abs(area(l)) > 1e-3);
  if (clean.length === 0) throw new Error("El SVG no tiene contornos cerrados (path, rect, circle, ellipse o polygon).");
  return clean;
}

/** Profundidad de anidado de cada contorno (par = material, impar = hueco). */
export function nestingDepth(loops: Loop[]): number[] {
  const inside = ([px, py]: [number, number], l: Loop) => {
    let c = false;
    for (let a = 0, b = l.length - 1; a < l.length; b = a++) {
      if (l[a][1] > py !== l[b][1] > py && px < ((l[b][0] - l[a][0]) * (py - l[a][1])) / (l[b][1] - l[a][1]) + l[a][0]) c = !c;
    }
    return c;
  };
  return loops.map((l, i) => loops.filter((o, j) => j !== i && Math.abs(area(o)) > Math.abs(area(l)) && inside(l[0], o)).length);
}
