import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, History, Info, MessageSquare, Upload, XCircle } from "lucide-react";
import type { AIJobSummary, CommentSummary, ReviewSummary } from "../../../api";
import { formatAIConfidence, type TaskAIAssistanceSummary } from "../ai/aiAssistance";
import { formatEnum } from "../../../utils/format";
import { formatReviewMetadata, formatSignedCount, type AnnotationVersionDiff, type TaskHistoryItem } from "../history/history";
import { type TaskReviewSettlementDisplay } from "../payment/payment";
import type { ReviewGuidanceItem } from "../review/reviewGuidance";
import { formatDateTime } from "./taskDetailUtils";

const reviewReasonOptions = [
  { label: "Missing label", value: "missing_label" },
  { label: "Bad boundary", value: "bad_boundary" },
  { label: "Wrong class", value: "wrong_class" },
  { label: "Incomplete", value: "incomplete" },
  { label: "Other", value: "other" }
];

const reviewSeverityOptions = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Critical", value: "critical" }
];

type TaskAIPredictionsPanelProps = {
  canAddPredictions: boolean;
  canImportPredictions: boolean;
  focusedPreviewRegionIndex: number | null;
  importError: string | null;
  importText: string;
  jobs: AIJobSummary[];
  jobsLoading: boolean;
  mockGenerating: boolean;
  onAddPredictions: (job: AIJobSummary, selectedRegionIndexes: number[]) => void;
  onClearPredictionPreview: () => void;
  onPreviewPredictions: (job: AIJobSummary, selectedRegionIndexes: number[], focusedRegionIndex: number | null) => void;
  onGenerateMock: () => void;
  onImportPredictions: () => void;
  setImportText: (value: string) => void;
  submitting: boolean;
};

export function TaskAIPredictionsPanel({
  canAddPredictions,
  canImportPredictions,
  focusedPreviewRegionIndex,
  importError,
  importText,
  jobs,
  jobsLoading,
  mockGenerating,
  onAddPredictions,
  onClearPredictionPreview,
  onPreviewPredictions,
  onGenerateMock,
  onImportPredictions,
  setImportText,
  submitting
}: TaskAIPredictionsPanelProps) {
  const completedJobs = jobs.filter((job) => job.status === "COMPLETED");
  const latestJob = completedJobs[0] ?? null;
  const latestRegions = useMemo(() => latestJob?.outputJson?.predictions?.regions ?? [], [latestJob]);
  const latestRegionCount = latestRegions.length;
  const [selectedRegionIndexes, setSelectedRegionIndexes] = useState<number[]>([]);

  useEffect(() => {
    setSelectedRegionIndexes(latestRegions.map((_, index) => index));
  }, [latestJob?.id, latestRegions]);

  useEffect(() => {
    if (!latestJob || selectedRegionIndexes.length === 0) {
      onClearPredictionPreview();
      return;
    }

    onPreviewPredictions(latestJob, selectedRegionIndexes, focusedPreviewRegionIndex);
  }, [focusedPreviewRegionIndex, latestJob, onClearPredictionPreview, onPreviewPredictions, selectedRegionIndexes]);

  function toggleRegion(index: number) {
    setSelectedRegionIndexes((current) => {
      const nextIndexes = current.includes(index) ? current.filter((candidate) => candidate !== index) : [...current, index].sort((a, b) => a - b);
      const nextFocus = nextIndexes.includes(index) ? index : nextIndexes[0] ?? null;

      if (latestJob && nextIndexes.length > 0) {
        onPreviewPredictions(latestJob, nextIndexes, nextFocus);
      } else {
        onClearPredictionPreview();
      }

      return nextIndexes;
    });
  }

  function focusRegion(index: number) {
    if (!latestJob) {
      return;
    }

    const nextSelectedIndexes = selectedRegionIndexes.includes(index)
      ? selectedRegionIndexes
      : [...selectedRegionIndexes, index].sort((a, b) => a - b);

    setSelectedRegionIndexes(nextSelectedIndexes);
    onPreviewPredictions(latestJob, nextSelectedIndexes, index);
  }

  return (
    <section className="panel task-ai-panel">
      <div className="task-panel-title">
        <p className="eyebrow">Prelabels</p>
        <Bot size={16} />
      </div>
      <div className="task-ai-summary">
        <span>
          <strong>{latestRegionCount}</strong>
          <small>Regions ready</small>
        </span>
        <span>
          <strong>{completedJobs.length}</strong>
          <small>Completed jobs</small>
        </span>
      </div>
      {latestJob && latestRegionCount > 0 ? (
        <>
          <div className="task-ai-region-list">
            {latestRegions.slice(0, 8).map((region, index) => (
              <div className={focusedPreviewRegionIndex === index ? "task-ai-region-row active" : "task-ai-region-row"} key={`${latestJob.id}-${index}`}>
                <input aria-label={`Preview ${region.label ?? formatEnum(region.type)}`} checked={selectedRegionIndexes.includes(index)} onChange={() => toggleRegion(index)} type="checkbox" />
                <button onClick={() => focusRegion(index)} type="button">
                  <strong>{region.label ?? formatEnum(region.type)}</strong>
                  <small>
                    {formatEnum(region.type)} {formatConfidence(region.confidence)}
                  </small>
                </button>
              </div>
            ))}
            {latestRegionCount > 8 && <small className="muted-copy">Showing first 8 of {latestRegionCount} predictions.</small>}
          </div>
          <button
            className="secondary-button compact-button"
            disabled={!canAddPredictions || selectedRegionIndexes.length === 0}
            onClick={() => onAddPredictions(latestJob, selectedRegionIndexes)}
            type="button"
          >
            <Bot size={16} />
            Add selected
          </button>
        </>
      ) : (
        <span className="muted-copy">{jobsLoading ? "Loading predictions." : "No predictions yet."}</span>
      )}
      {canImportPredictions && (
        <div className="task-ai-import">
          <button className="secondary-button compact-button" disabled={mockGenerating} onClick={onGenerateMock} type="button">
            <Bot size={16} />
            {mockGenerating ? "Generating" : "Generate test prelabel"}
          </button>
          <textarea
            onChange={(event) => setImportText(event.currentTarget.value)}
            placeholder='{"regions":[{"type":"BBOX","label":"Horse","geometry":{"x":0.1,"y":0.2,"width":0.4,"height":0.3}}]}'
            value={importText}
          />
          {importError && <p className="form-error">{importError}</p>}
          <button className="secondary-button compact-button" disabled={submitting || !importText.trim()} onClick={onImportPredictions} type="button">
            <Upload size={16} />
            {submitting ? "Importing" : canAddPredictions ? "Import and add" : "Import JSON"}
          </button>
        </div>
      )}
      {completedJobs.length > 0 && (
        <div className="task-ai-job-list">
          {completedJobs.slice(0, 3).map((job) => (
            <article className="task-ai-job" key={job.id}>
              <span>
                <strong>{isMockPredictionJob(job) ? "Test prelabel" : job.modelProvider?.name ?? formatEnum(job.type)}</strong>
                <small>{formatDateTime(job.completedAt ?? job.createdAt)}</small>
              </span>
              <small>{getPredictionRegionCount(job)} regions</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function getPredictionRegionCount(job: AIJobSummary | null) {
  return job?.outputJson?.predictions?.regions?.length ?? 0;
}

function isMockPredictionJob(job: AIJobSummary | null) {
  return job?.inputJson?.mock === true || job?.outputJson?.predictions?.regions?.some((region) => region.metadata?.mock === true) === true;
}

function formatConfidence(value: number | null) {
  return typeof value === "number" ? `- ${Math.round(value * 100)}% confidence` : "";
}

export function TaskAIReviewPanel({ summary }: { summary: TaskAIAssistanceSummary }) {
  if (!summary.hasAIAssist) {
    return null;
  }

  const changedRegions = summary.regions.filter((region) => region.status !== "accepted");
  const visibleRegions = changedRegions.length > 0 ? changedRegions : summary.regions.slice(0, 3);
  const title = summary.mockOnly ? "Test prelabel review" : "Prelabel review";

  return (
    <section className="panel task-ai-review-panel">
      <div className="task-panel-title">
        <p className="eyebrow">{title}</p>
        <Bot size={16} />
      </div>
      <div className="task-ai-summary task-ai-summary-wide">
        <span>
          <strong>{summary.predictedRegions}</strong>
          <small>Predicted</small>
        </span>
        <span>
          <strong>{summary.acceptedRegions}</strong>
          <small>Accepted</small>
        </span>
        <span>
          <strong>{summary.editedRegions}</strong>
          <small>Edited</small>
        </span>
        <span>
          <strong>{summary.removedRegions}</strong>
          <small>Removed</small>
        </span>
      </div>
      <div className="task-ai-review-note">
        <strong>{formatAIConfidence(summary.averageConfidence)}</strong>
        <small>{summary.providerName ? `${summary.providerName} average confidence` : "Average confidence"}</small>
      </div>
      {visibleRegions.length > 0 ? (
        <div className="task-ai-change-list">
          {visibleRegions.map((region) => (
            <article className={`task-ai-change-row ${region.status}`} key={region.id}>
              <span>
                <strong>{region.currentLabel}</strong>
                <small>
                  AI {formatAIConfidence(region.confidence)} - {formatEnum(region.status)}
                </small>
              </span>
              <dl>
                <div>
                  <dt>AI label</dt>
                  <dd>{region.originalLabel}</dd>
                </div>
                <div>
                  <dt>Current label</dt>
                  <dd>{region.currentLabel}</dd>
                </div>
                <div>
                  <dt>AI geometry</dt>
                  <dd>{region.originalGeometry}</dd>
                </div>
                <div>
                  <dt>Current geometry</dt>
                  <dd>{region.currentGeometry}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <span className="muted-copy">Prelabels are tracked, but no current regions are linked to them.</span>
      )}
    </section>
  );
}

export function TaskRevisionPanel({ latestRejectedReview }: { latestRejectedReview: ReviewSummary | null }) {
  if (!latestRejectedReview) {
    return null;
  }

  return (
    <section className="panel task-revision-panel">
      <p className="eyebrow">Needs revision</p>
      <strong>{latestRejectedReview.reviewer.name}</strong>
      <small>{formatReviewMetadata(latestRejectedReview)}</small>
      <span>{latestRejectedReview.feedback?.trim() || "Reviewer requested changes."}</span>
      <small>{formatDateTime(latestRejectedReview.createdAt)}</small>
    </section>
  );
}

export function AnnotationVersionPanel({ annotationVersionDiff }: { annotationVersionDiff: AnnotationVersionDiff | null }) {
  if (!annotationVersionDiff) {
    return null;
  }

  return (
    <section className="panel annotation-version-panel">
      <p className="eyebrow">Version compare</p>
      <strong>
        v{annotationVersionDiff.previousVersion} to v{annotationVersionDiff.currentVersion}
      </strong>
      <div className="version-diff-grid">
        <span>
          <small>Regions</small>
          <strong>{formatSignedCount(annotationVersionDiff.regionDelta)}</strong>
        </span>
        <span>
          <small>Responses</small>
          <strong>{formatSignedCount(annotationVersionDiff.responseDelta)}</strong>
        </span>
        <span>
          <small>Status</small>
          <strong>{formatEnum(annotationVersionDiff.currentStatus)}</strong>
        </span>
      </div>
    </section>
  );
}

type TaskReviewPanelProps = {
  blocksApproval: boolean;
  onReviewDecision: (decision: "approve" | "reject") => void;
  reviewFeedback: string;
  reviewGuidance: ReviewGuidanceItem[];
  reviewReason: string;
  reviewSaving: boolean;
  reviewScore: string;
  reviewSettlement: TaskReviewSettlementDisplay;
  reviewSeverity: string;
  setReviewFeedback: (value: string) => void;
  setReviewReason: (value: string) => void;
  setReviewScore: (value: string) => void;
  setReviewSeverity: (value: string) => void;
};

export function TaskReviewPanel({
  blocksApproval,
  onReviewDecision,
  reviewFeedback,
  reviewGuidance,
  reviewReason,
  reviewSaving,
  reviewScore,
  reviewSettlement,
  reviewSeverity,
  setReviewFeedback,
  setReviewReason,
  setReviewScore,
  setReviewSeverity
}: TaskReviewPanelProps) {
  return (
    <section className="panel task-review-panel">
      <p className="eyebrow">Review decision</p>
      {reviewGuidance.length > 0 ? (
        <div className="review-guidance-list">
          {reviewGuidance.map((item) => (
            <article className={`review-guidance-item ${item.tone}`} key={item.title}>
              {item.tone === "danger" ? <AlertTriangle size={16} /> : <Info size={16} />}
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </article>
          ))}
        </div>
      ) : null}
      <div className="review-meta-grid">
        <label>
          Score
          <input
            max="5"
            min="1"
            onChange={(event) => setReviewScore(event.currentTarget.value)}
            placeholder="1-5"
            type="number"
            value={reviewScore}
          />
        </label>
        <label>
          Reason
          <select onChange={(event) => setReviewReason(event.currentTarget.value)} value={reviewReason}>
            <option value="">Choose reason</option>
            {reviewReasonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select onChange={(event) => setReviewSeverity(event.currentTarget.value)} value={reviewSeverity}>
            {reviewSeverityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        className="review-feedback-input"
        onChange={(event) => setReviewFeedback(event.currentTarget.value)}
        placeholder="Feedback for the annotator..."
        value={reviewFeedback}
      />
      <div className="review-payment-summary">
        <span>
          <small>Worker pay</small>
          <strong>{reviewSettlement.workerText}</strong>
        </span>
        <span>
          <small>Platform fee</small>
          <strong>{reviewSettlement.platformFeeText}</strong>
        </span>
        <span>
          <small>Creator refund</small>
          <strong>{reviewSettlement.refundText}</strong>
        </span>
        <span>
          <small>Escrow used</small>
          <strong>{reviewSettlement.escrowText}</strong>
        </span>
      </div>
      <div className="task-action-stack">
        <button className="primary-button" disabled={reviewSaving || blocksApproval} onClick={() => onReviewDecision("approve")} type="button">
          <CheckCircle2 size={17} />
          {reviewSaving ? "Saving" : "Approve"}
        </button>
        <button className="secondary-button danger-button" disabled={reviewSaving || !reviewReason} onClick={() => onReviewDecision("reject")} type="button">
          <XCircle size={17} />
          Send back
        </button>
      </div>
    </section>
  );
}

type TaskCommentsPanelProps = {
  commentBody: string;
  commentSaving: boolean;
  comments: CommentSummary[];
  onAddComment: () => void;
  setCommentBody: (value: string) => void;
  taskCanWork: boolean;
};

export function TaskCommentsPanel({
  commentBody,
  commentSaving,
  comments,
  onAddComment,
  setCommentBody,
  taskCanWork
}: TaskCommentsPanelProps) {
  return (
    <section className="panel task-comments-panel">
      <div className="task-panel-title">
        <p className="eyebrow">Comments</p>
        <MessageSquare size={16} />
      </div>
      <div className="task-timeline-list">
        {comments.length > 0 ? (
          comments.map((comment) => (
            <article className="task-timeline-item" key={comment.id}>
              <strong>{comment.user.name}</strong>
              <span>{comment.body}</span>
              <small>{formatDateTime(comment.createdAt)}</small>
            </article>
          ))
        ) : (
          <span className="muted-copy">No comments yet.</span>
        )}
      </div>
      {taskCanWork && (
        <div className="task-comment-form">
          <textarea
            onChange={(event) => setCommentBody(event.currentTarget.value)}
            placeholder="Add a task comment..."
            value={commentBody}
          />
          <button className="secondary-button compact-button" disabled={commentSaving || !commentBody.trim()} onClick={onAddComment} type="button">
            {commentSaving ? "Adding" : "Add comment"}
          </button>
        </div>
      )}
    </section>
  );
}

export function TaskHistoryPanel({ taskHistoryItems }: { taskHistoryItems: TaskHistoryItem[] }) {
  return (
    <section className="panel task-history-panel">
      <div className="task-panel-title">
        <p className="eyebrow">History</p>
        <History size={16} />
      </div>
      <div className="task-timeline-list">
        {taskHistoryItems.map((item) => (
          <article className="task-timeline-item" key={item.id}>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
            {item.paymentLines && item.paymentLines.length > 0 ? (
              <div className="task-timeline-money">
                {item.paymentLines.map((line) => (
                  <small key={line}>{line}</small>
                ))}
              </div>
            ) : null}
            <small>{item.meta}</small>
            <small>{formatDateTime(item.timestamp)}</small>
          </article>
        ))}
        {taskHistoryItems.length === 0 && <span className="muted-copy">No history yet.</span>}
      </div>
    </section>
  );
}
