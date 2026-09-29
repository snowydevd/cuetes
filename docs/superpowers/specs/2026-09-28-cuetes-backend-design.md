# Cuetes — Backend de evaluación (diseño)

Fecha: 2026-09-28
Estado: borrador para revisión

## 1. Objetivo

Responder la pregunta uruguaya **"¿Por qué están tirando cuetes?"**. El producto final es una app
móvil; este documento cubre solo el **backend**, cuyo propósito inmediato es validar que la
evaluación de noticias con TypeSafe funciona.

El backend lee noticias uruguayas vía RSS, estima con TypeSafe (modelo Jev) cuáles pueden provocar
festejos (fútbol, elecciones, fechas festivas, etc.) y, dada la ubicación de un usuario, devuelve
las causas más probables de los cuetes que está escuchando.

### Criterio de éxito

- Sobre un set de ~15 titulares uruguayos etiquetados a mano, la Etapa A (sección 4.1) clasifica
  correctamente "da para festejar ahora" en al menos 13.
- `POST /api/cuetes` responde en menos de 3 s con las candidatas ya evaluadas.
- Si hay una noticia festejable reciente y relevante para la ubicación, aparece en el top 3.

### Fuera de alcance (por ahora)

- App móvil.
- Autenticación y base de datos de usuarios (el objeto usuario llega en el body).
- Calendario de feriados/fiestas (Navidad, Año Nuevo): se resuelve mejor con reglas, sin IA.
- APIs de resultados deportivos.
- Deploy.

## 2. Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Fuente | RSS de medios uruguayos | Gratis, sin API key, local, actualizado. Las APIs genéricas cubren mal Uruguay. |
| Ubicación | Texto libre en `usuario.ubicacion` (barrio/ciudad), p. ej. `"Pocitos, Montevideo"` | Viene del objeto usuario de la base de datos de la app. |
| Cuándo evaluar | Worker en segundo plano + caché en SQLite; juicio por usuario al consultar | Lo que depende solo de la noticia se evalúa una vez; lo que depende del usuario, por consulta. |
| Idioma de las preguntas | Inglés; state (noticias) en español tal cual | Jev está entrenado principalmente en inglés; acepta español con menor precisión. Se valida con el set etiquetado. |
| Runtime | Bun (`Bun.serve`, `bun:sqlite`, `bun test`) | Convención del proyecto. |
| SDK | `@typesafe-ai/sdk` ^0.6.0 (ya instalado) | — |
| Parser RSS | `fast-xml-parser` | Chico, sin dependencias, soporta RSS y Atom; regex es frágil. |

## 3. Arquitectura

```
┌──────────────┐  cada 5 min   ┌──────────────────┐  1 llamada por noticia nueva  ┌──────────┐
│ RSS medios UY│ ─────────────▶│ ingest (worker)  │ ─────────────────────────────▶│ TypeSafe │
└──────────────┘               │ parse + dedup    │◀── celebra, ya_paso, tipo, ───│  (Jev)   │
                               └────────┬─────────┘    alcance                    └──────────┘
                                        ▼                                               ▲
                                 ┌─────────────┐                                        │
                                 │ SQLite      │  noticias + evaluación Etapa A         │
                                 └──────┬──────┘                                        │
                                        ▼                                               │
 App ── POST /api/cuetes {usuario} ──▶ ┌─────────────┐  1 llamada: candidatas × ubicación│
                                       │ Bun.serve   │ ─────────────────────────────────┘
       ◀── causas ordenadas ────────── └─────────────┘
```

### Módulos

Cada módulo tiene una responsabilidad y se testea de forma aislada.

| Archivo | Responsabilidad | Depende de |
|---|---|---|
| `src/feeds.ts` | Lista de feeds RSS; descargar y parsear a `NoticiaCruda[]`. Sin IA. | `fast-xml-parser`, `fetch` |
| `src/store.ts` | SQLite: insertar con dedup por URL, listar pendientes, guardar evaluación, listar candidatas, purgar viejas. | `bun:sqlite` |
| `src/evaluate.ts` | Etapa A: juicios que dependen solo de la noticia. | `TypeSafeClient` (inyectado) |
| `src/rank.ts` | Etapa B: juicios noticia × ubicación, y combinación del puntaje final. | `TypeSafeClient` (inyectado) |
| `src/ingest.ts` | Ciclo del worker: feeds → store → evaluate pendientes → purgar. | feeds, store, evaluate |
| `src/server.ts` | `Bun.serve` con `/api/cuetes` y `/api/health`; validación del body. | store, rank |
| `src/config.ts` | Constantes ajustables (umbrales, ventanas, intervalo). | — |
| `src/tipos.ts` | Tipos compartidos (`NoticiaCruda`, `EvaluacionA`, `Candidata`, `Causa`, `Juez`). | — |
| `src/tiempo.ts` | Formato de fechas ISO en hora de Uruguay (UTC-3). | — |
| `index.ts` | Arranque: valida la API key, abre la DB, inicia el worker y el servidor. | todos |

El `TypeSafeClient` se inyecta en `evaluate` y `rank` para poder mockearlo en tests.

### Tipos principales

```ts
type NoticiaCruda = {
  url: string;
  medio: string;
  titulo: string;
  resumen: string;        // description del RSS, sin HTML, recortado a ~600 caracteres
  publicadoEn: number;    // epoch ms
};

type EvaluacionA = {
  celebra: number;        // Noul, 0..1
  yaPaso: number;         // Noul, 0..1
  tipo: Tipo;             // Choice
  alcance: number;        // Score esperado, 0..3
};

type Tipo = "futbol" | "otro_deporte" | "politica" | "fecha_festiva" | "cultural" | "otro" | "ninguno";
```

## 4. Juicios de TypeSafe

Jev devuelve juicios tipados, no texto. "Dónde se festeja" no se extrae como texto: se evalúa en la
Etapa B contra la ubicación del usuario.

### 4.1 Etapa A — por noticia (`evaluate.ts`)

Una request por noticia nueva, con las cuatro preguntas juntas (corren en paralelo y agruparlas es
más barato que separarlas).

**State:**

```json
{
  "medio": "Ovación",
  "titulo": "…",
  "resumen": "…",
  "publicado_en": "2026-09-28T22:50:00-03:00",
  "ahora": "2026-09-28T23:00:00-03:00"
}
```

**Preguntas** (redacción final en inglés; se refina durante la implementación con el set etiquetado):

| id | Primitiva | Juicio | Criterios |
|---|---|---|---|
| `celebra` | Noul | Whether the event described in this news item is something that makes people in Uruguay celebrate publicly — setting off fireworks (cuetes), honking, gathering in the streets. | true: a victory, title, electoral win, festive date or similar that a group of Uruguayans would celebrate loudly. false: neutral, negative, or not something people celebrate in public. |
| `ya_paso` | Noul | Whether, as of `ahora`, the celebrated event has already happened or is happening now, as opposed to being a preview, announcement or future event. | true: match finished, result announced, event ongoing. false: upcoming match, forecast, schedule, analysis before the fact. |
| `tipo` | Choice | What kind of event could cause the celebration. | `futbol`, `otro_deporte`, `politica`, `fecha_festiva`, `cultural` (carnaval, Llamadas, festivales), `otro`, `ninguno` (nothing to celebrate). |
| `alcance` | Score 0–3 | How widespread the celebration would be in Uruguay. | 0: nobody celebrates. 1: a neighbourhood or small group. 2: a city or department. 3: the whole country. |

**Regla de candidata** (en código): `celebra ≥ 0.5` **y** `ya_paso ≥ 0.5`. Umbrales en `config.ts`.

### 4.2 Etapa B — por consulta (`rank.ts`)

Una única request por consulta, con una pregunta Score por candidata.

**State:**

```json
{
  "usuario": { "ubicacion": "Pocitos, Montevideo" },
  "ahora": "2026-09-28T23:14:00-03:00",
  "noticias": [
    { "titulo": "…", "resumen": "…", "tipo": "futbol" },
    { "titulo": "…", "resumen": "…", "tipo": "politica" }
  ]
}
```

**Preguntas:** `cerca_0 … cerca_{n-1}`, cada una:

| Primitiva | Juicio | Criterios |
|---|---|---|
| Score 0–3 | How likely it is that someone located in `usuario.ubicacion` hears fireworks right now because of `noticias[i]`. | 0: unlikely — it happened elsewhere or concerns a public not present there. 1: possible. 2: likely. 3: very likely — it happened there, or the celebration is nationwide. |

Se usa un Score por candidata (no una Choice entre ellas) porque varias noticias pueden ser causa a
la vez y los Scores por ítem son comparables para rankear.

Máximo de candidatas por consulta: 10 (las más recientes). Constante en `config.ts`.

### 4.3 Puntaje final (en código)

```
frescura = 1                               si edad < 1 h
         = 1 - (edad - 1 h) / (6 h - 1 h)  si 1 h ≤ edad < 6 h
         = 0                               si edad ≥ 6 h

puntaje  = celebra × (cerca / 3) × frescura
```

- Se devuelven hasta 3 causas con `puntaje ≥ 0.3`, ordenadas de mayor a menor.
- `edad` se mide desde `publicadoEn`.
- Fórmula y constantes viven en código: cambiarlas no requiere reevaluar noticias.

## 5. API HTTP

### `POST /api/cuetes`

Request:

```json
{ "usuario": { "id": "u123", "ubicacion": "Pocitos, Montevideo" } }
```

Response 200:

```json
{
  "ubicacion": "Pocitos, Montevideo",
  "evaluado_en": "2026-09-28T23:14:00-03:00",
  "aproximado": false,
  "causas": [
    {
      "titulo": "Peñarol campeón del Clausura",
      "url": "https://…",
      "medio": "Ovación",
      "tipo": "futbol",
      "puntaje": 0.82,
      "publicado_en": "2026-09-28T22:50:00-03:00"
    }
  ]
}
```

- `causas: []` → la app muestra "No encontramos una causa probable".
- Sin candidatas en la ventana de 6 h → se responde `causas: []` sin llamar a TypeSafe.
- `usuario.ubicacion` ausente, vacía o no string → **400** `{ "error": "usuario.ubicacion es requerido" }`.
- Body que no es JSON → **400**.

### `GET /api/health`

```json
{ "ultima_ingesta": "…", "noticias_24h": 120, "candidatas_6h": 2, "pendientes": 0 }
```

## 6. Persistencia

SQLite vía `bun:sqlite`, archivo `cuetes.db` (ignorado en git). Tests usan `:memory:`.

```sql
CREATE TABLE IF NOT EXISTS noticias (
  url           TEXT PRIMARY KEY,
  medio         TEXT NOT NULL,
  titulo        TEXT NOT NULL,
  resumen       TEXT NOT NULL,
  publicado_en  INTEGER NOT NULL,   -- epoch ms
  ingresado_en  INTEGER NOT NULL,
  celebra       REAL,               -- NULL = pendiente de Etapa A
  ya_paso       REAL,
  tipo          TEXT,
  alcance       REAL,
  evaluado_en   INTEGER,
  intentos      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_noticias_publicado ON noticias(publicado_en);
```

- Se guardan probabilidades crudas, no booleanos: cambiar umbrales no requiere reevaluar.
- Noticias con `publicado_en` de más de 48 h se borran en cada ingesta.
- Noticias con `publicado_en` de más de 6 h al momento de ingresar se guardan pero no se evalúan
  (no pueden ser candidatas).

## 7. Ingesta (worker)

- Intervalo: cada 5 minutos (`setInterval`), más una corrida al arrancar.
- Una corrida a la vez: si la anterior no terminó, se saltea.
- Pasos: descargar todos los feeds en paralelo → insertar nuevas (dedup por URL) → evaluar
  pendientes de las últimas 6 h con concurrencia limitada (4 requests simultáneas) → purgar > 48 h.
- Feeds iniciales (verificados el 2026-09-28):

  | Medio | URL |
  |---|---|
  | Montevideo Portal | `https://www.montevideo.com.uy/anxml.aspx?59` |
  | la diaria | `https://ladiaria.com.uy/feeds/articulos/` |
  | Subrayado | `https://www.subrayado.com.uy/rss/pages/home.xml` |
  | Teledoce | `https://www.teledoce.com/feed/` |
  | Tenfield (deportes) | `https://www.tenfield.com.uy/feed/` |

  Descartados: El País y Ovación (403), El Observador (404), Google Noticias UY (mezcla noticias
  no uruguayas y usa links de redirección).
- Timeout por feed: 10 s.

## 8. Manejo de errores

| Falla | Comportamiento |
|---|---|
| Feed caído, timeout o XML inválido | Se loguea y se saltea; los demás feeds siguen. |
| Item RSS sin `link` o sin título | Se descarta. |
| Fecha del item inválida o ausente | Se usa la hora de ingreso. |
| TypeSafe falla en Etapa A | La noticia queda pendiente (`celebra` NULL) y se reintenta en la próxima corrida; tras 3 intentos (`intentos`) se deja de reintentar. El SDK ya reintenta 2 veces 408/429/5xx con backoff. |
| TypeSafe falla en Etapa B | Se responde con puntaje sin ubicación, `celebra × (alcance / 3) × frescura`, y `aproximado: true`. |
| Falta `TYPESAFE_API_KEY` | El proceso no arranca y muestra un error claro. |

La API key vive solo en el backend (`.env`, cargado automáticamente por Bun) y nunca se expone a la app.

## 9. Testing (`bun test`)

### Unitarios, sin red

- `feeds`: parseo de fixtures RSS y Atom guardados en `test/fixtures/`; limpieza de HTML;
  descarte de items inválidos.
- `store`: dedup por URL, pendientes, candidatas por ventana y umbral, purga — con `:memory:`.
- `rank`: fórmula de frescura y puntaje; top 3 y mínimo 0.3; fallback `aproximado` cuando el
  cliente mockeado lanza error.
- `evaluate`: mapeo de la respuesta de TypeSafe a `EvaluacionA` con cliente mockeado.
- `server`: 400 ante body inválido; `causas: []` sin candidatas sin llamar al cliente.

### Evaluación real (opcional, requiere API key)

- `test/eval/titulares.json`: ~15 titulares uruguayos etiquetados a mano con la respuesta esperada
  (p. ej. "Uruguay le ganó a Brasil" → candidata; "Mañana juega Peñarol" → no; "Sube el dólar" → no).
- Script `bun run eval` que corre la Etapa A sobre el set y reporta aciertos y probabilidades.
- Es la prueba que valida el criterio de éxito de la sección 1 y guía el ajuste de preguntas y umbrales.

## 10. Configuración ajustable (`src/config.ts`)

| Constante | Valor inicial |
|---|---|
| `INTERVALO_INGESTA_MS` | 5 min |
| `VENTANA_CANDIDATAS_MS` | 6 h |
| `FRESCURA_PLENA_MS` | 1 h |
| `RETENCION_MS` | 48 h |
| `UMBRAL_CELEBRA` | 0.5 |
| `UMBRAL_YA_PASO` | 0.5 |
| `MAX_CANDIDATAS_CONSULTA` | 10 |
| `PUNTAJE_MINIMO` | 0.3 |
| `MAX_CAUSAS` | 3 |
| `CONCURRENCIA_EVALUACION` | 4 |
| `MAX_INTENTOS_EVALUACION` | 3 |
| `PUERTO` | `process.env.PORT` o 3000 |
