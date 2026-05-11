# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Install all deps (including devDeps needed for build + prisma generate)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and compile
COPY . .
RUN npm run build


# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY package*.json ./
COPY prisma ./prisma

# Install only production dependencies
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
