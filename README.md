# ClinScriptum

Intelligent assistant for clinical documentation development. Analyzes, verifies, and assists in generating clinical trial documents (Protocol, ICF, IB, CSR).

## Quick Start

```bash
# Start infrastructure
docker compose up -d

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate --schema=packages/db/prisma/schema.prisma

# Run database migrations
npx prisma migrate dev --schema=packages/db/prisma/schema.prisma

# Seed demo data
npm run db:seed

# Start all services in development
npm run dev
```

## Architecture

```
clinscriptum/
  apps/
    web/              # Next.js web application (port 3000)
    api/              # Node.js API server with tRPC (port 4000)
    workers/          # BullMQ background processors
    word-addin/       # Office.js Word Add-in (port 3001)
  packages/
    db/               # Prisma schema and migrations
    shared/           # Shared TypeScript types
    llm-gateway/      # Multi-provider LLM abstraction
    doc-parser/       # Word document OOXML parser
    rules-engine/     # Section classification and fact extraction rules
    diff-engine/      # Document version comparison
    ui/               # Shared UI components
```

## Configuration

Copy `.env.example` to `.env` and configure:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Secret for JWT token signing
- `STORAGE_TYPE` — `local` or `s3`
- `LLM_API_KEY` — API key for LLM provider
- `LLM_PROVIDER` — `openai`, `anthropic`, `azure_openai`, or `qwen`

## Deployment

### Docker

```bash
docker build -f Dockerfile.api -t clinscriptum/api .
docker build -f Dockerfile.web -t clinscriptum/web .
docker build -f Dockerfile.workers -t clinscriptum/workers .
```

### Kubernetes (Helm)

```bash
helm install clinscriptum ./helm/clinscriptum -f values-prod.yaml
```

## License

Proprietary
