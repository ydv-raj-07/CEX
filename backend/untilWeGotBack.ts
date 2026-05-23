import { createClient } from "redis";

const subscriberClient = await createClient({
  url: Bun.env.REDIS_URL,
})
.on("error", (err) => console.log("Redis Client Error", err))
.connect();

interface filledQty{
  filledQty: number;
}

interface pendingResolvesType {
  [identifier: number]: (data: filledQty) => void;
}

let pendingResolves: pendingResolvesType = {};

async function pollQueue(){
  const response = await subscriberClient.brPop("order_filled",1);
  if(!response){
    pollQueue();
  }
  else{
    const parsedResponse = JSON.parse(response.element);
    const fn = pendingResolves[parsedResponse.identifier];
    if(parsedResponse && fn){
      fn({filledQty:parsedResponse.filledQTY});
    }
    pollQueue();
  }
}

pollQueue();

export async function untilWeGotBack(identifier: number){ 
  return new Promise<filledQty>((resolve,reject)=>{
    pendingResolves[identifier] = resolve;
  });
}
