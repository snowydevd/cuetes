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
