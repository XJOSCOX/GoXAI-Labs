import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Save } from "lucide-react";
import {
  applyDatasetBudgetPolicy,
  applyDatasetTaskRouting,
  listTaskParticipants,
  saveDatasetQualityGates,
  saveDatasetTaskWorkflowDefaults,
  type DatasetSummary,
  type TaskParticipantSummary
} from "../../api";
import { useAuth } from "../../auth";
import {
  buildDatasetBudgetInput,
  buildDatasetControllerInput,
  buildDatasetQualityInput,
  buildDatasetRoutingInput,
  getDatasetPaymentDraft,
  getDatasetQualityDraft,
  getSavedDatasetBudgetCredits,
  getDatasetWorkflowDraft,
  isDatasetControllerConfigured,
  type DatasetTaskAssignmentMode
} from "./datasetControllerConfigHelpers";
import { AssignmentSection, BudgetSection, QualitySection } from "./DatasetTaskControllerSections";

type DatasetTaskControllerPanelProps = {
  dataset: DatasetSummary;
  onSaved: () => Promise<void>;
  session: Session | null;
  setPageError: (error: string | null) => void;
};

export function DatasetTaskControllerPanel({
  dataset,
  onSaved,
  session,
  setPageError
}: DatasetTaskControllerPanelProps) {
  const { economics } = useAuth();
  const [savingAction, setSavingAction] = useState<"budget" | "defaults" | "quality" | "routing" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [participants, setParticipants] = useState<TaskParticipantSummary[]>([]);
  const [participantsRequested, setParticipantsRequested] = useState(false);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [workflow, setWorkflow] = useState(() => getDatasetWorkflowDraft(dataset));
  const [quality, setQuality] = useState(() => getDatasetQualityDraft(dataset));
  const [payment, setPayment] = useState(() => getDatasetPaymentDraft(dataset));
  const isConfigured = isDatasetControllerConfigured(dataset);
  const assignees = useMemo(() => participants.filter((participant) => participant.canWork), [participants]);
  const reviewers = useMemo(() => participants.filter((participant) => participant.canReview), [participants]);
  const selectedAssigneeNames = useMemo(
    () => assignees
      .filter((participant) => workflow.assigneeIds.includes(participant.id))
      .map((participant) => participant.name),
    [assignees, workflow.assigneeIds]
  );
  const savedBudgetCredits = getSavedDatasetBudgetCredits(dataset);
  const currency = payment.currency.trim().toUpperCase() || "USD";
  const previewCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const saving = savingAction !== null;

  const handleAssignmentModeChange = useCallback((assignmentMode: DatasetTaskAssignmentMode) => {
    setWorkflow((current) => ({
      ...current,
      assignmentMode,
      assignedToId: assignmentMode === "single" ? current.assignedToId : "",
      assigneeIds: assignmentMode === "round_robin" ? current.assigneeIds : []
    }));
  }, []);
  const handleAssignedToChange = useCallback((assignedToId: string) => {
    setWorkflow((current) => ({ ...current, assignedToId }));
  }, []);
  const handleAssigneeIdsChange = useCallback((assigneeIds: string[]) => {
    setWorkflow((current) => ({ ...current, assigneeIds }));
  }, []);
  const handleReviewerChange = useCallback((reviewerId: string) => {
    setWorkflow((current) => ({ ...current, reviewerId }));
  }, []);
  const handlePriorityChange = useCallback((priority: string) => {
    setWorkflow((current) => ({ ...current, priority }));
  }, []);
  const handleDueAtChange = useCallback((dueAt: string) => {
    setWorkflow((current) => ({ ...current, dueAt }));
  }, []);
  const handleSamplingTargetRateChange = useCallback((samplingTargetRate: string) => {
    setQuality((current) => ({ ...current, samplingTargetRate }));
  }, []);
  const handleMinAgreementRateChange = useCallback((minAgreementRate: string) => {
    setQuality((current) => ({ ...current, minAgreementRate }));
  }, []);
  const handleMinQualityScoreChange = useCallback((minQualityScore: string) => {
    setQuality((current) => ({ ...current, minQualityScore }));
  }, []);
  const handleAutoSampleReviewChange = useCallback((autoSampleReview: boolean) => {
    setQuality((current) => ({ ...current, autoSampleReview }));
  }, []);
  const handleRequireConsensusBeforeApprovalChange = useCallback((requireConsensusBeforeApproval: boolean) => {
    setQuality((current) => ({ ...current, requireConsensusBeforeApproval }));
  }, []);
  const handleDatasetBudgetChange = useCallback((datasetBudget: string) => {
    setPayment((current) => ({ ...current, datasetBudget }));
  }, []);
  const handleReviewShareChange = useCallback((reviewShare: string) => {
    setPayment((current) => ({ ...current, reviewShare }));
  }, []);
  const handleCurrencyChange = useCallback((currencyValue: string) => {
    setPayment((current) => ({ ...current, currency: currencyValue }));
  }, []);

  useEffect(() => {
    setWorkflow(getDatasetWorkflowDraft(dataset));
    setQuality(getDatasetQualityDraft(dataset));
    setPayment(getDatasetPaymentDraft(dataset));
  }, [dataset.id, dataset.metadata, dataset.version]);

  useEffect(() => {
    setParticipants([]);
    setParticipantsRequested(false);
    setParticipantsLoading(false);
  }, [dataset.id, dataset.projectId]);

  const loadParticipants = useCallback(async () => {
    if (participantsRequested || participantsLoading) {
      return;
    }

    if (!session || !dataset.canGenerateTasks) {
      setParticipants([]);
      return;
    }

    setParticipantsRequested(true);
    setParticipantsLoading(true);

    try {
      setParticipants(await listTaskParticipants(session, dataset.projectId));
    } catch (reason) {
      setParticipantsRequested(false);
      setParticipants([]);
      setPageError(reason instanceof Error ? reason.message : "Unable to load dataset task members.");
    } finally {
      setParticipantsLoading(false);
    }
  }, [dataset.canGenerateTasks, dataset.projectId, participantsLoading, participantsRequested, session, setPageError]);

  const handleApplyRouting = useCallback(async () => {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const workflowInput = buildDatasetRoutingInput(workflow);

    if (!workflowInput.ok) {
      setPageError(workflowInput.error);
      return;
    }

    setSavingAction("routing");

    try {
      const result = await applyDatasetTaskRouting(session, dataset.id, workflowInput.value);
      setMessage(`${result.updatedCount} active task${result.updatedCount === 1 ? "" : "s"} updated with routing.`);
      await onSaved();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save controller config.");
    } finally {
      setSavingAction(null);
    }
  }, [dataset.id, onSaved, session, setPageError, workflow]);

  const handleSaveQuality = useCallback(async () => {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const workflowInput = buildDatasetQualityInput(quality);

    if (!workflowInput.ok) {
      setPageError(workflowInput.error);
      return;
    }

    setSavingAction("quality");

    try {
      await saveDatasetQualityGates(session, dataset.id, workflowInput.value);
      setMessage("Quality gates saved.");
      await onSaved();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save controller config.");
    } finally {
      setSavingAction(null);
    }
  }, [dataset.id, onSaved, quality, session, setPageError]);

  const handleSaveBudget = useCallback(async () => {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const workflowInput = buildDatasetBudgetInput({
      dataset,
      economics,
      payment,
      workflow
    });

    if (!workflowInput.ok) {
      setPageError(workflowInput.error);
      return;
    }

    setSavingAction("budget");

    try {
      const result = await applyDatasetBudgetPolicy(session, dataset.id, workflowInput.value);
      setMessage(`${savedBudgetCredits > 0 ? "Budget increased" : "Budget saved"}. ${result.updatedCount} active task${result.updatedCount === 1 ? "" : "s"} updated.`);
      await onSaved();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save controller config.");
    } finally {
      setSavingAction(null);
    }
  }, [dataset, economics, onSaved, payment, savedBudgetCredits, session, setPageError, workflow]);

  const handleSaveDefaults = useCallback(async () => {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const workflowInput = buildDatasetControllerInput({
      dataset,
      economics,
      payment,
      quality,
      workflow
    });

    if (!workflowInput.ok) {
      setPageError(workflowInput.error);
      return;
    }

    setSavingAction("defaults");

    try {
      await saveDatasetTaskWorkflowDefaults(session, dataset.id, workflowInput.value);
      setMessage(isConfigured ? "Controller defaults updated." : "Controller defaults saved.");
      await onSaved();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save controller config.");
    } finally {
      setSavingAction(null);
    }
  }, [dataset, economics, isConfigured, onSaved, payment, quality, session, setPageError, workflow]);
  const handleApplyRoutingClick = useCallback(() => {
    void handleApplyRouting();
  }, [handleApplyRouting]);
  const handleSaveQualityClick = useCallback(() => {
    void handleSaveQuality();
  }, [handleSaveQuality]);
  const handleSaveBudgetClick = useCallback(() => {
    void handleSaveBudget();
  }, [handleSaveBudget]);
  const handleSaveDefaultsClick = useCallback(() => {
    void handleSaveDefaults();
  }, [handleSaveDefaults]);

  return (
    <section className="panel dataset-controller-config">
      <div className="dataset-template-assignment-head">
        <div>
          <p className="eyebrow">Controller</p>
          <h3>Task controller config</h3>
          <p className="muted-copy">Configure assignment, quality review, and dataset budget before generating tasks.</p>
        </div>
        <span className={`status-pill compact ${isConfigured ? "" : "warning"}`}>
          {isConfigured ? "Configured" : "Required"}
        </span>
      </div>

      <div className="dataset-controller-sections">
        <AssignmentSection
          assignees={assignees}
          loadingParticipants={participantsLoading}
          onApplyRouting={handleApplyRoutingClick}
          onAssigneeIdsChange={handleAssigneeIdsChange}
          onAssignedToChange={handleAssignedToChange}
          onAssignmentModeChange={handleAssignmentModeChange}
          onDueAtChange={handleDueAtChange}
          onLoadParticipants={() => void loadParticipants()}
          onPriorityChange={handlePriorityChange}
          onReviewerChange={handleReviewerChange}
          reviewers={reviewers}
          saving={saving}
          savingAction={savingAction}
          selectedAssigneeNames={selectedAssigneeNames}
          workflow={workflow}
        />

        <QualitySection
          onAutoSampleReviewChange={handleAutoSampleReviewChange}
          onMinAgreementRateChange={handleMinAgreementRateChange}
          onMinQualityScoreChange={handleMinQualityScoreChange}
          onRequireConsensusBeforeApprovalChange={handleRequireConsensusBeforeApprovalChange}
          onSamplingTargetRateChange={handleSamplingTargetRateChange}
          onSaveQuality={handleSaveQualityClick}
          quality={quality}
          saving={saving}
          savingAction={savingAction}
        />

        <BudgetSection
          dataset={dataset}
          economics={economics}
          onCurrencyChange={handleCurrencyChange}
          onDatasetBudgetChange={handleDatasetBudgetChange}
          onReviewShareChange={handleReviewShareChange}
          onSaveBudget={handleSaveBudgetClick}
          payment={payment}
          previewCurrency={previewCurrency}
          savedBudgetCredits={savedBudgetCredits}
          saving={saving}
          savingAction={savingAction}
          workflow={workflow}
        />
      </div>

      <button className="primary-button" disabled={saving} onClick={handleSaveDefaultsClick} type="button">
        <Save size={18} />
        {savingAction === "defaults"
          ? (isConfigured ? "Updating defaults" : "Saving defaults")
          : isConfigured ? "Update defaults" : "Save controller"}
      </button>
      {message ? <p className="form-success">{message}</p> : null}
    </section>
  );
}
