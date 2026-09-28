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

test("descarta noticias de más de 48 h sin insertarlas", async () => {
  const fetcherVieja: Fetcher = async () =>
    new Response(
      `<rss><channel><item><title>Vieja</title><link>https://ejemplo.uy/vieja</link>
        <pubDate>${new Date(AHORA - 49 * 60 * 60 * 1000).toUTCString()}</pubDate>
        <description>Vieja</description></item></channel></rss>`,
    );
  const { juez } = juezFalso(() => RESPUESTA_A);
  const ingestor = crearIngestor({ store, juez, feeds, fetcher: fetcherVieja, ahora: () => AHORA });

  expect(await ingestor.correr()).toEqual({ nuevas: 0, evaluadas: 0, fallidas: 0, purgadas: 0 });
  expect(store.pendientes(AHORA)).toHaveLength(0);
  expect(store.candidatas(AHORA, 10)).toHaveLength(0);
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
