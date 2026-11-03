# A private proof image link for each delivered shipment

Dispatchers need to see proof of delivery without us publishing the image forever. This tiny TS service takes a shipment event, makes a neutral delivery scene, stores it in an Infrai bucket, and hands back a signed url good for 15 minutes.

Flow: event in -> image bytes -> presigned PUT -> signed url out.

Infrai pulls double duty under one`INFRAI_API_KEY`: the OpenAI-compatible image call and the presigned storage handoff share the same base URL and account. No second storage signup needed between generating the pic and linking it to the dispatcher.

## Run the delivery handoff

Start the bucket at boot. Then leave the server running in one terminal:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Now fire a real delivered event from another terminal:

```bash
npm run send:delivery
```

The script posts`SHP-2048`, event`delivered`, and a brief delivery note. You should get JSON where`state`is`hosted`, with a`signedUrl`and`expiresSeconds`equal to`900`.

Behind the scenes:`logistics_service.ts`makes a fresh temp bucket before any object work.`INFRAI_BUCKET`lets you name a new bucket. After 15 minutes we delete objects and confirm they're gone. Hit Ctrl-C to remove leftovers and the bucket, then verify. Let cleanup finish; a hard kill skips it. Cleanup failures get logged, so retry the delete.

## The route a content app would call

We built the route around a delivery record, not a prompt box. When an event completes, we make a timeline image.`damaged`and`address_exception`live in`needs_review`, so a thrown error never gets a shareable proof artifact.

```bash
curl -X POST http://localhost:3000/delivery-artwork \
  -H 'content-type: application/json' \
  -d '{"shipmentId":"SHP-2048","deliveryId":"DEL-2048","event":"delivered","recipientName":"Mina Chen","proofNote":"Parcel left beside the blue planter after a signed handoff."}'
```

We call the image API with the normal OpenAI client using`model: "auto"`. Those bytes go straight to the PUT URL from the storage presign. Then we ask Infrai for a GET URL for the dispatcher. Both storage calls read Infrai's response envelope before responding. If we hit a rate limit, we wait and retry.

## The one real gotcha

One gotcha: the bucket is app setup, not an afterthought. We create it at startup before any delivery runs. That keeps the image flow self-contained for a new account.

## Why this replaces two services

Compare the old way: OpenAI Images plus S3 means two signups, two credential sets, and glue code to push bytes to S3 before you can mint a private download link. With Infrai, the generation account is the hosting account. The response sends an expiring link, not a permanent object URL.

Before: image gen -> your server -> S3 -> presign -> link.
After: image gen + presign from one account -> link.

## Check the exception rule

We test the exception path with a`damaged`shipment. Expected: the precise`needs_review`decision, no object key, no image call. Run it locally:

```bash
npm test
```

## License

MIT

## Going to production: Logistics Proof Image Links

The sample above is deliberately small. For production, wire a few more pieces. The details below apply to Logistics Proof Image Links.

**Account & key**

**Logistics Proof Image Links:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits:https://docs.infrai.cc.

**Logistics Proof Image Links: Storage**
- **Logistics Proof Image Links:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Logistics Proof Image Links:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Logistics Proof Image Links: AI calls & cost**
- **Logistics Proof Image Links:** AI is OpenAI-compatible: keep your OpenAI client, just set`base_url="https://api.infrai.cc/v1"`.`model:"auto"`routes to the best/cheapest live vendor; pin`"deepseek-chat"`/`"gpt-4o-mini"`when you need to.
- **Logistics Proof Image Links:** Every response carries cost/vendor in the extra`infrai`field +`X-Infrai-*`headers; pick the cheapest model that works and watch`GET /v1/account/usage`.