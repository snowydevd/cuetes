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
