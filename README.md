# AI3D Studio

Estudio de modelado 3D para impresión: organiza diseños en carpetas, modela con formas y agujeros, y deja que la IA componga o edite piezas desde una descripción o una foto. Exporta 3MF, STL y STEP.

## Descargar

| Sistema | Instalador |
| --- | --- |
| macOS · Apple Silicon (M1–M4) | [**AI3D-macOS-AppleSilicon.dmg**](https://github.com/sorodriguezz/AI3D/releases/latest/download/AI3D-macOS-AppleSilicon.dmg) |
| Windows · Intel / AMD (x64) | [**AI3D-Windows-x64-setup.exe**](https://github.com/sorodriguezz/AI3D/releases/latest/download/AI3D-Windows-x64-setup.exe) |
| Windows · ARM64 (Snapdragon) | [**AI3D-Windows-ARM64-setup.exe**](https://github.com/sorodriguezz/AI3D/releases/latest/download/AI3D-Windows-ARM64-setup.exe) |

Los enlaces siempre apuntan a la última versión ([todas las versiones](https://github.com/sorodriguezz/AI3D/releases)). Una vez instalada, AI3D se actualiza sola desde la app.

> **macOS:** la primera vez, permite la app en *Ajustes del Sistema → Privacidad y seguridad*.
> **Windows:** si aparece SmartScreen, pulsa *Más información → Ejecutar de todas formas*.

## Funciones

- **Espacio de trabajo** en `Documentos/AI3D`: carpetas reales y archivos `.ai3d` (JSON) con miniatura. Al eliminar, los archivos van a la carpeta `Papelera`, desde donde se restauran o se borran definitivamente.
- **Estudio:** escena con varias piezas, 8 formas básicas y 5 componentes paramétricos. Cualquier pieza puede ser sólida o agujero. Se mueve y rota con gizmo e imán (1 mm / 15°), y tiene deshacer/rehacer y autoguardado.
- **IA:** compone escenas completas con piezas del catálogo y edita la escena actual por conversación («hazla 10 mm más alta»). Nunca ejecuta código del modelo: AI3D valida y acota cada tipo, medida y posición.
- **Importar modelos** (botón, tarjeta de inicio o arrastrar al visor) para modificarlos:
  - **STL, 3MF, OBJ y AMF:** mallas procesadas con Manifold; las booleanas tardan menos de 1 s incluso con 200 000 triángulos. Una escena con mallas se exporta en 3MF o STL.
  - **STEP/STP:** sólido CAD exacto con OpenCascade; sigue exportándose a STEP.
  - **SVG:** contornos 2D (path, rect, circle, ellipse, polygon) extruidos con altura ajustable; los contornos interiores quedan como huecos.
  - La geometría importada se guarda dentro del archivo `.ai3d`.
- **Validación:** volumen de impresión, piezas flotantes o bajo la cama, paredes delgadas y medidas por confirmar.

## IA: suscripción o local

| Opción | Requisito |
| --- | --- |
| Claude Code | Suscripción Claude Pro/Max · `claude` con sesión iniciada |
| Codex CLI | ChatGPT Plus/Pro · `codex login` |
| Gemini CLI | Cuenta de Google · `gemini` con sesión iniciada |
| Local | llama.cpp, Ollama o LM Studio en `localhost` |

Con suscripción, AI3D ejecuta el CLI oficial (`src-tauri/src/cli.rs`) en una carpeta temporal y en modo restringido: sin herramientas para ejecutar comandos ni modificar archivos. Usa tu sesión, sin claves API.

## Atajos

`W` mover · `E` rotar · `H` sólido/agujero · `B` apoyar en la cama · `⌘D` duplicar · `Supr` eliminar · `⌘Z` / `⌘⇧Z` deshacer/rehacer · `Esc` deseleccionar

## Desarrollo

```bash
npm install
npm run tauri dev      # servidor en el puerto 1430
```

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/cad/` | Catálogo (`templates.ts`), geometría (`builders.ts`), worker OpenCascade, exportación 3MF |
| `src/studio/` | Piezas, espacio de trabajo en disco, caché de mallas |
| `src/ai/` | Agente de diseño y proveedores (CLI de suscripción y local) |
| `src/components/` | Inicio, estudio, visor, inspector, ajustes |
| `src-tauri/src/` | Detección de hardware y puente con los CLI |

Para añadir una forma, agrega sus metadatos en `src/cad/templates.ts` y su geometría en `src/cad/builders.ts`. El agente recibe automáticamente el catálogo actualizado.

## Releases y actualizaciones

- **`ci.yml`:** en cada PR y cada push a `main`, compila el frontend y la app en macOS (Apple Silicon), Windows x64 y Windows ARM64.
- **`release.yml`:** al subir una etiqueta `vX.Y.Z`, compila en runners nativos (`macos-14`, `windows-latest`, `windows-11-arm`), **firma** las actualizaciones y publica la Release con:
  - los instaladores de cada sistema;
  - copias con nombre fijo para los enlaces de descarga directa de arriba;
  - `latest.json`, que se publica solo cuando están las tres plataformas.
- **En la app:**
  - Busca una versión nueva al abrir y cada 6 h, y la muestra en el inicio, en el estudio y en *Ajustes → Versión*.
  - Al actualizar, muestra el progreso y el tiempo restante.
  - Antes de instalar, espera a que termine la IA y guarda el diseño abierto. Luego verifica la firma ed25519 y se reinicia.

Configuración inicial (una sola vez):

1. Crea el repo `github.com/sorodriguezz/AI3D`. Si usas otro nombre, cambia `plugins.updater.endpoints` en `src-tauri/tauri.conf.json`, y los enlaces de este README y de `src/lib/updates.ts`.
2. Crea el secreto `TAURI_SIGNING_PRIVATE_KEY` con el contenido de `~/.tauri/ai3d.key` (la clave no tiene contraseña; GitHub no admite secretos vacíos y el workflow usa una cadena vacía):

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY -R sorodriguezz/AI3D < ~/.tauri/ai3d.key
   ```

   **No pierdas esa clave:** sin ella, las versiones instaladas no aceptarán actualizaciones nuevas.

Publicar una versión:

```bash
python3 scripts/bump_version.py 0.2.0
```

```bash
git commit -am "Release v0.2.0" && git tag v0.2.0 && git push --follow-tags
```

Los binarios no tienen firma de sistema operativo (Apple/Microsoft); por eso macOS y Windows muestran los avisos indicados en *Descargar*.
