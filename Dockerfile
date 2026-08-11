# syntax=docker/dockerfile:1

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Skip Puppeteer Chrome download — not needed to compile TypeScript.
# npm cache is mounted externally (BuildKit cache) so it never lands on the
# container's filesystem layer, keeping the runner disk usage minimal.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and compile
COPY . .
RUN npm run build


# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

# System Chromium replaces Puppeteer's bundled Chrome (~300MB download skipped).
RUN apk add --no-cache openssl chromium

WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY package*.json ./
COPY prisma ./prisma

# PUPPETEER_SKIP_DOWNLOAD=1       — skip Chrome download during npm ci
# PUPPETEER_EXECUTABLE_PATH       — use system Chromium at runtime
# PRISMA_SKIP_POSTINSTALL_GENERATE — @prisma/client postinstall can't call
#   `prisma generate` (CLI is a devDep); generated client is copied from builder
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm ci --omit=dev

# Copy generated Prisma client from builder (prisma generate output)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma CLI from builder so the entrypoint can run migrate deploy
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma      ./node_modules/prisma

# Copy compiled application
COPY --from=builder /app/dist ./dist

# Copy and permission the entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
