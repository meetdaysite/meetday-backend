-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE INDEX "host_experience_categories_categoryId_idx" ON "host_experience_categories"("categoryId");

-- CreateIndex
CREATE INDEX "user_interests_categoryId_idx" ON "user_interests"("categoryId");
