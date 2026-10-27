import { MeshShape, draw, drawCircle, drawPolysides, drawRoundedRectangle, makeBaseBox, makeCylinder, makeSphere, type Shape3D } from "replicad";
import type { Loop } from "./importers";
import type { Params } from "./types";

// Generadores deterministas: reciben parámetros validados y construyen sólidos.
// Convención: milímetros, Z hacia arriba, la pared/superficie de montaje queda en Y negativo.

type Builder = (p: Params) => Shape3D;
const n = (p: Params, k: string) => Number(p[k]);

/** Caja alineada a ejes definida por sus límites. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Shape3D {
  return makeBaseBox(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, z0);
}

const union = (shapes: Shape3D[]) => shapes.reduce((a, b) => a.fuse(b));

/** Agujero pasante a lo largo de Y con rebaje para la cabeza en la cara frontal (y = yFront). */
function screwHoleY(x: number, z: number, d: number, yBack: number, yFront: number): Shape3D {
  const shank = makeCylinder(d / 2 + 0.2, yFront - yBack + 2, [x, yBack - 1, z], [0, 1, 0]);
  const headDepth = Math.min(d * 0.6, (yFront - yBack) * 0.5);
  const head = makeCylinder(d, headDepth + 1, [x, yFront - headDepth, z], [0, 1, 0]);
  return shank.fuse(head);
}

/** Agujero pasante a lo largo de Z con rebaje para la cabeza arriba o abajo. */
function screwHoleZ(x: number, y: number, d: number, zBottom: number, zTop: number, headAtTop = true): Shape3D {
  const shank = makeCylinder(d / 2 + 0.2, zTop - zBottom + 2, [x, y, zBottom - 1], [0, 0, 1]);
  const headDepth = Math.min(d * 0.6, (zTop - zBottom) * 0.5);
  const z = headAtTop ? zTop - headDepth : zBottom - 1;
  const head = makeCylinder(d, headDepth + 1, [x, y, z], [0, 0, 1]);
  return shank.fuse(head);
}

function tryFillet(shape: Shape3D, r: number, pick: Parameters<Shape3D["fillet"]>[1] | undefined): Shape3D {
  try {
    return shape.fillet(r, pick);
  } catch {
    return shape;
  }
}

const markerHolder: Builder = (p) => {
  const wall = n(p, "wall");
  const c = n(p, "clearance");
  const H = n(p, "trayHeight");
  const plate = Math.max(wall, 2.4);

  const slots: { w: number; d: number; kind: "round" | "rect" }[] = [];
  for (let i = 0; i < n(p, "markerCount"); i++) {
    const d = n(p, "markerDiameter") + 2 * c;
    slots.push({ w: d, d, kind: "round" });
  }
  if (p.eraser) slots.push({ w: n(p, "eraserWidth") + 2 * c, d: n(p, "eraserDepth") + 2 * c, kind: "rect" });
  if (slots.length === 0) slots.push({ w: 20, d: 20, kind: "rect" });

  const W = wall + slots.reduce((s, sl) => s + sl.w + wall, 0);
  const D = Math.max(...slots.map((s) => s.d)) + 2 * wall;

  let tray = box(-W / 2, W / 2, 0, D, 0, H);
  tray = tryFillet(tray, Math.min(3, wall), (e) => e.inDirection("Z"));

  let x = -W / 2 + wall;
  const pockets: Shape3D[] = [];
  for (const s of slots) {
    const cx = x + s.w / 2;
    if (s.kind === "round") pockets.push(makeCylinder(s.w / 2, H, [cx, D / 2, wall], [0, 0, 1]));
    else pockets.push(box(cx - s.w / 2, cx + s.w / 2, D / 2 - s.d / 2, D / 2 + s.d / 2, wall, H + 1));
    x += s.w + wall;
  }
  tray = tray.cut(union(pockets));

  const parts: Shape3D[] = [tray];
  if (p.mount === "clip") {
    const g = n(p, "frameThickness") + c;
    const top = H + n(p, "clipRise") + plate;
    const hook = Math.min(n(p, "hookDepth"), top - plate);
    parts.push(
      box(-W / 2, W / 2, -plate, 0.01, 0, top), // placa frontal (apoya contra el marco)
      box(-W / 2, W / 2, -2 * plate - g, 0, top - plate, top), // puente sobre el borde
      box(-W / 2, W / 2, -2 * plate - g, -plate - g, top - plate - hook, top), // pata trasera
      box(-W / 2, W / 2, -plate - g - 0.01, -plate - g + 0.8, top - plate - hook, top - plate - hook + 1.2), // diente de retención
    );
  } else if (p.mount === "adhesive") {
    parts.push(box(-W / 2, W / 2, -plate, 0.01, 0, H + n(p, "plateExtra")));
  } else {
    const d = n(p, "screwDiameter");
    const zone = d * 2 + 8;
    let back = box(-W / 2, W / 2, -plate - 1, 0.01, 0, H + zone);
    const hx = Math.max(W / 2 - d - 4, 0);
    const holes = [screwHoleY(-hx, H + zone / 2, d, -plate - 1, 0.01)];
    if (hx > 0) holes.push(screwHoleY(hx, H + zone / 2, d, -plate - 1, 0.01));
    back = back.cut(union(holes));
    parts.push(back);
  }
  return union(parts);
};

const wallHook: Builder = (p) => {
  const w = n(p, "plateWidth");
  const H = n(p, "plateHeight");
  const t = n(p, "plateThickness");
  const reach = n(p, "hookReach");
  const at = n(p, "armThickness");
  const rise = n(p, "hookRise");
  const z0 = Math.min(6, H / 4);

  let plate = box(-w / 2, w / 2, -t, 0, 0, H);
  plate = tryFillet(plate, Math.min(4, w / 4), (e) => e.inDirection("Y"));
  const arm = box(-w / 2, w / 2, -0.01, reach, z0, z0 + at);
  const tip = box(-w / 2, w / 2, reach - at, reach, z0, z0 + at + rise);
  let hook = union([plate, arm, tip]);

  if (p.mount === "screw") {
    const d = n(p, "screwDiameter");
    const zTop = H - d - 5;
    const zLow = Math.max(z0 + at + d + 4, H / 2);
    const holes = [screwHoleY(0, zTop, d, -t, 0.01)];
    if (zTop - zLow > d * 2.5) holes.push(screwHoleY(0, zLow, d, -t, 0.01));
    hook = hook.cut(union(holes));
  }
  return hook;
};

const pipeClip: Builder = (p) => {
  const ri = n(p, "pipeDiameter") / 2 + n(p, "clearance");
  const wall = n(p, "clipWall");
  const ro = ri + wall;
  const w = n(p, "clipWidth");
  const base = Math.max(3, wall);
  const zc = base + ri;

  const ring = makeCylinder(ro, w, [-w / 2, 0, zc], [1, 0, 0]).cut(makeCylinder(ri, w + 2, [-w / 2 - 1, 0, zc], [1, 0, 0]));
  const gap = (n(p, "pipeDiameter") * n(p, "opening")) / 100;
  const opened = ring.cut(box(-w / 2 - 1, w / 2 + 1, -gap / 2, gap / 2, zc, zc + ro + 1));

  const screw = p.mount === "screw";
  const d = n(p, "screwDiameter");
  const tab = screw ? d * 2 + 6 : ro * 0.6;
  const foot = box(-w / 2, w / 2, -ro - tab, ro + tab, 0, base);
  let clip = opened.fuse(foot);
  if (screw) {
    const y = ro + tab / 2;
    clip = clip.cut(union([screwHoleZ(0, -y, d, 0, base), screwHoleZ(0, y, d, 0, base)]));
  }
  return clip;
};

const lBracket: Builder = (p) => {
  const A = n(p, "legA");
  const B = n(p, "legB");
  const w = n(p, "width");
  const t = n(p, "thickness");
  const d = n(p, "screwDiameter");
  const holes = n(p, "holes");

  let bracket = union([box(-w / 2, w / 2, 0, t, 0, A), box(-w / 2, w / 2, 0, B, 0, t)]);

  if (p.gusset) {
    const gt = Math.max(2, t * 0.7);
    const tri = (x0: number) =>
      draw([t - 0.5, t - 0.5])
        .lineTo([t + (B - t) * 0.65, t - 0.5])
        .lineTo([t - 0.5, t + (A - t) * 0.65])
        .close()
        .sketchOnPlane("YZ", x0)
        .extrude(gt) as Shape3D;
    bracket = union([bracket, tri(-w / 2), tri(w / 2 - gt)]);
  }

  if (holes > 0) {
    const cuts: Shape3D[] = [];
    for (let i = 1; i <= holes; i++) {
      cuts.push(screwHoleY(0, t + ((A - t) * i) / (holes + 1), d, -0.01, t)); // cabeza hacia dentro de la escuadra
      cuts.push(screwHoleZ(0, t + ((B - t) * i) / (holes + 1), d, 0, t, false)); // tornillo desde abajo hacia la repisa
    }
    bracket = bracket.cut(union(cuts));
  }
  return bracket;
};

const organizerBox: Builder = (p) => {
  const L = n(p, "length");
  const W = n(p, "width");
  const H = n(p, "height");
  const wall = n(p, "wall");
  const floor = n(p, "floor");
  const r = Math.min(n(p, "cornerRadius"), W / 2 - 0.5, L / 2 - 0.5);
  const ri = Math.max(r - wall, 0);

  const rect = (l: number, w: number, rad: number) => (rad > 0.05 ? drawRoundedRectangle(l, w, rad) : drawRoundedRectangle(l, w));
  const outer = rect(L, W, r).sketchOnPlane("XY").extrude(H) as Shape3D;
  const inner = rect(L - 2 * wall, W - 2 * wall, ri).sketchOnPlane("XY", floor).extrude(H) as Shape3D;
  let result = outer.cut(inner);

  const dividers: Shape3D[] = [];
  const divH = H - 0.01;
  for (let i = 1; i <= n(p, "divX"); i++) {
    const x = -L / 2 + (L * i) / (n(p, "divX") + 1);
    dividers.push(box(x - wall / 2, x + wall / 2, -W / 2 + wall - 0.01, W / 2 - wall + 0.01, 0, divH));
  }
  for (let i = 1; i <= n(p, "divY"); i++) {
    const y = -W / 2 + (W * i) / (n(p, "divY") + 1);
    dividers.push(box(-L / 2 + wall - 0.01, L / 2 - wall + 0.01, y - wall / 2, y + wall / 2, 0, divH));
  }
  if (dividers.length) result = result.fuse(union(dividers));
  return result;
};

// --- Formas básicas (origen en el centro de la base) ---

const primBox: Builder = (p) => {
  const [w, d, h] = [n(p, "width"), n(p, "depth"), n(p, "height")];
  const r = Math.min(n(p, "radius"), Math.min(w, d, h) / 2 - 0.05);
  const b = makeBaseBox(w, d, h);
  return r > 0.05 ? tryFillet(b, r, undefined) : b;
};

const primCylinder: Builder = (p) => makeCylinder(n(p, "diameter") / 2, n(p, "height"));

const primTube: Builder = (p) => {
  const ro = n(p, "diameter") / 2;
  const ri = Math.max(ro - n(p, "wall"), 0.2);
  return makeCylinder(ro, n(p, "height")).cut(makeCylinder(ri, n(p, "height") + 2, [0, 0, -1]));
};

const primSphere: Builder = (p) => makeSphere(n(p, "diameter") / 2).translate(0, 0, n(p, "diameter") / 2);

const primCone: Builder = (p) => {
  const r1 = Math.max(n(p, "bottomDiameter") / 2, 0.05);
  const r2 = n(p, "topDiameter") / 2;
  const h = n(p, "height");
  const pen = draw([0, 0]).hLine(r1);
  const profile = (r2 > 0.05 ? pen.lineTo([r2, h]).hLine(-r2) : pen.lineTo([0, h])).close();
  return profile.sketchOnPlane("XZ").revolve() as Shape3D;
};

const primWedge: Builder = (p) => {
  const [w, d, h] = [n(p, "width"), n(p, "depth"), n(p, "height")];
  return draw([-d / 2, 0]).lineTo([d / 2, 0]).lineTo([-d / 2, h]).close().sketchOnPlane("YZ", -w / 2).extrude(w) as Shape3D;
};

const primPrism: Builder = (p) => drawPolysides(n(p, "diameter") / 2, n(p, "sides")).sketchOnPlane("XY").extrude(n(p, "height")) as Shape3D;

const primTorus: Builder = (p) => {
  const t = Math.min(n(p, "thickness"), n(p, "diameter") / 2 - 0.1);
  const R = n(p, "diameter") / 2 - t / 2;
  return drawCircle(t / 2).translate(R, t / 2).sketchOnPlane("XZ").revolve() as Shape3D;
};

// --- Modelos importados (registrados en el worker al abrir o importar) ---

/** Sólido exacto (OpenCascade) o malla (Manifold). Ambos comparten la API de transformaciones y booleanas. */
export type AnySolid = Shape3D | MeshShape;

type ManifoldLike = { scale(k: number): unknown; rotate(v: [number, number, number]): unknown; translate(v: [number, number, number]): unknown };
export const manifoldOf = (m: MeshShape) => (m as unknown as { wrapped: ManifoldLike }).wrapped;

export type ImportedAsset = { kind: "solid"; shape: Shape3D } | { kind: "mesh"; shape: MeshShape } | { kind: "svg"; loops: Loop[]; depth: number[] };
export const ASSETS = new Map<string, ImportedAsset>();

const imported = (p: Params): AnySolid => {
  const asset = ASSETS.get(String(p.asset));
  if (!asset) throw new Error("El modelo importado no está cargado.");
  const k = n(p, "scale") / 100;
  if (asset.kind === "solid") {
    const s = asset.shape.clone();
    return Math.abs(k - 1) > 1e-6 ? s.scale(k) : s;
  }
  if (asset.kind === "mesh") {
    // Se usa Manifold directamente: MeshShape.scale de replicad aplica la escala invertida.
    return Math.abs(k - 1) > 1e-6 ? new MeshShape(manifoldOf(asset.shape).scale(k) as never) : asset.shape.clone();
  }
  const shapes = asset.loops.map((l) => {
    const pen = draw([l[0][0] * k, l[0][1] * k]);
    for (const [x, y] of l.slice(1)) pen.lineTo([x * k, y * k]);
    return pen.close();
  });
  const solids = shapes.filter((_, i) => asset.depth[i] % 2 === 0);
  const holes = shapes.filter((_, i) => asset.depth[i] % 2 === 1);
  let drawing = solids.reduce((a, b) => a.fuse(b));
  for (const h of holes) drawing = drawing.cut(h);
  return drawing.sketchOnPlane("XY").extrude(n(p, "height")) as Shape3D;
};

export const BUILDERS: Record<string, (p: Params) => AnySolid> = {
  imported,
  box: primBox,
  cylinder: primCylinder,
  tube: primTube,
  sphere: primSphere,
  cone: primCone,
  wedge: primWedge,
  prism: primPrism,
  torus: primTorus,
  "marker-holder": markerHolder,
  "wall-hook": wallHook,
  "pipe-clip": pipeClip,
  "l-bracket": lBracket,
  organizer: organizerBox,
};
