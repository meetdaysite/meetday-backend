-- DropIndex
DROP INDEX "users_email_key";

-- DropIndex
DROP INDEX "users_phone_key";

-- Partial unique indexes: enforce uniqueness only for non-deleted users
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "users_phone_unique" ON "users"("phone") WHERE "deletedAt" IS NULL;
