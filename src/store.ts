import type { Database } from "bun:sqlite";
import { MAX_INTENTOS_EVALUACION, RETENCION_MS, UMBRAL_CELEBRA, UMBRAL_YA_PASO, VENTANA_CANDIDATAS_MS } from "./config";
import type { Candidata, EvaluacionA, NoticiaCruda, Tipo } from "./tipos";

const DIA_MS = 24 * 60 * 60 * 1000;

type FilaNoticia = { url: string; medio: string; titulo: string; resumen: string; publicado_en: number };
type FilaCandidata = FilaNoticia & { celebra: number; ya_paso: number; tipo: Tipo; alcance: number };

export type Stats = { noticias24h: number; candidatas6h: number; pendientes: number };

function aNoticia(f: FilaNoticia): NoticiaCruda {
  return { url: f.url, medio: f.medio, titulo: f.titulo, resumen: f.resumen, publicadoEn: f.publicado_en };
}

export class Store {
  constructor(private readonly db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS noticias (
      url           TEXT PRIMARY KEY,
      medio         TEXT NOT NULL,
      titulo        TEXT NOT NULL,
      resumen       TEXT NOT NULL,
      publicado_en  INTEGER NOT NULL,
      ingresado_en  INTEGER NOT NULL,
      celebra       REAL,
      ya_paso       REAL,
      tipo          TEXT,
      alcance       REAL,
      evaluado_en   INTEGER,
      intentos      INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_noticias_publicado ON noticias(publicado_en)`);
  }

  insertar(noticias: NoticiaCruda[], ahora: number): number {
    const stmt = this.db.query(
      `INSERT OR IGNORE INTO noticias (url, medio, titulo, resumen, publicado_en, ingresado_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let nuevas = 0;
    this.db.transaction(() => {
      for (const n of noticias) nuevas += stmt.run(n.url, n.medio, n.titulo, n.resumen, n.publicadoEn, ahora).changes;
    })();
    return nuevas;
  }

  pendientes(ahora: number): NoticiaCruda[] {
    return this.db
      .query<FilaNoticia, [number, number]>(
        `SELECT url, medio, titulo, resumen, publicado_en FROM noticias
         WHERE celebra IS NULL AND intentos < ? AND publicado_en >= ?
         ORDER BY publicado_en DESC`,
      )
      .all(MAX_INTENTOS_EVALUACION, ahora - VENTANA_CANDIDATAS_MS)
      .map(aNoticia);
  }

  guardarEvaluacion(url: string, ev: EvaluacionA, ahora: number): void {
    this.db
      .query(`UPDATE noticias SET celebra = ?, ya_paso = ?, tipo = ?, alcance = ?, evaluado_en = ? WHERE url = ?`)
      .run(ev.celebra, ev.yaPaso, ev.tipo, ev.alcance, ahora, url);
  }

  registrarFallo(url: string): void {
    this.db.query(`UPDATE noticias SET intentos = intentos + 1 WHERE url = ?`).run(url);
  }

  candidatas(ahora: number, limite: number): Candidata[] {
    return this.db
      .query<FilaCandidata, [number, number, number, number]>(
        `SELECT url, medio, titulo, resumen, publicado_en, celebra, ya_paso, tipo, alcance FROM noticias
         WHERE celebra >= ? AND ya_paso >= ? AND publicado_en >= ?
         ORDER BY publicado_en DESC LIMIT ?`,
      )
      .all(UMBRAL_CELEBRA, UMBRAL_YA_PASO, ahora - VENTANA_CANDIDATAS_MS, limite)
      .map((f) => ({ ...aNoticia(f), celebra: f.celebra, yaPaso: f.ya_paso, tipo: f.tipo, alcance: f.alcance }));
  }

  purgar(ahora: number): number {
    return this.db.query(`DELETE FROM noticias WHERE publicado_en < ?`).run(ahora - RETENCION_MS).changes;
  }

  stats(ahora: number): Stats {
    const contar = (sql: string, ...params: number[]) =>
      this.db.query<{ n: number }, number[]>(sql).get(...params)?.n ?? 0;
    return {
      noticias24h: contar(`SELECT COUNT(*) AS n FROM noticias WHERE publicado_en >= ?`, ahora - DIA_MS),
      candidatas6h: contar(
        `SELECT COUNT(*) AS n FROM noticias WHERE celebra >= ? AND ya_paso >= ? AND publicado_en >= ?`,
        UMBRAL_CELEBRA,
        UMBRAL_YA_PASO,
        ahora - VENTANA_CANDIDATAS_MS,
      ),
      pendientes: contar(
        `SELECT COUNT(*) AS n FROM noticias WHERE celebra IS NULL AND intentos < ? AND publicado_en >= ?`,
        MAX_INTENTOS_EVALUACION,
        ahora - VENTANA_CANDIDATAS_MS,
      ),
    };
  }
}
