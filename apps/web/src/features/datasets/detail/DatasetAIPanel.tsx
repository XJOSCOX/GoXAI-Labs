import { useEffect, useMemo, useState } from "react";
import { Bot, BrainCircuit, Upload } from "lucide-react";
import {
  generateMockDatasetAIPredictions,
  importDatasetAIPredictions,
  listAIJobs,
  listModelProviders,
  type AIJobSummary,
  type DatasetAIPredictionImportResult,
  type DatasetSummary,
  type ModelProviderSummary
} from "../../../api";
import { type AuthSession } from "../../shared/resourceSession";
import { formatEnum } from "../../../utils/format";

const exampleJsonl = `{"assetName":"horse-1.jpg","regions":[{"type":"BBOX","label":"Horse","geometry":{"x":0.12,"y":0.18,"width":0.42,"height":0.36},"confidence":0.91}]}
{"taskId":"TASK_ID","predictions":{"regions":[{"type":"BBOX","label":"Car","geometry":{"x":0.2,"y":0.2,"width":0.3,"height":0.25}}]}}`;

type DatasetAIPanelProps = {
  dataset: DatasetSummary;
  onImported: () => Promise<void>;
  session: AuthSession;
  setPageError: (error: string | null) => void;
};

export function DatasetAIPanel({ dataset, onImported, session, setPageError }: DatasetAIPanelProps) {
  const [providers, setProviders] = useState<ModelProviderSummary[]>([]);
  const [jobs, setJobs] = useState<AIJobSummary[]>([]);
  const [providerId, setProviderId] = useState("");
  const [payload, setPayload] = useState(exampleJsonl);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mocking, setMocking] = useState(false);
  const [result, setResult] = useState<DatasetAIPredictionImportResult | null>(null);
  const completedJobs = useMemo(() => jobs.filter((job) => job.status === "COMPLETED"), [jobs]);
  const totalRegions = useMemo(
    () => jobs.reduce((sum, job) => sum + (job.outputJson?.predictions?.regions?.length ?? 0), 0),
    [jobs]
  );

  useEffect(() => {
    if (!session) {
      setProviders([]);
      setJobs([]);
      return;
    }

    let active = true;
    setLoading(true);
    setPageError(null);

    Promise.all([
      listModelProviders(session, { projectId: dataset.projectId }),
      listAIJobs(session, { datasetId: dataset.id })
    ])
      .then(([nextProviders, nextJobs]) => {
        if (!active) {
          return;
        }

        setProviders(nextProviders);
        setJobs(nextJobs);
      })
      .catch((reason) => {
        if (active) {
          setPageError(reason instanceof Error ? reason.message : "Unable to load dataset AI jobs.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [dataset.id, dataset.projectId, session, setPageError]);

  async function handleImport() {
    setResult(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    if (!payload.trim()) {
      setPageError("Paste a JSON or JSONL prediction payload.");
      return;
    }

    setImporting(true);

    try {
      const nextResult = await importDatasetAIPredictions(session, {
        datasetId: dataset.id,
        modelProviderId: providerId || null,
        predictions: payload
      });
      setResult(nextResult);
      setJobs((current) => [...nextResult.jobs, ...current]);
      await onImported();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to import dataset predictions.");
    } finally {
      setImporting(false);
    }
  }

  async function handleGenerateMock() {
    setResult(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setMocking(true);

    try {
      const nextResult = await generateMockDatasetAIPredictions(session, {
        datasetId: dataset.id,
        limit: 25,
        modelProviderId: providerId || null
      });
      setResult(nextResult);
      setJobs((current) => [...nextResult.jobs, ...current]);
      await onImported();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to generate dataset test prelabels.");
    } finally {
      setMocking(false);
    }
  }

  return (
    <section className="dataset-ai-layout">
      <section className="panel dataset-ai-import-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">AI pre-labeling</p>
            <h2>Import dataset predictions</h2>
          </div>
          <Upload size={20} />
        </div>
        <div className="dataset-ai-import-grid">
          <label>
            Provider
            <select onChange={(event) => setProviderId(event.currentTarget.value)} value={providerId}>
              <option value="">Manual import</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} ({formatEnum(provider.type)})
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            JSON or JSONL
            <textarea onChange={(event) => setPayload(event.currentTarget.value)} value={payload} />
          </label>
        </div>
        <div className="dataset-ai-actions">
          <button className="primary-button" disabled={importing || !dataset.canGenerateTasks} onClick={() => void handleImport()} type="button">
            <Bot size={17} />
            {importing ? "Importing" : "Import predictions"}
          </button>
          <button className="secondary-button" disabled={mocking || !dataset.canGenerateTasks} onClick={() => void handleGenerateMock()} type="button">
            <BrainCircuit size={17} />
            {mocking ? "Generating" : "Generate test prelabels"}
          </button>
        </div>
        {result ? (
          <div className="dataset-ai-result">
            <span>
              <strong>{result.importedCount}</strong>
              <small>Tasks imported</small>
            </span>
            <span>
              <strong>{result.skippedCount}</strong>
              <small>Skipped rows</small>
            </span>
            <span>
              <strong>{result.totalRegions}</strong>
              <small>Regions</small>
            </span>
          </div>
        ) : null}
        {result && result.errors.length > 0 ? (
          <div className="dataset-ai-errors">
            {result.errors.slice(0, 5).map((error) => (
              <article key={`${error.row}-${error.taskId ?? error.assetName ?? error.error}`}>
                <strong>Row {error.row}</strong>
                <span>{error.error}</span>
                <small>{error.taskId ?? error.assetName ?? "No match key"}</small>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel dataset-ai-jobs-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Prediction jobs</p>
            <h2>Dataset ledger</h2>
          </div>
          <BrainCircuit size={20} />
        </div>
        <div className="dataset-ai-metrics">
          <span>
            <strong>{jobs.length}</strong>
            <small>Total jobs</small>
          </span>
          <span>
            <strong>{completedJobs.length}</strong>
            <small>Completed</small>
          </span>
          <span>
            <strong>{totalRegions}</strong>
            <small>Regions</small>
          </span>
        </div>
        <div className="dataset-ai-job-list">
          {jobs.map((job) => (
            <article className="dataset-ai-job-row" key={job.id}>
              <span>
                <strong>{job.task?.id ?? "Dataset job"}</strong>
                <small>{job.modelProvider?.name ?? "Manual import"}</small>
              </span>
              <span>
                <strong>{job.outputJson?.predictions?.regions?.length ?? 0}</strong>
                <small>regions</small>
              </span>
              <span>
                <strong>{formatEnum(job.status)}</strong>
                <small>{formatDateTime(job.completedAt ?? job.createdAt)}</small>
              </span>
            </article>
          ))}
          {jobs.length === 0 && <p className="muted-copy">{loading ? "Loading AI jobs." : "No prediction jobs for this dataset yet."}</p>}
        </div>
      </section>
    </section>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not finished";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
