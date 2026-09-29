import { TypeSafeClient } from "@typesafe-ai/sdk";
import { CONCURRENCIA_EVALUACION, UMBRAL_CELEBRA, UMBRAL_YA_PASO } from "../src/config";
import { evaluarNoticia } from "../src/evaluate";
import { enParalelo } from "../src/ingest";
import type { EvaluacionA } from "../src/tipos";

type Caso = { medio: string; titulo: string; resumen: string; esperado: boolean };

const OBJETIVO = 13;
const casos: Caso[] = await Bun.file(new URL("../test/eval/titulares.json", import.meta.url)).json();
const juez = new TypeSafeClient();
const ahora = Date.now();

const resultados: { caso: Caso; ev: EvaluacionA }[] = [];
await enParalelo(casos, CONCURRENCIA_EVALUACION, async (caso) => {
  const ev = await evaluarNoticia(
    juez,
    { url: "https://eval.local", medio: caso.medio, titulo: caso.titulo, resumen: caso.resumen, publicadoEn: ahora - 20 * 60_000 },
    ahora,
  );
  resultados.push({ caso, ev });
});

let aciertos = 0;
for (const caso of casos) {
  const { ev } = resultados.find((r) => r.caso === caso)!;
  const candidata = ev.celebra >= UMBRAL_CELEBRA && ev.yaPaso >= UMBRAL_YA_PASO;
  const ok = candidata === caso.esperado;
  if (ok) aciertos++;
  console.log(
    `${ok ? "✓" : "✗"} celebra=${ev.celebra.toFixed(2)} ya_paso=${ev.yaPaso.toFixed(2)} ` +
      `tipo=${ev.tipo} alcance=${ev.alcance.toFixed(1)}  ${caso.titulo}`,
  );
}

console.log(`\n${aciertos}/${casos.length} aciertos (objetivo: ≥ ${OBJETIVO})`);
process.exit(aciertos >= OBJETIVO ? 0 : 1);
