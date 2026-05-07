include .env
export

SHELL := /bin/bash
export PATH := /usr/local/bin:/usr/bin:/bin:$(PATH)

.PHONY: help up down restart logs ps clean setup health

# ─── Help ─────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Codebrief — Docker Compose commands"
	@echo ""
	@echo "  make setup     Copy .env.example → .env (first time only)"
	@echo "  make up        Start all services (detached)"
	@echo "  make down      Stop all services"
	@echo "  make restart   Restart all services"
	@echo "  make logs      Tail all logs"
	@echo "  make ps        Show running containers and health"
	@echo "  make health    Check health of each service"
	@echo "  make clean     Stop services and remove volumes (destructive!)"
	@echo ""

# ─── Setup ────────────────────────────────────────────────────
setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "  .env created — fill in your values before running 'make up'"; \
	else \
		echo "  .env already exists — skipping"; \
	fi

# ─── Lifecycle ────────────────────────────────────────────────
up:
	docker compose up -d --build
	@echo ""
	@echo "  Services starting. Check health with: make health"

down:
	docker compose down

restart:
	docker compose restart

# ─── Observability ────────────────────────────────────────────
logs:
	docker compose logs -f

logs-nestjs:
	docker compose logs -f nestjs

logs-fastapi:
	docker compose logs -f fastapi

logs-postgres:
	docker compose logs -f postgres

ps:
	docker compose ps

health:
	@echo ""
	@echo "  Checking service health..."
	@echo ""
	@echo -n "  NestJS   "; curl -sf http://localhost:3000/api/health && echo "✓ healthy" || echo "✗ not ready"
	@echo -n "  FastAPI  "; curl -sf http://localhost:8000/health  && echo "✓ healthy" || echo "✗ not ready"
	@echo -n "  Qdrant   "; curl -sf http://localhost:6333/healthz && echo "✓ healthy" || echo "✗ not ready"
	@echo -n "  Postgres "; docker exec codebrief_postgres pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB -q 2>&1 && echo "✓ healthy" || echo "✗ not ready"
	@echo -n "  Redis    "; docker exec codebrief_redis redis-cli -a $$REDIS_PASSWORD ping 2>/dev/null | grep -q PONG && echo "✓ healthy" || echo "✗ not ready"
	@echo -n "  MongoDB  "; docker exec codebrief_mongo mongosh --eval "db.adminCommand('ping')" --quiet 2>/dev/null | grep -q "ok: 1" && echo "✓ healthy" || echo "✗ not ready"
	@echo ""

# ─── Database ─────────────────────────────────────────────────
psql:
	docker exec -it codebrief_postgres psql -U $${POSTGRES_USER} -d $${POSTGRES_DB}

mongo-shell:
	docker exec -it codebrief_mongo mongosh -u $${MONGO_USER} -p $${MONGO_PASSWORD} --authenticationDatabase admin $${MONGO_DB}

redis-cli:
	docker exec -it codebrief_redis redis-cli -a $${REDIS_PASSWORD}

# ─── Cleanup ──────────────────────────────────────────────────
clean:
	@echo "  WARNING: This will delete all volumes and data!"
	@read -p "  Are you sure? (y/N) " confirm && [ "$$confirm" = "y" ] || exit 1
	docker compose down -v --remove-orphans
	@echo "  All containers and volumes removed."