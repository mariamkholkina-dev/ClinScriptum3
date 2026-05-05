# Deploy / Restore — известные грабли

Заметки про неочевидности при работе с `docker-compose.prod.yml` на dev-сервере.

## Грабли #1: `docker compose build api workers` не пересобирает `migrate`

Сервис `migrate` (применяет `prisma migrate deploy`) объявлен в `docker-compose.prod.yml` под profile `migrate` и **не входит** в выборку `build api workers`. Если после `git pull` собрать только `api`+`workers`, а потом запустить:

```bash
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
```

— контейнер `migrate` будет создан из **старого** образа (без новых файлов в `packages/db/prisma/migrations/`) и `migrate deploy` напишет «No pending migrations to apply». В итоге БД останется без новых колонок, а api/workers будут падать на `column ... does not exist`.

**Правильно:** при `git pull` всегда пересобирать `migrate` тоже. Любой из вариантов:

```bash
# A. Через deploy/deploy.sh (рекомендованный путь):
./deploy/deploy.sh

# B. Вручную — пересобрать migrate отдельно перед его запуском:
docker compose -f docker-compose.prod.yml build api workers migrate
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate

# C. Ещё быстрее — флаг --build на up (для всех сервисов разом):
docker compose -f docker-compose.prod.yml --profile migrate up --build migrate
```

`deploy/deploy.sh` уже делает это правильно (`build api`, `build workers`, `build web`, `build rule-admin`, и `migrate` пересобирается потому что использует `Dockerfile.api` — но **только если** до этого мы вызвали `build api`, иначе берётся cache).

## Грабли #2: после ручного `ALTER TABLE` миграция остаётся «не применённой» в Prisma

Если миграция почему-то не применилась (см. грабли #1) и колонку добавили вручную через `psql ALTER TABLE`, в `_prisma_migrations` запись о миграции **не появляется**. Следующий `migrate deploy` попытается применить её снова и упадёт с `column already exists`.

**Лечение:** пометить миграцию как applied:

```bash
docker compose -f docker-compose.prod.yml exec -w /app api \
  npx prisma migrate resolve --applied <migration_name> \
  --schema=packages/db/prisma/schema.prisma
```

`<migration_name>` — имя папки в `packages/db/prisma/migrations/`, например `20260503100000_add_evaluation_confidence_metrics`.

## Грабли #3: рабочая ветка на dev — не master

На dev-сервере исторически чекаут на ветке `feat/dev-server-deploy` (содержит локальные deploy-коммиты, которых нет в remote). `git pull origin master` на ней пытается merge'нуть master в feature → divergent branches.

**Правильно:** перед `git pull` переключиться на master:

```bash
cd /opt/clinscriptum
git checkout master
git pull --ff-only origin master
```

Локальная `feat/dev-server-deploy` никуда не денется (`git checkout feat/dev-server-deploy` вернёт). Untracked файлы (`baseline-clean.json`, `expert.csv`, `.env.bak`, и т.п.) тоже переживают checkout.

## Грабли #4: Redis eviction policy `allkeys-lru`

В логах любого скрипта, использующего BullMQ, появляется:
```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```

`docker-compose.prod.yml`, сервис `redis`, строка `command:` — стоит `--maxmemory-policy allkeys-lru`. Это значит: при достижении 200 MB памяти Redis выкинет случайные ключи, в том числе **данные jobs**, что может потерять или дублировать обработку.

**Правильно:** заменить на `noeviction` — тогда BullMQ получит ошибку записи вместо тихой потери:

```yaml
redis:
  command: redis-server --appendonly yes --maxmemory 200mb --maxmemory-policy noeviction
```

Не блокер, но при росте нагрузки рискнёт надёжностью.

## Стандартный deploy-чеклист

```bash
ssh root@141.105.71.244
cd /opt/clinscriptum

# 1. Свежий master
git checkout master
git pull --ff-only origin master

# 2. Полный rebuild + migrate (через deploy.sh — он делает всё правильно)
./deploy/deploy.sh

# Альтернатива вручную:
# docker compose -f docker-compose.prod.yml build api workers migrate web rule-admin
# docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
# docker compose -f docker-compose.prod.yml up -d --no-deps api workers web rule-admin

# 3. Sanity check — миграции
docker compose -f docker-compose.prod.yml exec -T postgres psql -U clinscriptum clinscriptum \
  -c "SELECT migration_name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"

# 4. Sanity check — taxonomy reseed (если правил yaml)
docker compose -f docker-compose.prod.yml exec -w /app api \
  npx tsx packages/db/src/seed-taxonomy.ts
```
