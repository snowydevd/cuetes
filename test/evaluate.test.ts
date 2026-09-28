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
