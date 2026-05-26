import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const envFilePath = findEnvFile(process.cwd());
const workspaceRoot = dirname(envFilePath);
const requireFromApi = createRequire(resolve(workspaceRoot, "services/api/package.json"));
const { DeleteObjectCommand, S3Client, PutObjectCommand } = requireFromApi("@aws-sdk/client-s3");
const { getSignedUrl } = requireFromApi("@aws-sdk/s3-request-presigner");

const env = loadEnv(envFilePath);
const origin = process.argv[2] ?? "http://localhost:5173";
const endpoint =
  env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");

const missing = [
  ["R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID],
  ["R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY],
  ["R2_BUCKET", env.R2_BUCKET],
  ["R2_ACCOUNT_ID or R2_ENDPOINT", endpoint]
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing R2 environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  }
});

const diagnosticKey = `cors-check/${Date.now()}-test.txt`;
const uploadUrl = await getSignedUrl(
  client,
  new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: diagnosticKey,
    ContentType: "text/plain"
  }),
  { expiresIn: 60 }
);

const response = await fetch(uploadUrl, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": "content-type"
  }
});

const putResponse = await fetch(uploadUrl, {
  method: "PUT",
  headers: {
    "Content-Type": "text/plain"
  },
  body: "GoXAi Lab R2 diagnostic upload"
});
let cleanupStatus = "skipped";

if (putResponse.ok) {
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: diagnosticKey
      })
    );
    cleanupStatus = "deleted";
  } catch (error) {
    cleanupStatus = error instanceof Error ? `failed: ${error.message}` : "failed";
  }
}

const headers = {
  allowOrigin: response.headers.get("access-control-allow-origin") ?? "",
  allowMethods: response.headers.get("access-control-allow-methods") ?? "",
  allowHeaders: response.headers.get("access-control-allow-headers") ?? "",
  exposedHeaders: putResponse.headers.get("access-control-expose-headers") ?? "",
  uploadedEtag: putResponse.headers.get("etag") ?? ""
};

console.log(
  JSON.stringify(
    {
      endpointHost: new URL(endpoint).host,
      signedUrlHost: new URL(uploadUrl).host,
      origin,
      preflightStatus: response.status,
      signedPutStatus: putResponse.status,
      cleanupStatus,
      ...headers,
      ok:
        response.ok &&
        (headers.allowOrigin === origin || headers.allowOrigin === "*") &&
        headers.allowMethods.toUpperCase().includes("PUT") &&
        headers.allowHeaders.toLowerCase().includes("content-type") &&
        Boolean(headers.uploadedEtag)
    },
    null,
    2
  )
);

function loadEnv(filePath) {
  const values = {};
  const text = readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");

    if (index === -1) {
      continue;
    }

    values[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  return values;
}

function findEnvFile(startDirectory) {
  let current = resolve(startDirectory);

  while (true) {
    const candidate = resolve(current, ".env");

    if (existsSync(candidate)) {
      return candidate;
    }

    const next = dirname(current);

    if (next === current) {
      throw new Error("Unable to find .env from the current directory.");
    }

    current = next;
  }
}
