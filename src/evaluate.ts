import { choice, noul, score } from "@typesafe-ai/sdk";
import { isoUY } from "./tiempo";
import type { EvaluacionA, Juez, NoticiaCruda, Tipo } from "./tipos";

// Jev está entrenado principalmente en inglés: preguntas en inglés, noticia en español.
const CRITERIOS_TIPO = {
  futbol: "Football (soccer): a club or the national team won a match, a title or a derby.",
  otro_deporte: "Another sport: basketball, rugby, athletics, etc.",
  politica: "Politics: an election result, a party or candidate winning, a decision a group celebrates.",
  fecha_festiva: "A festive date: New Year, Christmas, national holidays.",
  cultural: "Culture: carnival, Llamadas, concerts, festivals.",
  otro: "Something else people could celebrate.",
  ninguno: "Nothing to celebrate.",
} satisfies Record<Tipo, string>;

export const PREGUNTAS_A = {
  celebra: noul(
    "The news item is written in Spanish and comes from Uruguay. Does it describe an event that makes people in Uruguay celebrate publicly — setting off fireworks (cuetes), honking car horns or gathering in the streets?",
    {
      true: "A victory, title, electoral win, festive date or similar event that a group of Uruguayans would celebrate loudly in public.",
      false: "Neutral, negative or routine news, or something people do not celebrate in public.",
    },
  ),
  ya_paso: noul("As of `ahora`, has the event described in the news item already happened or is it happening right now?", {
    true: "The match has finished, the result was announced, or the event is ongoing.",
    false: "It is a preview, schedule, forecast, announcement or analysis of something that has not happened yet.",
  }),
  tipo: choice("What kind of event is described in the news item?", CRITERIOS_TIPO),
  alcance: score("If people celebrate this event, how widespread would the celebration be in Uruguay?", [
    "Nobody would celebrate it.",
    "A neighbourhood or a small group of people.",
    "A whole city or department.",
    "The whole country.",
  ]),
};

export function stateA(noticia: NoticiaCruda, ahora: number) {
  return {
    medio: noticia.medio,
    titulo: noticia.titulo,
    resumen: noticia.resumen,
    publicado_en: isoUY(noticia.publicadoEn),
    ahora: isoUY(ahora),
  };
}

export async function evaluarNoticia(juez: Juez, noticia: NoticiaCruda, ahora: number): Promise<EvaluacionA> {
  const { answers } = await juez.systemOne({ state: stateA(noticia, ahora), questions: PREGUNTAS_A });
  return {
    celebra: answers.celebra.noul,
    yaPaso: answers.ya_paso.noul,
    tipo: answers.tipo.choice,
    alcance: answers.alcance.score,
  };
}
