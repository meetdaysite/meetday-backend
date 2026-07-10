-- CreateTable
CREATE TABLE "interest_categories" (
    "interestId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "interest_categories_pkey" PRIMARY KEY ("interestId","categoryId")
);

-- CreateIndex
CREATE INDEX "interest_categories_categoryId_idx" ON "interest_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "interest_categories" ADD CONSTRAINT "interest_categories_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_categories" ADD CONSTRAINT "interest_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
