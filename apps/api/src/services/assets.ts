import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { isProductionRuntime } from "../config";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type StoredAsset = {
  body: Uint8Array;
  contentType: string;
};

export type PutAssetInput = {
  body: Uint8Array;
  contentType: string;
  key: string;
};

export type AssetStorage = {
  putObject(input: PutAssetInput): Promise<void>;
  getObject(key: string): Promise<StoredAsset | null>;
  deleteObject?(key: string): Promise<void>;
};

export function createAssetStorage(
  env: Record<string, string | undefined> = Bun.env,
): AssetStorage | null {
  const bucket = readEnv(
    env,
    "S3_BUCKET",
    "LOGO_BUCKET",
    "BUCKET",
    "AWS_S3_BUCKET_NAME",
    "BUCKET_NAME",
  );
  const endpoint = readEnv(
    env,
    "S3_ENDPOINT",
    "ENDPOINT",
    "AWS_ENDPOINT_URL",
    "BUCKET_ENDPOINT",
  );
  const accessKeyId = readEnv(
    env,
    "S3_ACCESS_KEY_ID",
    "ACCESS_KEY_ID",
    "AWS_ACCESS_KEY_ID",
    "BUCKET_ACCESS_KEY_ID",
  );
  const secretAccessKey = readEnv(
    env,
    "S3_SECRET_ACCESS_KEY",
    "SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "BUCKET_SECRET_ACCESS_KEY",
  );
  const region =
    readEnv(
      env,
      "S3_REGION",
      "REGION",
      "AWS_DEFAULT_REGION",
      "AWS_REGION",
      "BUCKET_REGION",
    ) ?? "auto";

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return isProductionRuntime(env)
      ? null
      : new FileSystemAssetStorage(
          env.COOEE_LOCAL_ASSET_DIR?.trim() ||
            join(tmpdir(), "cooee-local-assets"),
        );
  }

  return new S3AssetStorage({
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle:
      env.S3_FORCE_PATH_STYLE === "true" || env.AWS_S3_URL_STYLE === "path",
  });
}

export class FileSystemAssetStorage implements AssetStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async putObject(input: PutAssetInput): Promise<void> {
    const path = this.resolveKey(input.key);
    await mkdir(dirname(path), { recursive: true });
    await Promise.all([
      writeFile(path, input.body),
      writeFile(this.contentTypePath(path), input.contentType, "utf8"),
    ]);
  }

  async getObject(key: string): Promise<StoredAsset | null> {
    const path = this.resolveKey(key);
    try {
      const [body, contentType] = await Promise.all([
        readFile(path),
        readFile(this.contentTypePath(path), "utf8"),
      ]);
      return {
        body: new Uint8Array(body),
        contentType: contentType.trim() || "application/octet-stream",
      };
    } catch (error) {
      if (isFileNotFoundError(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const path = this.resolveKey(key);
    await Promise.all([
      rm(path, { force: true }),
      rm(this.contentTypePath(path), { force: true }),
    ]);
  }

  private resolveKey(key: string): string {
    if (
      !key ||
      isAbsolute(key) ||
      key.split(/[\\/]/).some((segment) => segment === ".." || segment === "")
    ) {
      throw new Error("Invalid local asset key.");
    }

    const path = resolve(this.root, ...key.split("/"));
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Invalid local asset key.");
    }
    return path;
  }

  private contentTypePath(path: string): string {
    return `${path}.content-type`;
  }
}

function readEnv(
  env: Record<string, string | undefined>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export class S3AssetStorage implements AssetStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: {
      accessKeyId: string;
      bucket: string;
      endpoint: string;
      forcePathStyle?: boolean;
      region: string;
      secretAccessKey: string;
    },
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(input: PutAssetInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async getObject(key: string): Promise<StoredAsset | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        return null;
      }

      return {
        body: await response.Body.transformToByteArray(),
        contentType: response.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ("name" in error || "$metadata" in error) &&
    ((error as { name?: string }).name === "NoSuchKey" ||
      (error as { name?: string }).name === "NotFound" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404)
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
