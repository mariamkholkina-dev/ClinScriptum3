import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface StorageProvider {
  upload(key: string, data: Buffer): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  constructor(basePath: string) {
    this.basePath = basePath;
  }
  async upload(key: string, data: Buffer): Promise<string> {
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return key;
  }
  async download(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.basePath, key));
  }
  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.basePath, key)).catch(() => {});
  }
  getUrl(key: string): string {
    return `file://${path.resolve(this.basePath, key)}`;
  }
}

class S3StorageProvider implements StorageProvider {
  private bucket: string;
  private region: string;
  private endpoint?: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private _client: any = null;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "";
    this.region = process.env.S3_REGION ?? "us-east-1";
    this.endpoint = process.env.S3_ENDPOINT || undefined;
    this.accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
    this.secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
  }

  private async getClient() {
    if (this._client) return this._client;
    const { S3Client } = await import("@aws-sdk/client-s3");
    this._client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      forcePathStyle: !!this.endpoint,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    });
    return this._client;
  }

  async upload(key: string, data: Buffer): Promise<string> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getUrl(key: string): string {
    const base = this.endpoint ?? `https://s3.${this.region}.amazonaws.com`;
    return `${base}/${this.bucket}/${key}`;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, "../../../..");
const API_UPLOADS = path.join(MONOREPO_ROOT, "apps/api/uploads");

export function createStorageProvider(): StorageProvider {
  const type = process.env.STORAGE_TYPE ?? "local";
  if (type === "s3") {
    return new S3StorageProvider();
  }
  const configured = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
  const uploadsPath = path.isAbsolute(configured) ? configured : API_UPLOADS;
  return new LocalStorageProvider(uploadsPath);
}
