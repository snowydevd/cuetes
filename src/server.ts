import { MAX_CANDIDATAS_CONSULTA, MAX_UBICACION } from "./config";
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
      if (ubicacion.length > MAX_UBICACION) {
        return error400("usuario.ubicacion es demasiado larga");
      }
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
    error: (error) => {
      console.error("[server] error:", error);
      return Response.json({ error: "Error interno" }, { status: 500 });
    },
  });
}
