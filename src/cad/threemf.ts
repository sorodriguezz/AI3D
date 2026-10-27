import { strToU8, zipSync } from "fflate";

// Escritor 3MF mínimo (núcleo 3MF 1.x) compatible con Bambu Studio, PrusaSlicer y Cura.

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * La malla de OpenCascade duplica vértices en los bordes de cada cara.
 * 3MF exige una malla cerrada, así que se sueldan vértices coincidentes.
 */
function weld(vertices: ArrayLike<number>, triangles: ArrayLike<number>) {
  const map = new Map<string, number>();
  const remap = new Uint32Array(vertices.length / 3);
  const out: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = out.length / 3;
      map.set(key, idx);
      out.push(x, y, z);
    }
    remap[i] = idx;
  }
  const tris: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const a = remap[triangles[i]], b = remap[triangles[i + 1]], c = remap[triangles[i + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { verts: out, tris };
}

export function build3MF(vertices: ArrayLike<number>, triangles: ArrayLike<number>, name: string): Uint8Array {
  const { verts, tris } = weld(vertices, triangles);
  const f = (v: number) => +v.toFixed(4);
  const parts: string[] = [];
  for (let i = 0; i < verts.length; i += 3) parts.push(`<vertex x="${f(verts[i])}" y="${f(verts[i + 1])}" z="${f(verts[i + 2])}"/>`);
  const vXml = parts.join("");
  parts.length = 0;
  for (let i = 0; i < tris.length; i += 3) parts.push(`<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`);
  const tXml = parts.join("");

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="es-ES" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${escapeXml(name)}</metadata>
  <metadata name="Application">AI3D</metadata>
  <resources>
    <object id="1" type="model" name="${escapeXml(name)}">
      <mesh><vertices>${vXml}</vertices><triangles>${tXml}</triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;

  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "3D/3dmodel.model": strToU8(model),
  });
}
