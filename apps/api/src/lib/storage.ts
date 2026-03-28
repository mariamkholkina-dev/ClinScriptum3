import { config } from "../config.js";
import { promises as fs } from "fs";
import path from "path";

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
    const filePath = path.join(this.basePath, key);
    return fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.basePath, key);
    await fs.unlink(filePath).catch(() => {});
  }

  getUrl(key: string): string {
    return `file://${path.resolve(this.basePath, key)}`;
  }
}

class S3StorageProvider implements StorageProvider {
  private bucket: string;
  private endpoint?: string;

  constructor() {
    this.bucket = config.storage.s3.bucket;
    this.endpoint = config.storage.s3.endpoint;
  }

  async upload(key: string, data: Buffer): Promise<string> {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = this.getClient(S3Client);
    await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = this.getClient(S3Client);
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = this.getClient(S3Client);
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getUrl(key: string): string {
    const base = this.endpoint ?? `https://s3.${config.storage.s3.region}.amazonaws.com`;
    return `${base}/${this.bucket}/${key}`;
  }

  private getClient(S3Client: any) {
    return new S3Client({
      region: config.storage.s3.region,
      endpoint: this.endpoint,
      forcePathStyle: !!this.endpoint,
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
      },
    });
  }
}

export function createStorageProvider(): StorageProvider {
  if (config.storage.type === "s3") {
    return new S3StorageProvider();
  }
  return new LocalStorageProvider(config.storage.localPath);
}

export const storage = createStorageProvider();
