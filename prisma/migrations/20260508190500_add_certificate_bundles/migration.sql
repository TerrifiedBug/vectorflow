-- CreateTable
CREATE TABLE "CertificateBundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "caId" TEXT,
    "certId" TEXT,
    "keyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateBundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateBundle_environmentId_name_key" ON "CertificateBundle"("environmentId", "name");

-- AddForeignKey
ALTER TABLE "CertificateBundle" ADD CONSTRAINT "CertificateBundle_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateBundle" ADD CONSTRAINT "CertificateBundle_caId_fkey" FOREIGN KEY ("caId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateBundle" ADD CONSTRAINT "CertificateBundle_certId_fkey" FOREIGN KEY ("certId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateBundle" ADD CONSTRAINT "CertificateBundle_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
