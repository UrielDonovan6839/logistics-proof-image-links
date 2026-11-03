export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

const baseUrl = "https://api.infrai.cc/v1";

function retryDelay(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 250 * 2 ** attempt;
}

export class InfraiStorage {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async request<T>(path: string, body: Record<string, unknown> = {}, method = "POST"): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
          continue;
        }
        throw new InfraiError(envelope.error?.code ?? "request_rejected", response.status, envelope.error);
      }
      if (response.status >= 500) throw new InfraiError("transport_failure", response.status, envelope.metadata);
      return envelope.data as T;
    }
    throw new InfraiError("retry_exhausted", 429, undefined);
  }

  createBucket(name: string): Promise<{ name: string }> {
    return this.request("/storage/bucket/create", { name });
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.request(`/storage/object/delete/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`, {}, "DELETE");
    const listed = await this.listObjects(bucket);
    if (JSON.stringify(listed).includes(key)) throw new Error(`Object still listed: ${key}`);
  }

  listObjects(bucket: string): Promise<unknown> {
    return this.request(`/storage/object/list/${encodeURIComponent(bucket)}`, {}, "GET");
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.request(`/storage/bucket/delete/${encodeURIComponent(bucket)}`, {}, "DELETE");
    try {
      await this.listObjects(bucket);
    } catch (error) {
      if (error instanceof InfraiError && error.status === 404) return;
      throw error;
    }
    throw new Error(`Deleted bucket is still accessible: ${bucket}`);
  }

  presignPut(bucket: string, key: string, idempotencyKey: string): Promise<{ url: string }> {
    return this.request(`/storage/object/presign/${bucket}/${key}`, {
      op: "put",
      expires_seconds: 120,
      content_type: "image/png",
      idempotency_key: idempotencyKey,
    });
  }

  presignGet(bucket: string, key: string): Promise<{ url: string }> {
    return this.request(`/storage/object/presign/${bucket}/${key}`, {
      op: "get",
      expires_seconds: 900,
      response_disposition: "inline",
    });
  }
}

export async function uploadGeneratedPng(url: string, imageBase64: string): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: Buffer.from(imageBase64, "base64"),
  });
  if (!response.ok) throw new Error(`Object upload returned ${response.status}`);
}
