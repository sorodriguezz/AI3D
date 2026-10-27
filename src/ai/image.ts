// Preparación de la foto: se reduce a un tamaño razonable para modelos de visión pequeños
// y se dibuja la marca de ubicación del usuario directamente sobre la imagen.

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    img.src = src;
  });
}

export async function imageForModel(src: string, mark: { x: number; y: number } | null, maxSide = 896): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  if (mark) {
    const r = Math.max(10, Math.min(w, h) * 0.035);
    ctx.lineWidth = Math.max(3, r * 0.25);
    ctx.strokeStyle = "#ff2d2d";
    ctx.beginPath();
    ctx.arc(mark.x * w, mark.y * h, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}
