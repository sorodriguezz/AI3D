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

AI3D está orientada al diseño de piezas funcionales: cajas, componentes para racks de servidores, soportes y objetos de uso cotidiano, con medidas en milímetros.

## Funciones

- **Espacio de trabajo** en `Documentos/AI3D`: carpetas reales y archivos `.ai3d` (JSON) con miniatura. Al eliminar, los archivos van a la carpeta `Papelera`, desde donde se restauran o se borran definitivamente.
- **Estudio:** escena con varias piezas y 12 figuras y perfiles. Incluye placa redondeada, ranura oblonga y perfiles L/U. Cualquier pieza puede ser sólida o agujero. Se mueve y rota con gizmo e imán (1 mm / 15°), y tiene deshacer/rehacer y autoguardado.
- **Herramientas CAD:** alinear centros o extremos con otra pieza o el origen por ejes X/Y/Z; apoyar piezas rotadas en la cama; espejo sobre los ejes locales; patrones lineales y circulares alrededor de Z. Cada patrón se deshace en una sola acción. La cantidad disponible se ajusta al tamaño de la geometría.
- **Medición:** herramienta Medir (`M`) para puntos, caras y aristas. Calcula distancias y diferencias en X/Y/Z, espesores y separaciones entre caras paralelas, distancias a un plano, ángulos, diámetros, radios y distancias entre centros. Las cotas quedan dibujadas en el visor.
- **Cuerpos:** cada pieza sólida pertenece a un cuerpo (por ejemplo, Caja y Tapa). Los cuerpos se combinan por separado, se ven con su color en Resultado y se exportan juntos o de a uno. En 3MF cada cuerpo es un objeto con nombre y color; en STEP, un sólido independiente. Cada agujero elige qué cuerpos recorta.
- **Cajas y carcasas:** plantilla Caja con tapa (medidas interiores o exteriores, labio con holgura de encaje y soportes para tornillos o insertos); vaciado con espesor y cara abierta; división por un plano que deja la parte superior en un cuerpo nuevo.
- **Fijaciones y acabados:** agujeros pasantes o ciegos M2–M6 con avellanado recto o cónico, alojamiento para tuerca o inserto térmico, y rejillas de ventilación. Se colocan haciendo clic sobre una cara: quedan perpendiculares a ella, atraviesan su espesor y solo recortan el cuerpo tocado. También hay patrones en rejilla y redondeos o chaflanes por arista. Vaciado, redondeos y chaflanes requieren figuras nativas o STEP; las mallas admiten división, medición y operaciones entre piezas.
- **Bocetos paramétricos:** editor 2D con líneas, rectángulos, círculos y arcos. Restricciones: horizontal, vertical, paralelas, perpendiculares, iguales, coincidentes, tangente y puntos fijos. Cotas de distancia, distancia horizontal y vertical, radio, diámetro y ángulo. Los contornos cerrados se extruyen o se revolucionan, y los interiores quedan como huecos.
- **Variables y fórmulas:** variables del diseño (`ancho = 120`, `interior = ancho - 2 * pared`) usables en cualquier medida (botón *fx*) y en las cotas de los bocetos. Al cambiar una variable se recalculan las medidas, los bocetos y las operaciones que dependen de ellos. Los cambios de variables se deshacen como cualquier otro.
- **Historial de operaciones editable:** el vaciado, los redondeos y los chaflanes de cada pieza se pueden modificar, suprimir temporalmente o quitar, y las operaciones siguientes se recalculan.
- **Racks (EIA-310):** panel de 10" o 19" de 1 a 8 U con ojales verificados (1 U = 44,45 mm; agujeros a 6,35 / 22,225 / 38,1 mm). Incluye abertura para un equipo y división del panel de 19" en dos mitades que caben en una cama de 256 mm. También hay bandeja con ventilación, orejas que adaptan un equipo de cualquier ancho, soporte con ojales de ajuste y pasacables para colocar sobre una cara.
- **Motor recuperable:** los cálculos largos se pueden cancelar y, si el motor falla, se reinicia solo y vuelve a cargar los modelos importados sin tocar el diseño.
- **Biblioteca de ejemplos:** los cinco diseños prefabricados siguen disponibles en una sección desplegable de Insertar.
- **Color por pieza:** paleta de 24 colores, selector libre y entrada HEX. Los colores se guardan con el diseño; cambiarlos no recalcula la geometría.
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

`W` mover · `E` rotar · `M` medir · `H` sólido/agujero · `B` apoyar en la cama · `⌘D` duplicar · `Supr` eliminar · `⌘Z` / `⌘⇧Z` deshacer/rehacer · `Esc` salir de la herramienta o deseleccionar

Para desplazar el encuadre vertical u horizontalmente: `Shift` + arrastrar con clic izquierdo, o arrastrar con clic derecho. La rueda acerca y aleja; el arrastre izquierdo gira alrededor del modelo.

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
- **`release.yml`:** al subir una versión nueva a `main`, crea su tag `vX.Y.Z` y compila en runners nativos (`macos-14`, `windows-latest`, `windows-11-arm`), **firma** las actualizaciones y publica la Release con:
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
git add -A
git commit -m "Release v0.2.0"
git push origin main
```

Al hacer push a `main`, el workflow comprueba que la versión coincida en la app, Tauri, el motor
(si existe) y los archivos de bloqueo. Si `vX.Y.Z` todavía no existe, crea el tag anotado en ese
mismo commit y construye su release. Un push sin cambio de versión no vuelve a publicar.
Los tags y las releases pertenecen únicamente a este repositorio.

La compilación y publicación continúan en el mismo workflow: el tag creado con `GITHUB_TOKEN`
no necesita disparar otro workflow ni requiere un token personal. La release se publica sólo
cuando están disponibles los instaladores y las actualizaciones firmadas de las tres plataformas.

Si falla una publicación, usa **Actions → release → Re-run all jobs** en la ejecución original.
También puedes usar **Run workflow** seleccionando el tag de esa versión. Se reutiliza el borrador;
una release ya publicada no se sobrescribe y un tag existente nunca se mueve a otro commit.
Si necesitas corregir código, incrementa la versión y sube un commit nuevo.

Comprobar la automatización localmente:

```bash
python3 scripts/bump_version.py --check
python3 -m unittest discover -s scripts -p test_release.py -v
```

Los binarios no tienen firma de sistema operativo (Apple/Microsoft); por eso macOS y Windows muestran los avisos indicados en *Descargar*.
