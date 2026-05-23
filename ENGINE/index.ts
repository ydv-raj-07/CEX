import {createClient} from "redis";

const BALANCES = {};
const ORDERBOOKS = {};

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



while(1){
  const response = await client.brPop("new_order",1);
  if(!response) continue;
  const parsedResponse = JSON.parse(response.element);
  if(parsedResponse.type === "market"){};
  if(parsedResponse.type === "limit"){};
  const filledQTY = 10;
  const identifier = parsedResponse.identifier;
  await publisherClient.lPush("order_filled", JSON.stringify({identifier, filledQTY}));
}