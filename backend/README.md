# Compute Engine Backend

Milestones: `compute-engine/BACKEND_EXECUTION.md`

## Local dev

```bash
npm i
cp .env.example .env
npm run migration:run
npm run start:dev
```

- Health: `GET /health`
- Ready: `GET /ready`
- Swagger UI: `GET /docs`

## Worker (placeholder)

```bash
npm run start:worker
```

## Migrations

- Show: `npm run migration:show`
- Run: `npm run migration:run`
- Revert: `npm run migration:revert`
