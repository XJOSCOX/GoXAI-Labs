import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeDatasetVersionSnapshot } from "./datasets.js";

describe("summarizeDatasetVersionSnapshot", () => {
  it("extracts stable counters and rollback metadata from a dataset snapshot", () => {
    const summary = summarizeDatasetVersionSnapshot({
      reason: "rollback",
      summary: {
        restoredFromVersion: 2
      },
      dataset: {
        name: "Training V1",
        status: "READY"
      },
      template: {
        name: "Object Detection"
      },
      labels: [{ name: "Car" }, { name: "Person" }],
      tools: [{ tool: "BBOX", enabled: true }, { tool: "POLYGON", enabled: false }],
      assets: {
        count: 12
      },
      tasks: {
        count: 10
      }
    });

    assert.deepEqual(summary, {
      assetCount: 12,
      datasetName: "Training V1",
      datasetStatus: "READY",
      labelCount: 2,
      reason: "rollback",
      restoredFromVersion: 2,
      taskCount: 10,
      templateName: "Object Detection",
      toolCount: 1
    });
  });

  it("falls back cleanly for old or malformed snapshots", () => {
    assert.deepEqual(summarizeDatasetVersionSnapshot(null), {
      assetCount: 0,
      datasetName: "Dataset snapshot",
      datasetStatus: "DRAFT",
      labelCount: 0,
      reason: "snapshot",
      restoredFromVersion: null,
      taskCount: 0,
      templateName: null,
      toolCount: 0
    });
  });
});
