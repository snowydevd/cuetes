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
    expect(pedidos[0]!.opciones).toEqual({ timeout: 2500, retry: { maxRetries: 0 } });
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
