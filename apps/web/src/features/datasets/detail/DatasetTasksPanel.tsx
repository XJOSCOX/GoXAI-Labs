import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { generateTasksFromDataset, type DatasetSummary, type TaskSummary } from "../../../api";
import { type AuthSession } from "../../shared/resourceSession";
import { TasksTable } from "../../tasks/queue/TasksTable";
import {
  getDatasetAssignmentLabel,
  hasDatasetControllerConfig,
  hasDatasetTemplateConfig
} from "./datasetDetailUtils";

type DatasetTasksPanelProps = {
  activeTaskTotal: number;
  assetTotal: number;
  canGenerateTasks: boolean;
  dataset: DatasetSummary;
  loading: boolean;
  onGenerated: () => Promise<void>;
  onPageChange: (page: number) => void;
  pageInfo: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  session: AuthSession;
  setPageError: (error: string | null) => void;
  taskTotal: number;
  tasks: TaskSummary[];
};

export function DatasetTasksPanel({
  activeTaskTotal,
  assetTotal,
  canGenerateTasks,
  dataset,
  loading,
  onGenerated,
  onPageChange,
  pageInfo,
  session,
  setPageError,
  taskTotal,
  tasks
}: DatasetTasksPanelProps) {
  const [generating, setGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<"all" | "custom">("all");
  const [taskQuantity, setTaskQuantity] = useState("10");
  const [message, setMessage] = useState<string | null>(null);
  const hasTemplateConfig = hasDatasetTemplateConfig(dataset);
  const hasControllerConfig = hasDatasetControllerConfig(dataset);
  const canGenerateConfiguredTasks = hasTemplateConfig && hasControllerConfig;
  const configIssue = !hasTemplateConfig && !hasControllerConfig
    ? "Apply a controller and template config before generating tasks."
    : !hasTemplateConfig
      ? "Apply a template config before generating tasks."
      : !hasControllerConfig
        ? "Apply a controller config before generating tasks."
        : null;

  async function handleGenerate() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const normalizedQuantity = Number(taskQuantity);

    if (generationMode === "custom" && (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1)) {
      setPageError("Enter a whole number greater than 0 for custom task generation.");
      return;
    }

    if (!canGenerateConfiguredTasks) {
      setPageError(configIssue ?? "Apply config before generating tasks.");
      return;
    }

    setGenerating(true);

    try {
      const result = await generateTasksFromDataset(session, dataset.id, {
        quantity: generationMode === "custom" ? normalizedQuantity : undefined
      });
      const remainingCount = result.remainingCount ?? 0;
      setMessage(
        `Generated ${result.createdCount} task${result.createdCount === 1 ? "" : "s"}. ` +
          `Skipped ${result.skippedCount} existing. Remaining ${remainingCount}. ` +
          `Assignment: ${getDatasetAssignmentLabel(dataset)}.`
      );
      await onGenerated();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to generate tasks.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="panel task-panel">
      <div className="task-panel-head">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>Dataset tasks</h2>
          <span>
            {taskTotal} task records for this dataset - {activeTaskTotal} active
          </span>
          <div className="dataset-readiness-badges">
            <span className={`status-pill compact ${hasControllerConfig ? "ready" : "warning"}`}>
              Controller: {hasControllerConfig ? "Ready" : "Required"}
            </span>
            <span className={`status-pill compact ${hasTemplateConfig ? "ready" : "warning"}`}>
              Template: {hasTemplateConfig ? "Ready" : "Required"}
            </span>
            <span className={`status-pill compact ${taskTotal >= assetTotal && assetTotal > 0 ? "ready" : "warning"}`}>
              Tasks: {taskTotal}/{assetTotal}
            </span>
          </div>
        </div>
        {canGenerateTasks ? (
          <div className="task-generator">
            <Link className="secondary-button compact-button" to={`/datasets/${dataset.id}/label-config`}>
              <ClipboardList size={15} />
              Apply Config
            </Link>
            <div className="task-generator-options" aria-label="Task generation quantity">
              <button
                className={generationMode === "all" ? "option-chip active" : "option-chip"}
                onClick={() => setGenerationMode("all")}
                type="button"
              >
                All
              </button>
              <button
                className={generationMode === "custom" ? "option-chip active" : "option-chip"}
                onClick={() => setGenerationMode("custom")}
                type="button"
              >
                Custom
              </button>
              {generationMode === "custom" && (
                <label className="task-quantity-field">
                  <span>Qty</span>
                  <input
                    min="1"
                    onChange={(event) => setTaskQuantity(event.currentTarget.value)}
                    step="1"
                    type="number"
                    value={taskQuantity}
                  />
                </label>
              )}
            </div>
            {configIssue ? <span className="inline-hint">{configIssue}</span> : null}
            <button className="primary-button" type="button" onClick={handleGenerate} disabled={generating || !canGenerateConfiguredTasks}>
              <ClipboardList size={18} />
              {generating ? "Generating" : "Generate tasks"}
            </button>
          </div>
        ) : null}
      </div>
      {message && <p className="form-success">{message}</p>}
      <TasksTable
        loading={loading}
        onChanged={onGenerated}
        onPageChange={onPageChange}
        pageInfo={pageInfo}
        session={session}
        setPageError={setPageError}
        tasks={tasks}
      />
    </section>
  );
}
