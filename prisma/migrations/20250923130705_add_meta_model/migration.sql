-- CreateTable
CREATE TABLE "public"."Meta" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "metaUserId" TEXT NOT NULL,
    "metaUserName" TEXT,
    "metaEmail" TEXT,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "pixelId" TEXT NOT NULL,
    "pixelName" TEXT,
    "businessId" TEXT,
    "adAccountId" TEXT,
    "permissions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meta_sessionId_key" ON "public"."Meta"("sessionId");

-- CreateIndex
CREATE INDEX "Meta_sessionId_idx" ON "public"."Meta"("sessionId");

-- CreateIndex
CREATE INDEX "Meta_pixelId_idx" ON "public"."Meta"("pixelId");

-- AddForeignKey
ALTER TABLE "public"."Meta" ADD CONSTRAINT "Meta_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
