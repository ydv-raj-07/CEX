-- CreateTable
CREATE TABLE "Balance" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "userStocks" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "userStocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Balance_userId_key" ON "Balance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "userStocks_userId_key" ON "userStocks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "userStocks_symbol_key" ON "userStocks"("symbol");
