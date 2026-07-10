-- CreateTable
CREATE TABLE "category_highlights" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_highlights_categoryId_idx" ON "category_highlights"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "category_highlights_categoryId_key_key" ON "category_highlights"("categoryId", "key");

-- AddForeignKey
ALTER TABLE "category_highlights" ADD CONSTRAINT "category_highlights_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
