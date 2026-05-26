import { TaskStatus } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getNextTaskCursorWhere, getTaskActionUpdate, parseAnnotationBody, summarizeTaskStatsForGroups } from "./tasks.js";

describe("summarizeTaskStatsForGroups", () => {
  it("buckets pending, active, done, total, and unassigned tasks", () => {
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
      }
    ]);

    assert.deepEqual(stats, {
      active: 2,
      done: 5,
      pending: 3,
      total: 10,
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
