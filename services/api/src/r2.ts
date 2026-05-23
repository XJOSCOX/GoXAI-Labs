import { S3Client } from "@aws-sdk/client-s3";

export interface R2Config {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  secretAccessKey: string;
}

export function getR2Config():
  | { ok: true; value: R2Config }
  | { ok: false; error: string } {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const missing = [
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET", bucket],
    ["R2_ACCOUNT_ID or R2_ENDPOINT", endpoint]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing R2 environment variables: ${missing.join(", ")}`
    };
  }

  return {
    ok: true,
    value: {
      accessKeyId: accessKeyId!,
      bucket: bucket!,
      endpoint,
      secretAccessKey: secretAccessKey!
    }
  };
}

export function createR2Client(config: R2Config) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}
