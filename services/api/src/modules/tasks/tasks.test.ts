import { AnnotationRegionType, AnnotationStatus, LedgerEntryType, ReviewStatus, TaskCreditEventType, TaskCreditStatus, TaskStatus, type Prisma } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settleTaskEscrowOnApproval } from "./taskCredits.js";
import {
  buildTaskQualityFlags,
  buildTaskQueueFilterWhere,
  getDatasetGenerationConfigIssue,
  getAnnotationApprovalCreditPoints,
  getAnnotationSubmissionCreditPoints,
  backfillReviewPaymentSettlements,
  getDatasetTaskCreditAllocation,
  getDatasetTaskEscrowEstimate,
  getDatasetWorkflowAssignments,
  getNextTaskCursorWhere,
  getReviewCreditPoints,
  getTaskActionUpdate,
  isConsensusBelowPolicy,
  parseAnnotationBody,
  parseDatasetTaskWorkflowBody,
  parseTaskWorkflowBody,
  summarizeReviewQuality,
  summarizeTaskConsensus,
  summarizeTaskStatsForGroups
} from "./tasks.js";

describe("backfillReviewPaymentSettlements", () => {
  it("adds payment settlement metadata from existing task ledger entries", () => {
    const reviews = backfillReviewPaymentSettlements([
      {
        id: "review-1",
        metadata: {}
      }
    ], {
      task: {
        metadata: {
          paymentCurrency: "USD"
        }
      },
      ledgerEntries: [
        {
          currency: "USD",
          metadata: {
            approvedCredits: 28,
            reviewId: "review-1"
          },
          type: LedgerEntryType.RELEASE
        },
        {
          currency: "USD",
          metadata: {
            feeCredits: 12,
            reviewId: "review-1"
          },
          type: LedgerEntryType.FEE
        }
      ]
    });

    assert.deepEqual(reviews[0]?.metadata, {
      paymentSettlement: {
        approvedCredits: 28,
        currency: "USD",
        escrowCredits: 40,
        feeCredits: 12,
        refundCredits: 0
      }
    });
  });

  it("keeps existing review payment settlement metadata", () => {
    const reviews = backfillReviewPaymentSettlements([
      {
        id: "review-1",
        metadata: {
          paymentSettlement: {
            approvedCredits: 1,
            currency: "USD",
            escrowCredits: 1,
            feeCredits: 0,
            refundCredits: 0
          }
        }
      }
    ], {
      task: {
        metadata: {}
      },
      ledgerEntries: [
        {
          currency: "USD",
          metadata: {
            approvedCredits: 28,
            reviewId: "review-1"
          },
          type: LedgerEntryType.RELEASE
        }
      ]
    });

    assert.deepEqual(reviews[0]?.metadata, {
      paymentSettlement: {
        approvedCredits: 1,
        currency: "USD",
        escrowCredits: 1,
        feeCredits: 0,
        refundCredits: 0
      }
    });
  });
});

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
  it("moves forward in stable priority, due date, created date, and id order", () => {
    const createdAt = new Date("2026-05-25T10:00:00.000Z");
    const dueAt = new Date("2026-05-26T10:00:00.000Z");

    assert.deepEqual(getNextTaskCursorWhere({ createdAt, dueAt, id: "task-2", priority: 5 }), [
      {
        priority: {
          lt: 5
        }
      },
      {
        priority: 5,
        dueAt: {
          gt: dueAt
        }
      },
      {
        priority: 5,
        dueAt: null
      },
      {
        priority: 5,
        dueAt,
        createdAt: {
          gt: createdAt
        }
      },
      {
        priority: 5,
        dueAt,
        createdAt,
        id: {
          gt: "task-2"
        }
      }
    ]);
  });

  it("moves forward among undated tasks after dated tasks", () => {
    const createdAt = new Date("2026-05-25T10:00:00.000Z");

    assert.deepEqual(getNextTaskCursorWhere({ createdAt, dueAt: null, id: "task-2", priority: 5 }), [
      {
        priority: {
          lt: 5
        }
      },
      {
        priority: 5,
        dueAt: null,
        createdAt: {
          gt: createdAt
        }
      },
      {
        priority: 5,
        dueAt: null,
        createdAt,
        id: {
          gt: "task-2"
        }
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

describe("getDatasetTaskEscrowEstimate", () => {
  it("holds annotation and review credits when a reviewer is configured", () => {
    assert.deepEqual(
      getDatasetTaskEscrowEstimate(
        3,
        { reviewerId: "reviewer-1" },
        { annotationCredits: 250, currency: "USD", datasetBudgetCredits: 900, reviewBudgetShare: 0.17, reviewCredits: 50, taskBudgetBasis: 3 }
      ),
      {
        amount: "9.00",
        credits: 900,
        currency: "USD"
      }
    );
  });

  it("does not include review credits when no reviewer is configured", () => {
    assert.deepEqual(
      getDatasetTaskEscrowEstimate(
        2,
        { reviewerId: null },
        { annotationCredits: 100, currency: "USD", datasetBudgetCredits: 250, reviewBudgetShare: 0.2, reviewCredits: 25, taskBudgetBasis: 2 }
      ),
      {
        amount: "2.50",
        credits: 250,
        currency: "USD"
      }
    );
  });

  it("distributes leftover budget credits across tasks instead of leaving them unreserved", () => {
    const paymentPolicy = {
      annotationCredits: 7,
      currency: "USD",
      datasetBudgetCredits: 1500,
      reviewBudgetShare: 0,
      reviewCredits: 0,
      taskBudgetBasis: 202
    };

    assert.deepEqual(getDatasetTaskEscrowEstimate(202, { reviewerId: null }, paymentPolicy), {
      amount: "15.00",
      credits: 1500,
      currency: "USD"
    });
    assert.deepEqual(getDatasetTaskCreditAllocation(0, { reviewerId: null }, paymentPolicy), {
      annotationCredits: 8,
      credits: 8,
      platformFeeCredits: 0,
      reviewCredits: 0,
      workerCredits: 8
    });
    assert.deepEqual(getDatasetTaskCreditAllocation(85, { reviewerId: null }, paymentPolicy), {
      annotationCredits: 8,
      credits: 8,
      platformFeeCredits: 0,
      reviewCredits: 0,
      workerCredits: 8
    });
    assert.deepEqual(getDatasetTaskCreditAllocation(86, { reviewerId: null }, paymentPolicy), {
      annotationCredits: 7,
      credits: 7,
      platformFeeCredits: 0,
      reviewCredits: 0,
      workerCredits: 7
    });
  });

  it("keeps dataset budgets as gross creator spend when platform fees are enabled", () => {
    const paymentPolicy = {
      annotationCredits: 0,
      currency: "USD",
      datasetBudgetCredits: 100,
      platformFeeRate: 0.3,
      reviewBudgetShare: 0,
      reviewCredits: 0,
      taskBudgetBasis: 2
    };

    assert.deepEqual(getDatasetTaskEscrowEstimate(2, { reviewerId: null }, paymentPolicy), {
      amount: "1.00",
      credits: 100,
      currency: "USD"
    });
    assert.deepEqual(getDatasetTaskCreditAllocation(0, { reviewerId: null }, paymentPolicy), {
      annotationCredits: 35,
      credits: 50,
      platformFeeCredits: 15,
      reviewCredits: 0,
      workerCredits: 35
    });
  });

  it("adds platform fees on top of explicit per-task worker pay", () => {
    const paymentPolicy = {
      annotationCredits: 70,
      currency: "USD",
      datasetBudgetCredits: 0,
      platformFeeRate: 0.3,
      reviewBudgetShare: 0.3,
      reviewCredits: 30,
      taskBudgetBasis: 1
    };

    assert.deepEqual(getDatasetTaskCreditAllocation(0, { reviewerId: "reviewer-1" }, paymentPolicy), {
      annotationCredits: 70,
      credits: 130,
      platformFeeCredits: 30,
      reviewCredits: 30,
      workerCredits: 100
    });
  });

  it("charges the configured posting fee for free tasks", () => {
    const paymentPolicy = {
      annotationCredits: 0,
      currency: "USD",
      datasetBudgetCredits: 0,
      freeTaskPostingFeeCredits: 25,
      platformFeeRate: 0.3,
      reviewBudgetShare: 0,
      reviewCredits: 0,
      taskBudgetBasis: 1
    };

    assert.deepEqual(getDatasetTaskCreditAllocation(0, { reviewerId: null }, paymentPolicy), {
      annotationCredits: 0,
      credits: 25,
      platformFeeCredits: 25,
      reviewCredits: 0,
      workerCredits: 0
    });
  });
});

describe("summarizeReviewQuality", () => {
  const project = {
    id: "project-1",
    name: "Computer vision"
  };
  const dataset = {
    id: "dataset-1",
    metadata: {},
    name: "Training V1"
  };
  const annotatorOne = {
    email: "one@example.com",
    firstName: "One",
    id: "annotator-1",
    lastName: "Annotator"
  };
  const annotatorTwo = {
    email: "two@example.com",
    firstName: "Two",
    id: "annotator-2",
    lastName: "Annotator"
  };
  const reviewer = {
    email: "reviewer@example.com",
    firstName: "Quality",
    id: "reviewer-1",
    lastName: "Reviewer"
  };

  it("builds sampling, consensus, rejection, annotator, and dataset quality metrics", () => {
    const createdAt = new Date("2026-05-26T12:00:00.000Z");
    const reviews = [
      {
        annotation: {
          leadTimeSeconds: 40,
          user: annotatorOne
        },
        createdAt,
        metadata: {
          reason: "bad_boundary",
          severity: "high"
        },
        reviewer,
        score: 2,
        status: ReviewStatus.NEEDS_CHANGES,
        task: {
          dataset,
          project
        }
      },
      {
        annotation: {
          leadTimeSeconds: 25,
          user: annotatorTwo
        },
        createdAt,
        metadata: {},
        reviewer,
        score: 5,
        status: ReviewStatus.APPROVED,
        task: {
          dataset,
          project
        }
      }
    ];
    const tasks = [
      {
        annotations: [
          {
            createdAt,
            leadTimeSeconds: 40,
            regions: [
              {
                confidence: null,
                geometryJson: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
                label: "Car",
                metadata: {},
                type: AnnotationRegionType.BBOX
              }
            ],
            resultJson: { results: [] },
            status: AnnotationStatus.SUBMITTED,
            submittedAt: createdAt,
            user: annotatorOne,
            userId: annotatorOne.id,
            version: 1
          },
          {
            createdAt,
            leadTimeSeconds: 25,
            regions: [
              {
                confidence: null,
                geometryJson: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
                label: "Truck",
                metadata: {},
                type: AnnotationRegionType.BBOX
              }
            ],
            resultJson: { results: [] },
            status: AnnotationStatus.SUBMITTED,
            submittedAt: createdAt,
            user: annotatorTwo,
            userId: annotatorTwo.id,
            version: 1
          }
        ],
        asset: {
          fileName: "asset-1.png"
        },
        createdAt,
        dataset,
        dueAt: null,
        id: "task-1",
        priority: 7,
        project,
        reviews: [
          {
            id: "review-1",
            status: ReviewStatus.NEEDS_CHANGES
          }
        ],
        status: TaskStatus.REJECTED
      },
      {
        annotations: [
          {
            createdAt,
            leadTimeSeconds: 30,
            regions: [
              {
                confidence: null,
                geometryJson: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
                label: "Car",
                metadata: {},
                type: AnnotationRegionType.BBOX
              }
            ],
            resultJson: { results: [] },
            status: AnnotationStatus.SUBMITTED,
            submittedAt: createdAt,
            user: annotatorTwo,
            userId: annotatorTwo.id,
            version: 1
          }
        ],
        asset: {
          fileName: "asset-2.png"
        },
        createdAt,
        dataset,
        dueAt: null,
        id: "task-2",
        priority: 2,
        project,
        reviews: [],
        status: TaskStatus.SUBMITTED
      }
    ];

    const quality = summarizeReviewQuality(reviews, tasks, [
      {
        amount: "0.11",
        credits: 11,
        createdAt,
        dataset,
        eventType: TaskCreditEventType.ANNOTATION_SUBMITTED,
        points: 11,
        project,
        status: TaskCreditStatus.UNDER_REVIEW,
        user: annotatorOne,
        userId: annotatorOne.id
      },
      {
        amount: "0.20",
        credits: 20,
        createdAt,
        dataset,
        eventType: TaskCreditEventType.ANNOTATION_APPROVED,
        points: 20,
        project,
        status: TaskCreditStatus.APPROVED,
        user: annotatorTwo,
        userId: annotatorTwo.id
      },
      {
        amount: "0.08",
        credits: 8,
        createdAt,
        dataset,
        eventType: TaskCreditEventType.REVIEW_COMPLETED,
        points: 8,
        project,
        status: TaskCreditStatus.APPROVED,
        user: reviewer,
        userId: reviewer.id
      }
    ]);

    assert.equal(quality.summary.reviewed, 2);
    assert.equal(quality.sampling.reviewableTasks, 2);
    assert.equal(quality.sampling.reviewedTasks, 1);
    assert.equal(quality.sampling.pendingReview, 1);
    assert.equal(quality.sampling.targetRate, 0.2);
    assert.equal(quality.consensus.overlapTasks, 1);
    assert.equal(quality.consensus.agreementRate, 0.5);
    assert.equal(quality.rejectionReasons[0]?.label, "bad_boundary");
    assert.equal(quality.datasets[0]?.name, "Training V1");
    assert.equal(quality.samplingCandidates[0]?.taskId, "task-2");
    assert.equal(quality.annotators.length, 2);
    assert.equal(quality.credits.underReviewCredits, 11);
    assert.equal(quality.credits.totalCredits, 28);
    assert.equal(quality.credits.leaderboard[0]?.name, "Two Annotator");
    assert.equal(quality.credits.events.length, 3);
  });

  it("summarizes AI-assisted prediction usage and edits", () => {
    const createdAt = new Date("2026-05-26T12:00:00.000Z");
    const originalBox = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const editedBox = { x: 0.2, y: 0.2, width: 0.2, height: 0.2 };
    const quality = summarizeReviewQuality([], [
      {
        aiJobs: [
          {
            id: "job-1",
            modelProvider: {
              id: "provider-1",
              name: "Vision Import",
              type: "MANUAL"
            },
            outputJson: {
              predictions: {
                regions: [{}, {}, {}]
              }
            }
          }
        ],
        annotations: [
          {
            createdAt,
            leadTimeSeconds: 12,
            regions: [
              {
                confidence: 0.9,
                geometryJson: originalBox,
                label: "Horse",
                metadata: {
                  aiJobId: "job-1",
                  originalGeometry: originalBox,
                  originalLabel: "Horse",
                  source: "ai_prediction"
                },
                type: AnnotationRegionType.BBOX
              },
              {
                confidence: 0.7,
                geometryJson: editedBox,
                label: "Horse",
                metadata: {
                  aiJobId: "job-1",
                  originalGeometry: originalBox,
                  originalLabel: "Horse",
                  source: "ai_prediction"
                },
                type: AnnotationRegionType.BBOX
              }
            ],
            resultJson: { results: [] },
            status: AnnotationStatus.SUBMITTED,
            submittedAt: createdAt,
            user: annotatorOne,
            userId: annotatorOne.id,
            version: 1
          }
        ],
        asset: {
          fileName: "asset-ai.png"
        },
        createdAt,
        dataset,
        dueAt: null,
        id: "task-ai-1",
        priority: 0,
        project,
        reviews: [],
        status: TaskStatus.SUBMITTED
      }
    ]);

    assert.equal(quality.ai.assistedTasks, 1);
    assert.equal(quality.ai.predictionRegions, 3);
    assert.equal(quality.ai.acceptedRegions, 2);
    assert.equal(quality.ai.editedRegions, 1);
    assert.equal(quality.ai.removedRegions, 1);
    assert.equal(quality.ai.averageConfidence, 0.8);
    assert.equal(quality.ai.providerBreakdown[0]?.name, "Vision Import");
    assert.equal(quality.ai.datasetBreakdown[0]?.name, "Training V1");
  });

  it("uses the dataset review sampling policy when calculating quality targets", () => {
    const createdAt = new Date("2026-05-26T12:00:00.000Z");
    const quality = summarizeReviewQuality([], [
      {
        annotations: [
          {
            createdAt,
            leadTimeSeconds: null,
            regions: [],
            resultJson: { results: [] },
            status: AnnotationStatus.SUBMITTED,
            submittedAt: createdAt,
            user: annotatorOne,
            userId: annotatorOne.id,
            version: 1
          }
        ],
        asset: {
          fileName: "asset-1.png"
        },
        createdAt,
        dataset: {
          id: "dataset-2",
          metadata: {
            qualityPolicy: {
              autoSampleReview: true,
              minAgreementRate: 0.8,
              minQualityScore: 75,
              requireConsensusBeforeApproval: false,
              samplingTargetRate: 0.5
            }
          },
          name: "Training V2"
        },
        dueAt: null,
        id: "task-1",
        priority: 0,
        project,
        reviews: [],
        status: TaskStatus.SUBMITTED
      }
    ]);

    assert.equal(quality.sampling.targetRate, 0.5);
  });
});

describe("summarizeTaskConsensus", () => {
  const userOne = {
    email: "one@example.com",
    firstName: "One",
    id: "user-1",
    lastName: "Annotator"
  };
  const userTwo = {
    email: "two@example.com",
    firstName: "Two",
    id: "user-2",
    lastName: "Annotator"
  };

  it("detects low agreement when annotators choose different labels", () => {
    const createdAt = new Date("2026-05-26T12:00:00.000Z");
    const consensus = summarizeTaskConsensus({
      annotations: [
        {
          createdAt,
          leadTimeSeconds: null,
          regions: [
            {
              confidence: null,
              geometryJson: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
              label: "Car",
              metadata: {},
              type: AnnotationRegionType.BBOX
            }
          ],
          resultJson: { results: [] },
          status: AnnotationStatus.SUBMITTED,
          submittedAt: createdAt,
          user: userOne,
          userId: userOne.id,
          version: 1
        },
        {
          createdAt,
          leadTimeSeconds: null,
          regions: [
            {
              confidence: null,
              geometryJson: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
              label: "Truck",
              metadata: {},
              type: AnnotationRegionType.BBOX
            }
          ],
          resultJson: { results: [] },
          status: AnnotationStatus.SUBMITTED,
          submittedAt: createdAt,
          user: userTwo,
          userId: userTwo.id,
          version: 1
        }
      ]
    });

    assert.equal(consensus.hasOverlap, true);
    assert.equal(consensus.agreementRate, 0.5);
    assert.equal(consensus.labelAgreementRate, 0);
    assert.equal(isConsensusBelowPolicy(consensus, { minAgreementRate: 0.8 }), true);
  });

  it("does not require consensus when only one annotator has submitted", () => {
    const createdAt = new Date("2026-05-26T12:00:00.000Z");
    const consensus = summarizeTaskConsensus({
      annotations: [
        {
          createdAt,
          leadTimeSeconds: null,
          regions: [],
          resultJson: { results: [{ value: { choices: ["Approved"] } }] },
          status: AnnotationStatus.SUBMITTED,
          submittedAt: createdAt,
          user: userOne,
          userId: userOne.id,
          version: 1
        }
      ]
    });

    assert.equal(consensus.hasOverlap, false);
    assert.equal(isConsensusBelowPolicy(consensus, { minAgreementRate: 0.8 }), false);
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

  it("builds SLA quality filters for due soon and urgent priority queues", () => {
    const now = new Date("2026-05-26T12:00:00.000Z");

    assert.deepEqual(buildTaskQueueFilterWhere({ quality: "due_soon" }, { now, userId: "user-1" }), {
      dueAt: {
        gte: now,
        lte: new Date("2026-05-27T12:00:00.000Z")
      }
    });
    assert.deepEqual(buildTaskQueueFilterWhere({ quality: "urgent_priority" }, { now, userId: "user-1" }), {
      priority: {
        gte: 10
      }
    });
  });

  it("uses reviewer assignment fields for review queues", () => {
    const now = new Date("2026-05-26T12:00:00.000Z");

    assert.deepEqual(buildTaskQueueFilterWhere({ assignment: "mine" }, { now, queue: "review", userId: "reviewer-1" }), {
      reviewerId: "reviewer-1"
    });
    assert.deepEqual(buildTaskQueueFilterWhere({ assignment: "unassigned" }, { now, queue: "review", userId: "reviewer-1" }), {
      reviewerId: null
    });
  });
});

describe("buildTaskQualityFlags", () => {
  it("adds SLA and priority flags without marking approved tasks overdue", () => {
    const dueSoon = buildTaskQualityFlags({
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
      metadata: {},
      priority: 10,
      reviews: [],
      status: TaskStatus.ASSIGNED
    });
    const overdueApproved = buildTaskQualityFlags({
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      metadata: {},
      priority: 6,
      reviews: [],
      status: TaskStatus.APPROVED
    });

    assert.equal(dueSoon.includes("DUE_SOON"), true);
    assert.equal(dueSoon.includes("URGENT_PRIORITY"), true);
    assert.equal(overdueApproved.includes("OVERDUE"), false);
    assert.equal(overdueApproved.includes("HIGH_PRIORITY"), true);
  });
});

describe("getDatasetWorkflowAssignments", () => {
  it("balances round-robin assignment against current workload", () => {
    assert.deepEqual(
      getDatasetWorkflowAssignments(
        {
          assignedToId: null,
          assigneeIds: ["user-1", "user-2"],
          assignmentMode: "round_robin",
          dueAt: null,
          priority: 0,
          reviewerId: null
        },
        4,
        [
          {
            count: 1,
            userId: "user-1"
          }
        ]
      ),
      ["user-2", "user-1", "user-2", "user-1"]
    );
  });

  it("returns fixed single assignments and empty unassigned slots", () => {
    assert.deepEqual(
      getDatasetWorkflowAssignments(
        {
          assignedToId: "user-1",
          assigneeIds: [],
          assignmentMode: "single",
          dueAt: null,
          priority: 0,
          reviewerId: null
        },
        2
      ),
      ["user-1", "user-1"]
    );
    assert.deepEqual(
      getDatasetWorkflowAssignments(
        {
          assignedToId: null,
          assigneeIds: [],
          assignmentMode: "unassigned",
          dueAt: null,
          priority: 0,
          reviewerId: null
        },
        2
      ),
      [null, null]
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

describe("task credit estimates", () => {
  it("caps under-review annotation estimates so noisy tasks cannot inflate pending balances forever", () => {
    assert.equal(getAnnotationSubmissionCreditPoints({ regionCount: 3, resultCount: 2 }), 15);
    assert.equal(getAnnotationSubmissionCreditPoints({ regionCount: 300, resultCount: 100 }), 45);
  });

  it("credits approval and review work with bounded score bonuses", () => {
    assert.equal(getAnnotationApprovalCreditPoints(5), 20);
    assert.equal(getAnnotationApprovalCreditPoints(20), 20);
    assert.equal(getReviewCreditPoints({ score: 4, status: ReviewStatus.APPROVED }), 8);
    assert.equal(getReviewCreditPoints({ score: null, status: ReviewStatus.NEEDS_CHANGES }), 7);
  });
});

describe("settleTaskEscrowOnApproval", () => {
  it("releases worker pay and platform fee when a submitted task is approved", async () => {
    const fixture = createEscrowSettlementFixture();

    const settlement = await settleTaskEscrowOnApproval(fixture.tx, {
      paymentPolicy: createPaymentPolicy({ annotationCredits: 28, reviewCredits: 0 }),
      reviewId: "review-1",
      task: createSettlementTask({ escrowCredits: 40, platformFeeCredits: 12, reviewerId: null })
    });

    assert.deepEqual(settlement && {
      approvedCredits: settlement.approvedCredits,
      currency: settlement.currency,
      escrowCredits: settlement.escrowCredits,
      feeCredits: settlement.feeCredits,
      refundCredits: settlement.refundCredits
    }, {
      approvedCredits: 28,
      currency: "USD",
      escrowCredits: 40,
      feeCredits: 12,
      refundCredits: 0
    });
    assert.deepEqual(fixture.ledgerEntries.map((entry) => [entry.type, entry.amount]), [
      [LedgerEntryType.RELEASE, "0.28"],
      [LedgerEntryType.FEE, "0.12"]
    ]);
    assert.equal(fixture.walletUpdates.length, 0);
  });

  it("refunds unused escrow back to the creator wallet", async () => {
    const fixture = createEscrowSettlementFixture();

    const settlement = await settleTaskEscrowOnApproval(fixture.tx, {
      paymentPolicy: createPaymentPolicy({ annotationCredits: 28, reviewCredits: 0 }),
      reviewId: "review-2",
      task: createSettlementTask({ escrowCredits: 50, platformFeeCredits: 12, reviewerId: null })
    });

    assert.equal(settlement?.approvedCredits, 28);
    assert.equal(settlement?.feeCredits, 12);
    assert.equal(settlement?.refundCredits, 10);
    assert.deepEqual(fixture.ledgerEntries.map((entry) => [entry.type, entry.amount]), [
      [LedgerEntryType.RELEASE, "0.28"],
      [LedgerEntryType.FEE, "0.12"],
      [LedgerEntryType.REFUND, "0.10"]
    ]);
    assert.deepEqual(fixture.walletUpdates, [
      {
        data: {
          balance: {
            increment: "0.10"
          }
        },
        where: {
          id: "wallet-1"
        }
      }
    ]);
  });

  it("includes reviewer pay in the approved worker pool when review work is configured", async () => {
    const fixture = createEscrowSettlementFixture();

    const settlement = await settleTaskEscrowOnApproval(fixture.tx, {
      paymentPolicy: createPaymentPolicy({ annotationCredits: 30, reviewCredits: 10 }),
      reviewId: "review-3",
      task: createSettlementTask({ escrowCredits: 55, platformFeeCredits: 15, reviewerId: "reviewer-1" })
    });

    assert.equal(settlement?.approvedCredits, 40);
    assert.equal(settlement?.feeCredits, 15);
    assert.equal(settlement?.refundCredits, 0);
    assert.deepEqual(fixture.ledgerEntries.map((entry) => [entry.type, entry.amount]), [
      [LedgerEntryType.RELEASE, "0.40"],
      [LedgerEntryType.FEE, "0.15"]
    ]);
  });

  it("does not create duplicate release or refund entries for an already settled task", async () => {
    const fixture = createEscrowSettlementFixture();
    const input = {
      paymentPolicy: createPaymentPolicy({ annotationCredits: 28, reviewCredits: 0 }),
      reviewId: "review-4",
      task: createSettlementTask({ escrowCredits: 50, platformFeeCredits: 12, reviewerId: null })
    };

    const firstSettlement = await settleTaskEscrowOnApproval(fixture.tx, input);
    const secondSettlement = await settleTaskEscrowOnApproval(fixture.tx, input);

    assert.ok(firstSettlement);
    assert.equal(secondSettlement, null);
    assert.deepEqual(fixture.ledgerEntries.map((entry) => entry.type), [
      LedgerEntryType.RELEASE,
      LedgerEntryType.FEE,
      LedgerEntryType.REFUND
    ]);
    assert.equal(fixture.walletUpdates.length, 1);
  });

  it("skips settlement when the task has no escrow hold", async () => {
    const fixture = createEscrowSettlementFixture();

    const settlement = await settleTaskEscrowOnApproval(fixture.tx, {
      paymentPolicy: createPaymentPolicy({ annotationCredits: 28, reviewCredits: 0 }),
      reviewId: "review-5",
      task: {
        ...createSettlementTask({ escrowCredits: 40, platformFeeCredits: 12, reviewerId: null }),
        metadata: {}
      }
    });

    assert.equal(settlement, null);
    assert.equal(fixture.ledgerEntries.length, 0);
    assert.equal(fixture.walletUpdates.length, 0);
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

function createPaymentPolicy(overrides: Partial<{
  annotationCredits: number;
  currency: string;
  datasetBudgetCredits: number;
  freeTaskPostingFeeCredits: number;
  platformFeeRate: number;
  reviewBudgetShare: number;
  reviewCredits: number;
  taskBudgetBasis: number;
}> = {}) {
  return {
    annotationCredits: 28,
    currency: "USD",
    datasetBudgetCredits: 0,
    freeTaskPostingFeeCredits: 0,
    platformFeeRate: 0.3,
    reviewBudgetShare: 0,
    reviewCredits: 0,
    taskBudgetBasis: 1,
    ...overrides
  };
}

function createSettlementTask(input: { escrowCredits: number; platformFeeCredits: number; reviewerId: string | null }) {
  return {
    id: "task-1",
    metadata: {
      paymentEscrowCredits: input.escrowCredits,
      paymentEscrowLedgerEntryId: "hold-1",
      paymentPlatformFeeCredits: input.platformFeeCredits
    },
    organizationId: "org-1",
    project: {
      organizationId: "org-1"
    },
    reviewerId: input.reviewerId
  };
}

function createEscrowSettlementFixture() {
  const ledgerEntries: Array<{
    amount: string;
    currency: string;
    description: string;
    id: string;
    metadata: unknown;
    referenceId: string;
    type: LedgerEntryType;
    walletId: string;
  }> = [];
  const walletUpdates: Array<{ data: unknown; where: unknown }> = [];
  const tx = {
    ledgerEntry: {
      async findFirst() {
        return ledgerEntries.find((entry) =>
          entry.referenceId === "task-1" &&
          (entry.type === LedgerEntryType.RELEASE || entry.type === LedgerEntryType.REFUND)
        ) ?? null;
      },
      async findUnique(input: { where: { id: string } }) {
        return input.where.id === "hold-1"
          ? {
              currency: "USD",
              walletId: "wallet-1"
            }
          : null;
      },
      async create(input: {
        data: {
          amount: string;
          currency: string;
          description: string;
          metadata: unknown;
          referenceId: string;
          type: LedgerEntryType;
          walletId: string;
        };
      }) {
        const entry = {
          id: `ledger-${ledgerEntries.length + 1}`,
          ...input.data
        };
        ledgerEntries.push(entry);

        return {
          id: entry.id,
          type: entry.type
        };
      }
    },
    wallet: {
      async update(input: { data: unknown; where: unknown }) {
        walletUpdates.push(input);

        return {
          id: "wallet-1"
        };
      }
    }
  } as unknown as Prisma.TransactionClient;

  return {
    ledgerEntries,
    tx,
    walletUpdates
  };
}
