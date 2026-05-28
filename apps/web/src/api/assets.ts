import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { AssetAccessUrl, AssetMultipartUpload, AssetSummary, AssetUploadRequest, AssetUploadUrl, CompletedMultipartPart, CreateAssetInput, DeleteAssetsResult, MultipartUploadPartUrl } from "./types";
export async function listAssets(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/assets${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load assets."));
  }

  return ((await response.json()) as { assets: AssetSummary[] }).assets;
}

export async function createAsset(session: Session, input: CreateAssetInput) {
  const response = await authenticatedFetch(session, "/api/assets", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to register asset."));
  }

  return ((await response.json()) as { asset: AssetSummary }).asset;
}

export async function createAssetUploadUrl(session: Session, input: AssetUploadRequest) {
  const response = await authenticatedFetch(session, "/api/assets/upload-url", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create R2 upload URL."));
  }

  return (await response.json()) as AssetUploadUrl;
}

export async function startAssetMultipartUpload(session: Session, input: AssetUploadRequest) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/start", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to start multipart upload."));
  }

  return (await response.json()) as AssetMultipartUpload;
}

export async function refreshAssetMultipartPartUrl(
  session: Session,
  input: {
    bucket: string;
    datasetId: string;
    objectKey: string;
    partNumber: number;
    uploadId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/part-url", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to refresh multipart upload URL."));
  }

  return (await response.json()) as MultipartUploadPartUrl;
}

export async function completeAssetMultipartUpload(
  session: Session,
  input: {
    bucket: string;
    datasetId: string;
    objectKey: string;
    parts: CompletedMultipartPart[];
    uploadId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/complete", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to complete multipart upload."));
  }

  return (await response.json()) as { bucket: string; objectKey: string };
}

export async function abortAssetMultipartUpload(
  session: Session,
  input: {
    bucket: string;
    datasetId: string;
    objectKey: string;
    uploadId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/abort", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to abort multipart upload."));
  }

  return (await response.json()) as { ok: true };
}

export async function getAssetAccessUrl(session: Session, assetId: string) {
  const response = await authenticatedFetch(session, `/api/assets/${encodeURIComponent(assetId)}/access-url`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create asset access URL."));
  }

  return (await response.json()) as AssetAccessUrl;
}

export async function deleteAssets(
  session: Session,
  input: { assetIds?: string[]; datasetId?: string; folderPrefix?: string }
) {
  const response = await authenticatedFetch(session, "/api/assets/delete", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete assets."));
  }

  return (await response.json()) as DeleteAssetsResult;
}

export async function uploadFileToSignedUrl(
  file: File,
  upload: AssetUploadUrl["upload"],
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void
) {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open(upload.method, upload.uploadUrl);

    for (const [header, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(header, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.({
        loaded: event.loaded,
        percent: Math.round((event.loaded / event.total) * 100),
        total: event.total
      });
    };

    request.onerror = () => {
      reject(
        new Error(
          "R2 upload could not reach Cloudflare. Check the bucket CORS policy for http://localhost:5173, confirm R2_ENDPOINT uses the r2.cloudflarestorage.com endpoint, then run pnpm check:r2-cors."
        )
      );
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.({
          loaded: file.size,
          percent: 100,
          total: file.size
        });
        resolve();
        return;
      }

      reject(
        new Error(
          `R2 upload failed with status ${request.status}. Check the bucket CORS settings and R2 credentials, then run pnpm check:r2-cors.`
        )
      );
    };

    request.send(file);
  });
}

export const resumableUploadThresholdBytes = 64 * 1024 * 1024;

interface ResumableUploadRecord {
  asset: CreateAssetInput;
  completedParts: CompletedMultipartPart[];
  fileLastModified: number;
  fileName: string;
  fileSize: number;
  upload: AssetMultipartUpload["upload"];
  updatedAt: number;
}

export async function uploadFileWithResumableMultipart(
  session: Session,
  file: File,
  request: AssetUploadRequest,
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void
) {
  const storageKey = getResumableUploadStorageKey(request.datasetId, request.objectKey ?? file.name, file);
  const existingRecord = readResumableUploadRecord(storageKey, file);
  const record = existingRecord ?? await createResumableUploadRecord(session, request, storageKey, file);
  const completedParts = new Map(record.completedParts.map((part) => [part.partNumber, part]));
  const partUrls = new Map(record.upload.parts.map((part) => [part.partNumber, part]));
  let completedBytes = getCompletedMultipartBytes(completedParts, record.upload.partSize, file.size);

  onProgress?.({
    loaded: completedBytes,
    percent: Math.round((completedBytes / file.size) * 100),
    total: file.size
  });

  for (let partNumber = 1; partNumber <= record.upload.partCount; partNumber += 1) {
    if (completedParts.has(partNumber)) {
      continue;
    }

    const start = (partNumber - 1) * record.upload.partSize;
    const end = Math.min(file.size, start + record.upload.partSize);
    const blob = file.slice(start, end);
    let partUrl = partUrls.get(partNumber) ?? await refreshAssetMultipartPartUrl(session, {
      bucket: record.upload.bucket,
      datasetId: request.datasetId,
      objectKey: record.upload.objectKey,
      partNumber,
      uploadId: record.upload.uploadId
    });
    let uploadedPart: CompletedMultipartPart | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const etag = await uploadMultipartPart(blob, partUrl, (loaded) => {
          onProgress?.({
            loaded: completedBytes + loaded,
            percent: Math.round(((completedBytes + loaded) / file.size) * 100),
            total: file.size
          });
        });
        uploadedPart = { etag, partNumber };
        break;
      } catch (error) {
        if (attempt >= 2) {
          throw error;
        }

        partUrl = await refreshAssetMultipartPartUrl(session, {
          bucket: record.upload.bucket,
          datasetId: request.datasetId,
          objectKey: record.upload.objectKey,
          partNumber,
          uploadId: record.upload.uploadId
        });
      }
    }

    if (!uploadedPart) {
      throw new Error(`Part ${partNumber} did not finish uploading.`);
    }

    completedParts.set(partNumber, uploadedPart);
    completedBytes += blob.size;
    writeResumableUploadRecord(storageKey, {
      ...record,
      completedParts: Array.from(completedParts.values()).sort((first, second) => first.partNumber - second.partNumber),
      updatedAt: Date.now()
    });
  }

  await completeAssetMultipartUpload(session, {
    bucket: record.upload.bucket,
    datasetId: request.datasetId,
    objectKey: record.upload.objectKey,
    parts: Array.from(completedParts.values()).sort((first, second) => first.partNumber - second.partNumber),
    uploadId: record.upload.uploadId
  });
  clearResumableUploadRecord(storageKey);
  onProgress?.({
    loaded: file.size,
    percent: 100,
    total: file.size
  });

  return record.asset;
}

async function createResumableUploadRecord(
  session: Session,
  request: AssetUploadRequest,
  storageKey: string,
  file: File
): Promise<ResumableUploadRecord> {
  const multipart = await startAssetMultipartUpload(session, request);
  const record: ResumableUploadRecord = {
    asset: multipart.asset,
    completedParts: [],
    fileLastModified: file.lastModified,
    fileName: file.name,
    fileSize: file.size,
    upload: multipart.upload,
    updatedAt: Date.now()
  };

  writeResumableUploadRecord(storageKey, record);
  return record;
}

function uploadMultipartPart(
  blob: Blob,
  part: MultipartUploadPartUrl,
  onProgress?: (loaded: number) => void
) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open(part.method, part.uploadUrl);

    for (const [header, value] of Object.entries(part.headers)) {
      request.setRequestHeader(header, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded);
      }
    };

    request.onerror = () => {
      reject(new Error("R2 multipart upload could not reach Cloudflare. Check the bucket CORS policy and network connection."));
    };

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`R2 multipart upload failed with status ${request.status}.`));
        return;
      }

      const etag = request.getResponseHeader("ETag");

      if (!etag) {
        reject(new Error("R2 multipart upload did not expose the ETag header. Add ETag to the bucket CORS ExposeHeaders setting."));
        return;
      }

      resolve(etag);
    };

    request.send(blob);
  });
}

function getCompletedMultipartBytes(completedParts: Map<number, CompletedMultipartPart>, partSize: number, fileSize: number) {
  let total = 0;

  for (const partNumber of completedParts.keys()) {
    const start = (partNumber - 1) * partSize;
    total += Math.max(0, Math.min(fileSize - start, partSize));
  }

  return total;
}

function getResumableUploadStorageKey(datasetId: string, objectKey: string, file: File) {
  return `goxai-resumable-upload:${datasetId}:${objectKey}:${file.name}:${file.size}:${file.lastModified}`;
}

function readResumableUploadRecord(storageKey: string, file: File): ResumableUploadRecord | null {
  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return null;
    }

    const record = JSON.parse(raw) as ResumableUploadRecord;

    if (record.fileName !== file.name || record.fileSize !== file.size || record.fileLastModified !== file.lastModified) {
      return null;
    }

    return record;
  } catch {
    return null;
  }
}

function writeResumableUploadRecord(storageKey: string, record: ResumableUploadRecord) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(record));
  } catch {
    // Best effort only. Uploads still work without local resumability.
  }
}

function clearResumableUploadRecord(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Best effort only.
  }
}
