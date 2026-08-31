-- CreateEnum
CREATE TYPE "TeamMemberStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateTable
CREATE TABLE "brand_team_members" (
    "id" TEXT NOT NULL,
    "brandProfileId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "status" "TeamMemberStatus" NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_team_members" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "status" "TeamMemberStatus" NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_team_members_brandProfileId_email_key" ON "brand_team_members"("brandProfileId", "email");

-- CreateIndex
CREATE INDEX "brand_team_members_brandProfileId_idx" ON "brand_team_members"("brandProfileId");

-- CreateIndex
CREATE INDEX "brand_team_members_email_idx" ON "brand_team_members"("email");

-- CreateIndex
CREATE UNIQUE INDEX "host_team_members_hostProfileId_email_key" ON "host_team_members"("hostProfileId", "email");

-- CreateIndex
CREATE INDEX "host_team_members_hostProfileId_idx" ON "host_team_members"("hostProfileId");

-- CreateIndex
CREATE INDEX "host_team_members_email_idx" ON "host_team_members"("email");

-- AddForeignKey
ALTER TABLE "brand_team_members" ADD CONSTRAINT "brand_team_members_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_team_members" ADD CONSTRAINT "brand_team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_team_members" ADD CONSTRAINT "brand_team_members_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_team_members" ADD CONSTRAINT "host_team_members_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_team_members" ADD CONSTRAINT "host_team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_team_members" ADD CONSTRAINT "host_team_members_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
