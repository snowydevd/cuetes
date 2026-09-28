const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;

export const INTERVALO_INGESTA_MS = 5 * MIN_MS;
export const VENTANA_CANDIDATAS_MS = 6 * HORA_MS;
export const FRESCURA_PLENA_MS = 1 * HORA_MS;
export const RETENCION_MS = 48 * HORA_MS;

export const UMBRAL_CELEBRA = 0.5;
export const UMBRAL_YA_PASO = 0.5;

export const MAX_CANDIDATAS_CONSULTA = 10;
export const PUNTAJE_MINIMO = 0.3;
export const MAX_CAUSAS = 3;

export const CONCURRENCIA_EVALUACION = 4;
export const MAX_INTENTOS_EVALUACION = 3;

export const TIMEOUT_ETAPA_B_MS = 2_500;

export const FEED_TIMEOUT_MS = 10_000;
export const MAX_RESUMEN = 600;

export const PUERTO = Number(process.env.PORT ?? 3000);
export const DB_PATH = process.env.CUETES_DB ?? "cuetes.db";

export const MAX_UBICACION = 120;
