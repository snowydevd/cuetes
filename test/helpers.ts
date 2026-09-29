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

export type Pedido = { state: any; questions: Record<string, unknown>; opciones?: unknown };

/** Cliente TypeSafe falso: registra los pedidos y responde con `responder` (o lanza lo que lance). */
export function juezFalso(responder: (pedido: Pedido) => Record<string, unknown>) {
  const pedidos: Pedido[] = [];
  const juez = {
    systemOne: async (pedido: Pedido, opciones?: unknown) => {
      pedidos.push({ ...pedido, opciones });
      return { model: "falso", answers: responder(pedido), usage: { input_tokens: 0, output_tokens: 0 } };
    },
  } as unknown as Juez;
  return { juez, pedidos };
}
