-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "calendar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dept" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hours" TEXT NOT NULL DEFAULT '9:30 am – 6:30 pm',
ADD COLUMN     "joinedAt" TIMESTAMP(3),
ADD COLUMN     "leaveUntil" DATE,
ADD COLUMN     "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "prefs" JSONB NOT NULL DEFAULT '{"remind": true, "mention": true, "digest": true}';

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

