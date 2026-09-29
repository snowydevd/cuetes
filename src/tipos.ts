import type { TypeSafeClient } from "@typesafe-ai/sdk";

export const TIPOS = ["futbol", "otro_deporte", "politica", "fecha_festiva", "cultural", "otro", "ninguno"] as const;
export type Tipo = (typeof TIPOS)[number];

export type NoticiaCruda = {
  url: string;
  medio: string;
  titulo: string;
  /** Texto plano, sin HTML, recortado a MAX_RESUMEN caracteres. */
  resumen: string;
  /** epoch ms */
  publicadoEn: number;
};

export type EvaluacionA = {
  celebra: number; // Noul 0..1
  yaPaso: number; // Noul 0..1
  tipo: Tipo; // Choice
  alcance: number; // Score esperado 0..3
};

export type Candidata = NoticiaCruda & EvaluacionA;

export type Causa = {
  titulo: string;
  url: string;
  medio: string;
  tipo: Tipo;
  puntaje: number;
  publicado_en: string;
};

/** Lo único que usamos del cliente de TypeSafe; permite inyectar un falso en tests. */
export type Juez = Pick<TypeSafeClient, "systemOne">;
