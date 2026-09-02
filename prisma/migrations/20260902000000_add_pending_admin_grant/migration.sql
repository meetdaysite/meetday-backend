-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pendingAdminRoleId" TEXT,
ADD COLUMN     "adminInviteRequestedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_pendingAdminRoleId_fkey" FOREIGN KEY ("pendingAdminRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
