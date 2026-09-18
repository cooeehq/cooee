import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssetStorage,
  FileSystemAssetStorage,
  S3AssetStorage,
} from "../services/assets";

describe("asset storage", () => {
  test("uses Railway CLI bucket credential variable names", () => {
    const storage = createAssetStorage({
      AWS_ACCESS_KEY_ID: "access-key",
      AWS_DEFAULT_REGION: "auto",
      AWS_ENDPOINT_URL: "https://storage.railway.app",
      AWS_S3_BUCKET_NAME: "cooee-assets",
      AWS_SECRET_ACCESS_KEY: "secret-key",
      AWS_S3_URL_STYLE: "virtual",
    });

    expect(storage).toBeInstanceOf(S3AssetStorage);
  });

  test("uses Railway bucket guide variable names", () => {
    const storage = createAssetStorage({
      BUCKET_ACCESS_KEY_ID: "access-key",
      BUCKET_ENDPOINT: "https://storage.railway.app",
      BUCKET_NAME: "cooee-assets",
      BUCKET_SECRET_ACCESS_KEY: "secret-key",
      BUCKET_REGION: "auto",
    });

    expect(storage).toBeInstanceOf(S3AssetStorage);
  });

  test("uses isolated temporary storage in development", async () => {
    const root = await mkdtemp(join(tmpdir(), "cooee-assets-test-"));
    try {
      const storage = createAssetStorage({
        COOEE_LOCAL_ASSET_DIR: root,
        NODE_ENV: "development",
      });
      expect(storage).toBeInstanceOf(FileSystemAssetStorage);

      await storage!.putObject({
        body: new TextEncoder().encode("image"),
        contentType: "image/webp",
        key: "workspaces/ws_test/changelog-entries/entry_test/image",
      });
      expect(
        await storage!.getObject(
          "workspaces/ws_test/changelog-entries/entry_test/image",
        ),
      ).toEqual({
        body: new TextEncoder().encode("image"),
        contentType: "image/webp",
      });

      await storage!.deleteObject?.(
        "workspaces/ws_test/changelog-entries/entry_test/image",
      );
      expect(
        await storage!.getObject(
          "workspaces/ws_test/changelog-entries/entry_test/image",
        ),
      ).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("does not silently use temporary storage in production", () => {
    expect(createAssetStorage({ NODE_ENV: "production" })).toBeNull();
  });
});
