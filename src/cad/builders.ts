import { MeshShape, draw, drawCircle, drawPolysides, drawRoundedRectangle, makeBaseBox, makeCylinder, makeSphere, type Shape3D } from "replicad";
import type { Loop } from "./importers";
import { loopDepths, parseSketch, profileLoops } from "./sketch";
import { SCREWS, enclosureOuter, holeDims, rackHoleHeights, rackPanelHeight, rackStandard } from "./templates";
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

const primRoundedPlate: Builder = (p) => {
  const [w, d, r] = [n(p, "width"), n(p, "depth"), n(p, "radius")];
  if (r >= Math.min(w, d) / 2) throw new Error("El radio debe ser menor que la mitad del ancho y del fondo.");
  return drawRoundedRectangle(w, d, r).sketchOnPlane("XY").extrude(n(p, "height")) as Shape3D;
};

const primSlot: Builder = (p) => {
  const [length, diameter, height] = [n(p, "length"), n(p, "diameter"), n(p, "height")];
  if (length < diameter) throw new Error("El largo total de la ranura debe ser mayor o igual que su diámetro.");
  const straight = length - diameter;
  if (straight < 1e-6) return makeCylinder(diameter / 2, height);
  return makeBaseBox(straight, diameter, height)
    .fuse(makeCylinder(diameter / 2, height, [-straight / 2, 0, 0]))
    .fuse(makeCylinder(diameter / 2, height, [straight / 2, 0, 0]));
};

const profile = (channel: boolean): Builder => (p) => {
  const [w, d, t, h] = [n(p, "width"), n(p, "depth"), n(p, "wall"), n(p, "height")];
  if (t >= d || t * (channel ? 2 : 1) >= w) throw new Error("El espesor es demasiado grande para las medidas del perfil.");
  const points = channel
    ? [[0, 0], [w, 0], [w, d], [w - t, d], [w - t, t], [t, t], [t, d], [0, d]]
    : [[0, 0], [w, 0], [w, t], [t, t], [t, d], [0, d]];
  const pen = draw(points[0] as [number, number]);
  for (const point of points.slice(1)) pen.lineTo(point as [number, number]);
  return pen.close().sketchOnPlane("XY").extrude(h) as Shape3D;
};

// --- Cajas y fijaciones ---

const roundedBlock = (l: number, w: number, r: number, h: number, z = 0) =>
  (r > 0.05 ? drawRoundedRectangle(l, w, Math.min(r, l / 2 - 0.01, w / 2 - 0.01)) : drawRoundedRectangle(l, w)).sketchOnPlane("XY", z).extrude(h) as Shape3D;

const enclosure: Builder = (p) => {
  const { length: L, width: W, height: H } = enclosureOuter(p);
  const [wall, floor, r] = [n(p, "wall"), n(p, "floor"), n(p, "cornerRadius")];
  const [lidT, lip, c] = [n(p, "lidThickness"), n(p, "lipHeight"), n(p, "clearance")];
  if (2 * wall >= Math.min(L, W) - 2 || floor >= H - 1) throw new Error("Las paredes ocupan todo el interior de la caja.");
  const ri = Math.max(r - wall, 0);
  const preset = SCREWS[String(p.standard)] ?? SCREWS.M3;
  const boss = n(p, "bossDiameter");
  // Centros de los soportes: tocan las paredes interiores en las esquinas.
  const bx = L / 2 - wall - boss / 2, by = W / 2 - wall - boss / 2;
  const corners = p.screws && bx > boss / 2 && by > boss / 2 ? [[-bx, -by], [bx, -by], [bx, by], [-bx, by]] : [];

  if (p.piece === "lid") {
    // Boca abajo: cara exterior sobre la cama y el labio hacia arriba.
    let lid = roundedBlock(L, W, r, lidT);
    if (lip > 0) {
      const lw = Math.min(wall, 1.6);
      const ol = L - 2 * wall - 2 * c, ow = W - 2 * wall - 2 * c;
      if (ol - 2 * lw > 1 && ow - 2 * lw > 1) {
        const ring = roundedBlock(ol, ow, Math.max(ri - c, 0), lip, lidT - 0.01).cut(roundedBlock(ol - 2 * lw, ow - 2 * lw, Math.max(ri - c - lw, 0), lip + 2, lidT - 1));
        lid = lid.fuse(ring);
      }
    }
    if (corners.length) {
      const holes = corners.map(([x, y]) => {
        const shank = makeCylinder(preset.clearance / 2, lidT + lip + 2, [x, y, -1]);
        // Avellanado cónico en la cara exterior (sobre la cama).
        const depth = (preset.cskD - preset.clearance) / 2;
        const cone = draw([0, -1]).hLine(preset.cskD / 2 + 1).lineTo([preset.clearance / 2, depth]).hLine(-preset.clearance / 2).close().sketchOnPlane("XZ").revolve().translate(x, y, 0) as Shape3D;
        return shank.fuse(cone);
      });
      lid = lid.cut(union(holes));
    }
    return lid;
  }

  let box = roundedBlock(L, W, r, H).cut(roundedBlock(L - 2 * wall, W - 2 * wall, ri, H, floor));
  if (corners.length) {
    // Los soportes terminan bajo el labio de la tapa para no chocar con él.
    const top = H - lip - 0.2;
    if (top - floor < 3) throw new Error("La caja es demasiado baja para los soportes de tornillo con este labio.");
    const holeD = p.bossHole === "insert" ? preset.insertD : preset.clearance * 0.8;
    const bosses = corners.map(([x, y]) => makeCylinder(boss / 2, top - floor + 0.01, [x, y, floor - 0.01]));
    box = box.fuse(union(bosses));
    box = box.cut(union(corners.map(([x, y]) => makeCylinder(holeD / 2, top - floor, [x, y, floor + 0.6]))));
  }
  return box;
};

/** Agujero con la entrada en z = depth (+1 si es pasante) y 1 mm de sobrante por encima. */
const screwHole: Builder = (p) => {
  const depth = n(p, "depth");
  const bottom = p.through ? -1 : 0;
  const { diameter, headD, headDepth } = holeDims(p);
  if (!(diameter > 0)) throw new Error("El diámetro del agujero debe ser mayor que cero.");
  let hole = makeCylinder(diameter / 2, depth + 1 - bottom, [0, 0, bottom]);
  const head = String(p.head);
  if (head === "countersink" && headD > diameter) {
    const h = (headD - diameter) / 2; // 90°: la profundidad es igual a la diferencia de radios
    hole = hole.fuse(draw([0, depth - h]).hLine(diameter / 2).lineTo([headD / 2, depth]).lineTo([headD / 2, depth + 1]).hLine(-headD / 2).close().sketchOnPlane("XZ").revolve() as Shape3D);
  } else if (head !== "none" && headD > 0 && headDepth > 0) {
    const z = Math.max(bottom, depth - headDepth);
    const pocket = head === "nut"
      ? (drawPolysides(headD / Math.sqrt(3), 6).sketchOnPlane("XY", z).extrude(depth + 1 - z) as Shape3D)
      : makeCylinder(headD / 2, depth + 1 - z, [0, 0, z]);
    hole = hole.fuse(pocket);
  }
  return hole;
};

const vent: Builder = (p) => {
  const [nx, ny, size, pitch, depth] = [n(p, "countX"), n(p, "countY"), n(p, "size"), n(p, "spacing"), n(p, "depth")];
  const bottom = p.through ? -1 : 0, h = depth + 1 - bottom;
  const slots = p.pattern === "slots";
  const len = slots ? Math.max(n(p, "length"), size) : size;
  // Las ranuras se reparten en X; las filas, una tras otra en Y.
  const stepY = slots ? len + pitch - size : pitch;
  const cells: Shape3D[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = (i - (nx - 1) / 2) * pitch, y = (j - (ny - 1) / 2) * stepY;
      const shape = slots
        ? (drawRoundedRectangle(size, len, size / 2 - 0.01).sketchOnPlane("XY", bottom).extrude(h) as Shape3D)
        : p.pattern === "hex"
          ? (drawPolysides(size / Math.sqrt(3), 6).sketchOnPlane("XY", bottom).extrude(h) as Shape3D)
          : makeCylinder(size / 2, h, [0, 0, bottom]);
      cells.push(shape.translate(x, y, 0));
    }
  }
  if (slots && pitch <= size) throw new Error("La separación debe ser mayor que el ancho de las ranuras.");
  return union(cells);
};

// --- Racks ---

/** Ojal (ranura de extremos redondos) a lo largo de X, centrado en (x, y), atravesando z0..z1. */
function slotXY(x: number, y: number, length: number, width: number, z0: number, z1: number): Shape3D {
  const straight = Math.max(length - width, 0);
  let s = makeCylinder(width / 2, z1 - z0, [x - straight / 2, y, z0]);
  if (straight > 1e-6) s = s.fuse(makeCylinder(width / 2, z1 - z0, [x + straight / 2, y, z0])).fuse(box(x - straight / 2, x + straight / 2, y - width / 2, y + width / 2, z0, z1));
  return s;
}

/** Ojales de montaje EIA-310 en una placa plana: X a ±separación/2, Y desde el borde inferior. */
function rackSlots(p: Params, xs: number[], z0: number, z1: number, yOffset = 0): Shape3D[] {
  return rackHoleHeights(n(p, "units"), String(p.holeLayout)).flatMap((y) => xs.map((x) => slotXY(x, y + yOffset, n(p, "slotLength"), 6.5, z0, z1)));
}

/** Panel plano: X ancho, Y alto (desde 0) y Z grosor. Las mitades se solapan 24 mm a media altura del grosor. */
const rackPanel: Builder = (p) => {
  const { width, holeSpacing } = rackStandard(p);
  const H = rackPanelHeight(n(p, "units"));
  const t = n(p, "thickness");
  const split = String(p.split);
  const lap = 12;
  let panel: Shape3D;
  if (split === "left") panel = box(-width / 2, 0, 0, H, 0, t).fuse(box(-0.01, lap, 0, H, t / 2, t));
  else if (split === "right") panel = box(0, width / 2, 0, H, 0, t).fuse(box(-lap, 0.01, 0, H, 0, t / 2));
  else panel = box(-width / 2, width / 2, 0, H, 0, t);
  const cuts = rackSlots(p, split === "left" ? [-holeSpacing / 2] : split === "right" ? [holeSpacing / 2] : [-holeSpacing / 2, holeSpacing / 2], -1, t + 1);
  if (split !== "full") {
    // Dos tornillos M3 atraviesan el solape central.
    for (const y of [H * 0.25, H * 0.75]) cuts.push(makeCylinder(SCREWS.M3.clearance / 2, t + 2, [split === "left" ? lap / 2 : -lap / 2, y, -1]));
  }
  if (p.cutout) {
    const [cw, ch] = [n(p, "cutoutWidth"), n(p, "cutoutHeight")];
    const r = Math.min(n(p, "cutoutRadius"), cw / 2 - 0.01, ch / 2 - 0.01);
    cuts.push((r > 0.05 ? drawRoundedRectangle(cw, ch, r) : drawRoundedRectangle(cw, ch)).sketchOnPlane("XY", -1).extrude(t + 2).translate(0, H / 2, 0) as Shape3D);
  }
  return panel.cut(union(cuts));
};

/** Bandeja: base en XY (Y hacia el fondo), frente vertical en y ∈ [−t, 0] con los ojales. */
const rackShelf: Builder = (p) => {
  const { width, holeSpacing, opening } = rackStandard(p);
  const H = rackPanelHeight(n(p, "units"));
  const [t, depth, wallH] = [n(p, "thickness"), n(p, "depth"), n(p, "wallHeight")];
  const inner = opening - 4;
  const parts = [box(-width / 2, width / 2, -t, 0, 0, H), box(-inner / 2, inner / 2, -0.01, depth, 0, t)];
  if (wallH > 0) for (const x of [-inner / 2, inner / 2 - t]) parts.push(box(x, x + t, -0.01, depth, 0, t + wallH));
  let shelf = union(parts);
  // Los ojales del frente se cortan a lo largo de Y: se dibujan en XY y se giran al plano XZ.
  // Girar 90° en X lleva (x, y, z) a (x, −z, y): la altura del agujero pasa a Z y el espesor, a Y.
  const slots = rackSlots(p, [-holeSpacing / 2, holeSpacing / 2], -1, t + 1).map((s) => s.rotate(90, [0, 0, 0], [1, 0, 0]));
  shelf = shelf.cut(union(slots));
  if (p.vents) {
    const pitch = 8, len = Math.max(10, depth - 30);
    const count = Math.floor((inner - 2 * t - 20) / pitch);
    const vents: Shape3D[] = [];
    for (let i = 0; i < count; i++) vents.push(drawRoundedRectangle(4, len, 1.99).sketchOnPlane("XY", -1).extrude(t + 2).translate((i - (count - 1) / 2) * pitch, 15 + len / 2, 0) as Shape3D);
    if (vents.length) shelf = shelf.cut(union(vents));
  }
  return shelf;
};

/** Oreja: placa frontal (XZ, y ∈ [−t, 0]) con los ojales y pestaña lateral (YZ) que se atornilla al equipo. */
const rackEar: Builder = (p) => {
  const { width, holeSpacing } = rackStandard(p);
  const H = rackPanelHeight(n(p, "units"));
  const t = n(p, "thickness");
  const left = p.side !== "right";
  // Coordenadas para la oreja izquierda; la derecha se refleja al final.
  const xOuter = -width / 2, xEquip = -n(p, "equipmentWidth") / 2;
  const flangeX = xEquip - t;
  let ear = box(xOuter, xEquip, -t, 0, 0, H).fuse(box(flangeX, xEquip, -0.01, n(p, "equipmentDepth"), 0, H));
  const slots = rackHoleHeights(n(p, "units"), String(p.holeLayout)).map((z) => {
    const s = slotXY(-holeSpacing / 2, 0, n(p, "slotLength"), 6.5, -t - 1, t + 1);
    return s.rotate(90, [0, 0, 0], [1, 0, 0]).translate(0, -t / 2, z);
  });
  const screw = SCREWS[String(p.sideScrew)] ?? SCREWS.M3;
  const holes: Shape3D[] = [];
  for (let i = 0; i < n(p, "sideHoles"); i++) {
    const y = n(p, "equipmentDepth") - 8 - i * n(p, "sideHoleSpacing");
    if (y > 4) holes.push(makeCylinder(screw.clearance / 2, t + 2, [flangeX - 1, y, n(p, "sideHoleHeight")], [1, 0, 0]));
  }
  if (xEquip - xOuter < 14) throw new Error("El equipo es demasiado ancho para este rack.");
  ear = ear.cut(union([...slots, ...holes]));
  return left ? ear : ear.mirror([1, 0, 0], [0, 0, 0]);
};

/** Escuadra como la de fijación, con ojales en ambos brazos (a lo largo de cada brazo). */
const adjustableBracket: Builder = (p) => {
  const [A, B, w, t, travel] = [n(p, "legA"), n(p, "legB"), n(p, "width"), n(p, "thickness"), n(p, "travel")];
  const d = (SCREWS[String(p.standard)] ?? SCREWS.M4).clearance;
  let bracket = union([box(-w / 2, w / 2, 0, t, 0, A), box(-w / 2, w / 2, 0, B, 0, t)]);
  if (p.gusset) {
    const gt = Math.max(2, t * 0.7);
    const tri = (x0: number) => draw([t - 0.5, t - 0.5]).lineTo([t + (B - t) * 0.35, t - 0.5]).lineTo([t - 0.5, t + (A - t) * 0.35]).close().sketchOnPlane("YZ", x0).extrude(gt) as Shape3D;
    bracket = union([bracket, tri(-w / 2), tri(w / 2 - gt)]);
  }
  const len = travel + d;
  // Brazo horizontal: ojal a lo largo de Y. Brazo vertical: a lo largo de Z.
  const yMid = t + (B - t) * 0.6, zMid = t + (A - t) * 0.6;
  const horizontal = slotXY(yMid, 0, len, d, -1, t + 1).rotate(90, [0, 0, 0], [0, 0, 1]);
  // −90° en Y y luego −90° en Z: el largo (X) pasa a Z y el espesor (Z), a Y.
  const vertical = slotXY(zMid, 0, len, d, -1, t + 1).rotate(-90, [0, 0, 0], [0, 1, 0]).rotate(-90, [0, 0, 0], [0, 0, 1]);
  return bracket.cut(horizontal.fuse(vertical));
};

const cablePass: Builder = (p) => {
  const [w, h, depth] = [n(p, "width"), n(p, "height"), n(p, "depth")];
  const r = Math.min(n(p, "radius"), w / 2 - 0.01, h / 2 - 0.01);
  const bottom = p.through ? -1 : 0;
  return (r > 0.05 ? drawRoundedRectangle(w, h, r) : drawRoundedRectangle(w, h)).sketchOnPlane("XY", bottom).extrude(depth + 1 - bottom) as Shape3D;
};

// --- Bocetos ---

/** Perfil del boceto: contornos pares como material y los impares (dentro de otros) como huecos. */
const sketchPart: Builder = (p) => {
  const loops = profileLoops(parseSketch(p.profile));
  const depth = loopDepths(loops);
  const drawings = loops.map((loop) => {
    if (loop.circle) return drawCircle(loop.circle.r).translate(loop.circle.c[0], loop.circle.c[1]);
    const pen = draw(loop.start);
    for (const s of loop.segments) {
      if (s.kind === "line") pen.lineTo(s.to);
      else pen.threePointsArcTo(s.to, s.mid);
    }
    return pen.close();
  });
  const solids = drawings.filter((_, i) => depth[i] % 2 === 0);
  const holes = drawings.filter((_, i) => depth[i] % 2 === 1);
  let profile = solids.reduce((a, b) => a.fuse(b));
  for (const h of holes) profile = profile.cut(h);
  if (p.operation === "revolve") {
    // El eje Y del boceto pasa a ser el eje Z: se revoluciona alrededor de él.
    const angle = Math.min(360, Math.max(1, n(p, "angle")));
    return profile.sketchOnPlane("XZ").revolve([0, 0, 1], { angle }) as Shape3D;
  }
  return profile.sketchOnPlane("XY").extrude(n(p, "height")) as Shape3D;
};

// --- Modelos importados (registrados en el worker al abrir o importar) ---

/** Sólido exacto (OpenCascade) o malla (Manifold). Ambos comparten la API de transformaciones y booleanas. */
export type AnySolid = Shape3D | MeshShape;

type ManifoldLike = { numTri(): number; delete(): void; mirror(v: [number, number, number]): ManifoldLike; scale(k: number): ManifoldLike; rotate(v: [number, number, number]): ManifoldLike; translate(v: [number, number, number]): ManifoldLike; trimByPlane(normal: [number, number, number], offset: number): ManifoldLike };
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
    return new MeshShape(manifoldOf(asset.shape).scale(k) as never);
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
  "rounded-plate": primRoundedPlate,
  slot: primSlot,
  "profile-l": profile(false),
  "profile-u": profile(true),
  "marker-holder": markerHolder,
  "wall-hook": wallHook,
  "pipe-clip": pipeClip,
  "l-bracket": lBracket,
  organizer: organizerBox,
  enclosure,
  "screw-hole": screwHole,
  vent,
  sketch: sketchPart,
  "rack-panel": rackPanel,
  "rack-shelf": rackShelf,
  "rack-ears": rackEar,
  "adjustable-bracket": adjustableBracket,
  "cable-pass": cablePass,
};
