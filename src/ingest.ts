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
