-- CreateEnum
CREATE TYPE "InterestAffinity" AS ENUM ('LIKED', 'DISLIKED', 'OPEN_TO');

-- CreateTable
CREATE TABLE "user_interest_affinities" (
    "userId" TEXT NOT NULL,
    "interestId" TEXT NOT NULL,
    "affinity" "InterestAffinity" NOT NULL,

    CONSTRAINT "user_interest_affinities_pkey" PRIMARY KEY ("userId","interestId")
);

-- CreateIndex
CREATE INDEX "user_interest_affinities_interestId_idx" ON "user_interest_affinities"("interestId");

-- AddForeignKey
ALTER TABLE "user_interest_affinities" ADD CONSTRAINT "user_interest_affinities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interest_affinities" ADD CONSTRAINT "user_interest_affinities_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
