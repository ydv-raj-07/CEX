import {createClient} from "redis";

const BALANCES = {};
const ORDERBOOKS = [];

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
  const response = await client.rPop("new_order");
  if(!response) continue;
  const parsedResponse = JSON.parse(response);
  if(parsedResponse.type === "market"){};
  if(parsedResponse.type === "limit"){};
  const filledQTY = 10;
  const identifier = parsedResponse.identifier;
  await publisherClient.publish("order_filled", JSON.stringify({identifier, filledQTY}));
}