import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Crosshair, Ruler, Square, Trash2, X } from "lucide-react";
import type { MeshPayload } from "../cad/client";
import { importPreviewScale } from "../cad/importScale";
import { entryOffset, getTemplate } from "../cad/templates";
import { MAIN_BODY, type Part, type Vec3 } from "../cad/types";
import { chainFrom, fitCircle, polylineLength, type Pick, type PickKind } from "../studio/measure";
import { rotationFromNormal } from "../studio/modeling";
import { newPart, uniqueName } from "../studio/parts";
import { useTools } from "../studio/tools";
import { useStore } from "../store";
import { cx } from "./ui";

// Clics en el visor para medir, perforar y elegir aristas. Las coordenadas de la malla son
// locales a la pieza; todo lo que se mide se convierte a coordenadas del mundo.

type Seg = { index: number; t: number; distance: number };
const toVec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

/** Segmento de arista más cercano a un punto (coordenadas locales de la malla). */
function nearestSegment(edges: Float32Array, p: THREE.Vector3): Seg | null {
  let best: Seg | null = null;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  for (let s = 0; s < edges.length / 6; s++) {
    a.fromArray(edges, s * 6);
    b.fromArray(edges, s * 6 + 3);
    ab.subVectors(b, a);
    const l2 = ab.lengthSq();
    const t = l2 > 0 ? Math.max(0, Math.min(1, ap.subVectors(p, a).dot(ab) / l2)) : 0;
    const d = a.addScaledVector(ab, t).distanceTo(p);
    if (!best || d < best.distance) best = { index: s, t, distance: d };
  }
  return best;
}

/** Grupo (arista exacta) al que pertenece un segmento. */
function groupOf(groups: Uint32Array | undefined, segment: number) {
  if (!groups) return -1;
  for (let g = 0; g < groups.length / 2; g++) if (segment >= groups[g * 2] && segment < groups[g * 2] + groups[g * 2 + 1]) return g;
  return -1;
}

/** Puntos de una arista exacta (su grupo) o, en mallas, de la cadena de segmentos conectados. */
function edgePolyline(mesh: MeshPayload, segment: number): Vec3[] {
  const g = groupOf(mesh.edgeGroups, segment);
  if (g < 0) return chainFrom(mesh.edges, segment);
  const [start, count] = [mesh.edgeGroups![g * 2], mesh.edgeGroups![g * 2 + 1]];
  const pts: Vec3[] = [];
  for (let s = start; s < start + count; s++) {
    if (s === start) pts.push([mesh.edges[s * 6], mesh.edges[s * 6 + 1], mesh.edges[s * 6 + 2]]);
    pts.push([mesh.edges[s * 6 + 3], mesh.edges[s * 6 + 4], mesh.edges[s * 6 + 5]]);
  }
  return pts;
}

const tolerance = (mesh: MeshPayload) => Math.max(0.6, Math.hypot(...mesh.bbox.max.map((v, i) => v - mesh.bbox.min[i])) * 0.025);

/** Normal del mundo de la cara tocada, orientada hacia la cámara. */
function worldNormal(e: ThreeEvent<MouseEvent>): THREE.Vector3 {
  const n = (e.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone().transformDirection(e.object.matrixWorld);
  if (n.dot(e.ray.direction) > 0) n.negate();
  return n;
}

/** Contexto de lo que se tocó: una pieza en la vista de piezas o el resultado combinado. */
export interface PickTarget {
  mesh: MeshPayload;
  part?: Part;
  /** Cuerpo tocado en la vista de resultado. */
  body?: string;
}

export function handlePick(e: ThreeEvent<MouseEvent>, target: PickTarget): boolean {
  const tools = useTools.getState();
  const mode = tools.mode;
  if (!mode) return false;
  e.stopPropagation();
  const { mesh, part } = target;
  const object = e.object;
  const local = object.worldToLocal(e.point.clone());
  const toWorld = (p: Vec3) => toVec(new THREE.Vector3(...p).applyMatrix4(object.matrixWorld));

  if (mode.kind === "measure") {
    const near = nearestSegment(mesh.edges, local);
    const close = near && near.distance < tolerance(mesh);
    if (mode.target === "point") {
      // Se ajusta al vértice de arista más cercano si está cerca.
      let point = toVec(e.point);
      if (close && near) {
        const end = near.t < 0.5 ? 0 : 3;
        const v = new THREE.Vector3().fromArray(mesh.edges, near.index * 6 + end);
        if (v.distanceTo(local) < tolerance(mesh)) point = toWorld(toVec(v));
      }
      tools.addPick({ kind: "point", point });
    } else if (mode.target === "face") {
      tools.addPick({ kind: "face", point: toVec(e.point), normal: toVec(worldNormal(e)) });
    } else {
      if (!close || !near) return tools.setHint("Haz clic más cerca de una arista."), true;
      const pts = edgePolyline(mesh, near.index).map(toWorld);
      const a = toWorld([mesh.edges[near.index * 6], mesh.edges[near.index * 6 + 1], mesh.edges[near.index * 6 + 2]]);
      const b = toWorld([mesh.edges[near.index * 6 + 3], mesh.edges[near.index * 6 + 4], mesh.edges[near.index * 6 + 5]]);
      const circle = fitCircle(pts) ?? undefined;
      const pick: Pick = { kind: "edge", point: toVec(e.point), a: pts.length > 2 && !circle ? pts[0] : a, b: pts.length > 2 && !circle ? pts[pts.length - 1] : b, length: polylineLength(pts), circle };
      tools.addPick(pick);
    }
    tools.setHint(null);
    return true;
  }

  if (mode.kind === "place") {
    if (part?.mode === "hole") return tools.setHint("Haz clic sobre una pieza sólida."), true;
    const body = target.body ?? part?.body ?? MAIN_BODY;
    const n = worldNormal(e);
    let depth = Number(mode.params.depth);
    if (mode.params.through) {
      // Espesor bajo el punto: primera salida a lo largo de la normal hacia dentro.
      // La salida es una cara vista por detrás: se sondea con un material de doble cara.
      const probe = new THREE.Mesh((object as THREE.Mesh).geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      probe.matrixWorld.copy(object.matrixWorld);
      const ray = new THREE.Raycaster(e.point.clone().addScaledVector(n, 0.01), n.clone().negate());
      const range = target.body && mesh.bodies?.find((b) => b.name === target.body);
      const hits = ray.intersectObject(probe, false);
      (probe.material as THREE.Material).dispose();
      const hit = hits.find((h) => h.distance > 0.05 && (!range || (h.faceIndex! >= range.triStart && h.faceIndex! < range.triStart + range.triCount)));
      if (hit) depth = +(hit.distance - 0.01).toFixed(2);
    }
    const params = { ...mode.params, depth };
    const doc = useStore.getState().doc;
    if (!doc) return true;
    const t = getTemplate(mode.type)!;
    const position = toVec(e.point.clone().addScaledVector(n, -entryOffset(params)));
    const hole = newPart(mode.type, { name: uniqueName(doc.parts, t.name), params, position, rotation: rotationFromNormal(toVec(n)), mode: "hole", cutBodies: [body], estimated: [] });
    useStore.getState().addParts([hole]);
    tools.setHint(`${t.name} colocado en «${body}»${mode.params.through ? ` (espesor ${depth.toLocaleString("es")} mm)` : ""}. Haz clic en otra cara o pulsa Esc.`);
    return true;
  }

  // Aristas para redondear: solo en la pieza elegida y si es un sólido exacto.
  if (!part || part.id !== mode.partId) return tools.setHint("Elige aristas de la pieza seleccionada."), true;
  if (!mesh.edgeGroups) return tools.setHint("Esta pieza es una malla: los redondeos por arista requieren figuras nativas o STEP."), true;
  const near = nearestSegment(mesh.edges, local);
  if (!near || near.distance > tolerance(mesh)) return tools.setHint("Haz clic más cerca de una arista."), true;
  const group = groupOf(mesh.edgeGroups, near.index);
  // Punto interior de la arista real (no un extremo, que comparten varias aristas):
  // en una recta, el centro del segmento; en una curva, un vértice intermedio de la teselación.
  const [start, count] = [mesh.edgeGroups[group * 2], mesh.edgeGroups[group * 2 + 1]];
  let best = new THREE.Vector3().fromArray(mesh.edges, start * 6).add(new THREE.Vector3().fromArray(mesh.edges, start * 6 + 3)).multiplyScalar(0.5);
  let bestD = Infinity;
  for (let s = start + 1; s < start + count; s++) {
    const v = new THREE.Vector3().fromArray(mesh.edges, s * 6);
    const d = v.distanceTo(local);
    if (d < bestD) [best, bestD] = [v, d];
  }
  const k = part.features?.length ? 1 : importPreviewScale(part.type, part.params);
  tools.toggleEdge({ point: [best.x * k, best.y * k, best.z * k].map((v) => +v.toFixed(5)) as Vec3, group });
  tools.setHint(null);
  return true;
}

/** Aristas elegidas resaltadas sobre la pieza (coordenadas locales), con líneas gruesas. */
export function SelectedEdges({ mesh }: { mesh: MeshPayload }) {
  const edges = useTools((s) => s.edges);
  const points = useMemo(() => {
    if (!mesh.edgeGroups || !edges.length) return null;
    const pts: Vec3[] = [];
    for (const { group } of edges) {
      const [start, count] = [mesh.edgeGroups[group * 2], mesh.edgeGroups[group * 2 + 1]];
      for (let s = start; s < start + count; s++) pts.push([mesh.edges[s * 6], mesh.edges[s * 6 + 1], mesh.edges[s * 6 + 2]], [mesh.edges[s * 6 + 3], mesh.edges[s * 6 + 4], mesh.edges[s * 6 + 5]]);
    }
    return pts;
  }, [mesh, edges]);
  if (!points) return null;
  return <Line points={points} segments color="#f59e0b" lineWidth={4} depthTest={false} renderOrder={10} />;
}

const fmtLabel = "pointer-events-none whitespace-nowrap rounded-md border border-line bg-surface/95 px-1.5 py-0.5 font-mono text-[11px] text-fg shadow";

/** Cotas y selecciones pendientes dibujadas en la escena. */
export function Dimensions() {
  const dims = useTools((s) => s.dims);
  const picks = useTools((s) => s.picks);
  return (
    <group renderOrder={20}>
      {dims.map((d) => {
        const mid = d.from.map((v, i) => (v + d.to[i]) / 2) as Vec3;
        return (
          <group key={d.id}>
            <Line points={[d.from, d.to]} color="#fbbf24" lineWidth={2} depthTest={false} />
            {[d.from, d.to].map((p, i) => (
              <mesh key={i} position={p} renderOrder={21}>
                <sphereGeometry args={[0.6, 12, 8]} />
                <meshBasicMaterial color="#fbbf24" depthTest={false} />
              </mesh>
            ))}
            {d.circle && <Line points={circlePoints(d.circle.center, d.circle.normal, d.circle.radius)} color="#fbbf24" lineWidth={1.5} depthTest={false} />}
            <Html position={mid} center zIndexRange={[20, 0]}>
              <div className={fmtLabel}>{d.label}</div>
            </Html>
          </group>
        );
      })}
      {picks.map((p, i) => (
        <mesh key={i} position={p.point} renderOrder={21}>
          <sphereGeometry args={[0.8, 12, 8]} />
          <meshBasicMaterial color="#60a5fa" depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

function circlePoints(center: Vec3, normal: Vec3, radius: number): Vec3[] {
  const n = new THREE.Vector3(...normal).normalize();
  const u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  return Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return toVec(new THREE.Vector3(...center).addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius));
  });
}

const TARGETS: { id: PickKind; label: string; icon: typeof Ruler; help: string }[] = [
  { id: "point", label: "Punto", icon: Crosshair, help: "Dos puntos: distancia y diferencias en X, Y y Z. Se ajusta a los vértices." },
  { id: "face", label: "Cara", icon: Square, help: "Dos caras: espesor o separación si son paralelas, ángulo si no. Una cara y otro elemento: distancia al plano." },
  { id: "edge", label: "Arista", icon: Ruler, help: "Una arista: longitud, diámetro o radio. Dos: ángulo, distancia entre centros o entre aristas paralelas." },
];

/** Panel flotante de la herramienta activa. */
export function ToolPanel() {
  const mode = useTools((s) => s.mode);
  const setMode = useTools((s) => s.setMode);
  const dims = useTools((s) => s.dims);
  const picks = useTools((s) => s.picks);
  const hint = useTools((s) => s.hint);
  const removeDim = useTools((s) => s.removeDim);
  const clearDims = useTools((s) => s.clearDims);
  if (!mode && !dims.length) return null;
  const help = mode?.kind === "measure" ? TARGETS.find((t) => t.id === mode.target)!.help
    : mode?.kind === "place" ? "Haz clic sobre una cara para colocar la perforación perpendicular a ella. Solo recorta el cuerpo tocado."
    : mode?.kind === "edges" ? "Haz clic cerca de las aristas que quieres modificar; vuelve a hacer clic para quitarlas." : null;
  return (
    <div className="pointer-events-auto absolute left-3 top-16 z-10 w-72 rounded-xl border border-line bg-surface/95 p-2.5 text-[11.5px] shadow-xl backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg">{mode?.kind === "place" ? "Colocar sobre una cara" : mode?.kind === "edges" ? "Elegir aristas" : "Medir"}</span>
        {mode && <button aria-label="Salir de la herramienta" onClick={() => setMode(null)} className="text-faint hover:text-fg cursor-pointer"><X size={14} /></button>}
      </div>
      {mode?.kind === "measure" && (
        <div className="mt-2 flex gap-1">
          {TARGETS.map((t) => (
            <button key={t.id} aria-pressed={mode.target === t.id} onClick={() => setMode({ kind: "measure", target: t.id })} className={cx("flex h-7 flex-1 items-center justify-center gap-1 rounded-md border cursor-pointer", mode.target === t.id ? "border-accent/40 bg-accent-soft text-accent-text" : "border-line text-muted hover:text-fg")}>
              <t.icon size={12} /> {t.label}
            </button>
          ))}
        </div>
      )}
      {help && <p className="mt-2 text-muted">{help}</p>}
      {mode?.kind === "measure" && picks.length === 1 && <p className="mt-1 text-accent-text">Elige el segundo elemento.</p>}
      {hint && <p role="status" className="mt-1 text-warn">{hint}</p>}
      {dims.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          {dims.map((d) => (
            <div key={d.id} className="group flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-fg" data-testid="dimension">{d.label}</div>
                {d.detail && <div className="text-[10.5px] text-faint">{d.detail}</div>}
              </div>
              <button aria-label="Quitar cota" onClick={() => removeDim(d.id)} className="text-faint opacity-0 hover:text-fg group-hover:opacity-100 cursor-pointer"><X size={12} /></button>
            </div>
          ))}
          <button onClick={clearDims} className="mt-1 flex items-center gap-1 text-faint hover:text-fg cursor-pointer"><Trash2 size={11} /> Borrar cotas</button>
        </div>
      )}
    </div>
  );
}
