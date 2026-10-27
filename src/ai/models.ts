import type { SystemInfo } from "../lib/platform";

export interface ModelOption {
  id: string;
  name: string;
  size: string;
  minMemoryGb: number;
  note: string;
  llamaCpp: string;
  ollama: string;
}

// Modelos multimodales con builds GGUF oficiales (ggml-org) que llama-server descarga junto a su proyector de visión.
export const VISION_MODELS: ModelOption[] = [
  {
    id: "qwen2.5-vl-3b",
    name: "Qwen2.5-VL 3B",
    size: "≈ 3 GB",
    minMemoryGb: 6,
    note: "Para equipos con 8 GB o Windows ARM64 sin aceleración.",
    llamaCpp: "llama-server -hf ggml-org/Qwen2.5-VL-3B-Instruct-GGUF --port 8080",
    ollama: "ollama pull qwen2.5vl:3b",
  },
  {
    id: "gemma-3-4b",
    name: "Gemma 3 4B",
    size: "≈ 3,5 GB",
    minMemoryGb: 8,
    note: "Buen equilibrio entre visión y razonamiento. Punto de partida recomendado.",
    llamaCpp: "llama-server -hf ggml-org/gemma-3-4b-it-GGUF --port 8080",
    ollama: "ollama pull gemma3:4b",
  },
  {
    id: "qwen2.5-vl-7b",
    name: "Qwen2.5-VL 7B",
    size: "≈ 6 GB",
    minMemoryGb: 16,
    note: "Mejor lectura de geometría y obstáculos en la foto.",
    llamaCpp: "llama-server -hf ggml-org/Qwen2.5-VL-7B-Instruct-GGUF --port 8080",
    ollama: "ollama pull qwen2.5vl:7b",
  },
  {
    id: "gemma-3-12b",
    name: "Gemma 3 12B",
    size: "≈ 8,5 GB",
    minMemoryGb: 24,
    note: "Para GPU dedicada (por ejemplo RTX 4090 con CUDA) o Mac con 32 GB.",
    llamaCpp: "llama-server -hf ggml-org/gemma-3-12b-it-GGUF --port 8080 -ngl 99",
    ollama: "ollama pull gemma3:12b",
  },
];

/** Elige el modelo más capaz que cabe con margen en la memoria disponible. */
export function recommendModel(info: SystemInfo): ModelOption {
  const usable = info.totalMemoryGb * (info.os === "macos" ? 0.7 : 0.6);
  const fits = VISION_MODELS.filter((m) => m.minMemoryGb * 0.75 <= usable);
  if (info.os === "windows" && info.arch === "aarch64") return VISION_MODELS[0];
  return fits[fits.length - 1] ?? VISION_MODELS[0];
}

export function accelerationLabel(info: SystemInfo): string {
  if (info.os === "macos" && info.arch === "aarch64") return "Metal (Apple Silicon)";
  if (info.os === "windows" && info.arch === "aarch64") return "CPU ARM64 (Vulkan si el driver lo permite)";
  if (info.os === "windows") return "CUDA si hay NVIDIA, si no Vulkan/CPU";
  return "CPU / Vulkan";
}
