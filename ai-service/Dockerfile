# ── Stage 1: dependency builder ───────────────────────────────────────────────
# Install Python deps in a separate stage so the final image doesn't need
# build tools (gcc, git headers, etc.) — smaller attack surface, smaller image.
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies for packages with C extensions (e.g. tree-sitter)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# --user installs into ~/.local so we can copy just that directory to final stage
RUN pip install --no-cache-dir --user -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Non-root user — never run as root in containers
RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid appgroup --no-create-home appuser

WORKDIR /app

# Runtime system deps — git is needed for gitpython's clone operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder stage
COPY --from=builder /root/.local /home/appuser/.local

# Copy application source
COPY --chown=appuser:appgroup . .

# Ensure local bin is on PATH for the non-root user
ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Temp directory for git clones during indexing
RUN mkdir -p /tmp/codebrief_repos && chown appuser:appgroup /tmp/codebrief_repos

USER appuser

EXPOSE 8000

# Uvicorn flags:
# --workers 1         : single worker per container — scale horizontally via ECS tasks
# --loop uvloop       : faster event loop (installed with uvicorn[standard])
# --no-access-log     : access logs handled by RequestIdMiddleware with structlog
# --timeout-keep-alive: ALB default is 60s, keep-alive must be longer
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--loop", "uvloop", \
     "--no-access-log", \
     "--timeout-keep-alive", "75"]