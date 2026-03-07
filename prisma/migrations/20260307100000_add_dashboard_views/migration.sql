-- CreateTable
CREATE TABLE "DashboardView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "panels" JSONB NOT NULL,
    "filters" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardView_userId_idx" ON "DashboardView"("userId");

-- AddForeignKey
ALTER TABLE "DashboardView" ADD CONSTRAINT "DashboardView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
