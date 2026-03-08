-- CreateTable
CREATE TABLE "ScimGroup" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroup_displayName_key" ON "ScimGroup"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroup_externalId_key" ON "ScimGroup"("externalId");
