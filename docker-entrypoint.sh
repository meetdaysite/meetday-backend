#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy || echo "Database migrations failed, continuing startup..."

echo "Starting application..."
exec node dist/main
