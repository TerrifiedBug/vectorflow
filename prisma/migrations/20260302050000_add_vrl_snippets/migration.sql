-- CreateTable
CREATE TABLE "VrlSnippet" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VrlSnippet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VrlSnippet_teamId_idx" ON "VrlSnippet"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "VrlSnippet_teamId_name_key" ON "VrlSnippet"("teamId", "name");

-- AddForeignKey
ALTER TABLE "VrlSnippet" ADD CONSTRAINT "VrlSnippet_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VrlSnippet" ADD CONSTRAINT "VrlSnippet_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
