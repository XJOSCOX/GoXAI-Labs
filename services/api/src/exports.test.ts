import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApprovedAnnotationsExportFile, buildApprovedAnnotationsExportPayload, buildExportObjectKey } from "./exports.js";

describe("buildExportObjectKey", () => {
  it("keeps dataset exports under the project and dataset scope", () => {
    assert.equal(
      buildExportObjectKey({
        datasetId: "dataset-1",
        exportJobId: "export-1",
        projectId: "project-1"
      }),
      "exports/project-1/datasets/dataset-1/export-1.json"
    );
  });

  it("keeps project exports under the project scope", () => {
    assert.equal(
      buildExportObjectKey({
        exportJobId: "export-2",
        projectId: "project-1"
      }),
      "exports/project-1/project/export-2.json"
    );
  });

  it("uses the requested format extension", () => {
    assert.equal(
      buildExportObjectKey({
        datasetId: "dataset-1",
        exportJobId: "export-3",
        format: "TSV",
        projectId: "project-1"
      }),
      "exports/project-1/datasets/dataset-1/export-3.tsv"
    );
  });

  it("uses zip extension when COCO includes source files", () => {
    assert.equal(
      buildExportObjectKey({
        datasetId: "dataset-1",
        exportJobId: "export-4",
        format: "COCO",
        includeSourceFiles: true,
        projectId: "project-1"
      }),
      "exports/project-1/datasets/dataset-1/export-4.zip"
    );
  });
});

describe("buildApprovedAnnotationsExportPayload", () => {
  it("serializes file sizes and annotation counts for approved export payloads", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: {
        id: "dataset-1",
        labelingConfig: { source: "image" },
        labels: [],
        name: "Training V1",
        tools: [],
        version: 1
      },
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Computer vision",
        organizationId: "org-1",
        slug: "computer-vision"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: 2.5,
              regions: [
                {
                  confidence: null,
                  geometryJson: {
                    height: 0.2,
                    width: 0.1,
                    x: 0.4,
                    y: 0.3
                  },
                  id: "region-1",
                  label: "Car",
                  metadata: null,
                  type: "BBOX"
                }
              ],
              resultJson: {
                results: [
                  {
                    from_name: "answer",
                    to_name: "text",
                    type: "textarea",
                    value: {
                      text: ["Short answer"]
                    }
                  }
                ]
              },
              status: "ACCEPTED",
              submittedAt: new Date("2026-05-25T12:01:00.000Z"),
              user: {
                email: "annotator@example.com",
                firstName: "A",
                id: "user-2",
                lastName: "User"
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "image.png",
            fileSize: 42n,
            height: 480,
            id: "asset-1",
            metadata: {
              data: {
                image: "datasets/image.png"
              }
            },
            mimeType: "image/png",
            objectKey: "datasets/image.png",
            width: 640
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });

    assert.equal(payload.annotationCount, 1);
    assert.equal(payload.exportedAt, "2026-05-25T12:00:00.000Z");
    assert.deepEqual(payload.tasks[0]?.data, { image: "datasets/image.png" });
    assert.equal(payload.tasks[0]?.asset?.fileSize, "42");
  });

  it("serializes CSV and JSON_MIN variants", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: null,
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Computer vision",
        organizationId: "org-1",
        slug: "computer-vision"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: 1,
              regions: [],
              resultJson: {
                results: [
                  {
                    from_name: "answer",
                    to_name: "text",
                    type: "textarea",
                    value: {
                      text: ["A summary"]
                    }
                  }
                ]
              },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: null,
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });

    const csv = buildApprovedAnnotationsExportFile({
      format: "CSV",
      payload,
      projectSlug: "computer-vision"
    });
    const jsonMin = buildApprovedAnnotationsExportFile({
      format: "JSON_MIN",
      payload,
      projectSlug: "computer-vision"
    });

    assert.match(csv.content.toString(), /task_id/);
    assert.match(csv.fileName, /\.csv$/);
    assert.deepEqual(JSON.parse(jsonMin.content.toString()), [{ answer: { text: ["A summary"] } }]);
  });

  it("serializes image annotations to COCO", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: {
        id: "dataset-1",
        labelingConfig: { source: "image" },
        labels: [
          {
            color: "#7dd3fc",
            id: "label-1",
            name: "Car",
            shortcutKey: "1"
          }
        ],
        name: "Training V1",
        tools: [],
        version: 1
      },
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Computer vision",
        organizationId: "org-1",
        slug: "computer-vision"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: null,
              regions: [
                {
                  confidence: null,
                  geometryJson: {
                    height: 0.25,
                    width: 0.5,
                    x: 0.1,
                    y: 0.2
                  },
                  id: "region-1",
                  label: "Car",
                  metadata: null,
                  type: "BBOX"
                }
              ],
              resultJson: { results: [] },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "car.png",
            fileSize: 42n,
            height: 200,
            id: "asset-1",
            metadata: null,
            mimeType: "image/png",
            objectKey: "datasets/car.png",
            width: 100
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });
    const coco = buildApprovedAnnotationsExportFile({
      format: "COCO",
      payload,
      projectSlug: "computer-vision"
    });
    const parsed = JSON.parse(coco.content.toString()) as {
      annotations: { bbox: number[]; category_id: number }[];
      categories: { name: string }[];
      images: { file_name: string; height: number; width: number }[];
    };

    assert.equal(coco.mimeType, "application/json");
    assert.deepEqual(parsed.categories.map((category) => category.name), ["Car"]);
    assert.deepEqual(parsed.images[0], { file_name: "car.png", height: 200, id: 1, width: 100 });
    assert.deepEqual(parsed.annotations[0]?.bbox, [10, 40, 50, 50]);
  });

  it("serializes COCO with source images as a zip bundle", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: null,
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Computer vision",
        organizationId: "org-1",
        slug: "computer-vision"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: null,
              regions: [
                {
                  confidence: null,
                  geometryJson: {
                    height: 0.25,
                    width: 0.5,
                    x: 0.1,
                    y: 0.2
                  },
                  id: "region-1",
                  label: "Car",
                  metadata: null,
                  type: "BBOX"
                }
              ],
              resultJson: { results: [] },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "car.png",
            fileSize: 42n,
            height: 200,
            id: "asset-1",
            metadata: null,
            mimeType: "image/png",
            objectKey: "datasets/car.png",
            width: 100
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });
    const coco = buildApprovedAnnotationsExportFile({
      format: "COCO",
      includeSourceFiles: true,
      imageFileNameByTaskId: new Map([["task-1", "car.png"]]),
      payload,
      projectSlug: "computer-vision",
      sourceFiles: {
        "images/car.png": Buffer.from("png")
      }
    });

    assert.ok(Buffer.isBuffer(coco.content));
    assert.equal(coco.content.subarray(0, 2).toString("utf8"), "PK");
    assert.equal(coco.mimeType, "application/zip");
    assert.match(coco.fileName, /coco-with-sources-.*\.zip$/);
  });

  it("serializes image annotations to YOLO and Pascal VOC zip bundles", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: null,
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Computer vision",
        organizationId: "org-1",
        slug: "computer-vision"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: null,
              regions: [
                {
                  confidence: null,
                  geometryJson: {
                    points: [
                      { x: 0.1, y: 0.1 },
                      { x: 0.4, y: 0.1 },
                      { x: 0.4, y: 0.3 }
                    ]
                  },
                  id: "region-1",
                  label: "Airplane",
                  metadata: null,
                  type: "POLYGON"
                }
              ],
              resultJson: { results: [] },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "airplane.png",
            fileSize: 42n,
            height: 200,
            id: "asset-1",
            metadata: null,
            mimeType: "image/png",
            objectKey: "datasets/airplane.png",
            width: 100
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });
    const yolo = buildApprovedAnnotationsExportFile({
      format: "YOLO",
      payload,
      projectSlug: "computer-vision"
    });
    const voc = buildApprovedAnnotationsExportFile({
      format: "PASCAL_VOC",
      payload,
      projectSlug: "computer-vision"
    });

    assert.ok(Buffer.isBuffer(yolo.content));
    assert.ok(Buffer.isBuffer(voc.content));
    assert.equal(yolo.content.subarray(0, 2).toString("utf8"), "PK");
    assert.equal(voc.content.subarray(0, 2).toString("utf8"), "PK");
    assert.match(yolo.fileName, /\.zip$/);
    assert.match(voc.fileName, /\.zip$/);
  });

  it("serializes text spans to CoNLL 2003", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: {
        id: "dataset-1",
        labelingConfig: { source: "text" },
        labels: [
          {
            color: "#7dd3fc",
            id: "label-1",
            name: "Person",
            shortcutKey: "1"
          }
        ],
        name: "Training V1",
        tools: [],
        version: 1
      },
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "NLP",
        organizationId: "org-1",
        slug: "nlp"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: null,
              regions: [
                {
                  confidence: null,
                  geometryJson: {
                    end: 10,
                    start: 0
                  },
                  id: "region-1",
                  label: "Person",
                  metadata: null,
                  type: "TEXT_SPAN"
                }
              ],
              resultJson: { results: [] },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "text-row.json",
            fileSize: 42n,
            height: null,
            id: "asset-1",
            metadata: {
              data: {
                text: "Ada Lovelace wrote notes."
              }
            },
            mimeType: "application/json",
            objectKey: "datasets/text-row.json",
            width: null
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });
    const conll = buildApprovedAnnotationsExportFile({
      format: "CONLL_2003",
      payload,
      projectSlug: "nlp"
    });

    assert.match(conll.content.toString(), /Ada B-PERSON/);
    assert.match(conll.content.toString(), /Lovelace I-PERSON/);
    assert.match(conll.fileName, /\.conll$/);
  });

  it("serializes transcript and text responses to JSONL", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: null,
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Audio",
        organizationId: "org-1",
        slug: "audio"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: null,
              regions: [],
              resultJson: {
                results: [
                  {
                    from_name: "transcription",
                    to_name: "audio",
                    type: "textarea",
                    value: {
                      text: ["hello world"]
                    }
                  }
                ]
              },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "clip.wav",
            fileSize: 42n,
            height: null,
            id: "asset-1",
            metadata: null,
            mimeType: "audio/wav",
            objectKey: "datasets/clip.wav",
            width: null
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });
    const asr = buildApprovedAnnotationsExportFile({
      format: "ASR_JSONL",
      payload,
      projectSlug: "audio"
    });
    const firstRow = JSON.parse(asr.content.toString().trim()) as { transcript: string };

    assert.equal(firstRow.transcript, "hello world");
    assert.match(asr.fileName, /\.jsonl$/);
  });

  it("keeps repeated media labels and page markers in compact exports", () => {
    const payload = buildApprovedAnnotationsExportPayload({
      dataset: null,
      exportedAt: new Date("2026-05-25T12:00:00.000Z"),
      exportJobId: "export-1",
      project: {
        createdById: "user-1",
        id: "project-1",
        name: "Media",
        organizationId: "org-1",
        slug: "media"
      },
      tasks: [
        {
          annotations: [
            {
              id: "annotation-1",
              leadTimeSeconds: null,
              regions: [],
              resultJson: {
                results: [
                  {
                    from_name: "segment",
                    to_name: "video",
                    type: "labels",
                    value: {
                      end: 2.5,
                      labels: ["Intro"],
                      start: 0.5
                    }
                  },
                  {
                    from_name: "segment",
                    to_name: "video",
                    type: "labels",
                    value: {
                      end: 5,
                      labels: ["Action"],
                      start: 3
                    }
                  },
                  {
                    from_name: "pdf_marker",
                    to_name: "pdf",
                    type: "labels",
                    value: {
                      end: 3,
                      labels: ["Invoice"],
                      page: 3,
                      start: 3
                    }
                  }
                ]
              },
              status: "ACCEPTED",
              submittedAt: null,
              user: {
                email: "annotator@example.com",
                firstName: null,
                id: "user-2",
                lastName: null
              },
              version: 1
            }
          ],
          asset: {
            bucket: "bucket",
            fileName: "clip.mp4",
            fileSize: 42n,
            height: null,
            id: "asset-1",
            metadata: null,
            mimeType: "video/mp4",
            objectKey: "datasets/clip.mp4",
            width: null
          },
          id: "task-1",
          metadata: null,
          reviews: [],
          status: "APPROVED"
        }
      ]
    });
    const jsonMin = buildApprovedAnnotationsExportFile({
      format: "JSON_MIN",
      payload,
      projectSlug: "media"
    });
    const csv = buildApprovedAnnotationsExportFile({
      format: "CSV",
      payload,
      projectSlug: "media"
    });
    const minRows = JSON.parse(jsonMin.content.toString()) as Array<{ segment: unknown; pdf_marker: { page: number } }>;

    assert.ok(Array.isArray(minRows[0].segment));
    assert.equal(minRows[0].pdf_marker.page, 3);
    assert.match(csv.content.toString(), /Intro\|Action\|Invoice/);
  });
});
