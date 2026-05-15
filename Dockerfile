# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Skip Puppeteer Chrome download — not needed to compile TypeScript
ENV PUPPETEER_SKIP_DOWNLOAD=1
# Install all deps (including devDeps needed for build + prisma generate)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and compile
COPY . .
RUN npm run build


# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install system Chromium + OpenSSL. Chromium replaces Puppeteer's bundled Chrome
# so we can skip the ~300MB download during npm ci.
RUN apk add --no-cache openssl chromium

WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY package*.json ./
COPY prisma ./prisma

# Skip Puppeteer's Chrome download — we use system Chromium instead.
# PRISMA_SKIP_POSTINSTALL_GENERATE skips @prisma/client postinstall (prisma CLI
# is a devDep, not available here; generated client is copied from builder).
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm ci --omit=dev && npm cache clean --force

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
