/*
  Warnings:

  - A unique constraint covering the columns `[userId,symbol]` on the table `userStocks` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "userStocks_symbol_key";

-- DropIndex
DROP INDEX "userStocks_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "userStocks_userId_symbol_key" ON "userStocks"("userId", "symbol");
