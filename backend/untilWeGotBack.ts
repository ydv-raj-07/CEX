import { createClient } from "redis";

const subscriberClient = await createClient({
  url: Bun.env.REDIS_URL,
})
.on("error", (err) => console.log("Redis Client Error", err))
.connect();


let pendingResolves = {};

interface pendingResolve {
  
}



while(1){
  const response = await subscriberClient.brPop("order_filled",1);
  if(!response) continue;
  const parsedResponse = JSON.parse(response.element);
  if(parsedResponse && pendingResolves[parsedResponse.identifier]){
    pendingResolves[parsedResponse.identifier]({filledQty:parsedResponse.filledQTY});
  }
}


export async function untilWeGotBack(identifier: number){ 
  return new Promise(resolve,reject)=>{
    pendingResolves[identifier] = resolve;
  }
}
