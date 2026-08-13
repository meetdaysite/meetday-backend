-- AlterTable
ALTER TABLE "brand_profiles" ADD COLUMN     "socialLinks" JSONB;

-- CreateTable
CREATE TABLE "brand_experience_categories" (
    "brandProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "brand_experience_categories_pkey" PRIMARY KEY ("brandProfileId","categoryId")
);

-- CreateIndex
CREATE INDEX "brand_experience_categories_categoryId_idx" ON "brand_experience_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "brand_experience_categories" ADD CONSTRAINT "brand_experience_categories_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_experience_categories" ADD CONSTRAINT "brand_experience_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
