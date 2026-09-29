# cuetes

Backend que responde **"¿Por qué están tirando cuetes?"**: lee noticias uruguayas por RSS, usa
TypeSafe (Jev) para detectar cuáles provocan festejos y las ordena según la ubicación del usuario.

## Requisitos

- Bun ≥ 1.4
- `TYPESAFE_API_KEY` en `.env`

## Uso

```bash
bun install
bun run dev        # servidor + ingesta cada 5 min (con recarga)
bun test           # tests unitarios (sin red)
bun run eval       # evaluación real de la Etapa A sobre titulares etiquetados
```

## API

`POST /api/cuetes`

```json
{ "usuario": { "id": "u123", "ubicacion": "Pocitos, Montevideo" } }
```

Responde `{ ubicacion, evaluado_en, aproximado, causas: [{ titulo, url, medio, tipo, puntaje, publicado_en }] }`.
`aproximado: true` indica que TypeSafe no respondió y el orden no considera la ubicación.

`GET /api/health` — última ingesta, noticias de las últimas 24 h, candidatas y pendientes.

Variables opcionales: `PORT` (3000), `CUETES_DB` (`cuetes.db`).

Diseño: `docs/superpowers/specs/2026-09-28-cuetes-backend-design.md`.
