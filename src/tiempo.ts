// Uruguay usa UTC-3 todo el año (sin horario de verano desde 2015).
const OFFSET_UY_MS = 3 * 60 * 60 * 1000;

export function isoUY(ms: number): string {
  return new Date(ms - OFFSET_UY_MS).toISOString().slice(0, 19) + "-03:00";
}
