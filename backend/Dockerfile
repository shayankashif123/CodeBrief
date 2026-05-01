# ─── Stage 1: Builder ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Stage 2: Development ─────────────────────────────────────
FROM node:20-alpine AS development

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json package-lock.json ./
RUN npm ci          # ← Installs ALL deps including devDependencies (nest CLI, ts-node)

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

# ─── Stage 3: Production ──────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN addgroup -S codebrief && adduser -S codebrief -G codebrief
USER codebrief

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health/ready || exit 1

CMD ["node", "dist/main.js"]