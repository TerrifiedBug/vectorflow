-- CreateTable
CREATE TABLE "ScimGroupMember" (
    "id" TEXT NOT NULL,
    "scimGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroupMember_scimGroupId_userId_key" ON "ScimGroupMember"("scimGroupId", "userId");

-- AddForeignKey
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_scimGroupId_fkey" FOREIGN KEY ("scimGroupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add source column to TeamMember
ALTER TABLE "TeamMember" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
