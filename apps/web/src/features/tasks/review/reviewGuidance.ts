import type { AnnotationSummary, TaskSummary } from "../../../api";

export type ReviewGuidanceItem = {
  blocksApproval?: boolean;
  detail: string;
  title: string;
  tone: "danger" | "info" | "warning";
};

export function buildReviewGuidance(task: TaskSummary, annotationHistory: AnnotationSummary[]): ReviewGuidanceItem[] {
  const items: ReviewGuidanceItem[] = [];
  const metadata = isRecord(task.metadata) ? task.metadata : {};
  const flags = new Set(task.qualityFlags ?? []);
  const policy = getTaskDatasetQualityPolicy(task);
  const consensus = summarizeClientConsensus(annotationHistory);

  if (flags.has("SAMPLED_QA")) {
    items.push({
      detail: "This task was selected by the dataset sampling policy.",
      title: "Sampled for QA",
      tone: "info"
    });
  }

  if (flags.has("OVERDUE") || flags.has("DUE_SOON") || flags.has("URGENT_PRIORITY")) {
    items.push({
      detail: [
        flags.has("URGENT_PRIORITY") ? "Priority 10." : null,
        flags.has("OVERDUE") ? "Past due." : flags.has("DUE_SOON") ? "Due within 24 hours." : null
      ].filter(Boolean).join(" "),
      title: "SLA attention",
      tone: flags.has("OVERDUE") ? "danger" : "warning"
    });
  }

  const savedAgreementRate = getNumberValue(metadata.qualityAgreementRate);
  const savedLabelAgreementRate = getNumberValue(metadata.qualityLabelAgreementRate);
  const hasSavedLowAgreement = metadata.qualityLowAgreement === true || flags.has("LOW_AGREEMENT");
  const hasLiveLowAgreement = consensus.hasOverlap &&
    (consensus.agreementRate < policy.minAgreementRate || consensus.labelAgreementRate < policy.minAgreementRate);

  if (hasSavedLowAgreement || hasLiveLowAgreement) {
    const agreementRate = savedAgreementRate ?? consensus.agreementRate;
    const labelAgreementRate = savedLabelAgreementRate ?? consensus.labelAgreementRate;

    items.push({
      blocksApproval: policy.requireConsensusBeforeApproval,
      detail: `Agreement ${formatPercentValue(agreementRate)}, label agreement ${formatPercentValue(labelAgreementRate)}, minimum ${formatPercentValue(policy.minAgreementRate)}.`,
      title: policy.requireConsensusBeforeApproval ? "Consensus below approval policy" : "Low annotator agreement",
      tone: "danger"
    });
  } else if (policy.requireConsensusBeforeApproval) {
    items.push({
      detail: consensus.hasOverlap
        ? `Consensus policy is active. Current agreement is ${formatPercentValue(consensus.agreementRate)}.`
        : "Consensus policy is active. Approval is checked when overlapping annotator submissions exist.",
      title: "Consensus policy active",
      tone: "info"
    });
  }

  if (flags.has("MISSING_REVIEW")) {
    items.push({
      detail: "No completed review exists yet for the submitted annotation.",
      title: "First review",
      tone: "info"
    });
  }

  return items;
}

function getTaskDatasetQualityPolicy(task: TaskSummary) {
  const metadata = isRecord(task.dataset?.metadata) ? task.dataset.metadata : {};
  const policy = isRecord(metadata.qualityPolicy) ? metadata.qualityPolicy : {};

  return {
    minAgreementRate: getPolicyPercent(policy.minAgreementRate, 0.8),
    requireConsensusBeforeApproval: typeof policy.requireConsensusBeforeApproval === "boolean" ? policy.requireConsensusBeforeApproval : false
  };
}

function getPolicyPercent(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const normalized = numberValue > 1 ? numberValue / 100 : numberValue;

  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1 ? normalized : fallback;
}

function summarizeClientConsensus(annotationHistory: AnnotationSummary[]) {
  const latestByUserId = new Map<string, AnnotationSummary>();

  for (const annotation of annotationHistory) {
    const existing = latestByUserId.get(annotation.userId);
    const existingCreatedAt = existing ? new Date(existing.createdAt).getTime() : 0;
    const createdAt = new Date(annotation.createdAt).getTime();

    if (!existing || annotation.version > existing.version || createdAt > existingCreatedAt) {
      latestByUserId.set(annotation.userId, annotation);
    }
  }

  const annotations = [...latestByUserId.values()];

  if (annotations.length < 2) {
    return {
      agreementRate: 1,
      hasOverlap: false,
      labelAgreementRate: 1
    };
  }

  const signatures = annotations.map(buildClientAnnotationSignature);
  const signatureCounts = new Map<string, number>();

  for (const signature of signatures) {
    signatureCounts.set(signature.signature, (signatureCounts.get(signature.signature) ?? 0) + 1);
  }

  return {
    agreementRate: Math.max(...signatureCounts.values()) / signatures.length,
    hasOverlap: true,
    labelAgreementRate: calculateClientLabelAgreement(signatures)
  };
}

function buildClientAnnotationSignature(annotation: AnnotationSummary) {
  const labels = new Map<string, number>();

  for (const region of annotation.regions) {
    if (region.label) {
      labels.set(region.label, (labels.get(region.label) ?? 0) + 1);
    }
  }

  const results = Array.isArray(annotation.resultJson.results) ? annotation.resultJson.results : [];

  for (const result of results) {
    if (!isRecord(result) || !isRecord(result.value)) {
      continue;
    }

    for (const value of Object.values(result.value)) {
      addClientResultLabels(labels, value);
    }
  }

  const labelEntries = [...labels.entries()].sort(([left], [right]) => left.localeCompare(right));

  return {
    labels: new Set(labelEntries.map(([label]) => label)),
    signature: labelEntries.map(([label, count]) => `${label}:${count}`).join("|") || "empty"
  };
}

function addClientResultLabels(labels: Map<string, number>, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      addClientResultLabels(labels, item);
    }
    return;
  }

  if (typeof value === "string" && value.trim()) {
    const label = value.trim().slice(0, 160);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
}

function calculateClientLabelAgreement(signatures: { labels: Set<string> }[]) {
  let total = 0;
  let pairs = 0;

  for (let leftIndex = 0; leftIndex < signatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < signatures.length; rightIndex += 1) {
      const left = signatures[leftIndex]?.labels ?? new Set<string>();
      const right = signatures[rightIndex]?.labels ?? new Set<string>();
      const union = new Set([...left, ...right]);
      const intersection = [...left].filter((label) => right.has(label));

      total += union.size > 0 ? intersection.length / union.size : 1;
      pairs += 1;
    }
  }

  return pairs > 0 ? total / pairs : 1;
}

function formatPercentValue(value: number | null) {
  return value === null ? "N/A" : `${Math.round(value * 100)}%`;
}

function getNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
