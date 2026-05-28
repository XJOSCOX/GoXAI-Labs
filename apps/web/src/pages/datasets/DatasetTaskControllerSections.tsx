import { memo, useMemo } from "react";
import type { PlatformTaskEconomics, TaskParticipantSummary } from "../../api";
import {
  formatCurrency,
  getDatasetBudgetPreview,
  getDatasetPaymentHistory,
  getPriorityMeaning,
  priorityPresets,
  type DatasetBudgetPreview,
  type DatasetPaymentDraft,
  type DatasetPaymentHistoryEntry,
  type DatasetQualityDraft,
  type DatasetTaskAssignmentMode,
  type DatasetWorkflowDraft
} from "./datasetControllerConfigHelpers";
import type { DatasetSummary } from "../../api";

type SavingAction = "budget" | "defaults" | "quality" | "routing" | null;

type AssignmentSectionProps = {
  assignees: TaskParticipantSummary[];
  loadingParticipants: boolean;
  onApplyRouting: () => void;
  onAssigneeIdsChange: (assigneeIds: string[]) => void;
  onAssignedToChange: (assignedToId: string) => void;
  onAssignmentModeChange: (assignmentMode: DatasetTaskAssignmentMode) => void;
  onDueAtChange: (dueAt: string) => void;
  onLoadParticipants: () => void;
  onPriorityChange: (priority: string) => void;
  onReviewerChange: (reviewerId: string) => void;
  reviewers: TaskParticipantSummary[];
  saving: boolean;
  savingAction: SavingAction;
  selectedAssigneeNames: string[];
  workflow: DatasetWorkflowDraft;
};

export const AssignmentSection = memo(function AssignmentSection({
  assignees,
  loadingParticipants,
  onApplyRouting,
  onAssigneeIdsChange,
  onAssignedToChange,
  onAssignmentModeChange,
  onDueAtChange,
  onLoadParticipants,
  onPriorityChange,
  onReviewerChange,
  reviewers,
  saving,
  savingAction,
  selectedAssigneeNames,
  workflow
}: AssignmentSectionProps) {
  const priorityMeaning = getPriorityMeaning(workflow.priority);

  return (
    <section className="controller-section" onFocusCapture={onLoadParticipants} onMouseEnter={onLoadParticipants}>
      <SectionTitle
        eyebrow="Assignment"
        help="Controls who receives generated tasks, who reviews submitted work, and how urgent the tasks are."
        title="Task routing"
      />
      <div className="dataset-workflow-controls stacked">
        <label>
          <FieldName help="Unassigned leaves work in the queue. One annotator sends all tasks to a user. Round-robin distributes tasks across selected annotators.">
            Assignment
          </FieldName>
          <select
            onChange={(event) => onAssignmentModeChange(event.currentTarget.value as DatasetTaskAssignmentMode)}
            value={workflow.assignmentMode}
          >
            <option value="unassigned">Unassigned</option>
            <option value="single">One annotator</option>
            <option value="round_robin">Round-robin</option>
          </select>
        </label>
        {workflow.assignmentMode === "single" ? (
          <label>
            <FieldName help="The annotator who should receive every generated task in this dataset.">
              Assign to
            </FieldName>
            <select onChange={(event) => onAssignedToChange(event.currentTarget.value)} value={workflow.assignedToId}>
              <option value="">{loadingParticipants ? "Loading annotators" : "Choose annotator"}</option>
              {assignees.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {workflow.assignmentMode === "round_robin" ? (
          <label className="wide">
            <FieldName help="Tasks are assigned in order across these annotators. Hold Ctrl or Shift to select multiple users.">
              Round-robin annotators
            </FieldName>
            <select
              multiple
              onChange={(event) => onAssigneeIdsChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
              value={workflow.assigneeIds}
            >
              {assignees.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <FieldName help="Reviewer assigned to check submitted tasks. Review credits apply only when a reviewer is set.">
            Reviewer
          </FieldName>
            <select onChange={(event) => onReviewerChange(event.currentTarget.value)} value={workflow.reviewerId}>
            <option value="">{loadingParticipants ? "Loading reviewers" : "No reviewer"}</option>
            {reviewers.map((participant) => (
              <option key={participant.id} value={participant.id}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldName help="Preset shortcut for priority. The numeric field stays editable for custom values from 0 to 10.">
            Priority preset
          </FieldName>
          <select onChange={(event) => onPriorityChange(event.currentTarget.value)} value={workflow.priority}>
            {priorityPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label} ({preset.value})
              </option>
            ))}
            {!priorityPresets.some((preset) => preset.value === workflow.priority) ? (
              <option value={workflow.priority}>Custom ({workflow.priority})</option>
            ) : null}
          </select>
        </label>
        <label>
          <FieldName help="Queue ordering from 0 to 10. Higher numbers appear first.">
            Priority number
          </FieldName>
          <input
            max="10"
            min="0"
            onChange={(event) => onPriorityChange(event.currentTarget.value)}
            type="number"
            value={workflow.priority}
          />
        </label>
        <label>
          <FieldName help="Optional deadline copied to generated tasks. Overdue tasks can be filtered later.">
            Due date
          </FieldName>
          <input
            onChange={(event) => onDueAtChange(event.currentTarget.value)}
            type="datetime-local"
            value={workflow.dueAt}
          />
        </label>
        <div className="workflow-summary wide">
          <strong>{priorityMeaning.title}</strong>
          <span>{priorityMeaning.description}</span>
          {workflow.assignmentMode === "round_robin" && selectedAssigneeNames.length > 0 ? (
            <span>Rotation: {selectedAssigneeNames.join(" -> ")}</span>
          ) : null}
        </div>
        <div className="controller-section-actions wide">
          <button className="secondary-button" disabled={saving} onClick={onApplyRouting} type="button">
            {savingAction === "routing" ? "Applying routing" : "Apply routing"}
          </button>
        </div>
      </div>
    </section>
  );
});

type QualitySectionProps = {
  onAutoSampleReviewChange: (autoSampleReview: boolean) => void;
  onMinAgreementRateChange: (minAgreementRate: string) => void;
  onMinQualityScoreChange: (minQualityScore: string) => void;
  onRequireConsensusBeforeApprovalChange: (requireConsensusBeforeApproval: boolean) => void;
  onSamplingTargetRateChange: (samplingTargetRate: string) => void;
  onSaveQuality: () => void;
  quality: DatasetQualityDraft;
  saving: boolean;
  savingAction: SavingAction;
};

export const QualitySection = memo(function QualitySection({
  onAutoSampleReviewChange,
  onMinAgreementRateChange,
  onMinQualityScoreChange,
  onRequireConsensusBeforeApprovalChange,
  onSamplingTargetRateChange,
  onSaveQuality,
  quality,
  saving,
  savingAction
}: QualitySectionProps) {
  return (
    <section className="controller-section">
      <SectionTitle
        eyebrow="Quality"
        help="Controls how much completed work is checked and what quality thresholds are expected before approval."
        title="Review gates"
      />
      <div className="dataset-workflow-controls stacked">
        <label>
          <FieldName help="Percentage of submitted tasks automatically marked for QA review.">
            Review sampling target
          </FieldName>
          <input
            max="100"
            min="0"
            onChange={(event) => onSamplingTargetRateChange(event.currentTarget.value)}
            type="number"
            value={quality.samplingTargetRate}
          />
        </label>
        <label>
          <FieldName help="Minimum agreement required when multiple annotators work on overlapping tasks.">
            Minimum agreement
          </FieldName>
          <input
            max="100"
            min="0"
            onChange={(event) => onMinAgreementRateChange(event.currentTarget.value)}
            type="number"
            value={quality.minAgreementRate}
          />
        </label>
        <label>
          <FieldName help="Minimum reviewer quality score expected for approved work.">
            Minimum quality score
          </FieldName>
          <input
            max="100"
            min="0"
            onChange={(event) => onMinQualityScoreChange(event.currentTarget.value)}
            type="number"
            value={quality.minQualityScore}
          />
        </label>
        <label className="checkbox-row wide">
          <input
            checked={quality.autoSampleReview}
            onChange={(event) => onAutoSampleReviewChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <FieldName help="Automatically sends sampled submitted tasks into reviewer queue.">
            Auto-mark sampled tasks for QA review
          </FieldName>
        </label>
        <label className="checkbox-row wide">
          <input
            checked={quality.requireConsensusBeforeApproval}
            onChange={(event) => onRequireConsensusBeforeApprovalChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <FieldName help="Prevents approval until overlapping annotations meet the agreement rule.">
            Require consensus before approval
          </FieldName>
        </label>
        <div className="controller-section-actions wide">
          <button className="secondary-button" disabled={saving} onClick={onSaveQuality} type="button">
            {savingAction === "quality" ? "Saving gates" : "Save gates"}
          </button>
        </div>
      </div>
    </section>
  );
});

type BudgetSectionProps = {
  dataset: DatasetSummary;
  economics: PlatformTaskEconomics;
  onCurrencyChange: (currency: string) => void;
  onDatasetBudgetChange: (datasetBudget: string) => void;
  onReviewShareChange: (reviewShare: string) => void;
  onSaveBudget: () => void;
  payment: DatasetPaymentDraft;
  previewCurrency: string;
  savedBudgetCredits: number;
  saving: boolean;
  savingAction: SavingAction;
  workflow: Pick<DatasetWorkflowDraft, "reviewerId">;
};

export const BudgetSection = memo(function BudgetSection({
  dataset,
  economics,
  onCurrencyChange,
  onDatasetBudgetChange,
  onReviewShareChange,
  onSaveBudget,
  payment,
  previewCurrency,
  savedBudgetCredits,
  saving,
  savingAction,
  workflow
}: BudgetSectionProps) {
  const budgetPreview = useMemo(() => getDatasetBudgetPreview(dataset, workflow, payment, economics), [dataset, economics, payment, workflow]);
  const budgetHistory = useMemo(() => getDatasetPaymentHistory(dataset), [dataset]);

  return (
    <section className="controller-section">
      <SectionTitle
        eyebrow="Payment"
        help="Creators reserve one dataset budget. GoXAI splits it into per-task credits when tasks are generated or updated."
        title="Dataset budget"
      />
      <div className="dataset-workflow-controls stacked">
        <label>
          <FieldName help="Total amount reserved for this dataset. Example: $10 across 200 tasks becomes 5 credits per task.">
            Dataset budget
          </FieldName>
          <input
            min="0"
            onChange={(event) => onDatasetBudgetChange(event.currentTarget.value)}
            step="0.01"
            type="number"
            value={payment.datasetBudget}
          />
        </label>
        <label>
          <FieldName help="Part of each task budget reserved for approved review work. It applies only when a reviewer is selected.">
            Review share
          </FieldName>
          <input
            max="100"
            min="0"
            onChange={(event) => onReviewShareChange(event.currentTarget.value)}
            type="number"
            value={payment.reviewShare}
          />
        </label>
        <label>
          <FieldName help="Currency code for creator escrow and worker credit accounting.">
            Currency
          </FieldName>
          <input
            maxLength={3}
            onChange={(event) => onCurrencyChange(event.currentTarget.value.toUpperCase())}
            value={payment.currency}
          />
        </label>
        <BudgetPreview
          budgetPreview={budgetPreview}
          previewCurrency={previewCurrency}
          savedBudgetCredits={savedBudgetCredits}
          reviewerId={workflow.reviewerId}
        />
        {budgetHistory.length > 0 ? (
          <BudgetHistory budgetHistory={budgetHistory} previewCurrency={previewCurrency} />
        ) : null}
        <div className="controller-section-actions wide">
          <button className="secondary-button" disabled={saving} onClick={onSaveBudget} type="button">
            {savingAction === "budget" ? "Applying budget" : savedBudgetCredits > 0 ? "Increase budget" : "Save budget"}
          </button>
        </div>
      </div>
    </section>
  );
});

function BudgetPreview({
  budgetPreview,
  previewCurrency,
  reviewerId,
  savedBudgetCredits
}: {
  budgetPreview: DatasetBudgetPreview;
  previewCurrency: string;
  reviewerId: string;
  savedBudgetCredits: number;
}) {
  const isFreeTaskPosting = budgetPreview.datasetBudgetCredits === 0;

  return (
    <div className="workflow-summary wide budget-preview">
      <div className="budget-preview-head">
        <span>
          <strong>{isFreeTaskPosting ? "Free task funding" : `${formatCurrency(budgetPreview.datasetBudgetCredits / 100, previewCurrency)} dataset budget`}</strong>
          <small>{budgetPreview.taskBudgetBasis} task{budgetPreview.taskBudgetBasis === 1 ? "" : "s"} in this budget basis</small>
        </span>
        {savedBudgetCredits > 0 ? <em>Locked minimum {formatCurrency(savedBudgetCredits / 100, previewCurrency)}</em> : null}
      </div>
      {savedBudgetCredits > 0 ? (
        <span className="budget-preview-note">You can increase this dataset budget, but not reduce it.</span>
      ) : null}

      <div className="budget-breakdown-grid">
        <BudgetBreakdownMetric
          label="Creator reserve"
          value={formatCurrency(budgetPreview.totalReservedCredits / 100, previewCurrency)}
          detail={isFreeTaskPosting ? "Posting fee only" : "Gross amount held"}
        />
        <BudgetBreakdownMetric
          label="Worker pay pool"
          value={formatCurrency(budgetPreview.workerBudgetCredits / 100, previewCurrency)}
          detail={`${budgetPreview.baseWorkerTaskCredits} credits base per task`}
        />
        <BudgetBreakdownMetric
          label="Platform fee"
          value={formatCurrency(budgetPreview.platformFeeCredits / 100, previewCurrency)}
          detail={isFreeTaskPosting ? "Free-task fee" : "Reserved for platform costs"}
        />
        <BudgetBreakdownMetric
          label="Per task pay"
          value={`${budgetPreview.annotationCredits}${reviewerId ? ` + ${budgetPreview.reviewCredits}` : ""}`}
          detail={reviewerId ? "Annotation + review credits" : "Annotation credits"}
        />
      </div>

      <div className="budget-breakdown-lines">
        {budgetPreview.workerBonusTaskCount > 0 ? (
          <span>
            {budgetPreview.workerBonusTaskCount} task{budgetPreview.workerBonusTaskCount === 1 ? "" : "s"} receive 1 extra worker credit.
          </span>
        ) : null}
        {budgetPreview.datasetBudgetCredits > 0 && budgetPreview.grossBonusTaskCount > 0 ? (
          <span>
            {budgetPreview.grossBonusTaskCount} task{budgetPreview.grossBonusTaskCount === 1 ? "" : "s"} reserve 1 extra creator credit so the full budget is held.
          </span>
        ) : null}
        {isFreeTaskPosting && budgetPreview.platformFeeCredits > 0 ? (
          <span>
            Free-task posting fee: {formatCurrency(budgetPreview.platformFeeCredits / 100, previewCurrency)} for this dataset.
          </span>
        ) : null}
      </div>
      {budgetPreview.unusedCredits > 0 ? (
        <span>{budgetPreview.unusedCredits} credit{budgetPreview.unusedCredits === 1 ? "" : "s"} remain unreserved because credits are whole numbers.</span>
      ) : null}
    </div>
  );
}

function BudgetBreakdownMetric({
  detail,
  label,
  value
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <span className="budget-breakdown-metric">
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{detail}</em>
    </span>
  );
}

function BudgetHistory({
  budgetHistory,
  previewCurrency
}: {
  budgetHistory: DatasetPaymentHistoryEntry[];
  previewCurrency: string;
}) {
  return (
    <div className="workflow-summary wide budget-history">
      <strong>Budget history</strong>
      {budgetHistory.slice(0, 4).map((entry) => (
        <span key={`${entry.changedAt}-${entry.toBudgetCredits}`}>
          {formatShortDateTime(entry.changedAt)}: {formatCurrency(entry.fromBudgetCredits / 100, previewCurrency)} to{" "}
          {formatCurrency(entry.toBudgetCredits / 100, previewCurrency)}
        </span>
      ))}
    </div>
  );
}

function formatShortDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Updated";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function SectionTitle({ eyebrow, help, title }: { eyebrow: string; help: string; title: string }) {
  return (
    <div className="controller-section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h4>{title}</h4>
      </div>
      <InfoHint text={help} />
    </div>
  );
}

function FieldName({ children, help }: { children: string; help: string }) {
  return (
    <span className="field-name-with-hint">
      {children}
      <InfoHint text={help} />
    </span>
  );
}

function InfoHint({ text }: { text: string }) {
  return (
    <span aria-label={text} className="info-hint" tabIndex={0}>
      !
      <span className="info-hint-popover">{text}</span>
    </span>
  );
}
