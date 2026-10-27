import { expect, test } from "@playwright/test";
import type { MeshShape } from "replicad";
import { binarySTL, manifoldMesh } from "../src/cad/meshTools";

test("indexed rendering retains every triangle, edge and exported coordinate", () => {
  const positions = new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 20]);
  const triangles = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
  const shape = { wrapped: { getMesh: () => ({ numProp: 3, vertProperties: positions, triVerts: triangles }) } } as unknown as MeshShape;
  const mesh = manifoldMesh(shape);
  expect(mesh.vertices).toEqual(positions);
  expect(mesh.triangles).toEqual(triangles);
  expect(mesh.vertices.length).toBe(12);
  expect(mesh.normals.length).toBe(mesh.vertices.length);
  expect([...mesh.normals].every(Number.isFinite)).toBe(true);
  expect(mesh.edges.length).toBe(36);
  const stl = new DataView(binarySTL(mesh.vertices, mesh.triangles));
  expect(stl.getUint32(80, true)).toBe(4);
  triangles.forEach((v, i) => {
    const offset = 84 + Math.floor(i / 3) * 50 + 12 + (i % 3) * 12;
    for (let axis = 0; axis < 3; axis++) expect(stl.getFloat32(offset + axis * 4, true)).toBe(positions[v * 3 + axis]);
  });
});
