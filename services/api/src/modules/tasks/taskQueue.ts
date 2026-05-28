import { AIJobStatus, getPrismaClient, Prisma, ReviewStatus, TaskStatus, type Task } from "@goxai/database";
import { normalizeInteger, normalizeShortText, parseTaskStatusQuery } from "./taskValidation.js";

export type TaskQueueFilters = {
  assignment?: "mine" | "unassigned";
  due?: "overdue" | "soon" | "none";
  minPriority?: number;
  quality?: "ai_assisted" | "ai_edited" | "ai_low_confidence" | "disagreement" | "due_soon" | "missing_review" | "needs_fixes" | "overdue" | "sampled" | "urgent_priority";
  search?: string;
  status?: TaskStatus;
};

export function buildTaskQueueFilterWhere(
  filters: TaskQueueFilters,
  input: { now: Date; queue?: "review" | "work"; userId: string }
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};
  const assignmentField = input.queue === "review" ? "reviewerId" : "assignedToId";

  if (filters.assignment === "mine") {
    where[assignmentField] = input.userId;
  } else if (filters.assignment === "unassigned") {
    where[assignmentField] = null;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.minPriority !== undefined) {
    where.priority = {
      gte: filters.minPriority
    };
  }

  if (filters.due === "overdue") {
    where.dueAt = {
      lt: input.now
    };
  } else if (filters.due === "soon") {
    where.dueAt = {
      gte: input.now,
      lte: getDueSoonDate(input.now)
    };
  } else if (filters.due === "none") {
    where.dueAt = null;
  }

  if (filters.quality === "missing_review") {
    where.status = TaskStatus.SUBMITTED;
    where.reviews = {
      none: {
        status: {
          not: ReviewStatus.PENDING
        }
      }
    };
  } else if (filters.quality === "needs_fixes") {
    where.status = TaskStatus.REJECTED;
  } else if (filters.quality === "sampled") {
    where.metadata = {
      path: ["qualitySampled"],
      equals: true
    };
  } else if (filters.quality === "disagreement") {
    where.metadata = {
      path: ["qualityLowAgreement"],
      equals: true
    };
  } else if (filters.quality === "overdue") {
    where.dueAt = {
      lt: input.now
    };
  } else if (filters.quality === "due_soon") {
    where.dueAt = {
      gte: input.now,
      lte: getDueSoonDate(input.now)
    };
  } else if (filters.quality === "urgent_priority") {
    where.priority = {
      gte: 10
    };
  } else if (filters.quality === "ai_assisted") {
    addTaskWhereAnd(where, getAIAssistedTaskWhere());
  } else if (filters.quality === "ai_edited") {
    addTaskWhereAnd(where, {
      annotations: {
        some: {
          regions: {
            some: {
              metadata: {
                path: ["aiEdited"],
                equals: true
              }
            }
          }
        }
      }
    });
  } else if (filters.quality === "ai_low_confidence") {
    addTaskWhereAnd(where, {
      annotations: {
        some: {
          regions: {
            some: {
              AND: [
                getAIRegionWhere(),
                {
                  confidence: {
                    lt: 0.75
                  }
                }
              ]
            }
          }
        }
      }
    });
  }

  if (filters.search) {
    const searchWhere: Prisma.TaskWhereInput = {
      OR: [
        {
          asset: {
            fileName: {
              contains: filters.search,
              mode: "insensitive"
            }
          }
        },
        {
          dataset: {
            name: {
              contains: filters.search,
              mode: "insensitive"
            }
          }
        },
        {
          project: {
            name: {
              contains: filters.search,
              mode: "insensitive"
            }
          }
        }
      ]
    };

    if (where.AND) {
      addTaskWhereAnd(where, searchWhere);
    } else {
      where.OR = searchWhere.OR;
    }
  }

  return where;
}

function addTaskWhereAnd(where: Prisma.TaskWhereInput, condition: Prisma.TaskWhereInput) {
  const existing = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [...existing, condition];
}

function getAIAssistedTaskWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      {
        aiJobs: {
          some: {
            status: AIJobStatus.COMPLETED
          }
        }
      },
      {
        annotations: {
          some: {
            regions: {
              some: getAIRegionWhere()
            }
          }
        }
      }
    ]
  };
}

function getAIRegionWhere(): Prisma.AnnotationRegionWhereInput {
  return {
    metadata: {
      path: ["source"],
      equals: "ai_prediction"
    }
  };
}

export function getDueSoonDate(now: Date) {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export function createTaskFolderCounters() {
  return {
    active: 0,
    approved: 0,
    done: 0,
    pending: 0,
    rejected: 0,
    review: 0,
    total: 0,
    unassigned: 0
  };
}

export function summarizeTaskStatsForGroups(
  statusGroups: { _count: { _all: number }; assignedToId: string | null; status: TaskStatus }[]
) {
  const counters = createTaskFolderCounters();

  for (const group of statusGroups) {
    addTaskFolderCount(counters, {
      assignedToId: group.assignedToId,
      count: group._count._all,
      status: group.status
    });
  }

  return counters;
}

export function addTaskFolderCount(
  counters: ReturnType<typeof createTaskFolderCounters>,
  input: { assignedToId: string | null; count: number; status: TaskStatus }
) {
  counters.total += input.count;

  if (!input.assignedToId) {
    counters.unassigned += input.count;
  }

  if (input.status === TaskStatus.PENDING) {
    counters.pending += input.count;
  } else if (
    input.status === TaskStatus.ASSIGNED ||
    input.status === TaskStatus.IN_PROGRESS
  ) {
    counters.active += input.count;
  } else if (input.status === TaskStatus.SUBMITTED || input.status === TaskStatus.REVIEWING) {
    counters.review += input.count;
  } else if (input.status === TaskStatus.APPROVED) {
    counters.approved += input.count;
    counters.done += input.count;
  } else if (input.status === TaskStatus.REJECTED) {
    counters.rejected += input.count;
  }
}

export function getNextTaskCursorWhere(task: Pick<Task, "createdAt" | "dueAt" | "id" | "priority">): Prisma.TaskWhereInput[] {
  const cursor: Prisma.TaskWhereInput[] = [
    {
      priority: {
        lt: task.priority
      }
    }
  ];

  if (task.dueAt) {
    cursor.push(
      {
        priority: task.priority,
        dueAt: {
          gt: task.dueAt
        }
      },
      {
        priority: task.priority,
        dueAt: null
      },
      {
        priority: task.priority,
        dueAt: task.dueAt,
        createdAt: {
          gt: task.createdAt
        }
      },
      {
        priority: task.priority,
        dueAt: task.dueAt,
        createdAt: task.createdAt,
        id: {
          gt: task.id
        }
      }
    );

    return cursor;
  }

  cursor.push(
    {
      priority: task.priority,
      dueAt: null,
      createdAt: {
        gt: task.createdAt
      }
    },
    {
      priority: task.priority,
      dueAt: null,
      createdAt: task.createdAt,
      id: {
        gt: task.id
      }
    }
  );

  return cursor;
}

export function getTaskQueueOrderBy(): Prisma.TaskOrderByWithRelationInput[] {
  return [
    {
      priority: "desc"
    },
    {
      dueAt: {
        sort: "asc",
        nulls: "last"
      }
    },
    {
      createdAt: "asc"
    },
    {
      id: "asc"
    }
  ];
}

export function parseTaskQueueFilters(query: Record<string, unknown>): TaskQueueFilters {
  const assignment = query.assignment === "mine" || query.assignment === "unassigned" ? query.assignment : undefined;
  const due = query.due === "overdue" || query.due === "soon" || query.due === "none" ? query.due : undefined;
  const minPriority = normalizeInteger(query.minPriority);
  const quality = parseTaskQualityFilter(query.quality);
  const search = normalizeShortText(query.search, 160) ?? undefined;
  const status = parseTaskStatusQuery(query.status);

  return {
    ...(assignment ? { assignment } : {}),
    ...(due ? { due } : {}),
    ...(minPriority !== undefined && minPriority >= 0 && minPriority <= 10 ? { minPriority } : {}),
    ...(quality ? { quality } : {}),
    ...(search ? { search } : {}),
    ...(status ? { status } : {})
  };
}

export async function summarizeTaskQueueQualityCounts(
  prisma: ReturnType<typeof getPrismaClient>,
  baseWhere: Prisma.TaskWhereInput,
  input: { now: Date; queue: "review" | "work"; userId: string }
) {
  const qualityFilters = [
    "missing_review",
    "sampled",
    "disagreement",
    "due_soon",
    "urgent_priority",
    "needs_fixes",
    "overdue",
    "ai_assisted",
    "ai_edited",
    "ai_low_confidence"
  ] as const;
  const entries = await Promise.all(
    qualityFilters.map(async (quality) => {
      const count = await prisma.task.count({
        where: {
          AND: [
            baseWhere,
            buildTaskQueueFilterWhere({ quality }, input)
          ]
        }
      });

      return [quality, count] as const;
    })
  );

  return Object.fromEntries(entries) as Record<typeof qualityFilters[number], number>;
}

function parseTaskQualityFilter(value: unknown) {
  return value === "ai_assisted" ||
    value === "ai_edited" ||
    value === "ai_low_confidence" ||
    value === "disagreement" ||
    value === "due_soon" ||
    value === "missing_review" ||
    value === "needs_fixes" ||
    value === "overdue" ||
    value === "sampled" ||
    value === "urgent_priority"
    ? value
    : undefined;
}
