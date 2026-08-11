-- AlterTable
ALTER TABLE "users" ADD COLUMN     "adminRoleId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
