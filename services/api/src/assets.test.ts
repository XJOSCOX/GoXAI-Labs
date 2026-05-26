import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMultipartPartSize, parseMultipartCompleteBody, parseMultipartPartUrlBody } from "./assets.js";

describe("multipart upload helpers", () => {
  it("keeps multipart uploads within the S3 part limit", () => {
    const fileSize = 200 * 1024 ** 3;
    const partSize = getMultipartPartSize(fileSize);

    assert.ok(partSize >= 16 * 1024 * 1024);
    assert.ok(Math.ceil(fileSize / partSize) <= 10_000);
  });

  it("normalizes completed parts in part-number order", () => {
    const parsed = parseMultipartCompleteBody({
      bucket: "bucket",
      datasetId: "dataset-1",
      objectKey: "folder/video.mp4",
      uploadId: "upload-1",
      parts: [
        { etag: "etag-2", partNumber: 2 },
        { etag: "\"etag-1\"", partNumber: 1 }
      ]
    });

    assert.equal(parsed.ok, true);

    if (!parsed.ok) {
      return;
    }

    assert.deepEqual(parsed.value.parts, [
      { etag: "\"etag-1\"", partNumber: 1 },
      { etag: "\"etag-2\"", partNumber: 2 }
    ]);
  });

  it("rejects malformed part URL requests", () => {
    const parsed = parseMultipartPartUrlBody({
      bucket: "bucket",
      datasetId: "dataset-1",
      objectKey: "folder/video.mp4",
      uploadId: "upload-1",
      partNumber: 0
    });

    assert.equal(parsed.ok, false);
  });
});
