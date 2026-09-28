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
