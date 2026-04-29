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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, "../../../..");
const API_UPLOADS = path.join(MONOREPO_ROOT, "apps/api/uploads");

export function createStorageProvider(): StorageProvider {
  const type = process.env.STORAGE_TYPE ?? "local";
  if (type === "local") {
    const configured = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
    const uploadsPath = path.isAbsolute(configured) ? configured : API_UPLOADS;
    return new LocalStorageProvider(uploadsPath);
  }
  throw new Error("S3 provider in workers: use @aws-sdk/client-s3 (not yet wired)");
}
