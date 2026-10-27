import type { MeshShape } from "replicad";

// Utilidades para mallas de Manifold. Se leen directamente de Manifold: la conversión de replicad
// (`MeshShape.mesh()`) recalcula normales y tarda decenas de segundos con modelos grandes.

/** Malla indexada de Manifold para Three.js, con aristas marcadas (> 30°). */
export function manifoldMesh(shape: MeshShape) {
  const g = (shape as unknown as { wrapped: { getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array } } }).wrapped.getMesh();
  const P = g.vertProperties, np = g.numProp, T = g.triVerts;
  const n = T.length / 3;
  const nv = P.length / np;
  // Keep shared vertices instead of expanding a million triangles into three
  // million vertices. The material uses flat shading to retain sharp faces.
  const vertices = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    vertices[i * 3] = P[i * np];
    vertices[i * 3 + 1] = P[i * np + 1];
    vertices[i * 3 + 2] = P[i * np + 2];
  }
  const faceN = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const ia = T[t * 3] * np, ib = T[t * 3 + 1] * np, ic = T[t * 3 + 2] * np;
    const ax = P[ia], ay = P[ia + 1], az = P[ia + 2], bx = P[ib], by = P[ib + 1], bz = P[ib + 2], cx = P[ic], cy = P[ic + 1], cz = P[ic + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    faceN[t * 3] = nx;
    faceN[t * 3 + 1] = ny;
    faceN[t * 3 + 2] = nz;
    for (let k = 0; k < 3; k++) {
      const offset = T[t * 3 + k] * 3;
      normals[offset] += nx;
      normals[offset + 1] += ny;
      normals[offset + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  // Aristas: lados compartidos por dos triángulos con un ángulo marcado, o bordes abiertos.
  const firstFace = new Map<number, number>();
  const lines: number[] = [];
  const pushEdge = (u: number, v: number) => lines.push(P[u * np], P[u * np + 1], P[u * np + 2], P[v * np], P[v * np + 1], P[v * np + 2]);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const u = T[t * 3 + k], v = T[t * 3 + ((k + 1) % 3)];
      const key = u < v ? u * nv + v : v * nv + u;
      const other = firstFace.get(key);
      if (other === undefined) firstFace.set(key, t);
      else {
        firstFace.delete(key);
        const dot = faceN[t * 3] * faceN[other * 3] + faceN[t * 3 + 1] * faceN[other * 3 + 1] + faceN[t * 3 + 2] * faceN[other * 3 + 2];
        if (dot < 0.866) pushEdge(u, v);
      }
    }
  }
  return { vertices, normals, triangles: T.slice(), edges: new Float32Array(lines), indexed: { P, np, T } };
}


export function binarySTL(v: ArrayLike<number>, t: ArrayLike<number>): ArrayBuffer {
  const n = t.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 96; // la normal (12 bytes) se deja en cero: los slicers la recalculan
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const j = t[i * 3 + k] * 3;
      dv.setFloat32(o, v[j], true);
      dv.setFloat32(o + 4, v[j + 1], true);
      dv.setFloat32(o + 8, v[j + 2], true);
      o += 12;
    }
    o += 14;
  }
  return buf;
}

