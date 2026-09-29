# Cuetes Backend — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend en Bun que lee RSS uruguayos, evalúa con TypeSafe (Jev) qué noticias provocan festejos y expone `POST /api/cuetes` con las causas más probables de cuetes para la ubicación de un usuario.

**Architecture:** Un worker en segundo plano descarga los feeds cada 5 min, deduplica en SQLite y evalúa cada noticia nueva una sola vez (Etapa A: `celebra`, `ya_paso`, `tipo`, `alcance`). En cada consulta, una única llamada a TypeSafe puntúa las candidatas de las últimas 6 h contra la ubicación del usuario (Etapa B), y el código combina el puntaje final. `TypeSafeClient` se inyecta como `Juez` para poder testear sin red.

**Tech Stack:** Bun 1.4 (`Bun.serve`, `bun:sqlite`, `bun test`), TypeScript estricto, `@typesafe-ai/sdk` 0.6, `fast-xml-parser`.

**Spec:** `docs/superpowers/specs/2026-09-28-cuetes-backend-design.md`

## Global Constraints

- Usar Bun para todo: `bun <archivo>`, `bun test`, `bun add`, `bun run`. Nada de Node, npm, express, dotenv, better-sqlite3, jest ni vitest.
- **Commits solo en la rama `feat/backend`.** Un commit por tarea al final de su checkpoint (mensaje convencional, p. ej. `feat: feeds RSS`). Nunca commitear en `master`, nunca push.
- La API key (`TYPESAFE_API_KEY`) vive solo en `.env` y nunca se devuelve en respuestas HTTP.
- Preguntas a TypeSafe en inglés; el state (noticias) en español tal cual.
- Fechas en respuestas y state: ISO 8601 con offset `-03:00` (Uruguay, UTC-3 todo el año).
- Constantes iniciales (spec §10): intervalo 5 min, ventana de candidatas 6 h, frescura plena 1 h, retención 48 h, umbrales `celebra` y `ya_paso` 0.5, máx. 10 candidatas por consulta, puntaje mínimo 0.3, máx. 3 causas, concurrencia de evaluación 4, máx. 3 intentos, puerto `PORT` o 3000.
- Typecheck: `bunx tsc --noEmit` debe pasar al final de cada tarea.

## Review Focus

1. **Feed con un solo `<item>`**: `fast-xml-parser` devuelve un objeto en vez de un array; el item igual debe ingresar. → test en Task 2.
2. **URLs con `utm_*` y URLs de Montevideo Portal del tipo `auc.aspx?976768`**: la misma nota no debe duplicarse por parámetros de tracking, y el id que va como query no debe perderse ni transformarse en `?976768=`. → test en Task 2.
3. **`pubDate` roto o en el futuro**: no debe romper la ingesta ni dejar una noticia "fresca" para siempre; se usa la hora de ingreso como tope. → test en Task 2.
4. **HTML y entidades dentro de CDATA** (`&#160;`, `&amp;`, `<img>`): el resumen que llega a Jev debe ser texto limpio. → test en Task 2.
5. **`ubicacion` solo con espacios o de tipo incorrecto**: 400, sin llamar a TypeSafe con una ubicación vacía. → test en Task 7.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/config.ts` | Constantes ajustables |
| `src/tipos.ts` | Tipos compartidos y lista de `TIPOS` |
| `src/tiempo.ts` | `isoUY(ms)` |
| `src/feeds.ts` | Lista de feeds, descarga y parseo RSS/Atom |
| `src/store.ts` | Clase `Store` sobre `bun:sqlite` |
| `src/evaluate.ts` | Etapa A |
| `src/rank.ts` | Etapa B + puntaje final |
| `src/ingest.ts` | Worker (`crearIngestor`) + `enParalelo` |
| `src/server.ts` | Handlers HTTP + `servir` |
| `index.ts` | Arranque (reemplaza el ejemplo actual) |
| `scripts/eval.ts` | Evaluación real sobre titulares etiquetados |
| `test/helpers.ts` | `AHORA`, `noticia()`, `candidata()`, `juezFalso()` |
| `test/fixtures/*.xml` | Feeds de ejemplo |
| `test/eval/titulares.json` | Set etiquetado a mano |
| `test/*.test.ts` | Tests unitarios |

---

### Task 1: Base del proyecto (dependencia, config, tipos, tiempo)

**Files:**
- Modify: `package.json` (scripts + dependencia)
- Modify: `.gitignore`
- Create: `src/config.ts`, `src/tipos.ts`, `src/tiempo.ts`
- Test: `test/tiempo.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `src/config.ts`: `INTERVALO_INGESTA_MS`, `VENTANA_CANDIDATAS_MS`, `FRESCURA_PLENA_MS`, `RETENCION_MS`, `UMBRAL_CELEBRA`, `UMBRAL_YA_PASO`, `MAX_CANDIDATAS_CONSULTA`, `PUNTAJE_MINIMO`, `MAX_CAUSAS`, `CONCURRENCIA_EVALUACION`, `MAX_INTENTOS_EVALUACION`, `FEED_TIMEOUT_MS`, `MAX_RESUMEN`, `PUERTO`, `DB_PATH` (todos `number` salvo `DB_PATH: string`).
  - `src/tipos.ts`: `TIPOS`, `Tipo`, `NoticiaCruda`, `EvaluacionA`, `Candidata`, `Causa`, `Juez`.
  - `src/tiempo.ts`: `isoUY(ms: number): string`.

- [ ] **Step 1: Instalar `fast-xml-parser`**

Run: `bun add fast-xml-parser`
Expected: `package.json` gana `"fast-xml-parser"` en `dependencies`.

- [ ] **Step 2: Scripts en `package.json`**

Reemplazar el bloque `"scripts"` por:

```json
  "scripts": {
    "dev": "bun --watch index.ts",
    "start": "bun index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "eval": "bun scripts/eval.ts"
  },
```

- [ ] **Step 3: Ignorar la base de datos**

Agregar al final de `.gitignore`:

```
# base de datos local
cuetes.db
cuetes.db-*
```

- [ ] **Step 4: Escribir el test de `isoUY`**

`test/tiempo.test.ts`:

```ts
import { expect, test } from "bun:test";
import { isoUY } from "../src/tiempo";

test("isoUY formatea en hora de Uruguay con offset -03:00", () => {
  expect(isoUY(Date.parse("2026-09-29T02:14:00Z"))).toBe("2026-09-28T23:14:00-03:00");
});

test("isoUY descarta milisegundos", () => {
  expect(isoUY(Date.parse("2026-01-01T03:00:00.999Z"))).toBe("2026-01-01T00:00:00-03:00");
});
```

- [ ] **Step 5: Correr y ver que falla**

Run: `bun test test/tiempo.test.ts`
Expected: FAIL — no se puede resolver `../src/tiempo`.

- [ ] **Step 6: Implementar `src/tiempo.ts`**

```ts
// Uruguay usa UTC-3 todo el año (sin horario de verano desde 2015).
const OFFSET_UY_MS = 3 * 60 * 60 * 1000;

export function isoUY(ms: number): string {
  return new Date(ms - OFFSET_UY_MS).toISOString().slice(0, 19) + "-03:00";
}
```

- [ ] **Step 7: Crear `src/config.ts`**

```ts
const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;

export const INTERVALO_INGESTA_MS = 5 * MIN_MS;
export const VENTANA_CANDIDATAS_MS = 6 * HORA_MS;
export const FRESCURA_PLENA_MS = 1 * HORA_MS;
export const RETENCION_MS = 48 * HORA_MS;

export const UMBRAL_CELEBRA = 0.5;
export const UMBRAL_YA_PASO = 0.5;

export const MAX_CANDIDATAS_CONSULTA = 10;
export const PUNTAJE_MINIMO = 0.3;
export const MAX_CAUSAS = 3;

export const CONCURRENCIA_EVALUACION = 4;
export const MAX_INTENTOS_EVALUACION = 3;

export const FEED_TIMEOUT_MS = 10_000;
export const MAX_RESUMEN = 600;

export const PUERTO = Number(process.env.PORT ?? 3000);
export const DB_PATH = process.env.CUETES_DB ?? "cuetes.db";
```

- [ ] **Step 8: Crear `src/tipos.ts`**

```ts
import type { TypeSafeClient } from "@typesafe-ai/sdk";

export const TIPOS = ["futbol", "otro_deporte", "politica", "fecha_festiva", "cultural", "otro", "ninguno"] as const;
export type Tipo = (typeof TIPOS)[number];

export type NoticiaCruda = {
  url: string;
  medio: string;
  titulo: string;
  /** Texto plano, sin HTML, recortado a MAX_RESUMEN caracteres. */
  resumen: string;
  /** epoch ms */
  publicadoEn: number;
};

export type EvaluacionA = {
  celebra: number; // Noul 0..1
  yaPaso: number; // Noul 0..1
  tipo: Tipo; // Choice
  alcance: number; // Score esperado 0..3
};

export type Candidata = NoticiaCruda & EvaluacionA;

export type Causa = {
  titulo: string;
  url: string;
  medio: string;
  tipo: Tipo;
  puntaje: number;
  publicado_en: string;
};

/** Lo único que usamos del cliente de TypeSafe; permite inyectar un falso en tests. */
export type Juez = Pick<TypeSafeClient, "systemOne">;
```

- [ ] **Step 9: Correr tests y typecheck**

Run: `bun test test/tiempo.test.ts && bunx tsc --noEmit`
Expected: 2 pass; tsc sin errores. (El `index.ts` actual todavía tiene el ejemplo de TypeSafe; compila igual.)

- [ ] **Step 10: Checkpoint + commit**

Run: `git status --short`
Expected: aparecen `src/`, `test/` y los cambios de `package.json`, `bun.lock` y `.gitignore`. Commitear en `feat/backend`.

---

### Task 2: Feeds RSS/Atom (`src/feeds.ts`)

**Files:**
- Create: `src/feeds.ts`
- Create: `test/fixtures/rss-mvd.xml`, `test/fixtures/rss-un-item.xml`, `test/fixtures/atom.xml`
- Test: `test/feeds.test.ts`

**Interfaces:**
- Consumes: `FEED_TIMEOUT_MS`, `MAX_RESUMEN` de `src/config.ts`; `NoticiaCruda` de `src/tipos.ts`.
- Produces:
  - `type Feed = { medio: string; url: string }`
  - `type Fetcher = (url: string, init?: RequestInit) => Promise<Response>`
  - `FEEDS: Feed[]`
  - `limpiarTexto(texto: string): string`
  - `normalizarUrl(url: string): string | null`
  - `parsearFeed(xml: string, medio: string, ahora: number): NoticiaCruda[]`
  - `descargarFeed(feed: Feed, fetcher: Fetcher, ahora: number): Promise<NoticiaCruda[]>` (lanza si HTTP no es ok)
  - `descargarTodos(feeds: Feed[], fetcher: Fetcher, ahora: number): Promise<NoticiaCruda[]>` (nunca lanza; loguea y saltea feeds fallidos)

- [ ] **Step 1: Crear los fixtures**

`test/fixtures/rss-mvd.xml` (formato real de Montevideo Portal: CDATA con HTML, id como query):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Montevideo Portal</title>
  <item>
    <title><![CDATA[Peñarol campeón del Clausura: festejos en todo Montevideo]]></title>
    <link>https://www.montevideo.com.uy/auc.aspx?976768</link>
    <description><![CDATA[<a href="https://www.montevideo.com.uy/auc.aspx?976768"><img border="0" src="https://imagenes.montevideo.com.uy/x.jpg" /></a><br /><br/>Los hinchas salieron a la calle &amp; tiraron cuetes.]]></description>
    <pubDate>Mon, 28 Sep 2026 22:50:00 -0300</pubDate>
  </item>
  <item>
    <title>Suba del dólar</title>
    <link>https://www.montevideo.com.uy/auc.aspx?976769&amp;utm_source=rss&amp;utm_medium=feed#arriba</link>
    <description>El dólar cerró en alza.</description>
    <pubDate>fecha rota</pubDate>
  </item>
  <item>
    <title>Item sin link</title>
    <description>No debería aparecer.</description>
  </item>
</channel>
</rss>
```

`test/fixtures/rss-un-item.xml` (formato Tenfield/WordPress: fecha `+0000`, entidad numérica dentro de CDATA):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Tenfield.com</title>
  <item>
    <title>Uruguay le ganó a Brasil en el Centenario</title>
    <link>https://www.tenfield.com.uy/uruguay-gano/</link>
    <pubDate>Tue, 29 Sep 2026 01:40:00 +0000</pubDate>
    <description><![CDATA[Victoria&#160;histórica de la Celeste.]]></description>
  </item>
</channel>
</rss>
```

`test/fixtures/atom.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Feed Atom</title>
  <entry>
    <title type="html">Nacional gana el Intermedio</title>
    <link rel="alternate" href="https://ejemplo.uy/nacional-intermedio"/>
    <updated>2026-09-29T01:00:00Z</updated>
    <summary>Festejos en el Parque Central.</summary>
  </entry>
</feed>
```

- [ ] **Step 2: Escribir los tests**

`test/feeds.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { descargarTodos, limpiarTexto, normalizarUrl, parsearFeed, type Fetcher } from "../src/feeds";

const AHORA = Date.parse("2026-09-29T03:00:00Z");
const fixture = (nombre: string) => Bun.file(new URL(`./fixtures/${nombre}`, import.meta.url)).text();

describe("parsearFeed", () => {
  test("RSS con CDATA y HTML: resumen limpio, id en query conservado, item sin link descartado", async () => {
    const noticias = parsearFeed(await fixture("rss-mvd.xml"), "Montevideo Portal", AHORA);
    expect(noticias).toHaveLength(2);
    expect(noticias[0]).toEqual({
      url: "https://www.montevideo.com.uy/auc.aspx?976768",
      medio: "Montevideo Portal",
      titulo: "Peñarol campeón del Clausura: festejos en todo Montevideo",
      resumen: "Los hinchas salieron a la calle & tiraron cuetes.",
      publicadoEn: Date.parse("2026-09-29T01:50:00Z"),
    });
  });

  test("quita utm_* y el hash sin romper el id de la query", async () => {
    const [, dolar] = parsearFeed(await fixture("rss-mvd.xml"), "Montevideo Portal", AHORA);
    expect(dolar!.url).toBe("https://www.montevideo.com.uy/auc.aspx?976769");
  });

  test("fecha inválida usa la hora de ingreso", async () => {
    const [, dolar] = parsearFeed(await fixture("rss-mvd.xml"), "Montevideo Portal", AHORA);
    expect(dolar!.publicadoEn).toBe(AHORA);
  });

  test("feed con un solo item y fecha +0000; decodifica &#160; dentro de CDATA", async () => {
    const noticias = parsearFeed(await fixture("rss-un-item.xml"), "Tenfield", AHORA);
    expect(noticias).toHaveLength(1);
    expect(noticias[0]!.publicadoEn).toBe(Date.parse("2026-09-29T01:40:00Z"));
    expect(noticias[0]!.resumen).toBe("Victoria histórica de la Celeste.");
  });

  test("Atom: título con atributos y link por href", async () => {
    const [n] = parsearFeed(await fixture("atom.xml"), "Atom", AHORA);
    expect(n).toEqual({
      url: "https://ejemplo.uy/nacional-intermedio",
      medio: "Atom",
      titulo: "Nacional gana el Intermedio",
      resumen: "Festejos en el Parque Central.",
      publicadoEn: Date.parse("2026-09-29T01:00:00Z"),
    });
  });

  test("fecha futura se recorta a la hora de ingreso", () => {
    const xml = `<rss><channel><item><title>Futuro</title><link>https://ejemplo.uy/f</link>
      <pubDate>Fri, 01 Jan 2027 00:00:00 -0300</pubDate></item></channel></rss>`;
    expect(parsearFeed(xml, "X", AHORA)[0]!.publicadoEn).toBe(AHORA);
  });

  test("recorta el resumen a 600 caracteres", () => {
    const largo = "a".repeat(1000);
    const xml = `<rss><channel><item><title>T</title><link>https://ejemplo.uy/l</link>
      <description>${largo}</description></item></channel></rss>`;
    expect(parsearFeed(xml, "X", AHORA)[0]!.resumen).toHaveLength(600);
  });

  test("texto que no es un feed devuelve []", () => {
    expect(parsearFeed("<html><body>Error 500</body></html>", "X", AHORA)).toEqual([]);
    expect(parsearFeed("esto no es xml", "X", AHORA)).toEqual([]);
  });
});

describe("normalizarUrl", () => {
  test("rechaza URLs inválidas o no http(s)", () => {
    expect(normalizarUrl("no es url")).toBeNull();
    expect(normalizarUrl("ftp://ejemplo.uy/x")).toBeNull();
  });

  test("conserva parámetros que no son utm", () => {
    expect(normalizarUrl("https://ejemplo.uy/n?id=5&utm_campaign=x")).toBe("https://ejemplo.uy/n?id=5");
  });
});

describe("limpiarTexto", () => {
  test("quita etiquetas, decodifica entidades y colapsa espacios", () => {
    expect(limpiarTexto("<p>Hola&nbsp;&amp; <b>chau</b></p>\n\n&#x21;")).toBe("Hola & chau !");
  });
});

describe("descargarTodos", () => {
  test("saltea feeds que fallan (red o HTTP) y devuelve el resto", async () => {
    const xml = await fixture("rss-un-item.xml");
    const fetcher: Fetcher = async (url) => {
      if (url.includes("caido")) throw new Error("ECONNREFUSED");
      if (url.includes("error")) return new Response("oops", { status: 500 });
      return new Response(xml);
    };
    const noticias = await descargarTodos(
      [
        { medio: "Caído", url: "https://caido.uy/rss" },
        { medio: "Error", url: "https://error.uy/rss" },
        { medio: "Tenfield", url: "https://ok.uy/rss" },
      ],
      fetcher,
      AHORA,
    );
    expect(noticias.map((n) => n.medio)).toEqual(["Tenfield"]);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `bun test test/feeds.test.ts`
Expected: FAIL — no se puede resolver `../src/feeds`.

- [ ] **Step 4: Implementar `src/feeds.ts`**

```ts
import { XMLParser } from "fast-xml-parser";
import { FEED_TIMEOUT_MS, MAX_RESUMEN } from "./config";
import type { NoticiaCruda } from "./tipos";

export type Feed = { medio: string; url: string };
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// Verificados el 2026-09-28. El País/Ovación (403) y El Observador (404) bloquean el acceso.
export const FEEDS: Feed[] = [
  { medio: "Montevideo Portal", url: "https://www.montevideo.com.uy/anxml.aspx?59" },
  { medio: "la diaria", url: "https://ladiaria.com.uy/feeds/articulos/" },
  { medio: "Subrayado", url: "https://www.subrayado.com.uy/rss/pages/home.xml" },
  { medio: "Teledoce", url: "https://www.teledoce.com/feed/" },
  { medio: "Tenfield", url: "https://www.tenfield.com.uy/feed/" },
];

const USER_AGENT = "Mozilla/5.0 (compatible; cuetes/0.1)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  htmlEntities: true,
  // Con un solo <item>, fast-xml-parser devolvería un objeto en vez de un array.
  isArray: (nombre) => nombre === "item" || nombre === "entry",
});

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function limpiarTexto(texto: string): string {
  return texto
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (entidad, nombre: string) => ENTIDADES[nombre.toLowerCase()] ?? entidad)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizarUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  // Se filtra la query a mano: URLSearchParams convertiría "?976768" en "?976768=".
  const partes = u.search.slice(1).split("&").filter((p) => p !== "" && !p.startsWith("utm_"));
  u.search = partes.length > 0 ? `?${partes.join("&")}` : "";
  u.hash = "";
  return u.toString();
}

type Nodo = Record<string, unknown>;

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number") return String(valor);
  if (valor && typeof valor === "object" && "#text" in valor) return texto((valor as Nodo)["#text"]);
  return "";
}

function enlace(item: Nodo): string {
  const links = Array.isArray(item.link) ? item.link : [item.link];
  for (const link of links) {
    if (typeof link === "string") return link;
    if (link && typeof link === "object") {
      const nodo = link as Nodo;
      const rel = nodo["@_rel"];
      if (typeof nodo["@_href"] === "string" && (rel === undefined || rel === "alternate")) return nodo["@_href"];
      if (typeof nodo["#text"] === "string") return nodo["#text"];
    }
  }
  return "";
}

function fecha(item: Nodo, ahora: number): number {
  for (const campo of ["pubDate", "published", "updated", "dc:date"]) {
    const ms = Date.parse(texto(item[campo]));
    if (!Number.isNaN(ms)) return Math.min(ms, ahora);
  }
  return ahora;
}

export function parsearFeed(xml: string, medio: string, ahora: number): NoticiaCruda[] {
  let doc: { rss?: { channel?: { item?: unknown[] } }; feed?: { entry?: unknown[] } };
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const noticias: NoticiaCruda[] = [];
  for (const crudo of items) {
    if (!crudo || typeof crudo !== "object") continue;
    const item = crudo as Nodo;
    const url = normalizarUrl(enlace(item));
    const titulo = limpiarTexto(texto(item.title));
    if (!url || !titulo) continue;
    const resumen = limpiarTexto(texto(item.description ?? item.summary ?? item.content)).slice(0, MAX_RESUMEN);
    noticias.push({ url, medio, titulo, resumen, publicadoEn: fecha(item, ahora) });
  }
  return noticias;
}

export async function descargarFeed(feed: Feed, fetcher: Fetcher, ahora: number): Promise<NoticiaCruda[]> {
  const res = await fetcher(feed.url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsearFeed(await res.text(), feed.medio, ahora);
}

export async function descargarTodos(feeds: Feed[], fetcher: Fetcher, ahora: number): Promise<NoticiaCruda[]> {
  const resultados = await Promise.allSettled(feeds.map((feed) => descargarFeed(feed, fetcher, ahora)));
  return resultados.flatMap((resultado, i) => {
    if (resultado.status === "fulfilled") return resultado.value;
    const motivo = resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason);
    console.warn(`[feeds] ${feeds[i]!.medio} falló: ${motivo}`);
    return [];
  });
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `bun test test/feeds.test.ts`
Expected: todos pass. Si falla el test de `&#160;`, verificar que el parser no esté decodificando dentro de CDATA; `limpiarTexto` es el que debe hacerlo.

- [ ] **Step 6: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass, sin errores de tipos.

---

### Task 3: Persistencia (`src/store.ts`)

**Files:**
- Create: `src/store.ts`
- Test: `test/store.test.ts`
- Create: `test/helpers.ts`

**Interfaces:**
- Consumes: `MAX_INTENTOS_EVALUACION`, `RETENCION_MS`, `UMBRAL_CELEBRA`, `UMBRAL_YA_PASO`, `VENTANA_CANDIDATAS_MS` de config; `Candidata`, `EvaluacionA`, `NoticiaCruda`, `Tipo` de tipos.
- Produces:
  - `class Store { constructor(db: Database) }` con:
    - `insertar(noticias: NoticiaCruda[], ahora: number): number` — cantidad realmente insertada
    - `pendientes(ahora: number): NoticiaCruda[]` — sin evaluar, `intentos < 3`, publicadas en las últimas 6 h, más recientes primero
    - `guardarEvaluacion(url: string, ev: EvaluacionA, ahora: number): void`
    - `registrarFallo(url: string): void`
    - `candidatas(ahora: number, limite: number): Candidata[]` — pasan ambos umbrales, últimas 6 h, más recientes primero
    - `purgar(ahora: number): number`
    - `stats(ahora: number): Stats`
  - `type Stats = { noticias24h: number; candidatas6h: number; pendientes: number }`
  - `test/helpers.ts`: `AHORA`, `MIN`, `HORA`, `noticia(parcial?)`, `evaluacion(parcial?)`, `candidata(parcial?)`, `juezFalso(responder)` (se usa en Tasks 4–7)

- [ ] **Step 1: Crear `test/helpers.ts`**

```ts
import type { Candidata, EvaluacionA, Juez, NoticiaCruda } from "../src/tipos";

export const AHORA = Date.parse("2026-09-29T02:14:00Z"); // 23:14 en Montevideo
export const MIN = 60_000;
export const HORA = 60 * MIN;

let contador = 0;

export function noticia(parcial: Partial<NoticiaCruda> = {}): NoticiaCruda {
  contador++;
  return {
    url: `https://ejemplo.uy/n${contador}`,
    medio: "Test",
    titulo: `Titular ${contador}`,
    resumen: "Resumen",
    publicadoEn: AHORA - 30 * MIN,
    ...parcial,
  };
}

export function evaluacion(parcial: Partial<EvaluacionA> = {}): EvaluacionA {
  return { celebra: 0.9, yaPaso: 0.9, tipo: "futbol", alcance: 2, ...parcial };
}

export function candidata(parcial: Partial<Candidata> = {}): Candidata {
  return { ...noticia(), ...evaluacion(), ...parcial };
}

export type Pedido = { state: any; questions: Record<string, unknown> };

/** Cliente TypeSafe falso: registra los pedidos y responde con `responder` (o lanza lo que lance). */
export function juezFalso(responder: (pedido: Pedido) => Record<string, unknown>) {
  const pedidos: Pedido[] = [];
  const juez = {
    systemOne: async (pedido: Pedido) => {
      pedidos.push(pedido);
      return { model: "falso", answers: responder(pedido), usage: { input_tokens: 0, output_tokens: 0 } };
    },
  } as unknown as Juez;
  return { juez, pedidos };
}
```

- [ ] **Step 2: Escribir los tests del store**

`test/store.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { Store } from "../src/store";
import { AHORA, HORA, MIN, evaluacion, noticia } from "./helpers";

let store: Store;
beforeEach(() => {
  store = new Store(new Database(":memory:"));
});

test("insertar deduplica por URL", () => {
  const n = noticia();
  expect(store.insertar([n], AHORA)).toBe(1);
  expect(store.insertar([n, { ...n, titulo: "Otro título" }], AHORA)).toBe(0);
});

test("pendientes: solo sin evaluar y publicadas en las últimas 6 h, más recientes primero", () => {
  const vieja = noticia({ publicadoEn: AHORA - 7 * HORA });
  const media = noticia({ publicadoEn: AHORA - 2 * HORA });
  const nueva = noticia({ publicadoEn: AHORA - 5 * MIN });
  const evaluada = noticia();
  store.insertar([vieja, media, nueva, evaluada], AHORA);
  store.guardarEvaluacion(evaluada.url, evaluacion(), AHORA);

  expect(store.pendientes(AHORA).map((n) => n.url)).toEqual([nueva.url, media.url]);
});

test("pendientes devuelve la noticia con los mismos datos que se insertaron", () => {
  const n = noticia();
  store.insertar([n], AHORA);
  expect(store.pendientes(AHORA)).toEqual([n]);
});

test("tras 3 fallos una noticia deja de estar pendiente", () => {
  const n = noticia();
  store.insertar([n], AHORA);
  store.registrarFallo(n.url);
  store.registrarFallo(n.url);
  expect(store.pendientes(AHORA)).toHaveLength(1);
  store.registrarFallo(n.url);
  expect(store.pendientes(AHORA)).toHaveLength(0);
});

test("candidatas: pasan ambos umbrales, dentro de la ventana, ordenadas y limitadas", () => {
  const a = noticia({ publicadoEn: AHORA - 10 * MIN });
  const b = noticia({ publicadoEn: AHORA - 20 * MIN });
  const c = noticia({ publicadoEn: AHORA - 30 * MIN });
  const noCelebra = noticia();
  const noPaso = noticia();
  const vieja = noticia({ publicadoEn: AHORA - 7 * HORA });
  store.insertar([a, b, c, noCelebra, noPaso, vieja], AHORA);
  for (const n of [a, b, c, vieja]) store.guardarEvaluacion(n.url, evaluacion(), AHORA);
  store.guardarEvaluacion(noCelebra.url, evaluacion({ celebra: 0.49 }), AHORA);
  store.guardarEvaluacion(noPaso.url, evaluacion({ yaPaso: 0.2 }), AHORA);

  const lista = store.candidatas(AHORA, 2);
  expect(lista.map((x) => x.url)).toEqual([a.url, b.url]);
  expect(lista[0]).toEqual({ ...a, ...evaluacion() });
});

test("purgar borra lo publicado hace más de 48 h", () => {
  const vieja = noticia({ publicadoEn: AHORA - 49 * HORA });
  const reciente = noticia();
  store.insertar([vieja, reciente], AHORA);
  expect(store.purgar(AHORA)).toBe(1);
  expect(store.insertar([vieja], AHORA)).toBe(1); // ya no existía
});

test("stats", () => {
  const a = noticia();
  const b = noticia();
  const vieja = noticia({ publicadoEn: AHORA - 30 * HORA });
  store.insertar([a, b, vieja], AHORA);
  store.guardarEvaluacion(a.url, evaluacion(), AHORA);
  expect(store.stats(AHORA)).toEqual({ noticias24h: 2, candidatas6h: 1, pendientes: 1 });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `bun test test/store.test.ts`
Expected: FAIL — no se puede resolver `../src/store`.

- [ ] **Step 4: Implementar `src/store.ts`**

```ts
import type { Database } from "bun:sqlite";
import { MAX_INTENTOS_EVALUACION, RETENCION_MS, UMBRAL_CELEBRA, UMBRAL_YA_PASO, VENTANA_CANDIDATAS_MS } from "./config";
import type { Candidata, EvaluacionA, NoticiaCruda, Tipo } from "./tipos";

const DIA_MS = 24 * 60 * 60 * 1000;

type FilaNoticia = { url: string; medio: string; titulo: string; resumen: string; publicado_en: number };
type FilaCandidata = FilaNoticia & { celebra: number; ya_paso: number; tipo: Tipo; alcance: number };

export type Stats = { noticias24h: number; candidatas6h: number; pendientes: number };

function aNoticia(f: FilaNoticia): NoticiaCruda {
  return { url: f.url, medio: f.medio, titulo: f.titulo, resumen: f.resumen, publicadoEn: f.publicado_en };
}

export class Store {
  constructor(private readonly db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS noticias (
      url           TEXT PRIMARY KEY,
      medio         TEXT NOT NULL,
      titulo        TEXT NOT NULL,
      resumen       TEXT NOT NULL,
      publicado_en  INTEGER NOT NULL,
      ingresado_en  INTEGER NOT NULL,
      celebra       REAL,
      ya_paso       REAL,
      tipo          TEXT,
      alcance       REAL,
      evaluado_en   INTEGER,
      intentos      INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_noticias_publicado ON noticias(publicado_en)`);
  }

  insertar(noticias: NoticiaCruda[], ahora: number): number {
    const stmt = this.db.query(
      `INSERT OR IGNORE INTO noticias (url, medio, titulo, resumen, publicado_en, ingresado_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let nuevas = 0;
    this.db.transaction(() => {
      for (const n of noticias) nuevas += stmt.run(n.url, n.medio, n.titulo, n.resumen, n.publicadoEn, ahora).changes;
    })();
    return nuevas;
  }

  pendientes(ahora: number): NoticiaCruda[] {
    return this.db
      .query<FilaNoticia, [number, number]>(
        `SELECT url, medio, titulo, resumen, publicado_en FROM noticias
         WHERE celebra IS NULL AND intentos < ? AND publicado_en >= ?
         ORDER BY publicado_en DESC`,
      )
      .all(MAX_INTENTOS_EVALUACION, ahora - VENTANA_CANDIDATAS_MS)
      .map(aNoticia);
  }

  guardarEvaluacion(url: string, ev: EvaluacionA, ahora: number): void {
    this.db
      .query(`UPDATE noticias SET celebra = ?, ya_paso = ?, tipo = ?, alcance = ?, evaluado_en = ? WHERE url = ?`)
      .run(ev.celebra, ev.yaPaso, ev.tipo, ev.alcance, ahora, url);
  }

  registrarFallo(url: string): void {
    this.db.query(`UPDATE noticias SET intentos = intentos + 1 WHERE url = ?`).run(url);
  }

  candidatas(ahora: number, limite: number): Candidata[] {
    return this.db
      .query<FilaCandidata, [number, number, number, number]>(
        `SELECT url, medio, titulo, resumen, publicado_en, celebra, ya_paso, tipo, alcance FROM noticias
         WHERE celebra >= ? AND ya_paso >= ? AND publicado_en >= ?
         ORDER BY publicado_en DESC LIMIT ?`,
      )
      .all(UMBRAL_CELEBRA, UMBRAL_YA_PASO, ahora - VENTANA_CANDIDATAS_MS, limite)
      .map((f) => ({ ...aNoticia(f), celebra: f.celebra, yaPaso: f.ya_paso, tipo: f.tipo, alcance: f.alcance }));
  }

  purgar(ahora: number): number {
    return this.db.query(`DELETE FROM noticias WHERE publicado_en < ?`).run(ahora - RETENCION_MS).changes;
  }

  stats(ahora: number): Stats {
    const contar = (sql: string, ...params: number[]) =>
      this.db.query<{ n: number }, number[]>(sql).get(...params)?.n ?? 0;
    return {
      noticias24h: contar(`SELECT COUNT(*) AS n FROM noticias WHERE publicado_en >= ?`, ahora - DIA_MS),
      candidatas6h: contar(
        `SELECT COUNT(*) AS n FROM noticias WHERE celebra >= ? AND ya_paso >= ? AND publicado_en >= ?`,
        UMBRAL_CELEBRA,
        UMBRAL_YA_PASO,
        ahora - VENTANA_CANDIDATAS_MS,
      ),
      pendientes: contar(
        `SELECT COUNT(*) AS n FROM noticias WHERE celebra IS NULL AND intentos < ? AND publicado_en >= ?`,
        MAX_INTENTOS_EVALUACION,
        ahora - VENTANA_CANDIDATAS_MS,
      ),
    };
  }
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `bun test test/store.test.ts`
Expected: todos pass.

- [ ] **Step 6: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass, sin errores de tipos.

---

### Task 4: Etapa A (`src/evaluate.ts`)

**Files:**
- Create: `src/evaluate.ts`
- Test: `test/evaluate.test.ts`

**Interfaces:**
- Consumes: `isoUY` de tiempo; `EvaluacionA`, `Juez`, `NoticiaCruda`, `Tipo` de tipos; `noul`, `choice`, `score` de `@typesafe-ai/sdk`; `juezFalso`, `noticia`, `AHORA` de `test/helpers.ts`.
- Produces:
  - `PREGUNTAS_A` — objeto con las claves `celebra`, `ya_paso`, `tipo`, `alcance`
  - `stateA(noticia: NoticiaCruda, ahora: number): { medio; titulo; resumen; publicado_en; ahora }`
  - `evaluarNoticia(juez: Juez, noticia: NoticiaCruda, ahora: number): Promise<EvaluacionA>` (propaga errores del juez)

- [ ] **Step 1: Escribir los tests**

`test/evaluate.test.ts`:

```ts
import { expect, test } from "bun:test";
import { PREGUNTAS_A, evaluarNoticia, stateA } from "../src/evaluate";
import { TIPOS } from "../src/tipos";
import { AHORA, MIN, juezFalso, noticia } from "./helpers";

const RESPUESTA = {
  celebra: { type: "noul", noul: 0.92 },
  ya_paso: { type: "noul", noul: 0.81 },
  tipo: { type: "choice", choice: "futbol", confidence: 0.9, probabilities: {} },
  alcance: { type: "score", score: 2.4, confidence: 0.7, legend: {}, probabilities: {} },
};

test("hace una sola request con las cuatro preguntas y mapea la respuesta", async () => {
  const { juez, pedidos } = juezFalso(() => RESPUESTA);
  const ev = await evaluarNoticia(juez, noticia(), AHORA);

  expect(pedidos).toHaveLength(1);
  expect(Object.keys(pedidos[0]!.questions).sort()).toEqual(["alcance", "celebra", "tipo", "ya_paso"]);
  expect(ev).toEqual({ celebra: 0.92, yaPaso: 0.81, tipo: "futbol", alcance: 2.4 });
});

test("el state lleva la noticia en español y las fechas en hora de Uruguay", () => {
  const n = noticia({ titulo: "Peñarol campeón", publicadoEn: AHORA - 24 * MIN });
  expect(stateA(n, AHORA)).toEqual({
    medio: n.medio,
    titulo: "Peñarol campeón",
    resumen: n.resumen,
    publicado_en: "2026-09-28T22:50:00-03:00",
    ahora: "2026-09-28T23:14:00-03:00",
  });
});

test("la pregunta tipo ofrece exactamente los TIPOS", () => {
  expect(Object.keys(PREGUNTAS_A.tipo.criteria)).toEqual([...TIPOS]);
  expect(PREGUNTAS_A.alcance.criteria).toHaveLength(4);
});

test("propaga errores de TypeSafe", async () => {
  const { juez } = juezFalso(() => {
    throw new Error("503");
  });
  await expect(evaluarNoticia(juez, noticia(), AHORA)).rejects.toThrow("503");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `bun test test/evaluate.test.ts`
Expected: FAIL — no se puede resolver `../src/evaluate`.

- [ ] **Step 3: Implementar `src/evaluate.ts`**

```ts
import { choice, noul, score } from "@typesafe-ai/sdk";
import { isoUY } from "./tiempo";
import type { EvaluacionA, Juez, NoticiaCruda, Tipo } from "./tipos";

// Jev está entrenado principalmente en inglés: preguntas en inglés, noticia en español.
const CRITERIOS_TIPO = {
  futbol: "Football (soccer): a club or the national team won a match, a title or a derby.",
  otro_deporte: "Another sport: basketball, rugby, athletics, etc.",
  politica: "Politics: an election result, a party or candidate winning, a decision a group celebrates.",
  fecha_festiva: "A festive date: New Year, Christmas, national holidays.",
  cultural: "Culture: carnival, Llamadas, concerts, festivals.",
  otro: "Something else people could celebrate.",
  ninguno: "Nothing to celebrate.",
} satisfies Record<Tipo, string>;

export const PREGUNTAS_A = {
  celebra: noul(
    "The news item is written in Spanish and comes from Uruguay. Does it describe an event that makes people in Uruguay celebrate publicly — setting off fireworks (cuetes), honking car horns or gathering in the streets?",
    {
      true: "A victory, title, electoral win, festive date or similar event that a group of Uruguayans would celebrate loudly in public.",
      false: "Neutral, negative or routine news, or something people do not celebrate in public.",
    },
  ),
  ya_paso: noul("As of `ahora`, has the event described in the news item already happened or is it happening right now?", {
    true: "The match has finished, the result was announced, or the event is ongoing.",
    false: "It is a preview, schedule, forecast, announcement or analysis of something that has not happened yet.",
  }),
  tipo: choice("What kind of event is described in the news item?", CRITERIOS_TIPO),
  alcance: score("If people celebrate this event, how widespread would the celebration be in Uruguay?", [
    "Nobody would celebrate it.",
    "A neighbourhood or a small group of people.",
    "A whole city or department.",
    "The whole country.",
  ]),
};

export function stateA(noticia: NoticiaCruda, ahora: number) {
  return {
    medio: noticia.medio,
    titulo: noticia.titulo,
    resumen: noticia.resumen,
    publicado_en: isoUY(noticia.publicadoEn),
    ahora: isoUY(ahora),
  };
}

export async function evaluarNoticia(juez: Juez, noticia: NoticiaCruda, ahora: number): Promise<EvaluacionA> {
  const { answers } = await juez.systemOne({ state: stateA(noticia, ahora), questions: PREGUNTAS_A });
  return {
    celebra: answers.celebra.noul,
    yaPaso: answers.ya_paso.noul,
    tipo: answers.tipo.choice,
    alcance: answers.alcance.score,
  };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `bun test test/evaluate.test.ts`
Expected: todos pass.

- [ ] **Step 5: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass. Si tsc marca `answers.tipo.choice` como `string`, revisar que `CRITERIOS_TIPO` use `satisfies` (no una anotación `: Record<Tipo, string>`, que borraría las claves literales).

---

### Task 5: Etapa B y puntaje (`src/rank.ts`)

**Files:**
- Create: `src/rank.ts`
- Test: `test/rank.test.ts`

**Interfaces:**
- Consumes: `FRESCURA_PLENA_MS`, `MAX_CAUSAS`, `PUNTAJE_MINIMO`, `VENTANA_CANDIDATAS_MS` de config; `isoUY`; `Candidata`, `Causa`, `Juez`; `score` del SDK; `candidata`, `juezFalso`, `AHORA`, `HORA`, `MIN` de helpers.
- Produces:
  - `frescura(edadMs: number): number`
  - `puntaje(celebra: number, cercania: number, edadMs: number): number`
  - `preguntasB(cantidad: number): Record<string, ScoreQuestion>` con claves `cerca_0 … cerca_{n-1}`
  - `stateB(ubicacion: string, candidatas: Candidata[], ahora: number)`
  - `type Ranking = { causas: Causa[]; aproximado: boolean }`
  - `rankear(juez: Juez, ubicacion: string, candidatas: Candidata[], ahora: number): Promise<Ranking>` (nunca lanza por errores de TypeSafe)

- [ ] **Step 1: Escribir los tests**

`test/rank.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { frescura, preguntasB, puntaje, rankear, stateB } from "../src/rank";
import { AHORA, HORA, MIN, candidata, juezFalso } from "./helpers";

describe("frescura", () => {
  test("1 hasta la primera hora, lineal hasta 0 a las 6 h", () => {
    expect(frescura(-5 * MIN)).toBe(1);
    expect(frescura(0)).toBe(1);
    expect(frescura(59 * MIN)).toBe(1);
    expect(frescura(1 * HORA)).toBe(1);
    expect(frescura(3.5 * HORA)).toBeCloseTo(0.5);
    expect(frescura(6 * HORA)).toBe(0);
    expect(frescura(10 * HORA)).toBe(0);
  });
});

describe("puntaje", () => {
  test("celebra × cercanía/3 × frescura", () => {
    expect(puntaje(0.9, 3, 0)).toBeCloseTo(0.9);
    expect(puntaje(0.8, 1.5, 3.5 * HORA)).toBeCloseTo(0.2);
  });
});

test("preguntasB crea un Score 0–3 por candidata que referencia su índice", () => {
  const preguntas = preguntasB(2);
  expect(Object.keys(preguntas)).toEqual(["cerca_0", "cerca_1"]);
  expect(preguntas.cerca_1!.type).toBe("score");
  expect(preguntas.cerca_1!.criteria).toHaveLength(4);
  expect(String(preguntas.cerca_1!.instructions)).toContain("`noticias[1]`");
});

test("stateB incluye ubicación, hora y solo los campos necesarios de cada noticia", () => {
  const c = candidata({ titulo: "Nacional campeón", resumen: "R", tipo: "futbol" });
  expect(stateB("Pocitos, Montevideo", [c], AHORA)).toEqual({
    usuario: { ubicacion: "Pocitos, Montevideo" },
    ahora: "2026-09-28T23:14:00-03:00",
    noticias: [{ titulo: "Nacional campeón", resumen: "R", tipo: "futbol" }],
  });
});

describe("rankear", () => {
  test("sin candidatas no llama a TypeSafe", async () => {
    const { juez, pedidos } = juezFalso(() => ({}));
    expect(await rankear(juez, "Pocitos", [], AHORA)).toEqual({ causas: [], aproximado: false });
    expect(pedidos).toHaveLength(0);
  });

  test("una sola request; filtra por mínimo, ordena y corta en 3", async () => {
    const reciente = AHORA - 30 * MIN;
    const cs = [
      candidata({ titulo: "A", celebra: 0.9, publicadoEn: reciente }), // 0.9 × 3/3 = 0.90
      candidata({ titulo: "B", celebra: 0.9, publicadoEn: reciente }), // 0.9 × 0/3 = 0.00
      candidata({ titulo: "C", celebra: 0.6, publicadoEn: reciente }), // 0.6 × 2/3 = 0.40
      candidata({ titulo: "D", celebra: 0.7, publicadoEn: reciente }), // 0.7 × 3/3 = 0.70
      candidata({ titulo: "E", celebra: 0.95, publicadoEn: reciente }), // 0.95 × 1/3 = 0.32
    ];
    const cercanias = [3, 0, 2, 3, 1];
    const { juez, pedidos } = juezFalso(() =>
      Object.fromEntries(cercanias.map((s, i) => [`cerca_${i}`, { type: "score", score: s }])),
    );

    const r = await rankear(juez, "Pocitos, Montevideo", cs, AHORA);

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.state.usuario.ubicacion).toBe("Pocitos, Montevideo");
    expect(r.aproximado).toBe(false);
    expect(r.causas.map((c) => [c.titulo, c.puntaje])).toEqual([
      ["A", 0.9],
      ["D", 0.7],
      ["C", 0.4],
    ]);
    expect(r.causas[0]).toEqual({
      titulo: "A",
      url: cs[0]!.url,
      medio: cs[0]!.medio,
      tipo: "futbol",
      puntaje: 0.9,
      publicado_en: "2026-09-28T22:44:00-03:00",
    });
  });

  test("si TypeSafe falla usa el alcance y marca aproximado", async () => {
    const { juez } = juezFalso(() => {
      throw new Error("timeout");
    });
    const c = candidata({ celebra: 0.9, alcance: 3, publicadoEn: AHORA - 10 * MIN });
    const r = await rankear(juez, "Salto", [c], AHORA);
    expect(r.aproximado).toBe(true);
    expect(r.causas.map((x) => x.puntaje)).toEqual([0.9]);
  });

  test("respuesta sin una clave cerca_i cuenta como cercanía 0", async () => {
    const { juez } = juezFalso(() => ({}));
    const r = await rankear(juez, "Salto", [candidata()], AHORA);
    expect(r).toEqual({ causas: [], aproximado: false });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `bun test test/rank.test.ts`
Expected: FAIL — no se puede resolver `../src/rank`.

- [ ] **Step 3: Implementar `src/rank.ts`**

```ts
import { score } from "@typesafe-ai/sdk";
import { FRESCURA_PLENA_MS, MAX_CAUSAS, PUNTAJE_MINIMO, VENTANA_CANDIDATAS_MS } from "./config";
import { isoUY } from "./tiempo";
import type { Candidata, Causa, Juez } from "./tipos";

export function frescura(edadMs: number): number {
  if (edadMs <= FRESCURA_PLENA_MS) return 1;
  if (edadMs >= VENTANA_CANDIDATAS_MS) return 0;
  return 1 - (edadMs - FRESCURA_PLENA_MS) / (VENTANA_CANDIDATAS_MS - FRESCURA_PLENA_MS);
}

export function puntaje(celebra: number, cercania: number, edadMs: number): number {
  return celebra * (cercania / 3) * frescura(edadMs);
}

const CRITERIOS_CERCA = [
  "Unlikely: it happened somewhere else or concerns people who are not there.",
  "Possible.",
  "Likely.",
  "Very likely: it happened there, or the celebration is nationwide.",
] as const;

function preguntaCerca(i: number) {
  return score(
    `How likely is it that someone located in \`usuario.ubicacion\` hears fireworks right now because of the event in \`noticias[${i}]\`?`,
    CRITERIOS_CERCA,
  );
}

export function preguntasB(cantidad: number) {
  const preguntas: Record<string, ReturnType<typeof preguntaCerca>> = {};
  for (let i = 0; i < cantidad; i++) preguntas[`cerca_${i}`] = preguntaCerca(i);
  return preguntas;
}

export function stateB(ubicacion: string, candidatas: Candidata[], ahora: number) {
  return {
    usuario: { ubicacion },
    ahora: isoUY(ahora),
    noticias: candidatas.map((c) => ({ titulo: c.titulo, resumen: c.resumen, tipo: c.tipo })),
  };
}

export type Ranking = { causas: Causa[]; aproximado: boolean };

export async function rankear(juez: Juez, ubicacion: string, candidatas: Candidata[], ahora: number): Promise<Ranking> {
  if (candidatas.length === 0) return { causas: [], aproximado: false };

  let cercanias: number[];
  let aproximado = false;
  try {
    const { answers } = await juez.systemOne({
      state: stateB(ubicacion, candidatas, ahora),
      questions: preguntasB(candidatas.length),
    });
    cercanias = candidatas.map((_, i) => answers[`cerca_${i}`]?.score ?? 0);
  } catch (error) {
    console.warn("[rank] TypeSafe falló, uso puntaje sin ubicación:", error instanceof Error ? error.message : error);
    cercanias = candidatas.map((c) => c.alcance);
    aproximado = true;
  }

  const causas = candidatas
    .map((c, i) => ({ c, p: puntaje(c.celebra, cercanias[i] ?? 0, ahora - c.publicadoEn) }))
    .filter(({ p }) => p >= PUNTAJE_MINIMO)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_CAUSAS)
    .map(({ c, p }) => ({
      titulo: c.titulo,
      url: c.url,
      medio: c.medio,
      tipo: c.tipo,
      puntaje: Math.round(p * 100) / 100,
      publicado_en: isoUY(c.publicadoEn),
    }));

  return { causas, aproximado };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `bun test test/rank.test.ts`
Expected: todos pass.

- [ ] **Step 5: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass, sin errores de tipos.

---

### Task 6: Worker de ingesta (`src/ingest.ts`)

**Files:**
- Create: `src/ingest.ts`
- Test: `test/ingest.test.ts`

**Interfaces:**
- Consumes: `CONCURRENCIA_EVALUACION`; `evaluarNoticia`; `descargarTodos`, `Feed`, `Fetcher`; `Store`; `Juez`; `juezFalso`, `AHORA` de helpers; fixture `rss-un-item.xml`.
- Produces:
  - `type ResumenIngesta = { nuevas: number; evaluadas: number; fallidas: number; purgadas: number }`
  - `type Ingestor = { correr(): Promise<ResumenIngesta | null>; ultimaIngesta(): number | null; iniciar(intervaloMs: number): () => void }`
  - `crearIngestor(deps: { store: Store; juez: Juez; feeds: Feed[]; fetcher: Fetcher; ahora?: () => number }): Ingestor` — `correr()` devuelve `null` si ya hay una corrida en curso
  - `enParalelo<T>(items: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void>`

- [ ] **Step 1: Escribir los tests**

`test/ingest.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import type { Fetcher } from "../src/feeds";
import { crearIngestor, enParalelo } from "../src/ingest";
import { Store } from "../src/store";
import { AHORA, juezFalso } from "./helpers";

// La noticia del fixture es de 01:40Z; AHORA es 02:14Z.
const xml = await Bun.file(new URL("./fixtures/rss-un-item.xml", import.meta.url)).text();
const fetcher: Fetcher = async () => new Response(xml);
const feeds = [{ medio: "Tenfield", url: "https://ok.uy/rss" }];

const RESPUESTA_A = {
  celebra: { type: "noul", noul: 0.95 },
  ya_paso: { type: "noul", noul: 0.9 },
  tipo: { type: "choice", choice: "futbol" },
  alcance: { type: "score", score: 3 },
};

let store: Store;
beforeEach(() => {
  store = new Store(new Database(":memory:"));
});

test("descarga, guarda, evalúa y deja candidatas; la segunda corrida no repite trabajo", async () => {
  const { juez, pedidos } = juezFalso(() => RESPUESTA_A);
  const ingestor = crearIngestor({ store, juez, feeds, fetcher, ahora: () => AHORA });

  expect(ingestor.ultimaIngesta()).toBeNull();
  expect(await ingestor.correr()).toEqual({ nuevas: 1, evaluadas: 1, fallidas: 0, purgadas: 0 });
  expect(ingestor.ultimaIngesta()).toBe(AHORA);
  expect(store.candidatas(AHORA, 10).map((c) => c.titulo)).toEqual(["Uruguay le ganó a Brasil en el Centenario"]);

  expect(await ingestor.correr()).toEqual({ nuevas: 0, evaluadas: 0, fallidas: 0, purgadas: 0 });
  expect(pedidos).toHaveLength(1);
});

test("si TypeSafe falla, la noticia queda pendiente y suma un intento", async () => {
  const { juez } = juezFalso(() => {
    throw new Error("429");
  });
  const ingestor = crearIngestor({ store, juez, feeds, fetcher, ahora: () => AHORA });

  expect(await ingestor.correr()).toEqual({ nuevas: 1, evaluadas: 0, fallidas: 1, purgadas: 0 });
  expect(store.pendientes(AHORA)).toHaveLength(1);
  await ingestor.correr();
  await ingestor.correr();
  expect(store.pendientes(AHORA)).toHaveLength(0); // 3 intentos agotados
});

test("no corre dos ingestas a la vez", async () => {
  const { juez } = juezFalso(() => RESPUESTA_A);
  const ingestor = crearIngestor({ store, juez, feeds, fetcher, ahora: () => AHORA });
  const [primera, segunda] = await Promise.all([ingestor.correr(), ingestor.correr()]);
  expect(primera).not.toBeNull();
  expect(segunda).toBeNull();
});

test("enParalelo procesa todo sin superar el límite de concurrencia", async () => {
  let activos = 0;
  let maximo = 0;
  const hechos: number[] = [];
  await enParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    activos++;
    maximo = Math.max(maximo, activos);
    await Bun.sleep(5);
    hechos.push(n);
    activos--;
  });
  expect(hechos.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(maximo).toBe(3);
});

test("enParalelo con lista vacía termina", async () => {
  await enParalelo([], 4, async () => {});
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `bun test test/ingest.test.ts`
Expected: FAIL — no se puede resolver `../src/ingest`.

- [ ] **Step 3: Implementar `src/ingest.ts`**

```ts
import { CONCURRENCIA_EVALUACION } from "./config";
import { evaluarNoticia } from "./evaluate";
import { descargarTodos, type Feed, type Fetcher } from "./feeds";
import type { Store } from "./store";
import type { Juez } from "./tipos";

export type ResumenIngesta = { nuevas: number; evaluadas: number; fallidas: number; purgadas: number };

export type Ingestor = {
  /** Una corrida completa; devuelve null si ya había una en curso. */
  correr(): Promise<ResumenIngesta | null>;
  ultimaIngesta(): number | null;
  /** Corre ya y luego cada `intervaloMs`; devuelve una función para detener. */
  iniciar(intervaloMs: number): () => void;
};

export type DepsIngestor = { store: Store; juez: Juez; feeds: Feed[]; fetcher: Fetcher; ahora?: () => number };

export function crearIngestor(deps: DepsIngestor): Ingestor {
  const ahora = deps.ahora ?? Date.now;
  let corriendo = false;
  let ultima: number | null = null;

  async function correr(): Promise<ResumenIngesta | null> {
    if (corriendo) return null;
    corriendo = true;
    try {
      const t = ahora();
      const nuevas = deps.store.insertar(await descargarTodos(deps.feeds, deps.fetcher, t), t);
      let evaluadas = 0;
      let fallidas = 0;
      await enParalelo(deps.store.pendientes(t), CONCURRENCIA_EVALUACION, async (noticia) => {
        try {
          deps.store.guardarEvaluacion(noticia.url, await evaluarNoticia(deps.juez, noticia, t), ahora());
          evaluadas++;
        } catch (error) {
          deps.store.registrarFallo(noticia.url);
          fallidas++;
          console.warn(`[ingesta] no se pudo evaluar ${noticia.url}:`, error instanceof Error ? error.message : error);
        }
      });
      const purgadas = deps.store.purgar(t);
      ultima = t;
      return { nuevas, evaluadas, fallidas, purgadas };
    } finally {
      corriendo = false;
    }
  }

  return {
    correr,
    ultimaIngesta: () => ultima,
    iniciar(intervaloMs) {
      const tick = () =>
        correr()
          .then((resumen) => resumen && console.log("[ingesta]", resumen))
          .catch((error) => console.error("[ingesta] error:", error));
      tick();
      const id = setInterval(tick, intervaloMs);
      return () => clearInterval(id);
    },
  };
}

export async function enParalelo<T>(items: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) await fn(items[siguiente++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `bun test test/ingest.test.ts`
Expected: todos pass.

- [ ] **Step 5: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass, sin errores de tipos.

---

### Task 7: API HTTP (`src/server.ts`)

**Files:**
- Create: `src/server.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `MAX_CANDIDATAS_CONSULTA`; `rankear`; `Store`; `isoUY`; `Juez`; helpers `AHORA`, `MIN`, `evaluacion`, `juezFalso`, `noticia`.
- Produces:
  - `type DepsServidor = { store: Store; juez: Juez; ultimaIngesta: () => number | null; ahora?: () => number }`
  - `crearHandlers(deps: DepsServidor): { cuetes(req: Request): Promise<Response>; health(): Response }`
  - `servir(handlers: ReturnType<typeof crearHandlers>, puerto: number): Server` — rutas `POST /api/cuetes`, `GET /api/health`, 404 JSON para el resto

- [ ] **Step 1: Escribir los tests**

`test/server.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { crearHandlers, servir } from "../src/server";
import { Store } from "../src/store";
import { AHORA, MIN, evaluacion, juezFalso, noticia } from "./helpers";

let store: Store;
beforeEach(() => {
  store = new Store(new Database(":memory:"));
});

const post = (body: unknown) =>
  new Request("http://x/api/cuetes", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/cuetes", () => {
  test.each([
    ["body que no es JSON", "{roto"],
    ["sin usuario", {}],
    ["ubicacion ausente", { usuario: { id: "u1" } }],
    ["ubicacion no string", { usuario: { ubicacion: 42 } }],
    ["ubicacion solo espacios", { usuario: { ubicacion: "   " } }],
    ["body null", "null"],
  ])("400 con %s y sin llamar a TypeSafe", async (_, body) => {
    const { juez, pedidos } = juezFalso(() => ({}));
    const res = await crearHandlers({ store, juez, ultimaIngesta: () => null, ahora: () => AHORA }).cuetes(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(pedidos).toHaveLength(0);
  });

  test("sin candidatas responde causas vacías sin llamar a TypeSafe", async () => {
    const { juez, pedidos } = juezFalso(() => ({}));
    const res = await crearHandlers({ store, juez, ultimaIngesta: () => null, ahora: () => AHORA }).cuetes(
      post({ usuario: { id: "u1", ubicacion: "  Pocitos, Montevideo " } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ubicacion: "Pocitos, Montevideo",
      evaluado_en: "2026-09-28T23:14:00-03:00",
      aproximado: false,
      causas: [],
    });
    expect(pedidos).toHaveLength(0);
  });

  test("con una candidata la devuelve puntuada", async () => {
    const n = noticia({ titulo: "Peñarol campeón", publicadoEn: AHORA - 10 * MIN });
    store.insertar([n], AHORA);
    store.guardarEvaluacion(n.url, evaluacion({ celebra: 0.9 }), AHORA);
    const { juez, pedidos } = juezFalso(() => ({ cerca_0: { type: "score", score: 3 } }));

    const res = await crearHandlers({ store, juez, ultimaIngesta: () => null, ahora: () => AHORA }).cuetes(
      post({ usuario: { ubicacion: "Pocitos, Montevideo" } }),
    );
    const body = (await res.json()) as { causas: { titulo: string; puntaje: number }[] };
    expect(body.causas.map((c) => [c.titulo, c.puntaje])).toEqual([["Peñarol campeón", 0.9]]);
    expect(pedidos[0]!.state.usuario.ubicacion).toBe("Pocitos, Montevideo");
  });
});

test("GET /api/health", async () => {
  store.insertar([noticia()], AHORA);
  const { juez } = juezFalso(() => ({}));
  const res = crearHandlers({ store, juez, ultimaIngesta: () => AHORA, ahora: () => AHORA }).health();
  await expect(res.json()).resolves.toEqual({
    ultima_ingesta: "2026-09-28T23:14:00-03:00",
    noticias_24h: 1,
    candidatas_6h: 0,
    pendientes: 1,
  });
});

describe("servir", () => {
  let servidor: ReturnType<typeof servir>;
  afterEach(() => servidor?.stop(true));

  test("enruta /api/health, /api/cuetes y devuelve 404 JSON para el resto", async () => {
    const { juez } = juezFalso(() => ({}));
    servidor = servir(crearHandlers({ store, juez, ultimaIngesta: () => null }), 0);

    expect((await fetch(new URL("/api/health", servidor.url))).status).toBe(200);
    const cuetes = await fetch(new URL("/api/cuetes", servidor.url), {
      method: "POST",
      body: JSON.stringify({ usuario: { ubicacion: "Salto" } }),
    });
    expect(cuetes.status).toBe(200);
    const otra = await fetch(new URL("/otra", servidor.url));
    expect(otra.status).toBe(404);
    expect(await otra.json()).toEqual({ error: "No encontrado" });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `bun test test/server.test.ts`
Expected: FAIL — no se puede resolver `../src/server`.

- [ ] **Step 3: Implementar `src/server.ts`**

```ts
import { MAX_CANDIDATAS_CONSULTA } from "./config";
import { rankear } from "./rank";
import type { Store } from "./store";
import { isoUY } from "./tiempo";
import type { Juez } from "./tipos";

export type DepsServidor = {
  store: Store;
  juez: Juez;
  ultimaIngesta: () => number | null;
  ahora?: () => number;
};

const error400 = (mensaje: string) => Response.json({ error: mensaje }, { status: 400 });

export function crearHandlers(deps: DepsServidor) {
  const ahora = deps.ahora ?? Date.now;

  return {
    async cuetes(req: Request): Promise<Response> {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return error400("El body debe ser JSON");
      }
      const ubicacionCruda = (body as { usuario?: { ubicacion?: unknown } } | null)?.usuario?.ubicacion;
      if (typeof ubicacionCruda !== "string" || ubicacionCruda.trim() === "") {
        return error400("usuario.ubicacion es requerido");
      }
      const ubicacion = ubicacionCruda.trim();
      const t = ahora();
      const { causas, aproximado } = await rankear(
        deps.juez,
        ubicacion,
        deps.store.candidatas(t, MAX_CANDIDATAS_CONSULTA),
        t,
      );
      return Response.json({ ubicacion, evaluado_en: isoUY(t), aproximado, causas });
    },

    health(): Response {
      const t = ahora();
      const stats = deps.store.stats(t);
      const ultima = deps.ultimaIngesta();
      return Response.json({
        ultima_ingesta: ultima === null ? null : isoUY(ultima),
        noticias_24h: stats.noticias24h,
        candidatas_6h: stats.candidatas6h,
        pendientes: stats.pendientes,
      });
    },
  };
}

export function servir(handlers: ReturnType<typeof crearHandlers>, puerto: number) {
  return Bun.serve({
    port: puerto,
    routes: {
      "/api/cuetes": { POST: (req) => handlers.cuetes(req) },
      "/api/health": { GET: () => handlers.health() },
    },
    fetch: () => Response.json({ error: "No encontrado" }, { status: 404 }),
  });
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `bun test test/server.test.ts`
Expected: todos pass.

- [ ] **Step 5: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass, sin errores de tipos.

---

### Task 8: Arranque (`index.ts`) y prueba de humo con feeds reales

**Files:**
- Modify: `index.ts` (reemplazar el contenido completo; hoy tiene el ejemplo de tickets de TypeSafe)
- Modify: `README.md`

**Interfaces:**
- Consumes: `DB_PATH`, `INTERVALO_INGESTA_MS`, `PUERTO`; `FEEDS`; `crearIngestor`; `crearHandlers`, `servir`; `Store`; `TypeSafeClient`.
- Produces: proceso ejecutable con `bun run start` / `bun run dev`.

- [ ] **Step 1: Reemplazar `index.ts`**

```ts
import { Database } from "bun:sqlite";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DB_PATH, INTERVALO_INGESTA_MS, PUERTO } from "./src/config";
import { FEEDS } from "./src/feeds";
import { crearIngestor } from "./src/ingest";
import { crearHandlers, servir } from "./src/server";
import { Store } from "./src/store";

if (!process.env.TYPESAFE_API_KEY) {
  console.error("Falta TYPESAFE_API_KEY. Agregala al archivo .env (Bun lo carga automáticamente).");
  process.exit(1);
}

const juez = new TypeSafeClient();
const store = new Store(new Database(DB_PATH, { create: true }));
const ingestor = crearIngestor({ store, juez, feeds: FEEDS, fetcher: fetch });

ingestor.iniciar(INTERVALO_INGESTA_MS);
const servidor = servir(crearHandlers({ store, juez, ultimaIngesta: ingestor.ultimaIngesta }), PUERTO);
console.log(`cuetes escuchando en ${servidor.url}`);
```

- [ ] **Step 2: Typecheck y tests**

Run: `bun test && bunx tsc --noEmit`
Expected: todo pass, sin errores de tipos.

- [ ] **Step 3: Verificar el error por falta de API key**

Run: `TYPESAFE_API_KEY= bun index.ts; echo "exit=$?"`
Expected: imprime `Falta TYPESAFE_API_KEY…` y `exit=1`.

- [ ] **Step 4: Prueba de humo con feeds y TypeSafe reales**

Arrancar en segundo plano con una base de datos descartable:

Run: `CUETES_DB=/tmp/cuetes-humo.db PORT=3999 bun index.ts` (en segundo plano)

Esperar a que el log muestre `[ingesta] { nuevas: …, evaluadas: …, … }` (puede tardar 1–2 min en la primera corrida). Luego:

Run: `curl -s localhost:3999/api/health`
Expected: JSON con `ultima_ingesta` no nulo, `noticias_24h` > 0 y `pendientes` en 0 o bajando.

Run: `curl -s -X POST localhost:3999/api/cuetes -d '{"usuario":{"ubicacion":"Pocitos, Montevideo"}}'`
Expected: 200 con la forma `{ ubicacion, evaluado_en, aproximado: false, causas: [...] }`. `causas` puede venir vacío si ninguna noticia del momento da para festejar: es un resultado válido.

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3999/api/cuetes -d '{"usuario":{}}'`
Expected: `400`.

Revisar el log: si algún feed aparece como `[feeds] <medio> falló`, anotarlo en el reporte final (no bloquea).

Detener el proceso y borrar `/tmp/cuetes-humo.db*`.

- [ ] **Step 5: Actualizar `README.md`**

Reemplazar el contenido completo por:

````markdown
# cuetes

Backend que responde **"¿Por qué están tirando cuetes?"**: lee noticias uruguayas por RSS, usa
TypeSafe (Jev) para detectar cuáles provocan festejos y las ordena según la ubicación del usuario.

## Requisitos

- Bun ≥ 1.4
- `TYPESAFE_API_KEY` en `.env`

## Uso

```bash
bun install
bun run dev        # servidor + ingesta cada 5 min (con recarga)
bun test           # tests unitarios (sin red)
bun run eval       # evaluación real de la Etapa A sobre titulares etiquetados
```

## API

`POST /api/cuetes`

```json
{ "usuario": { "id": "u123", "ubicacion": "Pocitos, Montevideo" } }
```

Responde `{ ubicacion, evaluado_en, aproximado, causas: [{ titulo, url, medio, tipo, puntaje, publicado_en }] }`.
`aproximado: true` indica que TypeSafe no respondió y el orden no considera la ubicación.

`GET /api/health` — última ingesta, noticias de las últimas 24 h, candidatas y pendientes.

Variables opcionales: `PORT` (3000), `CUETES_DB` (`cuetes.db`).

Diseño: `docs/superpowers/specs/2026-09-28-cuetes-backend-design.md`.
````

- [ ] **Step 6: Checkpoint + commit**

Run: `bun test && bunx tsc --noEmit && git status --short`
Expected: todo pass; `cuetes.db` no aparece en el status (está ignorado).

---

### Task 9: Evaluación real de la Etapa A (`scripts/eval.ts`)

**Files:**
- Create: `test/eval/titulares.json`
- Create: `scripts/eval.ts`

**Interfaces:**
- Consumes: `evaluarNoticia`; `enParalelo`; `UMBRAL_CELEBRA`, `UMBRAL_YA_PASO`, `CONCURRENCIA_EVALUACION`; `TypeSafeClient`.
- Produces: `bun run eval` — imprime cada caso y `N/15 aciertos`; exit 0 si N ≥ 13, exit 1 si no.

- [ ] **Step 1: Crear el set etiquetado**

`test/eval/titulares.json` (`esperado: true` = debería ser candidata: festejable y ya ocurrió):

```json
[
  { "medio": "Tenfield", "titulo": "Uruguay le ganó 2-0 a Brasil en el Centenario y se clasificó al Mundial", "resumen": "La Celeste selló su pasaje con goles en el segundo tiempo ante un estadio lleno.", "esperado": true },
  { "medio": "Montevideo Portal", "titulo": "Peñarol se consagró campeón uruguayo tras vencer a Nacional en la final", "resumen": "Los hinchas aurinegros salieron a festejar a la Plaza Fabini y a la avenida 18 de Julio.", "esperado": true },
  { "medio": "Subrayado", "titulo": "Nacional ganó el clásico y es el nuevo campeón del Torneo Clausura", "resumen": "El tricolor se impuso 1-0 y los festejos se trasladaron al Parque Central.", "esperado": true },
  { "medio": "la diaria", "titulo": "El Frente Amplio ganó el balotaje y Yamandú Orsi es el presidente electo", "resumen": "Miles de simpatizantes se concentraron en la rambla para celebrar el resultado.", "esperado": true },
  { "medio": "Tenfield", "titulo": "Liverpool campeón del Torneo Intermedio: fiesta en Belvedere", "resumen": "El negriazul venció en la final y sus hinchas celebraron en el barrio.", "esperado": true },
  { "medio": "Teledoce", "titulo": "Aguada es campeón de la Liga Uruguaya de Básquetbol", "resumen": "El aguatero ganó la serie final y sus hinchas festejaron en Goes.", "esperado": true },
  { "medio": "Montevideo Portal", "titulo": "Montevideo recibió el Año Nuevo con fuegos artificiales en la rambla", "resumen": "Miles de personas se reunieron en la costa para celebrar la llegada del nuevo año.", "esperado": true },
  { "medio": "Tenfield", "titulo": "Mañana juega Uruguay ante Argentina: la probable formación", "resumen": "El entrenador definirá el equipo tras el último entrenamiento en el Complejo Celeste.", "esperado": false },
  { "medio": "Montevideo Portal", "titulo": "Suba del dólar: la moneda estadounidense cerró en alza", "resumen": "El billete verde subió 0,8% en el mercado local.", "esperado": false },
  { "medio": "Subrayado", "titulo": "Alerta naranja por tormentas fuertes en cinco departamentos", "resumen": "Inumet advirtió por lluvias intensas, ráfagas de viento y posible caída de granizo.", "esperado": false },
  { "medio": "Subrayado", "titulo": "Falleció un bebé en un siniestro de tránsito en Canelones", "resumen": "El accidente ocurrió en la ruta 8 y quedó registrado por una cámara de videovigilancia.", "esperado": false },
  { "medio": "la diaria", "titulo": "El Parlamento discute la reforma de la seguridad social", "resumen": "La comisión recibió a delegaciones de trabajadores y empresarios.", "esperado": false },
  { "medio": "Teledoce", "titulo": "Encuestas muestran empate técnico a una semana de las elecciones", "resumen": "Las consultoras coinciden en que el resultado se definirá por pocos votos.", "esperado": false },
  { "medio": "Tenfield", "titulo": "Comienza la venta de entradas para Uruguay ante Colombia", "resumen": "Las localidades estarán disponibles desde el lunes en las redes de cobranza.", "esperado": false },
  { "medio": "Tenfield", "titulo": "Uruguay perdió 1-0 con Paraguay y complica su clasificación", "resumen": "La Celeste no pudo revertir el gol de visitante y quedó fuera de zona de clasificación.", "esperado": false }
]
```

- [ ] **Step 2: Crear `scripts/eval.ts`**

```ts
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { CONCURRENCIA_EVALUACION, UMBRAL_CELEBRA, UMBRAL_YA_PASO } from "../src/config";
import { evaluarNoticia } from "../src/evaluate";
import { enParalelo } from "../src/ingest";
import type { EvaluacionA } from "../src/tipos";

type Caso = { medio: string; titulo: string; resumen: string; esperado: boolean };

const OBJETIVO = 13;
const casos: Caso[] = await Bun.file(new URL("../test/eval/titulares.json", import.meta.url)).json();
const juez = new TypeSafeClient();
const ahora = Date.now();

const resultados: { caso: Caso; ev: EvaluacionA }[] = [];
await enParalelo(casos, CONCURRENCIA_EVALUACION, async (caso) => {
  const ev = await evaluarNoticia(
    juez,
    { url: "https://eval.local", medio: caso.medio, titulo: caso.titulo, resumen: caso.resumen, publicadoEn: ahora - 20 * 60_000 },
    ahora,
  );
  resultados.push({ caso, ev });
});

let aciertos = 0;
for (const caso of casos) {
  const { ev } = resultados.find((r) => r.caso === caso)!;
  const candidata = ev.celebra >= UMBRAL_CELEBRA && ev.yaPaso >= UMBRAL_YA_PASO;
  const ok = candidata === caso.esperado;
  if (ok) aciertos++;
  console.log(
    `${ok ? "✓" : "✗"} celebra=${ev.celebra.toFixed(2)} ya_paso=${ev.yaPaso.toFixed(2)} ` +
      `tipo=${ev.tipo} alcance=${ev.alcance.toFixed(1)}  ${caso.titulo}`,
  );
}

console.log(`\n${aciertos}/${casos.length} aciertos (objetivo: ≥ ${OBJETIVO})`);
process.exit(aciertos >= OBJETIVO ? 0 : 1);
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Correr la evaluación real**

Run: `bun run eval`
Expected: 15 líneas `✓`/`✗` y el total. Reportar el resultado **tal cual** al usuario, incluidos los `✗` con sus probabilidades. Si queda por debajo de 13/15, no ajustar preguntas ni umbrales por cuenta propia: presentar los fallos y proponer cambios concretos (redacción de la pregunta, umbral) para que el usuario decida.

- [ ] **Step 5: Checkpoint final + commit**

Run: `bun test && bunx tsc --noEmit && git status --short`
Expected: todos los tests pasan; el status solo lista `test/eval/` y `scripts/` antes de commitear. Commitear en `feat/backend`.
