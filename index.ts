import { Database } from "bun:sqlite";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DB_PATH, INTERVALO_INGESTA_MS, PUERTO } from "./src/config";
import { FEEDS } from "./src/feeds";
import { crearIngestor } from "./src/ingest";
import { crearHandlers, servir } from "./src/server";
import { Store } from "./src/store";

if (!process.env.TYPESAFE_API_KEY) {
  console.error("Falta TYPESAFE_API_KEY. Agregala al archivo .env (Bun lo carga automáticamente).");
  process.exit(1);
}

const juez = new TypeSafeClient();
const store = new Store(new Database(DB_PATH, { create: true }));
const ingestor = crearIngestor({ store, juez, feeds: FEEDS, fetcher: fetch });

ingestor.iniciar(INTERVALO_INGESTA_MS);
const servidor = servir(crearHandlers({ store, juez, ultimaIngesta: ingestor.ultimaIngesta }), PUERTO);
console.log(`cuetes escuchando en ${servidor.url}`);
