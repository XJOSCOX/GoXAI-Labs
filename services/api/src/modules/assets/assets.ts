import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getPrismaClient,
  Prisma,
  StorageProvider,
  type StorageAsset
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";
import { recordDatasetVersionChange } from "../datasets/datasets.js";
import { getRequestId, saveAuditLog } from "../../shared/logging.js";
import { canManageAssets, getEffectiveMembershipForCapability } from "../../shared/permissions.js";
import { createR2Client, getR2Config } from "../../shared/r2.js";

const router = Router();
const multipartPartSizeBytes = 16 * 1024 * 1024;
const multipartUrlExpiresInSeconds = 60 * 10;
const maxMultipartParts = 10_000;

router.use(requireAuthenticatedUser);

router.get("/:assetId/access-url", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const assetId = normalizeId(request.params.assetId);

  if (!assetId) {
    response.status(400).json({ error: "Asset is required." });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    void saveAuditLog({
      action: "asset.access_url.config_missing",
      userId: user.id,
      entityType: "storage_asset",
      entityId: assetId,
      metadata: {
        requestId: getRequestId(request),
        error: config.error
      }
    });
    response.status(503).json({ error: config.error });
    return;
  }

  const prisma = getPrismaClient();
  const asset = await prisma.storageAsset.findUnique({
    where: {
      id: assetId
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      provider: true,
      bucket: true,
      objectKey: true,
      fileName: true,
      mimeType: true
    }
  });

  if (!asset) {
    response.status(404).json({ error: "Asset was not found." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: asset.organizationId,
      status: "ACTIVE"
    },
    select: {
      id: true,
      role: true
    }
  });

  if (!membership) {
    response.status(403).json({ error: "You do not have access to this asset." });
    return;
  }

  if (asset.provider !== StorageProvider.R2) {
    response.status(400).json({ error: "Only R2 assets support signed access URLs right now." });
    return;
  }

  const expiresInSeconds = 60 * 10;
  const client = createR2Client(config.value);
  const accessUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: asset.bucket,
      Key: asset.objectKey,
      ResponseContentType: asset.mimeType,
      ResponseContentDisposition: `inline; filename="${asset.fileName.replaceAll("\"", "")}"`
    }),
    { expiresIn: expiresInSeconds }
  );

  void saveAuditLog({
    action: "asset.access_url.created",
    organizationId: asset.organizationId,
    projectId: asset.projectId ?? undefined,
    userId: user.id,
    entityType: "storage_asset",
    entityId: asset.id,
    metadata: {
      requestId: getRequestId(request),
      bucket: asset.bucket,
      objectKey: asset.objectKey,
      fileName: asset.fileName,
      expiresInSeconds
    }
  });

  response.status(200).json({
    accessUrl,
    expiresInSeconds
  });
});

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
    void saveAuditLog({
      action: "asset.upload_url.config_missing",
      userId: user.id,
      entityType: "dataset",
      entityId: parsed.value.datasetId,
      metadata: {
        requestId: getRequestId(request),
        error: config.error,
        fileName: parsed.value.fileName,
        mimeType: parsed.value.mimeType,
        fileSize: parsed.value.fileSize.toString()
      }
    });
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
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const uploadMembership = await getEffectiveAssetManagerMembership(user.id, dataset.projectId, dataset.organizationId);

  if (dataset.project.createdById !== user.id && (!uploadMembership || !canManageAssets(uploadMembership))) {
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
    ContentType: parsed.value.mimeType
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 10 });
  void saveAuditLog({
    action: "asset.upload_url.created",
    organizationId: dataset.organizationId,
    projectId: dataset.projectId,
    userId: user.id,
    entityType: "dataset",
    entityId: dataset.id,
    metadata: {
      requestId: getRequestId(request),
      bucket: config.value.bucket,
      objectKey,
      fileName: parsed.value.fileName,
      mimeType: parsed.value.mimeType,
      fileSize: parsed.value.fileSize.toString(),
      expiresInSeconds: 60 * 10
    }
  });

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

router.post("/multipart/start", async (request: AuthenticatedRequest, response) => {
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

  const access = await getDatasetUploadAccess(parsed.value.datasetId, user.id);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  const objectKey =
    parsed.value.objectKey ??
    buildDatasetObjectKey(access.dataset.projectId, access.dataset.id, parsed.value.fileName);
  const existingAsset = await getPrismaClient().storageAsset.findUnique({
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

  const fileSize = Number(parsed.value.fileSize);
  const partSize = getMultipartPartSize(fileSize);
  const partCount = Math.ceil(fileSize / partSize);

  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || partCount > maxMultipartParts) {
    response.status(400).json({ error: "File is too large for multipart upload." });
    return;
  }

  const client = createR2Client(config.value);
  const multipart = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.value.bucket,
      Key: objectKey,
      ContentType: parsed.value.mimeType
    })
  );

  if (!multipart.UploadId) {
    response.status(502).json({ error: "R2 did not create a multipart upload session." });
    return;
  }

  const parts = await Promise.all(
    Array.from({ length: partCount }, async (_, index) => {
      const partNumber = index + 1;
      const uploadUrl = await createMultipartPartUrl(client, {
        bucket: config.value.bucket,
        objectKey,
        partNumber,
        uploadId: multipart.UploadId!
      });

      return {
        expiresInSeconds: multipartUrlExpiresInSeconds,
        headers: {},
        method: "PUT" as const,
        partNumber,
        uploadUrl
      };
    })
  );

  void saveAuditLog({
    action: "asset.multipart_upload.started",
    organizationId: access.dataset.organizationId,
    projectId: access.dataset.projectId,
    userId: user.id,
    entityType: "dataset",
    entityId: access.dataset.id,
    metadata: {
      requestId: getRequestId(request),
      bucket: config.value.bucket,
      objectKey,
      uploadId: multipart.UploadId,
      fileName: parsed.value.fileName,
      mimeType: parsed.value.mimeType,
      fileSize: parsed.value.fileSize.toString(),
      partCount,
      partSize
    }
  });

  response.status(201).json({
    upload: {
      bucket: config.value.bucket,
      objectKey,
      uploadId: multipart.UploadId,
      partSize,
      partCount,
      expiresInSeconds: multipartUrlExpiresInSeconds,
      parts
    },
    asset: {
      datasetId: access.dataset.id,
      bucket: config.value.bucket,
      objectKey,
      fileName: parsed.value.fileName,
      mimeType: parsed.value.mimeType,
      fileSize: parsed.value.fileSize.toString()
    }
  });
});

router.post("/multipart/part-url", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseMultipartPartUrlBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    response.status(503).json({ error: config.error });
    return;
  }

  if (parsed.value.bucket !== config.value.bucket) {
    response.status(400).json({ error: "Multipart upload bucket does not match the configured R2 bucket." });
    return;
  }

  const access = await getDatasetUploadAccess(parsed.value.datasetId, user.id);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  const client = createR2Client(config.value);
  const uploadUrl = await createMultipartPartUrl(client, {
    bucket: parsed.value.bucket,
    objectKey: parsed.value.objectKey,
    partNumber: parsed.value.partNumber,
    uploadId: parsed.value.uploadId
  });

  response.status(200).json({
    expiresInSeconds: multipartUrlExpiresInSeconds,
    headers: {},
    method: "PUT",
    partNumber: parsed.value.partNumber,
    uploadUrl
  });
});

router.post("/multipart/complete", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseMultipartCompleteBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    response.status(503).json({ error: config.error });
    return;
  }

  if (parsed.value.bucket !== config.value.bucket) {
    response.status(400).json({ error: "Multipart upload bucket does not match the configured R2 bucket." });
    return;
  }

  const access = await getDatasetUploadAccess(parsed.value.datasetId, user.id);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  const existingAsset = await getPrismaClient().storageAsset.findUnique({
    where: {
      provider_bucket_objectKey: {
        provider: StorageProvider.R2,
        bucket: parsed.value.bucket,
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

  const client = createR2Client(config.value);
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: parsed.value.bucket,
      Key: parsed.value.objectKey,
      UploadId: parsed.value.uploadId,
      MultipartUpload: {
        Parts: parsed.value.parts.map((part) => ({
          ETag: part.etag,
          PartNumber: part.partNumber
        }))
      }
    })
  );

  void saveAuditLog({
    action: "asset.multipart_upload.completed",
    organizationId: access.dataset.organizationId,
    projectId: access.dataset.projectId,
    userId: user.id,
    entityType: "dataset",
    entityId: access.dataset.id,
    metadata: {
      requestId: getRequestId(request),
      bucket: parsed.value.bucket,
      objectKey: parsed.value.objectKey,
      uploadId: parsed.value.uploadId,
      partCount: parsed.value.parts.length
    }
  });

  response.status(200).json({
    bucket: parsed.value.bucket,
    objectKey: parsed.value.objectKey
  });
});

router.post("/multipart/abort", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseMultipartAbortBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    response.status(503).json({ error: config.error });
    return;
  }

  if (parsed.value.bucket !== config.value.bucket) {
    response.status(400).json({ error: "Multipart upload bucket does not match the configured R2 bucket." });
    return;
  }

  const access = await getDatasetUploadAccess(parsed.value.datasetId, user.id);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  const client = createR2Client(config.value);
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: parsed.value.bucket,
      Key: parsed.value.objectKey,
      UploadId: parsed.value.uploadId
    })
  );

  void saveAuditLog({
    action: "asset.multipart_upload.aborted",
    organizationId: access.dataset.organizationId,
    projectId: access.dataset.projectId,
    userId: user.id,
    entityType: "dataset",
    entityId: access.dataset.id,
    metadata: {
      requestId: getRequestId(request),
      bucket: parsed.value.bucket,
      objectKey: parsed.value.objectKey,
      uploadId: parsed.value.uploadId
    }
  });

  response.status(200).json({ ok: true });
});

router.post("/delete", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseDeleteAssetsBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const assets = await prisma.storageAsset.findMany({
    where: parsed.value.assetIds
      ? {
          id: {
            in: parsed.value.assetIds
          }
        }
      : {
          datasetId: parsed.value.datasetId,
          objectKey: {
            startsWith: parsed.value.folderPrefix
          }
        },
    include: {
      project: {
        select: {
          id: true,
          createdById: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 1001
  });

  if (assets.length === 0) {
    response.status(404).json({ error: "No registered assets matched this delete request." });
    return;
  }

  if (assets.length > 1000) {
    response.status(400).json({ error: "Delete up to 1000 registered assets at a time." });
    return;
  }

  const projectIds = [
    ...new Set(
      assets
        .map((asset) => asset.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string" && projectId.length > 0)
    )
  ];
  const organizationIds = [
    ...new Set(
      assets
        .map((asset) => asset.organizationId)
        .filter((organizationId): organizationId is string => typeof organizationId === "string" && organizationId.length > 0)
    )
  ];
  const [memberships, organizationMemberships] = await Promise.all([
    prisma.projectMembership.findMany({
      where: {
        userId: user.id,
        projectId: {
          in: projectIds
        },
        status: "ACTIVE"
      },
      select: {
        projectId: true,
        role: true
      }
    }),
    prisma.membership.findMany({
      where: {
        userId: user.id,
        organizationId: {
          in: organizationIds
        },
        status: "ACTIVE"
      },
      select: {
        organizationId: true,
        role: true
      }
    })
  ]);
  const manageableProjectIds = new Set(
    memberships.filter((membership) => canManageAssets(membership)).map((membership) => membership.projectId)
  );
  const manageableOrganizationIds = new Set(
    organizationMemberships
      .filter((membership) => canManageAssets(membership))
      .map((membership) => membership.organizationId)
  );
  const unauthorizedAsset = assets.find((asset) => {
    if (!asset.projectId || !asset.project) {
      return true;
    }

    return (
      asset.project.createdById !== user.id &&
      !manageableProjectIds.has(asset.projectId) &&
      !manageableOrganizationIds.has(asset.organizationId)
    );
  });

  if (unauthorizedAsset) {
    response.status(403).json({ error: "You need owner, admin, or manager access to delete these assets." });
    return;
  }

  const r2Assets = assets.filter((asset) => asset.provider === StorageProvider.R2);

  if (r2Assets.length > 0) {
    const config = getR2Config();

    if (!config.ok) {
      response.status(503).json({ error: config.error });
      return;
    }

    const client = createR2Client(config.value);
    const buckets = [...new Set(r2Assets.map((asset) => asset.bucket))];

    for (const bucket of buckets) {
      const bucketAssets = r2Assets.filter((asset) => asset.bucket === bucket);
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: bucketAssets.map((asset) => ({
              Key: asset.objectKey
            })),
            Quiet: true
          }
        })
      );

      if (result.Errors && result.Errors.length > 0) {
        response.status(502).json({
          error: `R2 refused to delete ${result.Errors.length} object${result.Errors.length === 1 ? "" : "s"}.`
        });
        return;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.storageAsset.deleteMany({
      where: {
        id: {
          in: assets.map((asset) => asset.id)
        }
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: assets[0]?.organizationId,
        projectId: assets[0]?.projectId ?? undefined,
        userId: user.id,
        action: "asset.deleted",
        entityType: parsed.value.folderPrefix ? "storage_asset_folder" : "storage_asset",
        entityId: parsed.value.folderPrefix ?? assets[0]?.id,
        metadata: {
          requestId: getRequestId(request),
          deletedCount: assets.length,
          assetIds: assets.map((asset) => asset.id),
          folderPrefix: parsed.value.folderPrefix,
          datasetId: parsed.value.datasetId
        }
      }
    });

    const datasetIds = [
      ...new Set(
        assets
          .map((asset) => asset.datasetId)
          .filter((datasetId): datasetId is string => typeof datasetId === "string" && datasetId.length > 0)
      )
    ];

    for (const datasetId of datasetIds) {
      await recordDatasetVersionChange(tx, {
        datasetId,
        reason: "assets_deleted",
        summary: {
          deletedCount: assets.filter((asset) => asset.datasetId === datasetId).length
        },
        userId: user.id
      });
    }
  });

  response.status(200).json({
    deletedCount: assets.length
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
          name: true,
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await getEffectiveAssetManagerMembership(user.id, dataset.projectId, dataset.organizationId);

  if (dataset.project.createdById !== user.id && (!membership || !canManageAssets(membership))) {
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
          source: "r2-registration",
          ...parsed.value.metadata
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

    await recordDatasetVersionChange(tx, {
      datasetId: dataset.id,
      reason: "asset_registered",
      summary: {
        fileName: createdAsset.fileName,
        mimeType: createdAsset.mimeType
      },
      userId: user.id
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
      metadata?: unknown;
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

type MultipartPartUrlBody =
  | {
      bucket?: unknown;
      datasetId?: unknown;
      objectKey?: unknown;
      partNumber?: unknown;
      uploadId?: unknown;
    }
  | undefined;

type MultipartCompleteBody =
  | {
      bucket?: unknown;
      datasetId?: unknown;
      objectKey?: unknown;
      parts?: unknown;
      uploadId?: unknown;
    }
  | undefined;

type MultipartAbortBody =
  | {
      bucket?: unknown;
      datasetId?: unknown;
      objectKey?: unknown;
      uploadId?: unknown;
    }
  | undefined;

type DeleteAssetsBody =
  | {
      assetIds?: unknown;
      datasetId?: unknown;
      folderPrefix?: unknown;
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
        metadata?: Prisma.InputJsonObject;
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
  const metadata = parseMetadata(body?.metadata);

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
      duration,
      metadata
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

export function parseMultipartPartUrlBody(body: MultipartPartUrlBody):
  | {
      ok: true;
      value: {
        bucket: string;
        datasetId: string;
        objectKey: string;
        partNumber: number;
        uploadId: string;
      };
    }
  | { ok: false; error: string } {
  const parsed = parseMultipartSessionBody(body);

  if (!parsed.ok) {
    return parsed;
  }

  const partNumber = parsePositiveInteger(body?.partNumber);

  if (!partNumber || partNumber > maxMultipartParts) {
    return { ok: false, error: "Multipart part number is required." };
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      partNumber
    }
  };
}

export function parseMultipartCompleteBody(body: MultipartCompleteBody):
  | {
      ok: true;
      value: {
        bucket: string;
        datasetId: string;
        objectKey: string;
        parts: { etag: string; partNumber: number }[];
        uploadId: string;
      };
    }
  | { ok: false; error: string } {
  const parsed = parseMultipartSessionBody(body);

  if (!parsed.ok) {
    return parsed;
  }

  if (!Array.isArray(body?.parts) || body.parts.length === 0 || body.parts.length > maxMultipartParts) {
    return { ok: false, error: "Completed multipart parts are required." };
  }

  const parts = body.parts.map((part) => {
    if (!part || typeof part !== "object") {
      return null;
    }

    const record = part as Record<string, unknown>;
    const partNumber = parsePositiveInteger(record.partNumber);
    const etag = normalizeText(record.etag);

    return partNumber && etag ? { etag: normalizeEtag(etag), partNumber } : null;
  });

  if (parts.some((part) => part === null)) {
    return { ok: false, error: "Each completed multipart part needs a part number and ETag." };
  }

  const sortedParts = (parts as { etag: string; partNumber: number }[]).sort((first, second) => first.partNumber - second.partNumber);
  const uniquePartNumbers = new Set(sortedParts.map((part) => part.partNumber));

  if (uniquePartNumbers.size !== sortedParts.length) {
    return { ok: false, error: "Multipart part numbers must be unique." };
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      parts: sortedParts
    }
  };
}

function parseMultipartAbortBody(body: MultipartAbortBody) {
  return parseMultipartSessionBody(body);
}

function parseMultipartSessionBody(body: MultipartPartUrlBody | MultipartCompleteBody | MultipartAbortBody):
  | {
      ok: true;
      value: {
        bucket: string;
        datasetId: string;
        objectKey: string;
        uploadId: string;
      };
    }
  | { ok: false; error: string } {
  const bucket = normalizeText(body?.bucket);
  const datasetId = normalizeId(body?.datasetId);
  const objectKey = normalizeText(body?.objectKey);
  const uploadId = normalizeText(body?.uploadId);

  if (!datasetId) {
    return { ok: false, error: "Dataset is required." };
  }

  if (!bucket) {
    return { ok: false, error: "R2 bucket is required." };
  }

  if (!objectKey || objectKey.length > 1024) {
    return { ok: false, error: "R2 object key is required." };
  }

  if (!uploadId) {
    return { ok: false, error: "Multipart upload id is required." };
  }

  return {
    ok: true,
    value: {
      bucket,
      datasetId,
      objectKey,
      uploadId
    }
  };
}

function parseMetadata(value: unknown): Prisma.InputJsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Prisma.InputJsonObject;
}

function parseDeleteAssetsBody(body: DeleteAssetsBody):
  | {
      ok: true;
      value:
        | {
            assetIds: string[];
            datasetId?: undefined;
            folderPrefix?: undefined;
          }
        | {
            assetIds?: undefined;
            datasetId: string;
            folderPrefix: string;
          };
    }
  | { ok: false; error: string } {
  const assetIds = Array.isArray(body?.assetIds)
    ? [
        ...new Set(
          body.assetIds
            .map((assetId) => normalizeId(assetId))
            .filter((assetId): assetId is string => Boolean(assetId))
        )
      ]
    : undefined;
  const datasetId = normalizeId(body?.datasetId);
  const folderPrefix = normalizeFolderPrefix(body?.folderPrefix);

  if (assetIds && assetIds.length > 0) {
    if (assetIds.length > 1000) {
      return { ok: false, error: "Delete up to 1000 registered assets at a time." };
    }

    return {
      ok: true,
      value: {
        assetIds
      }
    };
  }

  if (!datasetId || !folderPrefix) {
    return { ok: false, error: "Choose files or a dataset folder to delete." };
  }

  if (folderPrefix.length < 2) {
    return { ok: false, error: "Folder prefix is too short." };
  }

  return {
    ok: true,
    value: {
      datasetId,
      folderPrefix
    }
  };
}

async function getDatasetUploadAccess(datasetId: string, userId: string): Promise<
  | {
      ok: true;
      dataset: {
        id: string;
        organizationId: string;
        projectId: string;
        project: {
          createdById: string;
        };
      };
    }
  | { ok: false; error: string; status: number }
> {
  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: {
      id: datasetId
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    return { ok: false, error: "Dataset was not found.", status: 404 };
  }

  const uploadMembership = await getEffectiveAssetManagerMembership(userId, dataset.projectId, dataset.organizationId);

  if (dataset.project.createdById !== userId && (!uploadMembership || !canManageAssets(uploadMembership))) {
    return {
      ok: false,
      error: "You need owner, admin, or manager access to upload assets to this dataset.",
      status: 403
    };
  }

  return { ok: true, dataset };
}

async function getEffectiveAssetManagerMembership(userId: string, projectId: string, organizationId: string) {
  const prisma = getPrismaClient();
  const [organizationMembership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        organizationId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        projectId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    })
  ]);

  return getEffectiveMembershipForCapability(organizationMembership, projectMembership, canManageAssets);
}

async function createMultipartPartUrl(
  client: ReturnType<typeof createR2Client>,
  input: {
    bucket: string;
    objectKey: string;
    partNumber: number;
    uploadId: string;
  }
) {
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      PartNumber: input.partNumber,
      UploadId: input.uploadId
    }),
    { expiresIn: multipartUrlExpiresInSeconds }
  );
}

export function getMultipartPartSize(fileSize: number) {
  const minimumPartSize = Math.ceil(fileSize / maxMultipartParts);

  return Math.max(multipartPartSizeBytes, minimumPartSize);
}

function normalizeEtag(value: string) {
  const trimmed = value.trim();

  return trimmed.startsWith("\"") ? trimmed : `"${trimmed.replace(/^"+|"+$/g, "")}"`;
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

function buildDatasetObjectKey(projectId: string, datasetId: string, fileName: string) {
  return [
    "dataset",
    "import",
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

function normalizeFolderPrefix(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");

  return normalized ? `${normalized}/` : undefined;
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
