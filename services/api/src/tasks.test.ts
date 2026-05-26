import { TaskStatus } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTaskQueueFilterWhere,
  getDatasetGenerationConfigIssue,
  getNextTaskCursorWhere,
  getTaskActionUpdate,
  parseAnnotationBody,
  parseDatasetTaskWorkflowBody,
  parseTaskWorkflowBody,
  summarizeTaskStatsForGroups
} from "./tasks.js";

describe("summarizeTaskStatsForGroups", () => {
  it("buckets pending, active, review, approved, rejected, total, and unassigned tasks", () => {
    const stats = summarizeTaskStatsForGroups([
      {
        _count: {
          _all: 3
        },
        assignedToId: null,
        status: TaskStatus.PENDING
      },
      {
        _count: {
          _all: 2
        },
        assignedToId: "user-1",
        status: TaskStatus.IN_PROGRESS
      },
      {
        _count: {
          _all: 4
        },
        assignedToId: "user-2",
        status: TaskStatus.SUBMITTED
      },
      {
        _count: {
          _all: 1
        },
        assignedToId: null,
        status: TaskStatus.APPROVED
      },
      {
        _count: {
          _all: 2
        },
        assignedToId: "user-3",
        status: TaskStatus.REJECTED
      }
    ]);

    assert.deepEqual(stats, {
      active: 2,
      approved: 1,
      done: 1,
      pending: 3,
      rejected: 2,
      review: 4,
      total: 12,
      unassigned: 4
    });
  });
});

describe("getNextTaskCursorWhere", () => {
  it("moves forward in stable priority, created date, and id order", () => {
    const createdAt = new Date("2026-05-25T10:00:00.000Z");

    assert.deepEqual(getNextTaskCursorWhere({ createdAt, id: "task-2", priority: 5 }), [
      {
        priority: {
          lt: 5
        }
      },
      {
        priority: 5,
        createdAt: {
          gt: createdAt
        }
      },
      {
        createdAt,
        id: {
          gt: "task-2"
        },
        priority: 5
      }
    ]);
  });
});

describe("getDatasetGenerationConfigIssue", () => {
  const readyDataset = {
    labelingConfig: {
      labels: ["Car"],
      tools: ["BBOX"]
    },
    labels: [{ id: "label-1" }],
    metadata: {
      taskWorkflowDefaults: {
        assignmentMode: "unassigned",
        assigneeIds: [],
        assignedToId: null,
        dueAt: null,
        priority: 0,
        reviewerId: null
      }
    },
    tools: [{ enabled: true }]
  };

  it("allows task generation when controller and template configs are saved", () => {
    assert.equal(getDatasetGenerationConfigIssue(readyDataset), null);
  });

  it("requires saved controller defaults", () => {
    assert.equal(
      getDatasetGenerationConfigIssue({
        ...readyDataset,
        metadata: {}
      }),
      "Apply a controller config before generating tasks."
    );
  });

  it("requires template labels, tools, and labeling config", () => {
    assert.equal(
      getDatasetGenerationConfigIssue({
        ...readyDataset,
        labels: [],
        labelingConfig: null
      }),
      "Apply a template config before generating tasks."
    );
  });
});

describe("buildTaskQueueFilterWhere", () => {
  it("builds assignment, status, priority, due, and search filters", () => {
    const now = new Date("2026-05-26T12:00:00.000Z");

    assert.deepEqual(
      buildTaskQueueFilterWhere(
        {
          assignment: "mine",
          due: "soon",
          minPriority: 3,
          search: "invoice",
          status: TaskStatus.IN_PROGRESS
        },
        {
          now,
          userId: "user-1"
        }
      ),
      {
        assignedToId: "user-1",
        dueAt: {
          gte: now,
          lte: new Date("2026-05-27T12:00:00.000Z")
        },
        OR: [
          {
            asset: {
              fileName: {
                contains: "invoice",
                mode: "insensitive"
              }
            }
          },
          {
            dataset: {
              name: {
                contains: "invoice",
                mode: "insensitive"
              }
            }
          },
          {
            project: {
              name: {
                contains: "invoice",
                mode: "insensitive"
              }
            }
          }
        ],
        priority: {
          gte: 3
        },
        status: TaskStatus.IN_PROGRESS
      }
    );
  });
});

describe("getTaskActionUpdate", () => {
  it("lets rejected tasks return to in-progress for revision", () => {
    assert.deepEqual(getTaskActionUpdate({ assignedToId: "user-1", status: TaskStatus.REJECTED }, "start", "user-1"), {
      ok: true,
      data: {
        assignedToId: "user-1",
        status: TaskStatus.IN_PROGRESS
      }
    });
  });
});

describe("parseTaskWorkflowBody", () => {
  it("normalizes manager queue updates", () => {
    const parsed = parseTaskWorkflowBody({
      assignedToId: "user-1",
      dueAt: "2026-05-26T12:00:00.000Z",
      priority: "7",
      reviewerId: ""
    });

    assert.equal(parsed.ok, true);

    if (!parsed.ok) {
      return;
    }

    assert.deepEqual(parsed.value, {
      assignedToId: "user-1",
      dueAt: new Date("2026-05-26T12:00:00.000Z"),
      priority: 7,
      reviewerId: null
    });
  });

  it("rejects invalid priorities", () => {
    const parsed = parseTaskWorkflowBody({
      priority: 11
    });

    assert.equal(parsed.ok, false);
  });

  it("rejects malformed member ids", () => {
    const parsed = parseTaskWorkflowBody({
      assignedToId: 12
    });

    assert.equal(parsed.ok, false);
  });
});

describe("parseDatasetTaskWorkflowBody", () => {
  it("normalizes round-robin dataset defaults", () => {
    const parsed = parseDatasetTaskWorkflowBody(
      {
        assignmentMode: "round_robin",
        assigneeIds: ["user-1", "user-2", "user-1"],
        dueAt: "2026-05-27T16:00:00.000Z",
        priority: "10",
        reviewerId: "reviewer-1",
        saveDefaults: true
      },
      { requireWorkflow: true }
    );

    assert.equal(parsed.ok, true);

    if (!parsed.ok) {
      return;
    }

    assert.equal(parsed.saveDefaults, true);
    assert.deepEqual(parsed.value, {
      assignedToId: null,
      assigneeIds: ["user-1", "user-2"],
      assignmentMode: "round_robin",
      dueAt: new Date("2026-05-27T16:00:00.000Z"),
      priority: 10,
      reviewerId: "reviewer-1"
    });
  });

  it("rejects round-robin workflow without annotators", () => {
    const parsed = parseDatasetTaskWorkflowBody(
      {
        assignmentMode: "round_robin",
        assigneeIds: []
      },
      { requireWorkflow: true }
    );

    assert.equal(parsed.ok, false);
  });

  it("uses saved defaults when generating tasks without explicit workflow fields", () => {
    const fallback = {
      assignedToId: "user-1",
      assigneeIds: [],
      assignmentMode: "single" as const,
      dueAt: new Date("2026-05-28T12:00:00.000Z"),
      priority: 10,
      reviewerId: null
    };
    const parsed = parseDatasetTaskWorkflowBody({}, { fallback, requireWorkflow: false });

    assert.equal(parsed.ok, true);

    if (!parsed.ok) {
      return;
    }

    assert.equal(parsed.saveDefaults, false);
    assert.deepEqual(parsed.value, fallback);
  });
});

describe("parseAnnotationBody", () => {
  it("keeps PDF page and source metadata on saved regions", () => {
    const parsed = parseAnnotationBody({
      regions: [
        {
          geometry: {
            height: 0.2,
            ocrBlockId: "word-17",
            page: 3,
            sourceName: "pdf",
            text: "Invoice total $124.50",
            width: 0.4,
            x: 0.1,
            y: 0.2
          },
          label: "Invoice total",
          type: "BBOX"
        },
        {
          geometry: {
            page: 4,
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.3, y: 0.1 },
              { x: 0.2, y: 0.3 }
            ],
            sourceName: "pdf"
          },
          label: "Signature",
          type: "POLYGON"
        }
      ],
      results: []
    });

    assert.equal(parsed.ok, true);

    if (!parsed.ok) {
      return;
    }

    assert.deepEqual(parsed.value.regions[0]?.geometryJson, {
      height: 0.2,
      ocrBlockId: "word-17",
      page: 3,
      sourceName: "pdf",
      text: "Invoice total $124.50",
      width: 0.4,
      x: 0.1,
      y: 0.2
    });
    assert.deepEqual(parsed.value.regions[0]?.metadata, {
      ocrBlockId: "word-17",
      page: 3,
      sourceName: "pdf",
      text: "Invoice total $124.50",
      tool: "bbox"
    });
    assert.deepEqual(parsed.value.regions[1]?.geometryJson, {
      page: 4,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.2, y: 0.3 }
      ],
      sourceName: "pdf"
    });
  });
});
