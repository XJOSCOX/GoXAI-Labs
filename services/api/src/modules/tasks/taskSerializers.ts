import {
  AIJobStatus,
  AnnotationRegionType,
  AnnotationStatus,
  AnnotationTool,
  MembershipRole,
  ProjectAccessMode,
  ProjectStatus,
  ReviewStatus,
  TaskStatus,
  type Task
} from "@goxai/database";
import { canGenerateTasks, canReviewTasks, canWorkTasks } from "../../shared/permissions.js";
import { getDueSoonDate } from "./taskQueue.js";
export const taskIncludes = {
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      organizationId: true,
      status: true,
      accessMode: true
    }
  },
  dataset: {
    select: {
      id: true,
      metadata: true,
      name: true,
      version: true,
      labelingConfig: true,
      labels: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          id: true,
          name: true,
          color: true,
          shortcutKey: true,
          metadata: true
        }
      },
      tools: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          id: true,
          tool: true,
          enabled: true,
          configJson: true
        }
      }
    }
  },
  asset: {
    select: {
      id: true,
      fileName: true,
      objectKey: true,
      mimeType: true,
      fileSize: true,
      width: true,
      height: true,
      metadata: true
    }
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  },
  reviewer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  },
  reviews: {
    select: {
      id: true,
      status: true
    }
  }
} as const;

export const taskListIncludes = {
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      organizationId: true,
      status: true,
      accessMode: true
    }
  },
  dataset: {
    select: {
      id: true,
      name: true,
      version: true
    }
  },
  asset: {
    select: {
      id: true,
      fileName: true,
      objectKey: true,
      mimeType: true,
      fileSize: true,
      width: true,
      height: true
    }
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  },
  reviewer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  },
  annotations: {
    orderBy: {
      version: "desc"
    },
    take: 3,
    select: {
      id: true,
      status: true,
      userId: true,
      version: true,
      createdAt: true,
      regions: {
        select: {
          confidence: true,
          geometryJson: true,
          label: true,
          metadata: true
        }
      }
    }
  },
  aiJobs: {
    where: {
      status: AIJobStatus.COMPLETED
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 3,
    select: {
      id: true,
      outputJson: true,
      status: true
    }
  }
} as const;

export const annotationIncludes = {
  regions: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      type: true,
      label: true,
      geometryJson: true,
      confidence: true,
      metadata: true,
      createdAt: true,
      updatedAt: true
    }
  },
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

export const reviewIncludes = {
  annotation: {
    select: {
      id: true,
      status: true,
      version: true
    }
  },
  reviewer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

export const commentIncludes = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

export const taskDetailIncludes = {
  ...taskIncludes,
  annotations: {
    orderBy: {
      version: "desc"
    },
    include: annotationIncludes
  },
  comments: {
    orderBy: {
      createdAt: "asc"
    },
    include: commentIncludes
  },
  reviews: {
    orderBy: {
      createdAt: "desc"
    },
    include: reviewIncludes
  }
} as const;

export type TaskWithRelations = Task & {
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    status: ProjectStatus;
    accessMode: ProjectAccessMode;
  };
  dataset: {
    id: string;
    metadata: unknown;
    name: string;
    version: number;
    labelingConfig: unknown;
    labels: {
      id: string;
      name: string;
      color: string;
      shortcutKey: string | null;
      metadata: unknown;
    }[];
    tools: {
      id: string;
      tool: AnnotationTool;
      enabled: boolean;
      configJson: unknown;
    }[];
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: bigint;
    width: number | null;
    height: number | null;
    metadata: unknown;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  reviewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  reviews: {
    id: string;
    status: ReviewStatus;
  }[];
};

export type TaskListWithRelations = Task & {
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    status: ProjectStatus;
    accessMode: ProjectAccessMode;
  };
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: bigint;
    width: number | null;
    height: number | null;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  reviewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  annotations: {
    id: string;
    status: AnnotationStatus;
    userId: string;
    version: number;
    createdAt: Date;
    regions: {
      confidence: number | null;
      geometryJson: unknown;
      label: string | null;
      metadata: unknown;
    }[];
  }[];
  aiJobs: {
    id: string;
    outputJson: unknown;
    status: AIJobStatus;
  }[];
};

export type TaskWithDetailRelations = TaskWithRelations & {
  annotations: AnnotationWithRegions[];
  comments: CommentWithRelations[];
  reviews: ReviewWithRelations[];
};

export type AnnotationWithRegions = {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  status: AnnotationStatus;
  resultJson: unknown;
  leadTimeSeconds: number | null;
  version: number;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  regions: {
    id: string;
    type: AnnotationRegionType;
    label: string | null;
    geometryJson: unknown;
    confidence: number | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }[];
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

export type ReviewWithRelations = {
  id: string;
  annotationId: string;
  taskId: string;
  reviewerId: string;
  status: ReviewStatus;
  score: number | null;
  feedback: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  annotation: {
    id: string;
    status: AnnotationStatus;
    version: number;
  };
  reviewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

export type CommentWithRelations = {
  id: string;
  taskId: string | null;
  annotationId: string | null;
  userId: string;
  parentId: string | null;
  body: string;
  resolved: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

export function serializeTask(task: TaskWithRelations, membership?: { role: MembershipRole }) {
  return {
    id: task.id,
    projectId: task.projectId,
    datasetId: task.datasetId,
    assetId: task.assetId,
    status: task.status,
    priority: task.priority,
    assignedToId: task.assignedToId,
    reviewerId: task.reviewerId,
    qualityFlags: buildTaskQualityFlags(task),
    metadata: task.metadata,
    dueAt: task.dueAt,
    project: task.project,
    dataset: task.dataset,
    asset: task.asset
      ? {
          ...task.asset,
          fileSize: task.asset.fileSize.toString()
        }
      : null,
    assignedTo: task.assignedTo ? serializeUserName(task.assignedTo) : null,
    reviewer: task.reviewer ? serializeUserName(task.reviewer) : null,
    payment: serializeTaskPayment(task.metadata),
    canManage: membership ? canGenerateTasks(membership) : false,
    canReview: membership ? canReviewTasks(membership) : false,
    canWork: membership ? canWorkTasks(membership) : false,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function serializeTaskListItem(task: TaskListWithRelations, membership?: { role: MembershipRole }) {
  return {
    id: task.id,
    projectId: task.projectId,
    datasetId: task.datasetId,
    assetId: task.assetId,
    status: task.status,
    priority: task.priority,
    assignedToId: task.assignedToId,
    reviewerId: task.reviewerId,
    qualityFlags: buildTaskQualityFlags(task),
    metadata: task.metadata,
    dueAt: task.dueAt,
    project: task.project,
    dataset: task.dataset
      ? {
          ...task.dataset,
          labelingConfig: null,
          labels: [],
          tools: []
        }
      : null,
    asset: task.asset
      ? {
          ...task.asset,
          fileSize: task.asset.fileSize.toString(),
          metadata: null
        }
      : null,
    assignedTo: task.assignedTo ? serializeUserName(task.assignedTo) : null,
    reviewer: task.reviewer ? serializeUserName(task.reviewer) : null,
    payment: serializeTaskPayment(task.metadata),
    canManage: membership ? canGenerateTasks(membership) : false,
    canReview: membership ? canReviewTasks(membership) : false,
    canWork: membership ? canWorkTasks(membership) : false,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function serializeTaskPayment(metadata: unknown) {
  const taskMetadata = isPlainJsonObject(metadata) ? metadata : {};
  const annotationCredits = getTaskPaymentCreditValue(taskMetadata.paymentAnnotationCredits);
  const reviewCredits = getTaskPaymentCreditValue(taskMetadata.paymentReviewCredits);
  const escrowCredits = getTaskPaymentCreditValue(taskMetadata.paymentEscrowCredits);
  const platformFeeCredits = getTaskPaymentCreditValue(taskMetadata.paymentPlatformFeeCredits);
  const workerCredits = getTaskPaymentCreditValue(taskMetadata.paymentWorkerCredits) || annotationCredits + reviewCredits;
  const totalCredits = escrowCredits > 0 ? escrowCredits : annotationCredits + reviewCredits;
  const currency = getTaskPaymentCurrency(taskMetadata.paymentCurrency);

  return {
    annotationCredits,
    currency,
    platformFeeCredits,
    reviewCredits,
    totalCredits,
    workerCredits
  };
}

export function getTaskPaymentCurrency(value: unknown) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "USD";

  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

export function getTaskPaymentCreditValue(value: unknown) {
  const credits = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : 0;

  return Number.isInteger(credits) && credits >= 0 ? credits : 0;
}

export function buildTaskQualityFlags(task: {
  aiJobs?: { outputJson: unknown; status: AIJobStatus }[];
  annotations?: {
    regions: {
      confidence: number | null;
      geometryJson: unknown;
      label: string | null;
      metadata: unknown;
    }[];
  }[];
  dueAt: Date | null;
  metadata: unknown;
  priority: number;
  reviews?: { status: ReviewStatus }[];
  status: TaskStatus;
}) {
  const flags = new Set<string>();
  const metadata = isPlainJsonObject(task.metadata) ? task.metadata : {};
  const now = Date.now();
  const completedReviews = task.reviews?.filter((review) => review.status !== ReviewStatus.PENDING) ?? [];
  const rejectedReviews = completedReviews.filter((review) => review.status === ReviewStatus.NEEDS_CHANGES || review.status === ReviewStatus.REJECTED);

  if (task.dueAt && task.dueAt.getTime() < now && task.status !== TaskStatus.APPROVED && task.status !== TaskStatus.ARCHIVED) {
    flags.add("OVERDUE");
  }

  if (
    task.dueAt &&
    task.dueAt.getTime() >= now &&
    task.dueAt.getTime() <= getDueSoonDate(new Date(now)).getTime() &&
    task.status !== TaskStatus.APPROVED &&
    task.status !== TaskStatus.ARCHIVED
  ) {
    flags.add("DUE_SOON");
  }

  if (task.priority >= 10) {
    flags.add("URGENT_PRIORITY");
  } else if (task.priority >= 5) {
    flags.add("HIGH_PRIORITY");
  }

  if ((task.status === TaskStatus.SUBMITTED || task.status === TaskStatus.REVIEWING) && completedReviews.length === 0) {
    flags.add("MISSING_REVIEW");
  }

  if (task.status === TaskStatus.REJECTED) {
    flags.add("NEEDS_FIXES");
  }

  if (rejectedReviews.length >= 2) {
    flags.add("REJECTED_MULTIPLE");
  }

  if (metadata.qualitySampled === true) {
    flags.add("SAMPLED_QA");
  }

  if (metadata.qualityLowAgreement === true || (typeof metadata.qualityAgreementRate === "number" && metadata.qualityAgreementRate < 0.8)) {
    flags.add("LOW_AGREEMENT");
  }

  const aiRegions = (task.annotations ?? [])
    .flatMap((annotation) => annotation.regions)
    .filter(isAIAnnotationRegion);
  const completedAIJobs = (task.aiJobs ?? []).filter((job) => job.status === AIJobStatus.COMPLETED);

  if (completedAIJobs.length > 0 || aiRegions.length > 0) {
    flags.add("AI_ASSISTED");
  }

  if (aiRegions.some((region) => typeof region.confidence === "number" && region.confidence < 0.75)) {
    flags.add("AI_LOW_CONFIDENCE");
  }

  if (aiRegions.some(isEditedAIAnnotationRegion)) {
    flags.add("AI_EDITED");
  }

  const predictedRegionCount = completedAIJobs.reduce((total, job) => total + getPredictionRegionCount(job.outputJson), 0);
  if (predictedRegionCount > aiRegions.length) {
    flags.add("AI_REMOVED");
  }

  return [...flags];
}

export function serializeAnnotation(annotation: AnnotationWithRegions | null) {
  if (!annotation) {
    return null;
  }

  return {
    id: annotation.id,
    taskId: annotation.taskId,
    projectId: annotation.projectId,
    userId: annotation.userId,
    status: annotation.status,
    resultJson: annotation.resultJson,
    leadTimeSeconds: annotation.leadTimeSeconds,
    version: annotation.version,
    submittedAt: annotation.submittedAt,
    user: serializeUserName(annotation.user),
    regions: annotation.regions.map((region) => ({
      id: region.id,
      type: region.type,
      label: region.label,
      geometryJson: region.geometryJson,
      confidence: region.confidence,
      metadata: region.metadata,
      createdAt: region.createdAt,
      updatedAt: region.updatedAt
    })),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt
  };
}

export function serializeReview(review: ReviewWithRelations) {
  return {
    annotation: review.annotation,
    annotationId: review.annotationId,
    createdAt: review.createdAt,
    feedback: review.feedback,
    id: review.id,
    metadata: review.metadata,
    reviewer: serializeUserName(review.reviewer),
    reviewerId: review.reviewerId,
    score: review.score,
    status: review.status,
    taskId: review.taskId,
    updatedAt: review.updatedAt
  };
}

export function serializeComment(comment: CommentWithRelations) {
  return {
    annotationId: comment.annotationId,
    body: comment.body,
    createdAt: comment.createdAt,
    id: comment.id,
    metadata: comment.metadata,
    parentId: comment.parentId,
    resolved: comment.resolved,
    taskId: comment.taskId,
    updatedAt: comment.updatedAt,
    user: serializeUserName(comment.user),
    userId: comment.userId
  };
}

export function serializeUserName(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  };
}

function getPredictionRegionCount(outputJson: unknown) {
  if (!isPlainJsonObject(outputJson) || !isPlainJsonObject(outputJson.predictions)) {
    return 0;
  }

  return Array.isArray(outputJson.predictions.regions) ? outputJson.predictions.regions.length : 0;
}

function isAIAnnotationRegion(region: {
  metadata: unknown;
}) {
  const metadata = isPlainJsonObject(region.metadata) ? region.metadata : {};
  return metadata.source === "ai_prediction" || typeof metadata.aiJobId === "string";
}

function isEditedAIAnnotationRegion(region: {
  geometryJson: unknown;
  label: string | null;
  metadata: unknown;
}) {
  if (!isAIAnnotationRegion(region)) {
    return false;
  }

  const metadata = isPlainJsonObject(region.metadata) ? region.metadata : {};
  const originalGeometry = metadata.originalGeometry;
  const originalLabel = typeof metadata.originalLabel === "string" || metadata.originalLabel === null
    ? metadata.originalLabel
    : undefined;

  return metadata.aiEdited === true ||
    (originalGeometry !== undefined && !jsonValuesEqual(originalGeometry, region.geometryJson)) ||
    (originalLabel !== undefined && originalLabel !== region.label);
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(normalizeJsonForComparison(left)) === JSON.stringify(normalizeJsonForComparison(right));
}

function normalizeJsonForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonForComparison);
  }

  if (!isPlainJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => [key, normalizeJsonForComparison(entry)])
  );
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
