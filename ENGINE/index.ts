import { createClient } from "redis";
import { Prisma, PrismaClient } from "shared/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: Bun.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface Order {
  symbol: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  userId: number;
  identifier: number;
  QueueId: number;
  orderId?: string;
}

interface OrderType {
  type: "market" | "limit";
}
interface msgtype {
  msgtype:
    | "create_order"
    | "get_depth"
    | "cancel_order"
    | "get_user_balance"
    | "get_orders";
}

interface OrderBooks {
  [symbol: string]: {
    buy: Order[];
    sell: Order[];
  };
}

interface Balances {
  [userId: number]: {
    amount: number;
    assets: {
      [symbol: string]: number;
    };
  };
}

const BALANCES: Balances = {};
const ORDERBOOKS: OrderBooks = {};

const client = await createClient({
  url: Bun.env.REDIS_URL,
})
  .on("error", (err) => console.log("Redis Client Error", err))
  .connect();

const publisherClient = await createClient({
  url: Bun.env.REDIS_URL,
})
  .on("error", (err) => console.log("Redis Client Error", err))
  .connect();

const ORDERS: Prisma.OrderCreateManyInput[] = [];
const FILLS: Prisma.FillCreateManyInput[] = [];

setInterval(async () => {
  if (ORDERS.length === 0 && FILLS.length === 0) return;
  await prisma.order.createMany({ data: ORDERS, skipDuplicates: true });
  await prisma.fill.createMany({ data: FILLS, skipDuplicates: true });
  ORDERS.length = 0;
  FILLS.length = 0;
}, 1000);

setInterval(async () => {
  for (const [userId, balance] of Object.entries(BALANCES)) {
    await prisma.balance.upsert({
      where: { userId: Number(userId) },
      update: { amount: balance.amount },
      create: { userId: Number(userId), amount: balance.amount },
    });
    for (const [symbol, qty] of Object.entries(balance.assets)) {
      await prisma.userStocks.upsert({
        where: {
          userId_symbol: {
            userId: Number(userId),
            symbol: symbol,
          },
        },
        update: { qty: Number(qty) },
        create: { userId: Number(userId), symbol: symbol, qty: Number(qty) },
      });
    }
  }
}, 1000);

while (1) {
  const response = await client.brPop("new_order", 1);
  if (!response) continue;
  const parsedResponse = JSON.parse(response.element) as Order &
    msgtype &
    OrderType;

  if (parsedResponse.msgtype === "create_order") {
    const { symbol, side, price, qty, userId, type, identifier, orderId } =
      parsedResponse;

    if (!ORDERBOOKS[symbol]) {
      ORDERBOOKS[symbol] = {
        buy: [],
        sell: [],
      };
    }

    const userBalance = BALANCES[userId];

    if (userBalance === undefined) {
      await publisherClient.lPush(
        "order_filled" + parsedResponse.QueueId,
        JSON.stringify({
          identifier,
          error: "User balance not found",
        }),
      );
      continue
    }

    userBalance.assets[symbol] ??= 0;

    if (side === "buy" && type === "market") {
      const bestsell = ORDERBOOKS[symbol]?.sell[0];
      if (!bestsell) {
        continue;
      }
      const reqBalance = bestsell.price * qty;
      if (userBalance.amount < reqBalance) {
        continue;
      }
    }

    if (side === "sell" && type === "market") {
      if (!userBalance.assets[symbol] || userBalance.assets[symbol] < qty) {
        continue;
      }
    }

    if (side === "buy" && type === "limit") {
      const reqBalance = price * qty;
      if (userBalance.amount < reqBalance) {
        continue;
      }
      userBalance.amount -= reqBalance;
    }

    if (side === "sell" && type === "limit") {
      const reqAsset = qty;
      if (
        !userBalance.assets[symbol] ||
        userBalance.assets[symbol] < reqAsset
      ) {
        continue;
      }
      userBalance.assets[symbol] -= reqAsset;
    }

    // Opposite side
    let oppSide: "buy" | "sell";
    if (side === "buy") oppSide = "sell";
    else oppSide = "buy";
    const oppOrder = ORDERBOOKS[symbol][oppSide];

    // sort the opposite order book chipest seller first and highest buyer first
    if (oppSide === "sell") {
      oppOrder.sort((a, b) => a.price - b.price);
    } else {
      oppOrder.sort((a, b) => b.price - a.price);
    }

    let remainingQty = qty;
    let totalFilled = 0;

    while (remainingQty > 0 && oppOrder.length > 0) {
      const best = oppOrder[0];

      if (!best) break;

      const bestUserBalance = BALANCES[best.userId];

      if (bestUserBalance === undefined) {
        oppOrder.shift();
        continue;
      }
      bestUserBalance.assets[symbol] ??= 0;

      // price check
      let priceMatch = false;
      if (type === "market") {
        priceMatch = true;
      } else if (side === "buy" && price >= best.price) {
        priceMatch = true;
      } else if (side === "sell" && price <= best.price) {
        priceMatch = true;
      }

      if (!priceMatch) {
        break;
      }

      // how much qty can we fill from the best order
      const filledQty = Math.min(remainingQty, best.qty);
      totalFilled += filledQty;
      remainingQty -= filledQty;
      best.qty -= filledQty;

      const tradeValue = best.price * filledQty;

      if (side === "buy") {
        if (type === "market") {
          userBalance.amount -= tradeValue;
        }
        userBalance.assets[symbol] += filledQty;
        bestUserBalance.amount += tradeValue;
        bestUserBalance.assets[symbol] -= filledQty;
      } else {
        if (type === "market") {
          userBalance.assets[symbol] -= filledQty;
        }
        userBalance.amount += tradeValue;
        bestUserBalance.amount -= tradeValue;
        bestUserBalance.assets[symbol] += filledQty;
      }

      FILLS.push({
        qty: filledQty,
        price: best.price,
        side: best.side,
        userId: Number(best.userId),
        asset: symbol,
        originalOrderId: Number(best.orderId ?? 0),
        type: type,
      });

      await publisherClient.lPush(
        "order_filled" + best.QueueId,
        JSON.stringify({
          identifier: best.identifier,
          filledQTY: filledQty,
        }),
      );

      if (best.qty === 0) {
        oppOrder.shift();
      }
    }

    if (totalFilled > 0) {
      // update balance of the user and the opposite user
      // send the filled qty back to the user through redis pub/sub or any other method
      ORDERS.push({
        userId: Number(userId),
        symbol: symbol,
        price,
        qty,
        filledQty: totalFilled,
        side,
        type: type,
        status: totalFilled === qty ? "filled" : "partially_filled",
      });
    }

    await publisherClient.lPush(
      "order_filled" + parsedResponse.QueueId,
      JSON.stringify({
        identifier,
        filledQTY: totalFilled,
      }),
    );

    if (remainingQty > 0 && type === "limit") {
      // add the remaining order to the order book
      if (side === "buy") {
        userBalance.amount += price * remainingQty;
      } else {
        userBalance.assets[symbol] += remainingQty;
      }

      const unfilledOrder = {
        symbol,
        side,
        price,
        qty: remainingQty,
        userId,
        identifier,
        orderId: parsedResponse.orderId,
        QueueId: parsedResponse.QueueId,
      };
      ORDERBOOKS[symbol][side].push(unfilledOrder);
      if (side === "buy") {
        ORDERBOOKS[symbol][side].sort((a, b) => b.price - a.price);
      } else {
        ORDERBOOKS[symbol][side].sort((a, b) => a.price - b.price);
      }
    }
  }
  if (parsedResponse.msgtype === "get_depth") {
    const symbol = parsedResponse.symbol;
    if (!ORDERBOOKS[symbol]) {
      ORDERBOOKS[symbol] = {
        buy: [],
        sell: [],
      };
    }
    const depth = ORDERBOOKS[symbol];
    await publisherClient.lPush(
      "order_filled" + parsedResponse.QueueId,
      JSON.stringify({
        identifier: parsedResponse.identifier,
        buy: depth.buy,
        sell: depth.sell,
      }),
    );
  }
  if (parsedResponse.msgtype === "cancel_order") {
    const { symbol, side, identifier, orderId, QueueId } = parsedResponse;
    if (!ORDERBOOKS[symbol]) {
      ORDERBOOKS[symbol] = {
        buy: [],
        sell: [],
      };
    }
    const book = ORDERBOOKS[symbol][side];
    const index = book.findIndex((o) => o.orderId === orderId);
    if (index !== -1) {
      const cancelOrder = book[index];
      if(cancelOrder){
        const userBalance = BALANCES[cancelOrder.userId];
        if(userBalance){
          if (side === "buy") {
            userBalance.amount += cancelOrder.price * cancelOrder.qty;
          } else {
            if(userBalance.assets[symbol]=== undefined){
              userBalance.assets[symbol] = 0;
            }
            userBalance.assets[symbol] += cancelOrder.qty;
          }
        }
      }
      book.splice(index, 1);
    }
    await publisherClient.lPush(
      "order_filled" + QueueId,
      JSON.stringify({
        identifier,
        cancelled: true,
      }),
    );
  }
  if (parsedResponse.msgtype === "get_user_balance") {
    const userId = parsedResponse.userId;
    const balance = BALANCES[userId];
    await publisherClient.lPush(
      "order_filled" + parsedResponse.QueueId,
      JSON.stringify({
        identifier: parsedResponse.identifier,
        balance,
      }),
    );
  }
  if (parsedResponse.msgtype === "get_orders") {
    const { orderId, symbol, QueueId } = parsedResponse;
    if (!ORDERBOOKS[symbol]) {
      ORDERBOOKS[symbol] = {
        buy: [],
        sell: [],
      };
    }
    let buyOrders = ORDERBOOKS[symbol]?.buy.find((o) => o.orderId === orderId);
    let sellOrders = ORDERBOOKS[symbol]?.sell.find(
      (o) => o.orderId === orderId,
    );
    const order = buyOrders ?? sellOrders ?? null;
    await publisherClient.lPush(
      "order_filled" + QueueId,
      JSON.stringify({
        identifier: parsedResponse.identifier,
        order: order ?? null,
        message: order
          ? null
          : "Order not found in order book, it might be filled or cancelled",
      }),
    );
  }
}
