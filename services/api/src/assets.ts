import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getPrismaClient,
  StorageProvider,
  type StorageAsset
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.post("/upload-url", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCreateUploadUrlBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    response.status(503).json({ error: config.error });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: {
      id: parsed.value.datasetId
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: dataset.organizationId,
      status: "ACTIVE",
      role: {
        in: ["OWNER", "ADMIN", "MANAGER"]
      }
    },
    select: {
      id: true
    }
  });

  if (!membership) {
    response.status(403).json({
      error: "You need owner, admin, or manager access to upload assets to this dataset."
    });
    return;
  }

  const objectKey =
    parsed.value.objectKey ??
    buildDatasetObjectKey(dataset.projectId, dataset.id, parsed.value.fileName);
  const existingAsset = await prisma.storageAsset.findUnique({
    where: {
      provider_bucket_objectKey: {
        provider: StorageProvider.R2,
        bucket: config.value.bucket,
        objectKey
      }
    },
    select: {
      id: true
    }
  });

  if (existingAsset) {
    response.status(409).json({ error: "An asset already exists for this R2 bucket and object key." });
    return;
  }

  const client = createR2Client(config.value);
  const command = new PutObjectCommand({
    Bucket: config.value.bucket,
    Key: objectKey,
    ContentLength: Number(parsed.value.fileSize),
    ContentType: parsed.value.mimeType
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 10 });

  response.status(201).json({
    upload: {
      uploadUrl,
      method: "PUT",
      expiresInSeconds: 60 * 10,
      headers: {
        "Content-Type": parsed.value.mimeType
      }
    },
    asset: {
      datasetId: dataset.id,
      bucket: config.value.bucket,
      objectKey,
      fileName: parsed.value.fileName,
      mimeType: parsed.value.mimeType,
      fileSize: parsed.value.fileSize.toString()
    }
  });
});

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.query.datasetId);
  const projectId = normalizeId(request.query.projectId);
  const prisma = getPrismaClient();
  const organizationIds = await getAccessibleOrganizationIds(user.id);

  if (organizationIds.length === 0) {
    response.status(200).json({ assets: [] });
    return;
  }

  if (datasetId) {
    const dataset = await prisma.dataset.findFirst({
      where: {
        id: datasetId,
        organizationId: {
          in: organizationIds
        }
      },
      select: {
        id: true
      }
    });

    if (!dataset) {
      response.status(404).json({ error: "Dataset was not found or you do not have access." });
      return;
    }
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: {
          in: organizationIds
        }
      },
      select: {
        id: true
      }
    });

    if (!project) {
      response.status(404).json({ error: "Project was not found or you do not have access." });
      return;
    }
  }

  const assets = await prisma.storageAsset.findMany({
    where: {
      organizationId: {
        in: organizationIds
      },
      ...(datasetId ? { datasetId } : {}),
      ...(projectId ? { projectId } : {})
    },
    include: assetIncludes,
    orderBy: {
      createdAt: "desc"
    }
  });

  response.status(200).json({
    assets: assets.map(serializeAsset)
  });
});

router.post("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCreateAssetBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: {
      id: parsed.value.datasetId
    },
    include: {
      project: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: dataset.organizationId,
      status: "ACTIVE",
      role: {
        in: ["OWNER", "ADMIN", "MANAGER"]
      }
    },
    select: {
      id: true
    }
  });

  if (!membership) {
    response.status(403).json({
      error: "You need owner, admin, or manager access to register assets in this dataset."
    });
    return;
  }

  const bucket = parsed.value.bucket ?? getDefaultR2Bucket();

  if (!bucket) {
    response.status(400).json({
      error: "R2_BUCKET is not configured. Add it to the API environment before registering assets."
    });
    return;
  }

  const existingAsset = await prisma.storageAsset.findUnique({
    where: {
      provider_bucket_objectKey: {
        provider: StorageProvider.R2,
        bucket,
        objectKey: parsed.value.objectKey
      }
    },
    select: {
      id: true
    }
  });

  if (existingAsset) {
    response.status(409).json({ error: "An asset already exists for this R2 bucket and object key." });
    return;
  }

  const asset = await prisma.$transaction(async (tx) => {
    const createdAsset = await tx.storageAsset.create({
      data: {
        organizationId: dataset.organizationId,
        projectId: dataset.projectId,
        datasetId: dataset.id,
        uploadedById: user.id,
        provider: StorageProvider.R2,
        bucket,
        objectKey: parsed.value.objectKey,
        fileName: parsed.value.fileName,
        mimeType: parsed.value.mimeType,
        fileSize: parsed.value.fileSize,
        checksum: parsed.value.checksum,
        width: parsed.value.width,
        height: parsed.value.height,
        duration: parsed.value.duration,
        metadata: {
          source: "r2-registration"
        }
      },
      include: assetIncludes
    });

    await tx.auditLog.create({
      data: {
        organizationId: createdAsset.organizationId,
        projectId: createdAsset.projectId,
        userId: user.id,
        action: "asset.registered",
        entityType: "storage_asset",
        entityId: createdAsset.id,
        metadata: {
          bucket: createdAsset.bucket,
          objectKey: createdAsset.objectKey,
          fileName: createdAsset.fileName,
          datasetId: dataset.id,
          projectName: dataset.project.name
        }
      }
    });

    return createdAsset;
  });

  response.status(201).json({
    asset: serializeAsset(asset)
  });
});

export { router as assetsRouter };

const assetIncludes = {
  organization: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  project: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  dataset: {
    select: {
      id: true,
      name: true,
      version: true
    }
  }
} as const;

type CreateAssetBody =
  | {
      datasetId?: unknown;
      bucket?: unknown;
      objectKey?: unknown;
      fileName?: unknown;
      mimeType?: unknown;
      fileSize?: unknown;
      checksum?: unknown;
      width?: unknown;
      height?: unknown;
      duration?: unknown;
    }
  | undefined;

type CreateUploadUrlBody =
  | {
      datasetId?: unknown;
      objectKey?: unknown;
      fileName?: unknown;
      mimeType?: unknown;
      fileSize?: unknown;
    }
  | undefined;

function parseCreateAssetBody(body: CreateAssetBody):
  | {
      ok: true;
      value: {
        datasetId: string;
        bucket?: string;
        objectKey: string;
        fileName: string;
        mimeType: string;
        fileSize: bigint;
        checksum?: string;
        width?: number;
        height?: number;
        duration?: number;
      };
    }
  | { ok: false; error: string } {
  const datasetId = normalizeId(body?.datasetId);
  const bucket = normalizeText(body?.bucket);
  const objectKey = normalizeText(body?.objectKey);
  const fileName = normalizeText(body?.fileName);
  const mimeType = normalizeText(body?.mimeType);
  const fileSize = parsePositiveBigInt(body?.fileSize);
  const checksum = normalizeText(body?.checksum);
  const width = parsePositiveInteger(body?.width);
  const height = parsePositiveInteger(body?.height);
  const duration = parsePositiveNumber(body?.duration);

  if (!datasetId) {
    return { ok: false, error: "Dataset is required." };
  }

  if (!objectKey) {
    return { ok: false, error: "R2 object key is required." };
  }

  if (objectKey.length > 1024) {
    return { ok: false, error: "R2 object key must be 1024 characters or fewer." };
  }

  if (!fileName) {
    return { ok: false, error: "File name is required." };
  }

  if (fileName.length > 255) {
    return { ok: false, error: "File name must be 255 characters or fewer." };
  }

  if (!mimeType) {
    return { ok: false, error: "MIME type is required." };
  }

  if (!fileSize) {
    return { ok: false, error: "File size must be a positive number of bytes." };
  }

  return {
    ok: true,
    value: {
      datasetId,
      bucket,
      objectKey,
      fileName,
      mimeType,
      fileSize,
      checksum,
      width,
      height,
      duration
    }
  };
}

function parseCreateUploadUrlBody(body: CreateUploadUrlBody):
  | {
      ok: true;
      value: {
        datasetId: string;
        objectKey?: string;
        fileName: string;
        mimeType: string;
        fileSize: bigint;
      };
    }
  | { ok: false; error: string } {
  const datasetId = normalizeId(body?.datasetId);
  const objectKey = normalizeText(body?.objectKey);
  const fileName = normalizeText(body?.fileName);
  const mimeType = normalizeText(body?.mimeType);
  const fileSize = parsePositiveBigInt(body?.fileSize);

  if (!datasetId) {
    return { ok: false, error: "Dataset is required." };
  }

  if (objectKey && objectKey.length > 1024) {
    return { ok: false, error: "R2 object key must be 1024 characters or fewer." };
  }

  if (!fileName) {
    return { ok: false, error: "File name is required." };
  }

  if (fileName.length > 255) {
    return { ok: false, error: "File name must be 255 characters or fewer." };
  }

  if (!mimeType) {
    return { ok: false, error: "MIME type is required." };
  }

  if (!fileSize) {
    return { ok: false, error: "File size must be a positive number of bytes." };
  }

  return {
    ok: true,
    value: {
      datasetId,
      objectKey,
      fileName,
      mimeType,
      fileSize
    }
  };
}

async function getAccessibleOrganizationIds(userId: string) {
  const prisma = getPrismaClient();
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE"
    },
    select: {
      organizationId: true
    }
  });

  return [...new Set(memberships.map((membership) => membership.organizationId))];
}

type AssetWithRelations = StorageAsset & {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
  } | null;
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
};

function serializeAsset(asset: AssetWithRelations) {
  return {
    id: asset.id,
    organizationId: asset.organizationId,
    projectId: asset.projectId,
    datasetId: asset.datasetId,
    provider: asset.provider,
    bucket: asset.bucket,
    objectKey: asset.objectKey,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize.toString(),
    checksum: asset.checksum,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    metadata: asset.metadata,
    organization: asset.organization,
    project: asset.project,
    dataset: asset.dataset,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
}

function getDefaultR2Bucket() {
  return process.env.R2_BUCKET?.trim() || undefined;
}

interface R2Config {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  secretAccessKey: string;
}

function getR2Config():
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

function createR2Client(config: R2Config) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

function buildDatasetObjectKey(projectId: string, datasetId: string, fileName: string) {
  return [
    "projects",
    projectId,
    "datasets",
    datasetId,
    `${new Date().toISOString().slice(0, 10)}-${randomUUID()}-${sanitizeFileName(fileName)}`
  ].join("/");
}

function sanitizeFileName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 180) || "asset";
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);

  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function parsePositiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parsePositiveBigInt(value: unknown) {
  try {
    if (typeof value === "bigint") {
      return value > 0n ? value : undefined;
    }

    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      return BigInt(value);
    }

    if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
      return BigInt(value.trim());
    }
  } catch {
    return undefined;
  }

  return undefined;
}
