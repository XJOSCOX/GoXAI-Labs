import {
  AnnotationRegionType,
  AnnotationStatus,
  Prisma,
  ReviewStatus,
  TaskCreditEventType,
  TaskCreditStatus,
  TaskStatus
} from "@goxai/database";
import { getDefaultDatasetQualityPolicy, readDatasetQualityPolicy, type DatasetQualityPolicyValue } from "./taskPolicies.js";
export function summarizeReviewQuality(
  reviews: QualityReviewInput[],
  tasks: QualityTaskInput[] = [],
  creditEvents: QualityCreditInput[] = []
) {
  const approved = reviews.filter((review) => review.status === ReviewStatus.APPROVED).length;
  const rejected = reviews.filter((review) => review.status === ReviewStatus.NEEDS_CHANGES).length;
  const scoredReviews = reviews.filter((review) => typeof review.score === "number");
  const reviewerStats = new Map<string, QualityPersonStats>();
  const annotatorStats = new Map<string, QualityPersonStats>();
  const reasonCounts = new Map<string, number>();
  const severityCounts = new Map<string, number>();
  const trendCounts = new Map<string, { approved: number; rejected: number; total: number }>();

  for (const review of reviews) {
    const reviewer = getOrCreateQualityPersonStats(reviewerStats, review.reviewer);
    const annotator = getOrCreateQualityPersonStats(annotatorStats, review.annotation.user);

    addReviewToQualityPersonStats(reviewer, review);
    addReviewToQualityPersonStats(annotator, review);
    addAnnotationSpeedToQualityPersonStats(annotator, review.annotation.leadTimeSeconds);

    const metadata = isPlainJsonObject(review.metadata) ? review.metadata : {};
    const reason = typeof metadata.reason === "string" ? metadata.reason : null;
    const severity = typeof metadata.severity === "string" ? metadata.severity : null;

    if (reason) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }

    if (severity) {
      severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
    }

    const day = review.createdAt.toISOString().slice(0, 10);
    const trend = trendCounts.get(day) ?? { approved: 0, rejected: 0, total: 0 };
    trend.total += 1;

    if (review.status === ReviewStatus.APPROVED) {
      trend.approved += 1;
    } else if (review.status === ReviewStatus.NEEDS_CHANGES) {
      trend.rejected += 1;
    }

    trendCounts.set(day, trend);
  }

  for (const task of tasks) {
    for (const annotation of getLatestSubmittedAnnotationsByUser(task.annotations)) {
      const annotator = getOrCreateQualityPersonStats(annotatorStats, annotation.user);
      addSubmittedAnnotationToQualityPersonStats(annotator, annotation.leadTimeSeconds);
    }
  }

  const sampling = summarizeReviewSampling(tasks);
  const consensus = summarizeAnnotationConsensus(tasks);
  const credits = summarizeTaskCredits(creditEvents);
  const datasets = summarizeDatasetQuality(tasks, reviews, sampling.byDataset, consensus.byDataset);
  const ai = summarizeAIAssistance(tasks);
  const datasetQualityScore = datasets.length > 0
    ? Math.round(datasets.reduce((total, dataset) => total + dataset.qualityScore, 0) / datasets.length)
    : calculateQualityScore({
        acceptanceRate: reviews.length > 0 ? approved / reviews.length : null,
        agreementRate: consensus.summary.agreementRate,
        averageScore: scoredReviews.length > 0
          ? scoredReviews.reduce((total, review) => total + (review.score ?? 0), 0) / scoredReviews.length
          : null,
        samplingRate: sampling.summary.sampleRate
      });

  return {
    annotators: serializeQualityPeople(annotatorStats),
    ai,
    consensus: consensus.summary,
    credits,
    datasets,
    disagreements: consensus.disagreements,
    rejectionReasons: serializeRejectionReasons(reasonCounts, rejected),
    reasons: serializeQualityCounts(reasonCounts),
    reviewers: serializeQualityPeople(reviewerStats),
    sampling: sampling.summary,
    samplingCandidates: sampling.candidates,
    severity: serializeQualityCounts(severityCounts),
    summary: {
      acceptanceRate: reviews.length > 0 ? approved / reviews.length : 0,
      approved,
      averageScore: scoredReviews.length > 0
        ? scoredReviews.reduce((total, review) => total + (review.score ?? 0), 0) / scoredReviews.length
        : null,
      datasetQualityScore,
      rejected,
      reviewed: reviews.length
    },
    trend: [...trendCounts.entries()]
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-14)
  };
}

type QualityPersonStats = {
  approved: number;
  averageLeadTimeSeconds: number | null;
  averageScore: number | null;
  id: string;
  leadTimeSamples: number;
  leadTimeTotal: number;
  name: string;
  qualityScore: number;
  rejected: number;
  scoreTotal: number;
  scored: number;
  submitted: number;
  total: number;
};

type QualityReviewInput = {
  annotation: {
    leadTimeSeconds: number | null;
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    };
  };
  createdAt: Date;
  metadata: unknown;
  reviewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  score: number | null;
  status: ReviewStatus;
  task: {
    dataset: {
      id: string;
      metadata: unknown;
      name: string;
    } | null;
    project: {
      id: string;
      name: string;
    };
  };
};

type QualityAnnotationInput = {
  createdAt: Date;
  leadTimeSeconds: number | null;
  regions: {
    confidence: number | null;
    geometryJson: unknown;
    label: string | null;
    metadata: unknown;
    type: AnnotationRegionType;
  }[];
  resultJson: unknown;
  status: AnnotationStatus;
  submittedAt: Date | null;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  userId: string;
  version: number;
};

type QualityTaskInput = {
  aiJobs?: {
    id: string;
    modelProvider: {
      id: string;
      name: string;
      type: string;
    } | null;
    outputJson: unknown;
  }[];
  annotations: QualityAnnotationInput[];
  asset: {
    fileName: string;
  } | null;
  createdAt: Date;
  dataset: {
    id: string;
    metadata: unknown;
    name: string;
  } | null;
  dueAt: Date | null;
  id: string;
  priority: number;
  project: {
    id: string;
    name: string;
  };
  reviews: {
    id: string;
    status: ReviewStatus;
  }[];
  status: TaskStatus;
};

type QualityCreditInput = {
  amount: Prisma.Decimal | number | string;
  credits: number;
  createdAt: Date;
  dataset: {
    id: string;
    name: string;
  } | null;
  eventType: TaskCreditEventType;
  points: number;
  project: {
    id: string;
    name: string;
  } | null;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  userId: string | null;
  status: TaskCreditStatus;
};

type QualitySamplingDatasetStats = {
  id: string | null;
  key: string;
  name: string;
  pendingReview: number;
  reviewableTasks: number;
  reviewedTasks: number;
  targetReviewTasks: number;
  totalTasks: number;
};

type QualityConsensusDatasetStats = {
  exactAgreementTotal: number;
  id: string | null;
  key: string;
  labelAgreementTotal: number;
  name: string;
  overlapTasks: number;
};

type QualityDatasetStats = {
  approved: number;
  id: string | null;
  key: string;
  name: string;
  rejected: number;
  reviewableTasks: number;
  reviewed: number;
  scored: number;
  scoreTotal: number;
  totalTasks: number;
};

type QualityAIDatasetStats = {
  acceptedRegions: number;
  assistedTasks: number;
  confidenceSamples: number;
  confidenceTotal: number;
  editedRegions: number;
  id: string | null;
  key: string;
  name: string;
  predictionRegions: number;
  removedRegions: number;
};

type QualityAIProviderStats = {
  id: string | null;
  key: string;
  name: string;
  regions: number;
  taskIds: Set<string>;
  type: string | null;
};

type QualitySamplingCandidate = {
  assetName: string;
  datasetId: string | null;
  datasetName: string;
  dueAt: Date | null;
  priority: number;
  status: TaskStatus;
  taskId: string;
};

type QualityDisagreementSummary = {
  agreementRate: number;
  annotators: string[];
  assetName: string;
  datasetId: string | null;
  datasetName: string;
  labelAgreementRate: number;
  taskId: string;
};

type QualityCreditPersonStats = {
  annotationsApproved: number;
  annotationsSubmitted: number;
  approvedCredits: number;
  availableCredits: number;
  eventCount: number;
  id: string;
  lastCreditedAt: Date;
  name: string;
  points: number;
  reviewsCompleted: number;
  underReviewCredits: number;
  voidedCredits: number;
  withdrawnCredits: number;
};

type QualityCreditDatasetStats = {
  approvedCredits: number;
  availableCredits: number;
  id: string | null;
  key: string;
  name: string;
  points: number;
  underReviewCredits: number;
  withdrawnCredits: number;
};

function summarizeTaskCredits(events: QualityCreditInput[]) {
  const eventCounts = new Map<TaskCreditEventType, { count: number; points: number }>();
  const people = new Map<string, QualityCreditPersonStats>();
  const datasets = new Map<string, QualityCreditDatasetStats>();
  let approvedCredits = 0;
  let availableCredits = 0;
  let underReviewCredits = 0;
  let voidedCredits = 0;
  let withdrawnCredits = 0;

  for (const event of events) {
    const eventCredits = Number.isFinite(event.credits) && event.credits > 0 ? event.credits : getCreditsFromPoints(event.points);

    if (eventCredits <= 0) {
      continue;
    }

    if (event.status === TaskCreditStatus.UNDER_REVIEW) {
      underReviewCredits += eventCredits;
    } else if (event.status === TaskCreditStatus.APPROVED) {
      approvedCredits += eventCredits;
    } else if (event.status === TaskCreditStatus.AVAILABLE) {
      availableCredits += eventCredits;
    } else if (event.status === TaskCreditStatus.WITHDRAWN) {
      withdrawnCredits += eventCredits;
    } else if (event.status === TaskCreditStatus.VOIDED) {
      voidedCredits += eventCredits;
    }

    const eventStats = eventCounts.get(event.eventType) ?? { count: 0, points: 0 };
    eventStats.count += 1;
    eventStats.points += eventCredits;
    eventCounts.set(event.eventType, eventStats);

    const datasetKey = event.dataset?.id ?? "unknown";
    const datasetStats = datasets.get(datasetKey) ?? {
      approvedCredits: 0,
      availableCredits: 0,
      id: event.dataset?.id ?? null,
      key: datasetKey,
      name: event.dataset?.name ?? "No dataset",
      points: 0,
      underReviewCredits: 0,
      withdrawnCredits: 0
    };
    datasetStats.points += eventCredits;
    addCreditsByStatus(datasetStats, event.status, eventCredits);
    datasets.set(datasetKey, datasetStats);

    if (!event.user) {
      continue;
    }

    const person = people.get(event.user.id) ?? {
      annotationsApproved: 0,
      annotationsSubmitted: 0,
      approvedCredits: 0,
      availableCredits: 0,
      eventCount: 0,
      id: event.user.id,
      lastCreditedAt: event.createdAt,
      name: serializeQualityUserName(event.user).name,
      points: 0,
      reviewsCompleted: 0,
      underReviewCredits: 0,
      voidedCredits: 0,
      withdrawnCredits: 0
    };
    person.eventCount += 1;
    person.points += eventCredits;
    addCreditsByStatus(person, event.status, eventCredits);

    if (event.createdAt > person.lastCreditedAt) {
      person.lastCreditedAt = event.createdAt;
    }

    if (event.eventType === TaskCreditEventType.ANNOTATION_SUBMITTED) {
      person.annotationsSubmitted += 1;
    } else if (event.eventType === TaskCreditEventType.ANNOTATION_APPROVED) {
      person.annotationsApproved += 1;
    } else if (event.eventType === TaskCreditEventType.REVIEW_COMPLETED) {
      person.reviewsCompleted += 1;
    }

    people.set(event.user.id, person);
  }

  return {
    datasets: [...datasets.values()]
      .map((dataset) => ({
        approvedCredits: dataset.approvedCredits,
        availableCredits: dataset.availableCredits,
        id: dataset.id,
        name: dataset.name,
        points: dataset.points,
        underReviewCredits: dataset.underReviewCredits,
        withdrawnCredits: dataset.withdrawnCredits
      }))
      .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name))
      .slice(0, 10),
    approvedCredits,
    availableCredits,
    eventCount: [...eventCounts.values()].reduce((total, item) => total + item.count, 0),
    events: [...eventCounts.entries()]
      .map(([label, item]) => ({ count: item.count, label, points: item.points }))
      .sort((left, right) => right.points - left.points || left.label.localeCompare(right.label)),
    leaderboard: [...people.values()]
      .map((person) => ({
        annotationsApproved: person.annotationsApproved,
        annotationsSubmitted: person.annotationsSubmitted,
        approvedCredits: person.approvedCredits,
        availableCredits: person.availableCredits,
        eventCount: person.eventCount,
        id: person.id,
        lastCreditedAt: person.lastCreditedAt,
        name: person.name,
        points: person.points,
        reviewsCompleted: person.reviewsCompleted,
        underReviewCredits: person.underReviewCredits,
        voidedCredits: person.voidedCredits,
        withdrawnCredits: person.withdrawnCredits
      }))
      .sort((left, right) => right.approvedCredits + right.availableCredits - (left.approvedCredits + left.availableCredits) || left.name.localeCompare(right.name))
      .slice(0, 10),
    totalCredits: approvedCredits + availableCredits + withdrawnCredits,
    totalPoints: approvedCredits + availableCredits + withdrawnCredits,
    underReviewCredits,
    voidedCredits,
    withdrawnCredits
  };
}

function addCreditsByStatus<T extends {
  approvedCredits: number;
  availableCredits: number;
  underReviewCredits: number;
  withdrawnCredits: number;
  voidedCredits?: number;
}>(target: T, status: TaskCreditStatus, credits: number) {
  if (status === TaskCreditStatus.UNDER_REVIEW) {
    target.underReviewCredits += credits;
  } else if (status === TaskCreditStatus.APPROVED) {
    target.approvedCredits += credits;
  } else if (status === TaskCreditStatus.AVAILABLE) {
    target.availableCredits += credits;
  } else if (status === TaskCreditStatus.WITHDRAWN) {
    target.withdrawnCredits += credits;
  } else if (status === TaskCreditStatus.VOIDED && typeof target.voidedCredits === "number") {
    target.voidedCredits += credits;
  }
}

function getOrCreateQualityPersonStats(
  statsByUserId: Map<string, QualityPersonStats>,
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
) {
  const existing = statsByUserId.get(user.id);

  if (existing) {
    return existing;
  }

  const created = {
    approved: 0,
    averageScore: null,
    averageLeadTimeSeconds: null,
    id: user.id,
    leadTimeSamples: 0,
    leadTimeTotal: 0,
    name: serializeQualityUserName(user).name,
    qualityScore: 0,
    rejected: 0,
    scoreTotal: 0,
    scored: 0,
    submitted: 0,
    total: 0
  };
  statsByUserId.set(user.id, created);
  return created;
}

function addReviewToQualityPersonStats(stats: QualityPersonStats, review: { score: number | null; status: ReviewStatus }) {
  stats.total += 1;

  if (review.status === ReviewStatus.APPROVED) {
    stats.approved += 1;
  } else if (review.status === ReviewStatus.NEEDS_CHANGES) {
    stats.rejected += 1;
  }

  if (typeof review.score === "number") {
    stats.scoreTotal += review.score;
    stats.scored += 1;
    stats.averageScore = stats.scoreTotal / stats.scored;
  }
}

function addSubmittedAnnotationToQualityPersonStats(stats: QualityPersonStats, leadTimeSeconds: number | null) {
  stats.submitted += 1;
  addAnnotationSpeedToQualityPersonStats(stats, leadTimeSeconds);
}

function addAnnotationSpeedToQualityPersonStats(stats: QualityPersonStats, leadTimeSeconds: number | null) {
  if (typeof leadTimeSeconds !== "number" || !Number.isFinite(leadTimeSeconds) || leadTimeSeconds < 0) {
    return;
  }

  stats.leadTimeTotal += leadTimeSeconds;
  stats.leadTimeSamples += 1;
  stats.averageLeadTimeSeconds = stats.leadTimeTotal / stats.leadTimeSamples;
}

function serializeQualityPeople(statsByUserId: Map<string, QualityPersonStats>) {
  return [...statsByUserId.values()]
    .map((stats) => {
      const acceptanceRate = stats.total > 0 ? stats.approved / stats.total : 0;
      const rejectionRate = stats.total > 0 ? stats.rejected / stats.total : 0;
      const qualityScore = calculateQualityScore({
        acceptanceRate: stats.total > 0 ? acceptanceRate : null,
        agreementRate: null,
        averageScore: stats.averageScore,
        samplingRate: stats.submitted > 0 ? stats.total / stats.submitted : null
      });

      return {
        acceptanceRate,
        approved: stats.approved,
        averageLeadTimeSeconds: stats.averageLeadTimeSeconds,
        averageScore: stats.averageScore,
        id: stats.id,
        name: stats.name,
        qualityScore,
        rejected: stats.rejected,
        rejectionRate,
        reviewed: stats.total,
        submitted: stats.submitted,
        total: stats.total
      };
    })
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
    .slice(0, 10);
}

function serializeQualityCounts(counts: Map<string, number>) {
  return [...counts.entries()]
    .map(([label, count]) => ({ count, label }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10);
}

function serializeRejectionReasons(counts: Map<string, number>, rejected: number) {
  return [...counts.entries()]
    .map(([label, count]) => ({
      count,
      label,
      share: rejected > 0 ? count / rejected : 0
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10);
}

function summarizeReviewSampling(tasks: QualityTaskInput[]) {
  const byDataset = new Map<string, QualitySamplingDatasetStats>();
  const candidates: QualitySamplingCandidate[] = [];
  let reviewableTasks = 0;
  let reviewedTasks = 0;
  let pendingReview = 0;
  let targetReviewTasks = 0;

  for (const task of tasks) {
    const reviewable = isReviewableTask(task);
    const hasReview = task.reviews.some((review) => review.status !== ReviewStatus.PENDING);
    const dataset = getQualityDatasetKey(task.dataset);
    const datasetStats = getOrCreateSamplingDatasetStats(byDataset, dataset);
    const qualityPolicy = readDatasetQualityPolicy(task.dataset?.metadata);

    datasetStats.totalTasks += 1;

    if (!reviewable) {
      continue;
    }

    reviewableTasks += 1;
    datasetStats.reviewableTasks += 1;
    datasetStats.targetReviewTasks += qualityPolicy.samplingTargetRate;
    targetReviewTasks += qualityPolicy.samplingTargetRate;

    if (hasReview) {
      reviewedTasks += 1;
      datasetStats.reviewedTasks += 1;
      continue;
    }

    pendingReview += 1;
    datasetStats.pendingReview += 1;
    candidates.push({
      assetName: getQualityTaskAssetName(task),
      datasetId: task.dataset?.id ?? null,
      datasetName: task.dataset?.name ?? "No dataset",
      dueAt: task.dueAt,
      priority: task.priority,
      status: task.status,
      taskId: task.id
    });
  }

  return {
    byDataset,
    candidates: candidates
      .sort((left, right) => right.priority - left.priority || String(left.dueAt ?? "").localeCompare(String(right.dueAt ?? "")))
      .slice(0, 8),
    summary: {
      pendingReview,
      reviewableTasks,
      reviewedTasks,
      sampleRate: reviewableTasks > 0 ? reviewedTasks / reviewableTasks : 0,
      targetRate: reviewableTasks > 0 ? targetReviewTasks / reviewableTasks : getDefaultDatasetQualityPolicy().samplingTargetRate
    }
  };
}

function summarizeAnnotationConsensus(tasks: QualityTaskInput[]) {
  const byDataset = new Map<string, QualityConsensusDatasetStats>();
  const disagreements: QualityDisagreementSummary[] = [];
  let overlapTasks = 0;
  let totalExactAgreement = 0;
  let totalLabelAgreement = 0;
  let comparedPairs = 0;

  for (const task of tasks) {
    const annotations = getLatestSubmittedAnnotationsByUser(task.annotations);

    if (annotations.length < 2) {
      continue;
    }

    const dataset = getQualityDatasetKey(task.dataset);
    const datasetStats = getOrCreateConsensusDatasetStats(byDataset, dataset);
    const consensus = summarizeAnnotationsConsensus(annotations);

    overlapTasks += 1;
    totalExactAgreement += consensus.agreementRate;
    totalLabelAgreement += consensus.labelAgreementRate;
    comparedPairs += consensus.comparedPairs;
    datasetStats.overlapTasks += 1;
    datasetStats.exactAgreementTotal += consensus.agreementRate;
    datasetStats.labelAgreementTotal += consensus.labelAgreementRate;

    if (consensus.agreementRate < 0.8 || consensus.labelAgreementRate < 0.8) {
      disagreements.push({
        agreementRate: consensus.agreementRate,
        annotators: annotations.map((annotation) => serializeQualityUserName(annotation.user).name),
        assetName: getQualityTaskAssetName(task),
        datasetId: task.dataset?.id ?? null,
        datasetName: task.dataset?.name ?? "No dataset",
        labelAgreementRate: consensus.labelAgreementRate,
        taskId: task.id
      });
    }
  }

  return {
    byDataset,
    disagreements: disagreements
      .sort((left, right) => left.agreementRate - right.agreementRate || left.labelAgreementRate - right.labelAgreementRate)
      .slice(0, 8),
    summary: {
      agreementRate: overlapTasks > 0 ? totalExactAgreement / overlapTasks : null,
      comparedPairs,
      labelAgreementRate: overlapTasks > 0 ? totalLabelAgreement / overlapTasks : null,
      overlapTasks
    }
  };
}

export function summarizeTaskConsensus(task: { annotations: QualityAnnotationInput[] }) {
  return summarizeAnnotationsConsensus(getLatestSubmittedAnnotationsByUser(task.annotations));
}

function summarizeAnnotationsConsensus(annotations: QualityAnnotationInput[]) {
  if (annotations.length < 2) {
    return {
      agreementRate: 1,
      comparedPairs: 0,
      hasOverlap: false,
      labelAgreementRate: 1
    };
  }

  const signatures = annotations.map(buildAnnotationSignature);
  const pairAgreement = calculatePairwiseLabelAgreement(signatures);

  return {
    agreementRate: calculateExactAgreement(signatures),
    comparedPairs: pairAgreement.pairs,
    hasOverlap: true,
    labelAgreementRate: pairAgreement.average
  };
}

export function isConsensusBelowPolicy(
  consensus: ReturnType<typeof summarizeTaskConsensus>,
  policy: Pick<DatasetQualityPolicyValue, "minAgreementRate">
) {
  return consensus.agreementRate < policy.minAgreementRate || consensus.labelAgreementRate < policy.minAgreementRate;
}

export function buildConsensusTaskMetadata(
  metadata: unknown,
  consensus: ReturnType<typeof summarizeTaskConsensus>,
  policy: DatasetQualityPolicyValue
): Prisma.InputJsonObject {
  const base = isPlainJsonObject(metadata) ? metadata : {};
  const lowAgreement = consensus.hasOverlap && isConsensusBelowPolicy(consensus, policy);

  return {
    ...base,
    qualityAgreementRate: consensus.hasOverlap ? consensus.agreementRate : null,
    qualityComparedPairs: consensus.comparedPairs,
    qualityLabelAgreementRate: consensus.hasOverlap ? consensus.labelAgreementRate : null,
    qualityLowAgreement: lowAgreement
  } as Prisma.InputJsonObject;
}

function summarizeDatasetQuality(
  tasks: QualityTaskInput[],
  reviews: QualityReviewInput[],
  samplingByDataset: Map<string, QualitySamplingDatasetStats>,
  consensusByDataset: Map<string, QualityConsensusDatasetStats>
) {
  const datasets = new Map<string, QualityDatasetStats>();

  for (const task of tasks) {
    const dataset = getQualityDatasetKey(task.dataset);
    const stats = getOrCreateDatasetStats(datasets, dataset);

    stats.totalTasks += 1;

    if (isReviewableTask(task)) {
      stats.reviewableTasks += 1;
    }
  }

  for (const review of reviews) {
    const dataset = getQualityDatasetKey(review.task.dataset);
    const stats = getOrCreateDatasetStats(datasets, dataset);

    stats.reviewed += 1;

    if (review.status === ReviewStatus.APPROVED) {
      stats.approved += 1;
    } else if (review.status === ReviewStatus.NEEDS_CHANGES) {
      stats.rejected += 1;
    }

    if (typeof review.score === "number") {
      stats.scoreTotal += review.score;
      stats.scored += 1;
    }
  }

  return [...datasets.values()]
    .map((stats) => {
      const sampling = samplingByDataset.get(stats.key);
      const consensus = consensusByDataset.get(stats.key);
      const acceptanceRate = stats.reviewed > 0 ? stats.approved / stats.reviewed : null;
      const averageScore = stats.scored > 0 ? stats.scoreTotal / stats.scored : null;
      const samplingRate = sampling && sampling.reviewableTasks > 0 ? sampling.reviewedTasks / sampling.reviewableTasks : null;
      const agreementRate = consensus && consensus.overlapTasks > 0
        ? consensus.exactAgreementTotal / consensus.overlapTasks
        : null;

      return {
        acceptanceRate,
        agreementRate,
        approved: stats.approved,
        averageScore,
        id: stats.id,
        name: stats.name,
        qualityScore: calculateQualityScore({
          acceptanceRate,
          agreementRate,
          averageScore,
          samplingRate
        }),
        rejected: stats.rejected,
        reviewed: stats.reviewed,
        samplingRate,
        totalTasks: stats.totalTasks
      };
    })
    .sort((left, right) => right.qualityScore - left.qualityScore || left.name.localeCompare(right.name))
    .slice(0, 12);
}

function summarizeAIAssistance(tasks: QualityTaskInput[]) {
  const datasets = new Map<string, QualityAIDatasetStats>();
  const providers = new Map<string, QualityAIProviderStats>();
  let assistedTasks = 0;
  let acceptedRegions = 0;
  let editedRegions = 0;
  let predictionRegions = 0;
  let removedRegions = 0;
  let confidenceSamples = 0;
  let confidenceTotal = 0;

  for (const task of tasks) {
    const dataset = getQualityDatasetKey(task.dataset);
    const datasetStats = getOrCreateAIDatasetStats(datasets, dataset);
    const taskPredictionRegions = (task.aiJobs ?? []).reduce((total, job) => {
      const jobRegions = getPredictionRegionCount(job.outputJson);
      const providerKey = job.modelProvider?.id ?? "__unknown_provider__";
      const providerStats = providers.get(providerKey) ?? {
        id: job.modelProvider?.id ?? null,
        key: providerKey,
        name: job.modelProvider?.name ?? "Unconfigured model",
        regions: 0,
        taskIds: new Set<string>(),
        type: job.modelProvider?.type ?? null
      };

      providerStats.regions += jobRegions;
      providerStats.taskIds.add(task.id);
      providers.set(providerKey, providerStats);

      return total + jobRegions;
    }, 0);

    const acceptedAIRegions = getLatestSubmittedAnnotationsByUser(task.annotations)
      .flatMap((annotation) => annotation.regions)
      .filter(isAIAnnotationRegion);
    const taskAcceptedRegions = acceptedAIRegions.length;
    const taskEditedRegions = acceptedAIRegions.filter(isEditedAIAnnotationRegion).length;
    const taskRemovedRegions = Math.max(0, taskPredictionRegions - taskAcceptedRegions);
    const taskHasAIAssist = taskPredictionRegions > 0 || taskAcceptedRegions > 0;

    if (taskHasAIAssist) {
      assistedTasks += 1;
      datasetStats.assistedTasks += 1;
    }

    predictionRegions += taskPredictionRegions;
    acceptedRegions += taskAcceptedRegions;
    editedRegions += taskEditedRegions;
    removedRegions += taskRemovedRegions;

    datasetStats.predictionRegions += taskPredictionRegions;
    datasetStats.acceptedRegions += taskAcceptedRegions;
    datasetStats.editedRegions += taskEditedRegions;
    datasetStats.removedRegions += taskRemovedRegions;

    for (const region of acceptedAIRegions) {
      if (typeof region.confidence === "number" && Number.isFinite(region.confidence)) {
        confidenceSamples += 1;
        confidenceTotal += region.confidence;
        datasetStats.confidenceSamples += 1;
        datasetStats.confidenceTotal += region.confidence;
      }
    }
  }

  return {
    acceptedRegions,
    assistedTasks,
    averageConfidence: confidenceSamples > 0 ? confidenceTotal / confidenceSamples : null,
    datasetBreakdown: [...datasets.values()]
      .filter((dataset) => dataset.assistedTasks > 0 || dataset.predictionRegions > 0 || dataset.acceptedRegions > 0)
      .map((dataset) => ({
        acceptedRegions: dataset.acceptedRegions,
        assistedTasks: dataset.assistedTasks,
        averageConfidence: dataset.confidenceSamples > 0 ? dataset.confidenceTotal / dataset.confidenceSamples : null,
        editedRegions: dataset.editedRegions,
        id: dataset.id,
        name: dataset.name,
        predictionRegions: dataset.predictionRegions,
        removedRegions: dataset.removedRegions
      }))
      .sort((left, right) => right.acceptedRegions - left.acceptedRegions || right.assistedTasks - left.assistedTasks || left.name.localeCompare(right.name))
      .slice(0, 10),
    editedRegions,
    predictionRegions,
    providerBreakdown: [...providers.values()]
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        regions: provider.regions,
        tasks: provider.taskIds.size,
        type: provider.type
      }))
      .sort((left, right) => right.regions - left.regions || right.tasks - left.tasks || left.name.localeCompare(right.name))
      .slice(0, 8),
    removedRegions
  };
}

function getLatestSubmittedAnnotationsByUser(annotations: QualityAnnotationInput[]) {
  const byUserId = new Map<string, QualityAnnotationInput>();

  for (const annotation of annotations) {
    const existing = byUserId.get(annotation.userId);

    if (!existing || annotation.version > existing.version || annotation.createdAt > existing.createdAt) {
      byUserId.set(annotation.userId, annotation);
    }
  }

  return [...byUserId.values()];
}

function buildAnnotationSignature(annotation: QualityAnnotationInput) {
  const labels = new Map<string, number>();

  for (const region of annotation.regions) {
    if (region.label) {
      labels.set(region.label, (labels.get(region.label) ?? 0) + 1);
    }
  }

  const results = Array.isArray((annotation.resultJson as { results?: unknown[] } | null)?.results)
    ? ((annotation.resultJson as { results: unknown[] }).results)
    : [];

  for (const result of results) {
    if (!isPlainJsonObject(result) || !isPlainJsonObject(result.value)) {
      continue;
    }

    for (const value of Object.values(result.value)) {
      addResultValueLabels(labels, value);
    }
  }

  const labelEntries = [...labels.entries()].sort(([left], [right]) => left.localeCompare(right));

  return {
    labels: new Set(labelEntries.map(([label]) => label)),
    signature: labelEntries.map(([label, count]) => `${label}:${count}`).join("|") || "empty"
  };
}

function addResultValueLabels(labels: Map<string, number>, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      addResultValueLabels(labels, item);
    }
    return;
  }

  if (typeof value === "string" && value.trim()) {
    const label = value.trim().slice(0, 160);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
}

function calculateExactAgreement(signatures: { signature: string }[]) {
  const counts = new Map<string, number>();

  for (const signature of signatures) {
    counts.set(signature.signature, (counts.get(signature.signature) ?? 0) + 1);
  }

  return signatures.length > 0 ? Math.max(...counts.values()) / signatures.length : 0;
}

function calculatePairwiseLabelAgreement(signatures: { labels: Set<string> }[]) {
  let total = 0;
  let pairs = 0;

  for (let leftIndex = 0; leftIndex < signatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < signatures.length; rightIndex += 1) {
      total += calculateJaccard(signatures[leftIndex]?.labels ?? new Set(), signatures[rightIndex]?.labels ?? new Set());
      pairs += 1;
    }
  }

  return {
    average: pairs > 0 ? total / pairs : 0,
    pairs
  };
}

function calculateJaccard(left: Set<string>, right: Set<string>) {
  const union = new Set([...left, ...right]);

  if (union.size === 0) {
    return 1;
  }

  let intersection = 0;

  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function calculateQualityScore(input: {
  acceptanceRate: number | null;
  agreementRate: number | null;
  averageScore: number | null;
  samplingRate: number | null;
}) {
  const acceptance = input.acceptanceRate ?? 0;
  const score = input.averageScore !== null ? input.averageScore / 5 : acceptance;
  const sampling = input.samplingRate ?? 0;
  const agreement = input.agreementRate ?? acceptance;

  return Math.round(Math.max(0, Math.min(1, acceptance * 0.4 + score * 0.25 + sampling * 0.2 + agreement * 0.15)) * 100);
}

function isReviewableTask(task: Pick<QualityTaskInput, "status">) {
  return task.status === TaskStatus.SUBMITTED || task.status === TaskStatus.APPROVED || task.status === TaskStatus.REJECTED;
}

function getQualityDatasetKey(dataset: { id: string; metadata?: unknown; name: string } | null) {
  return {
    id: dataset?.id ?? null,
    key: dataset?.id ?? "__no_dataset__",
    name: dataset?.name ?? "No dataset"
  };
}

function getOrCreateSamplingDatasetStats(
  statsByDataset: Map<string, QualitySamplingDatasetStats>,
  dataset: { id: string | null; key: string; name: string }
) {
  const existing = statsByDataset.get(dataset.key);

  if (existing) {
    return existing;
  }

  const created = {
    id: dataset.id,
    key: dataset.key,
    name: dataset.name,
    pendingReview: 0,
    reviewableTasks: 0,
    reviewedTasks: 0,
    targetReviewTasks: 0,
    totalTasks: 0
  };
  statsByDataset.set(dataset.key, created);
  return created;
}

function getOrCreateConsensusDatasetStats(
  statsByDataset: Map<string, QualityConsensusDatasetStats>,
  dataset: { id: string | null; key: string; name: string }
) {
  const existing = statsByDataset.get(dataset.key);

  if (existing) {
    return existing;
  }

  const created = {
    exactAgreementTotal: 0,
    id: dataset.id,
    key: dataset.key,
    labelAgreementTotal: 0,
    name: dataset.name,
    overlapTasks: 0
  };
  statsByDataset.set(dataset.key, created);
  return created;
}

function getOrCreateDatasetStats(
  statsByDataset: Map<string, QualityDatasetStats>,
  dataset: { id: string | null; key: string; name: string }
) {
  const existing = statsByDataset.get(dataset.key);

  if (existing) {
    return existing;
  }

  const created = {
    approved: 0,
    id: dataset.id,
    key: dataset.key,
    name: dataset.name,
    rejected: 0,
    reviewableTasks: 0,
    reviewed: 0,
    scored: 0,
    scoreTotal: 0,
    totalTasks: 0
  };
  statsByDataset.set(dataset.key, created);
  return created;
}

function getCreditsFromPoints(points: number) {
  return Math.max(0, Math.round(points));
}

function getOrCreateAIDatasetStats(
  statsByDataset: Map<string, QualityAIDatasetStats>,
  dataset: { id: string | null; key: string; name: string }
) {
  const existing = statsByDataset.get(dataset.key);

  if (existing) {
    return existing;
  }

  const created = {
    acceptedRegions: 0,
    assistedTasks: 0,
    confidenceSamples: 0,
    confidenceTotal: 0,
    editedRegions: 0,
    id: dataset.id,
    key: dataset.key,
    name: dataset.name,
    predictionRegions: 0,
    removedRegions: 0
  };
  statsByDataset.set(dataset.key, created);
  return created;
}

function getPredictionRegionCount(outputJson: unknown) {
  if (!isPlainJsonObject(outputJson) || !isPlainJsonObject(outputJson.predictions)) {
    return 0;
  }

  return Array.isArray(outputJson.predictions.regions) ? outputJson.predictions.regions.length : 0;
}

function isAIAnnotationRegion(region: QualityAnnotationInput["regions"][number]) {
  const metadata = isPlainJsonObject(region.metadata) ? region.metadata : {};
  return metadata.source === "ai_prediction" || typeof metadata.aiJobId === "string";
}

function isEditedAIAnnotationRegion(region: QualityAnnotationInput["regions"][number]) {
  if (!isAIAnnotationRegion(region)) {
    return false;
  }

  const metadata = isPlainJsonObject(region.metadata) ? region.metadata : {};
  const originalGeometry = metadata.originalGeometry;
  const originalLabel = typeof metadata.originalLabel === "string" || metadata.originalLabel === null
    ? metadata.originalLabel
    : undefined;

  return (originalGeometry !== undefined && !jsonValuesEqual(originalGeometry, region.geometryJson)) ||
    (originalLabel !== undefined && originalLabel !== region.label);
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getQualityTaskAssetName(task: { asset?: { fileName: string } | null; dataset?: { name: string } | null }) {
  return task.asset?.fileName ?? task.dataset?.name ?? "Task";
}

function serializeQualityUserName(user: {
  email: string;
  firstName: string | null;
  id: string;
  lastName: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  };
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
