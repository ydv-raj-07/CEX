import express from "express";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import authmiddleware from "./authmiddleware";
import { createClient } from "redis";
import { untilWeGotBack } from "./untilWeGotBack";

const client = await createClient({
  url: Bun.env.REDIS_URL,
})
.on("error", (err) => console.log("Redis Client Error", err))
.connect();

interface AuthenticatedRequest extends express.Request {
  userId?: number;
}

const adapter = new PrismaNeon({ connectionString: Bun.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(express.json());

const BALANCES = {};
const ORDERBOOKS = [];

app.post("/signup", async function (req, res) {
  const username = req.body?.username;
  const password = req.body?.password;
   if (!username || !password) {
     res.status(400).json({ error: "Username and password are required fields." });
     return;
  }
  const existingUser = await prisma.user.findFirst({
    where: {
      username: username,
    },
  });
  if (existingUser) {
    res.status(400).json({ error: "Username already exists" });
    return;
  }

  const hassedPassword = await bcrypt.hash(password, 10);

  const newUser = await prisma.user.create({
    data: {
      username: username,
      password: hassedPassword,
    },
  });

  res.json({ message: "User created successfully" });
});

app.post("/signin", async function (req, res) {
  const username = req.body?.username;
  const password = req.body?.password;

  const existingUser = await prisma.user.findUnique({
    where: {
      username: username,
    },
  });

  if (!existingUser) {
    res.status(400).json({ error: "Invalid username or password" });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, existingUser.password);

  if (!passwordMatch) {
    res.status(400).json({ error: "Invalid username or password" });
    return;
  }
  const secretKey: string = process.env.JWT_SECRET as string;
  const token = jwt.sign({ userId: existingUser.id }, secretKey, {
    expiresIn: "1h",
  });
  res.json({
    message: "Sign in successful",
    token: token,
  });
});

/* body = {
    type: "market" | "limit",
    price: number | null,
    qty: number,
    side: "buy" | "sell",
    market_id: String
} 
    @returns{
        orderId: String,
        filledQty: number,
        totalPrice: number,  
      }
*/


app.post("/order",authmiddleware, async function (req: AuthenticatedRequest, res) {
  const userId = req.userId;
  const { type, price, qty, side, market_id,symbol } = req.body;
  let identifier = Math.random();
  await client.lPush("new_order", JSON.stringify({
    type,
    price,
    qty,
    side,
    market_id,
    symbol,
    userId,
    identifier
  }));  
  
  const returnedData = await untilWeGotBack(identifier);

  res.json({
    message: "Order placed successfully",
    filledQty:returnedData.filledQty,
  });
});

// returns the status of an order (partially filled, success, cancelled)
// also returns the individual fills of this order
app.get("/order/:orderId",authmiddleware, function (req : AuthenticatedRequest, res) {
  const userId = req.userId;
  const orderId = req.params.orderId;
  if (!orderId) {
    res.status(400).json({ error: "Order ID is required" });
    return;
  }
  const order = ORDERBOOKS.find((o) => o.id === orderId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.userId !== userId) {
    res.status(403).json({ error: "Unauthorized access to this order" });
    return;
  }
  res.json({
    orderId: order.id,
    filledQty: order.filledQty,
    totalPrice: order.totalPrice,
    status: order.status,
    fills: order.fills,
  });
});

app.delete("/order/:orderId",authmiddleware, function (req : AuthenticatedRequest, res) {});

// app.get("/depth/:symbol", function (req, res) {
//   res.json({ depth: ORDERBOOKS[req.params.symbol] });
// });

app.get("/orders",authmiddleware, function (req : AuthenticatedRequest, res) {
  const userId = req.userId;
  const userOrders = ORDERBOOKS.filter((o) => o.userId === userId);
  res.json({ orders: userOrders });
});

app.get("/fills",authmiddleware, function (req : AuthenticatedRequest, res) {
});

app.get("/balance/usd",authmiddleware, function (req : AuthenticatedRequest, res) {
  const userId = req.userId;
  if (!userId) {
    res.status(400).json({ error: "User ID is required" });
    return;
  }
  const balance = BALANCES[userId]?.usd || 0;
  if (balance === undefined) {
    res.status(404).json({ error: "Balance not found for user" });
    return;
  }
  res.json({ usdBalance: balance });
});

// Returns the balance of all stocks
app.get("/balance",authmiddleware, function (req : AuthenticatedRequest, res) {
  const userId = req.userId;
  if (!userId) {
    res.status(400).json({ error: "User ID is required" });
    return;
  }
  const stockBalance = BALANCES[userId]?.stocks || {};
  if (stockBalance === undefined) {
    res.status(404).json({ error: "Stock balance not found for user" });
    return;
  }
  res.json({ stockBalance: stockBalance });
});

app.listen(3000, function () {
  console.log("Server is running on port 3000");
});
