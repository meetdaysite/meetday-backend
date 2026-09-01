-- AlterTable
ALTER TABLE "brand_team_members" ADD COLUMN     "canManageMembers" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "host_team_members" ADD COLUMN     "canManageMembers" BOOLEAN NOT NULL DEFAULT true;
