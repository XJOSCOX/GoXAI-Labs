import { TaskStatus } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getNextTaskCursorWhere, summarizeTaskStatsForGroups } from "./tasks.js";

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
