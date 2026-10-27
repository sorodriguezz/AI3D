import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { AlertTriangle, ArrowDownToLine, Copy, Eye, Grid3x3, Layers, Loader2, Magnet, Move3d, RefreshCw, Rotate3d, Ruler, Trash2, X } from "lucide-react";
import type { MeshPayload } from "../cad/client";
import { partPreviewScale } from "../cad/importScale";
import type { Part } from "../cad/types";
import { usePartMesh } from "../studio/meshes";
import { bodyColors } from "../studio/parts";
import { useTools } from "../studio/tools";
import { thumbnailHook, useStore } from "../store";
import { IconButton, cx } from "./ui";
import { Dimensions, SelectedEdges, ToolPanel, handlePick } from "./ViewportTools";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const DEG = Math.PI / 180;

function useCssColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (k: string) => s.getPropertyValue(k).trim();
    return { bg: v("--viewport"), grid: v("--grid"), model: v("--model"), accent: v("--accent"), border: v("--border-strong") };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => setColors(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return colors;
}

function useGeometry(mesh: MeshPayload | undefined) {
  const geo = useMemo(() => {
    if (!mesh) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
    const e = new THREE.BufferGeometry();
    e.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
    return { faces: g, edges: e };
  }, [mesh]);
  useEffect(() => () => (geo?.faces.dispose(), geo?.edges.dispose()), [geo]);
  return geo;
}

/** Cuadrícula de la cama en el plano XY (Z hacia arriba): 10 mm finas y 50 mm marcadas. */
function PlateGrid({ size, minor, major, outline }: { size: number; minor: string; major: string; outline: string }) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const span = Math.ceil(size / 50) * 50;
    const fine = new THREE.GridHelper(span, span / 10, minor, minor);
    const coarse = new THREE.GridHelper(span, span / 50, major, major);
    coarse.position.z = 0.01;
    for (const h of [fine, coarse]) {
      h.rotation.x = Math.PI / 2;
      g.add(h);
    }
    const s = size / 2;
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-s, -s, 0.02), new THREE.Vector3(s, -s, 0.02), new THREE.Vector3(s, s, 0.02), new THREE.Vector3(-s, s, 0.02)]),
      new THREE.LineBasicMaterial({ color: outline }),
    );
    g.add(border);
    return g;
  }, [size, minor, major, outline]);
  useEffect(
    () => () =>
      group.children.forEach((c) => {
        const l = c as THREE.Line;
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }),
    [group],
  );
  return <primitive object={group} />;
}

function PartObject({ part, selected, edgeColor, dimmed, register }: { part: Part; selected: boolean; edgeColor: string; dimmed: boolean; register: (id: string, o: THREE.Object3D | null) => void }) {
  const entry = usePartMesh(part.type, part.params, part.features);
  const pickingEdges = useTools((s) => s.mode?.kind === "edges" && s.mode.partId === part.id);
  const geo = useGeometry(entry?.mesh);
  const select = useStore((s) => s.select);
  const hole = part.mode === "hole";
  const attach = useCallback((o: THREE.Object3D | null) => register(part.id, o), [part.id, register]);
  if (part.hidden) return null;

  return (
    <group
      ref={attach}
      position={part.position}
      scale={partPreviewScale(part)}
      rotation={new THREE.Euler(part.rotation[0] * DEG, part.rotation[1] * DEG, part.rotation[2] * DEG, "ZYX")}
      onClick={(e) => {
        if (entry?.mesh && handlePick(e, { mesh: entry.mesh, part })) return;
        e.stopPropagation();
        select(part.id);
      }}
    >
      {geo && (
        <>
          <mesh geometry={geo.faces} castShadow={!hole} receiveShadow>
            <meshStandardMaterial
              flatShading={entry?.mesh?.exact === false}
              color={hole ? "#f87171" : part.color}
              roughness={0.55}
              metalness={0.05}
              transparent={hole || dimmed}
              opacity={hole ? 0.28 : dimmed ? 0.18 : 1}
              depthWrite={!hole && !dimmed}
              emissive={selected ? "#ffffff" : "#000000"}
              emissiveIntensity={selected ? 0.12 : 0}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </mesh>
          <lineSegments geometry={geo.edges}>
            <lineBasicMaterial color={selected ? "#ffffff" : hole ? "#f87171" : edgeColor} transparent opacity={selected ? 0.9 : 0.45} />
          </lineSegments>
          {pickingEdges && entry?.mesh && <SelectedEdges mesh={entry.mesh} />}
        </>
      )}
    </group>
  );
}

/** Resultado combinado: cada cuerpo con el color de su primera pieza. */
function ResultObject({ mesh, color, edgeColor }: { mesh: MeshPayload; color: string; edgeColor: string }) {
  const geo = useGeometry(mesh);
  const parts = useStore((s) => s.doc?.parts);
  const bodies = useMemo(() => mesh.bodies ?? [], [mesh]);
  const materials = useMemo(() => {
    const colors = parts ? bodyColors(parts) : {};
    const list = (bodies.length ? bodies : [{ name: "" }]).map((b) => new THREE.MeshStandardMaterial({ color: colors[b.name] ?? color, flatShading: !mesh.exact, roughness: 0.5, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    return list;
  }, [parts, bodies, color, mesh.exact]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  // Los grupos se fijan antes del primer render (el lienzo solo dibuja bajo demanda).
  useMemo(() => {
    if (!geo) return;
    geo.faces.clearGroups();
    if (bodies.length) bodies.forEach((b, i) => geo.faces.addGroup(b.triStart * 3, b.triCount * 3, i));
    else geo.faces.addGroup(0, mesh.triangles.length, 0);
  }, [geo, bodies, mesh]);
  if (!geo) return null;
  return (
    <group>
      <mesh
        geometry={geo.faces}
        material={materials}
        castShadow
        receiveShadow
        onClick={(e) => {
          const body = bodies.find((b) => e.faceIndex! >= b.triStart && e.faceIndex! < b.triStart + b.triCount)?.name;
          handlePick(e, { mesh, body });
        }}
      />
      <lineSegments geometry={geo.edges}>
        <lineBasicMaterial color={edgeColor} transparent opacity={0.5} />
      </lineSegments>
    </group>
  );
}

type View = "iso" | "front" | "top" | "side";

function CameraRig({ view, nonce, radius, center }: { view: View; nonce: number; radius: number; center: THREE.Vector3 }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  useEffect(() => {
    const d = radius * 2.4 + 60;
    const dirs: Record<View, THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1.3, 0.95),
      front: new THREE.Vector3(0, -1, 0.06),
      top: new THREE.Vector3(0.0001, -0.0001, 1),
      side: new THREE.Vector3(1, 0, 0.06),
    };
    camera.position.copy(center.clone().add(dirs[view].normalize().multiplyScalar(d)));
    camera.near = 0.5;
    camera.far = d * 30;
    camera.updateProjectionMatrix();
    controls?.target.copy(center);
    controls?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, nonce, controls]);
  return null;
}

function ThumbnailRegistrar() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    thumbnailHook.capture = () => {
      try {
        gl.render(scene, camera);
        const src = gl.domElement;
        const w = 360;
        const h = Math.round((w * 3) / 4);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        const scale = Math.max(w / src.width, h / src.height);
        const sw = w / scale, sh = h / scale;
        ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
        return c.toDataURL("image/jpeg", 0.8);
      } catch {
        return null;
      }
    };
    return () => {
      thumbnailHook.capture = null;
    };
  }, [gl, scene, camera]);
  return null;
}

const fmt = (v: number) => v.toLocaleString("es", { maximumFractionDigits: 1 });

export function StudioViewport() {
  const parts = useStore((s) => s.doc?.parts ?? []);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const updatePart = useStore((s) => s.updatePart);
  const beginChange = useStore((s) => s.beginChange);
  const removePart = useStore((s) => s.removePart);
  const duplicatePart = useStore((s) => s.duplicatePart);
  const dropToBed = useStore((s) => s.dropToBed);
  const mode = useStore((s) => s.transformMode);
  const setMode = useStore((s) => s.setTransformMode);
  const snap = useStore((s) => s.snap);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const showResult = useStore((s) => s.showResult);
  const setShowResult = useStore((s) => s.setShowResult);
  const result = useStore((s) => s.result);
  const building = useStore((s) => s.building);
  const buildError = useStore((s) => s.buildError);
  const buildVolume = useStore((s) => s.settings.buildVolume);
  const retryBuild = useStore((s) => s.retryBuild);
  const cancelBuild = useStore((s) => s.cancelBuild);
  const toolMode = useTools((s) => s.mode);
  const setToolMode = useTools((s) => s.setMode);
  const colors = useCssColors();
  const [view, setView] = useState<View>("iso");
  const [nonce, setNonce] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const importFiles = useStore((s) => s.importFiles);
  const objects = useRef(new Map<string, THREE.Object3D>());
  const [, force] = useState(0);
  const selected = parts.find((p) => p.id === selectedId) ?? null;

  // Ref callbacks must stay stable: detaching and reattaching a selected object
  // on every render otherwise schedules another render indefinitely.
  const register = useCallback((id: string, o: THREE.Object3D | null) => {
    const had = objects.current.get(id);
    if (had === o || (!had && !o)) return;
    if (o) objects.current.set(id, o);
    else objects.current.delete(id);
    if (id === useStore.getState().selectedId) force((n) => n + 1);
  }, []);

  const dims = result ? result.bbox.max.map((v, i) => v - result.bbox.min[i]) : null;
  const tooBig = dims ? dims.some((d) => d > buildVolume) : false;
  const center = result ? new THREE.Vector3((result.bbox.min[0] + result.bbox.max[0]) / 2, (result.bbox.min[1] + result.bbox.max[1]) / 2, (result.bbox.min[2] + result.bbox.max[2]) / 2) : new THREE.Vector3(0, 0, 10);
  const radius = dims ? Math.max(...dims) : 60;
  const pickView = (v: View) => {
    setView(v);
    setNonce((n) => n + 1);
  };

  // Atajos del estudio
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key.toLowerCase() === "d" && s.selectedId) {
        e.preventDefault();
        s.duplicatePart(s.selectedId);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selectedId) {
        e.preventDefault();
        s.removePart(s.selectedId);
      } else if (e.key === "Escape") {
        if (useTools.getState().mode) useTools.getState().setMode(null);
        else s.select(null);
      } else if (!mod && e.key.toLowerCase() === "m") useTools.getState().setMode(useTools.getState().mode?.kind === "measure" ? null : { kind: "measure", target: "point" });
      else if (!mod && e.key.toLowerCase() === "w") s.setTransformMode("translate");
      else if (!mod && e.key.toLowerCase() === "e") s.setTransformMode("rotate");
      else if (!mod && e.key.toLowerCase() === "h" && s.selectedId) {
        const p = s.doc?.parts.find((x) => x.id === s.selectedId);
        if (p) s.updatePart(p.id, { mode: p.mode === "hole" ? "solid" : "hole" });
      } else if (!mod && e.key.toLowerCase() === "b" && s.selectedId) s.dropToBed(s.selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const target = selected && !showResult && !toolMode ? objects.current.get(selected.id) : undefined;

  const syncFromObject = () => {
    if (!selected || !target) return;
    const r = (v: number, step = 0.01) => Math.round(v / step) * step;
    const e = new THREE.Euler().setFromQuaternion(target.quaternion, "ZYX");
    updatePart(
      selected.id,
      {
        position: [r(target.position.x), r(target.position.y), r(target.position.z)],
        rotation: [r(e.x / DEG, 0.1), r(e.y / DEG, 0.1), r(e.z / DEG, 0.1)],
      },
      false,
    );
  };

  return (
    <section
      className="relative min-h-0 min-w-0"
      style={{ background: colors.bg }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <Canvas
        frameloop="demand"
        shadows
        dpr={[1, 1.5]}
        resize={{ scroll: false, debounce: { resize: 120, scroll: 0 } }}
        camera={{ fov: 35, position: [180, -220, 160], up: [0, 0, 1] }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        onPointerMissed={(e) => e.button === 0 && !useTools.getState().mode && select(null)}
      >
        <color attach="background" args={[colors.bg]} />
        <hemisphereLight args={["#ffffff", "#30343c", 1.4]} />
        <directionalLight position={[120, -160, 260]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-140, 100, 80]} intensity={0.45} />
        {showGrid && <PlateGrid size={buildVolume} minor={colors.grid} major={colors.border} outline={tooBig ? "#f87171" : colors.border} />}
        {showResult && result ? (
          <ResultObject mesh={result} color={colors.model} edgeColor={colors.bg} />
        ) : (
          parts.map((p) => <PartObject key={p.id} part={p} selected={p.id === selectedId} edgeColor={colors.bg} dimmed={false} register={register} />)
        )}
        {target && (
          <TransformControls
            object={target}
            mode={mode}
            size={0.8}
            translationSnap={snap ? 1 : null}
            rotationSnap={snap ? 15 * DEG : null}
            onMouseDown={beginChange}
            onObjectChange={syncFromObject}
          />
        )}
        <Dimensions />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <CameraRig view={view} nonce={nonce} radius={radius} center={center} />
        <ThumbnailRegistrar />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#f87171", "#4ade80", "#60a5fa"]} labelColor="#0b0c0e" />
        </GizmoHelper>
      </Canvas>

      {/* Barra de herramientas */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-line bg-surface/90 p-1 shadow-lg shadow-black/10 backdrop-blur">
          <IconButton label="Mover (W)" active={mode === "translate"} onClick={() => setMode("translate")}>
            <Move3d size={16} />
          </IconButton>
          <IconButton label="Rotar (E)" active={mode === "rotate"} onClick={() => setMode("rotate")}>
            <Rotate3d size={16} />
          </IconButton>
          <IconButton label={snap ? "Imán activado (1 mm / 15°)" : "Imán desactivado"} active={snap} onClick={toggleSnap}>
            <Magnet size={16} />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-line" />
          <button
            disabled={!selected}
            onClick={() => selected && updatePart(selected.id, { mode: selected.mode === "hole" ? "solid" : "hole" })}
            className={cx("h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors disabled:opacity-35 cursor-pointer", selected?.mode === "hole" ? "bg-err/15 text-err" : "text-muted hover:bg-surface-2 hover:text-fg")}
            title="Alternar sólido / agujero (H)"
          >
            {selected?.mode === "hole" ? "Agujero" : "Sólido"}
          </button>
          <IconButton label="Apoyar en la cama (B)" disabled={!selected} onClick={() => selected && dropToBed(selected.id)} className="disabled:opacity-35">
            <ArrowDownToLine size={16} />
          </IconButton>
          <IconButton label="Duplicar (⌘D)" disabled={!selected} onClick={() => selected && duplicatePart(selected.id)} className="disabled:opacity-35">
            <Copy size={16} />
          </IconButton>
          <IconButton label="Eliminar (Supr)" disabled={!selected} onClick={() => selected && removePart(selected.id)} className="disabled:opacity-35">
            <Trash2 size={16} />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Medir (M)" active={toolMode?.kind === "measure"} onClick={() => setToolMode(toolMode?.kind === "measure" ? null : { kind: "measure", target: "point" })}>
            <Ruler size={16} />
          </IconButton>
        </div>

        <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-line bg-surface/90 p-1 shadow-lg shadow-black/10 backdrop-blur">
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            <button onClick={() => setShowResult(false)} className={cx("h-7 rounded-md px-2.5 text-[12px] cursor-pointer", !showResult ? "bg-surface text-fg shadow-sm" : "text-muted")}>
              Piezas
            </button>
            <button onClick={() => setShowResult(true)} className={cx("flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] cursor-pointer", showResult ? "bg-surface text-fg shadow-sm" : "text-muted")}>
              <Layers size={12} /> Resultado
            </button>
          </div>
          <div className="mx-1 h-5 w-px bg-line" />
          {(
            [
              ["iso", "3D"],
              ["front", "Frente"],
              ["side", "Lado"],
              ["top", "Arriba"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button key={v} onClick={() => pickView(v)} className={cx("h-7 rounded-md px-2 text-[12px] cursor-pointer", view === v ? "text-fg" : "text-muted hover:text-fg")}>
              {label}
            </button>
          ))}
          <IconButton label="Cuadrícula" active={showGrid} onClick={() => setShowGrid(!showGrid)} className="size-7">
            <Grid3x3 size={14} />
          </IconButton>
          <IconButton label="Encuadrar" onClick={() => pickView(view)} className="size-7">
            <Eye size={14} />
          </IconButton>
        </div>
      </div>

      {/* Estado inferior */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[11.5px] text-muted">
        {dims && (
          <span className={cx("flex items-center gap-1.5 rounded-lg border bg-surface/85 px-2.5 py-1.5 font-mono backdrop-blur", tooBig ? "border-err/50 text-err" : "border-line text-fg")}>
            {fmt(dims[0])} × {fmt(dims[1])} × {fmt(dims[2])} mm
          </span>
        )}
        {result && (
          <span className="whitespace-nowrap rounded-lg border border-line bg-surface/85 px-2.5 py-1.5 backdrop-blur">
            {fmt(result.volume / 1000)} cm³ · ≈{fmt((result.volume / 1000) * 1.24)} g PLA macizo
          </span>
        )}
        {building && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-line bg-surface/85 px-2.5 py-1.5 backdrop-blur">
            <Loader2 size={12} className="animate-spin" /> Calculando
            <button aria-label="Cancelar cálculo" title="Cancelar cálculo" onClick={cancelBuild} className="ml-0.5 text-faint hover:text-fg cursor-pointer">
              <X size={12} />
            </button>
          </span>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft">
          <div className="rounded-xl bg-surface/90 px-5 py-3 text-[13px] font-medium text-fg backdrop-blur">Suelta para importar STL, 3MF, OBJ, AMF, STEP o SVG</div>
        </div>
      )}
      {parts.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-line bg-surface/85 px-6 py-5 text-center backdrop-blur">
            <div className="text-[14px] font-medium text-fg">Escena vacía</div>
            <div className="mt-1 max-w-xs text-[12.5px] text-muted">Inserta formas desde el panel izquierdo, arrastra aquí un modelo para importarlo o describe la pieza en la pestaña IA.</div>
          </div>
        </div>
      )}

      {buildError && (
        <div className="absolute bottom-14 left-3 max-w-md rounded-xl border border-err/40 bg-surface/95 px-4 py-3 text-[12.5px] shadow-xl backdrop-blur">
          <div className="flex items-center gap-2 font-medium text-err">
            <AlertTriangle size={14} /> No se pudo combinar la escena
          </div>
          <div className="mt-1 text-muted">{buildError}</div>
          <button onClick={retryBuild} className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-fg hover:text-accent-text cursor-pointer">
            <RefreshCw size={12} /> Reintentar
          </button>
        </div>
      )}
      <ToolPanel />
    </section>
  );
}
