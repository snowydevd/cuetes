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

// Fecha-hora ISO sin offset ni "Z", p. ej. "2026-09-28T22:50:00" o "2026-09-28 22:50:00".
const ISO_SIN_ZONA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function parsearFechaTexto(texto: string): number {
  const t = texto.trim();
  // Sin zona horaria: se asume que el feed publica en hora de Uruguay (-03:00), no la del servidor.
  if (ISO_SIN_ZONA.test(t)) return Date.parse(`${t.replace(" ", "T")}-03:00`);
  return Date.parse(t);
}

function fecha(item: Nodo, ahora: number): number {
  for (const campo of ["pubDate", "published", "updated", "dc:date"]) {
    const ms = parsearFechaTexto(texto(item[campo]));
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
