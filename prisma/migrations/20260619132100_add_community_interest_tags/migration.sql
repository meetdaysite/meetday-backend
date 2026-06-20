-- AlterTable
ALTER TABLE "communities" ADD COLUMN     "interestTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
