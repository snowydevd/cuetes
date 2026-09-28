import { score } from "@typesafe-ai/sdk";
import { FRESCURA_PLENA_MS, MAX_CAUSAS, PUNTAJE_MINIMO, VENTANA_CANDIDATAS_MS } from "./config";
import { isoUY } from "./tiempo";
import type { Candidata, Causa, Juez } from "./tipos";

export function frescura(edadMs: number): number {
  if (edadMs <= FRESCURA_PLENA_MS) return 1;
  if (edadMs >= VENTANA_CANDIDATAS_MS) return 0;
  return 1 - (edadMs - FRESCURA_PLENA_MS) / (VENTANA_CANDIDATAS_MS - FRESCURA_PLENA_MS);
}

export function puntaje(celebra: number, cercania: number, edadMs: number): number {
  return celebra * (cercania / 3) * frescura(edadMs);
}

const CRITERIOS_CERCA = [
  "Unlikely: it happened somewhere else or concerns people who are not there.",
  "Possible.",
  "Likely.",
  "Very likely: it happened there, or the celebration is nationwide.",
] as const;

function preguntaCerca(i: number) {
  return score(
    `How likely is it that someone located in \`usuario.ubicacion\` hears fireworks right now because of the event in \`noticias[${i}]\`?`,
    CRITERIOS_CERCA,
  );
}

export function preguntasB(cantidad: number) {
  const preguntas: Record<string, ReturnType<typeof preguntaCerca>> = {};
  for (let i = 0; i < cantidad; i++) preguntas[`cerca_${i}`] = preguntaCerca(i);
  return preguntas;
}

export function stateB(ubicacion: string, candidatas: Candidata[], ahora: number) {
  return {
    usuario: { ubicacion },
    ahora: isoUY(ahora),
    noticias: candidatas.map((c) => ({ titulo: c.titulo, resumen: c.resumen, tipo: c.tipo })),
  };
}

export type Ranking = { causas: Causa[]; aproximado: boolean };

export async function rankear(juez: Juez, ubicacion: string, candidatas: Candidata[], ahora: number): Promise<Ranking> {
  if (candidatas.length === 0) return { causas: [], aproximado: false };

  let cercanias: number[];
  let aproximado = false;
  try {
    const { answers } = await juez.systemOne({
      state: stateB(ubicacion, candidatas, ahora),
      questions: preguntasB(candidatas.length),
    });
    cercanias = candidatas.map((_, i) => answers[`cerca_${i}`]?.score ?? 0);
  } catch (error) {
    console.warn("[rank] TypeSafe falló, uso puntaje sin ubicación:", error instanceof Error ? error.message : error);
    cercanias = candidatas.map((c) => c.alcance);
    aproximado = true;
  }

  const causas = candidatas
    .map((c, i) => ({ c, p: puntaje(c.celebra, cercanias[i] ?? 0, ahora - c.publicadoEn) }))
    .filter(({ p }) => p >= PUNTAJE_MINIMO)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_CAUSAS)
    .map(({ c, p }) => ({
      titulo: c.titulo,
      url: c.url,
      medio: c.medio,
      tipo: c.tipo,
      puntaje: Math.round(p * 100) / 100,
      publicado_en: isoUY(c.publicadoEn),
    }));

  return { causas, aproximado };
}
