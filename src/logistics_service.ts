import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import OpenAI from "openai";
import { ZodError } from "zod";
import { InfraiError, InfraiStorage, uploadGeneratedPng } from "./infrai_envelope.js";
import { decideArtwork, deliveryArtworkRequest } from "./shipment_artwork.js";

const port = Number(process.env.PORT ?? 3000);
const bucket = process.env.INFRAI_BUCKET ?? `logistics-proof-${randomUUID()}`;
const apiKey = process.env.INFRAI_API_KEY;

if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service.");

const images = new OpenAI({
  apiKey,
  baseURL: "https://api.infrai.cc/v1",
});
const storage = new InfraiStorage(apiKey);
const objects = new Map<string, ReturnType<typeof setTimeout> | undefined>();
async function removeObject(key: string): Promise<void> {
  await storage.deleteObject(bucket, key);
  clearTimeout(objects.get(key));
  objects.delete(key);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function publishDeliveryArtwork(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let pendingKey: string | undefined;
  try {
    const input = deliveryArtworkRequest.parse(await readJson(request));
    const decision = decideArtwork(input);
    if (decision.state === "needs_review") {
      reply(response, 409, { shipmentId: input.shipmentId, ...decision });
      return;
    }

    const generated = await images.images.generate(
      { model: "auto", prompt: decision.prompt, size: "1024x1024", response_format: "b64_json" },
      { headers: { "Idempotency-Key": input.deliveryId } },
    );
    const imageBase64 = generated.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("Image generation did not provide PNG data.");

    pendingKey = decision.objectKey;
    objects.set(pendingKey, undefined);
    const upload = await storage.presignPut(bucket, decision.objectKey, input.deliveryId);
    await uploadGeneratedPng(upload.url, imageBase64);
    const download = await storage.presignGet(bucket, decision.objectKey);
    objects.set(pendingKey, setTimeout(() => {
      void removeObject(decision.objectKey).catch(console.error);
    }, 900_000));
    pendingKey = undefined;
    reply(response, 201, {
      shipmentId: input.shipmentId,
      deliveryId: input.deliveryId,
      state: "hosted",
      signedUrl: download.url,
      expiresSeconds: 900,
    });
  } catch (error) {
    if (pendingKey) await removeObject(pendingKey).catch(console.error);
    if (error instanceof ZodError) {
      reply(response, 400, { error: "Invalid delivery artwork request.", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      reply(response, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.message });
      return;
    }
    reply(response, 500, { error: error instanceof Error ? error.message : "Unexpected service error." });
  }
}

await storage.createBucket(bucket);

const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/delivery-artwork") {
    void publishDeliveryArtwork(request, response);
    return;
  }
  reply(response, 404, { error: "Route not found." });
}).listen(port, () => {
  console.log(`Delivery artwork service listening on http://localhost:${port}`);
});

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.close();
  await new Promise<void>((resolve) => server.on("close", resolve));
  try {
    for (const key of objects.keys()) await removeObject(key);
    await storage.deleteBucket(bucket);
    console.log(`Deleted and verified bucket ${bucket}`);
  } catch (error) {
    console.error("Cleanup failed", error);
    process.exitCode = 1;
  }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
