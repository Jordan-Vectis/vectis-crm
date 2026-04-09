-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allowedApps" TEXT[] DEFAULT ARRAY[]::TEXT[];
