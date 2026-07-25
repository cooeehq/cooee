import { describe, expect, test } from "bun:test";
import { createAssetStorage, S3AssetStorage } from "../services/assets";

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
});
