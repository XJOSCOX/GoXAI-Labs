import { useEffect, useMemo, useState } from "react";
import { Bot, BrainCircuit, CheckCircle2, CircleSlash, Plus, RefreshCw, Search } from "lucide-react";
import {
  createModelProvider,
  generateMockDatasetAIPredictions,
  listDatasets,
  listAIJobs,
  listModelProviders,
  listOrganizations,
  listProjects,
  updateModelProvider,
  type AIJobSummary,
  type DatasetSummary,
  type ModelProviderSummary,
  type OrganizationSummary,
  type ProjectSummary
} from "../../api";
import { useAuth } from "../../auth";
import { formatEnum } from "../../utils/format";

const providerTypes = ["OPENAI", "ANTHROPIC", "GOOGLE", "HUGGINGFACE", "CUSTOM"];

const emptyConfig = `{
  "endpoint": "",
  "model": "",
  "notes": "Configuration is stored for future execution."
}`;

export function AIPage() {
  const { session } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [providers, setProviders] = useState<ModelProviderSummary[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [jobs, setJobs] = useState<AIJobSummary[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [providerName, setProviderName] = useState("");
  const [providerType, setProviderType] = useState("OPENAI");
  const [providerConfig, setProviderConfig] = useState(emptyConfig);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mocking, setMocking] = useState(false);

  const manageableOrganizations = useMemo(
    () => organizations.filter((organization) => ["OWNER", "ADMIN", "MANAGER"].includes(organization.role)),
    [organizations]
  );
  const manageableProjects = useMemo(
    () => projects.filter((project) => (project.canManage || project.canCreateDataset) && (!selectedOrganizationId || project.organizationId === selectedOrganizationId)),
    [projects, selectedOrganizationId]
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId]
  );
  const jobScopeLabel = selectedProject?.name ?? selectedOrganization?.name ?? "Workspace";
  const completedJobs = jobs.filter((job) => job.status === "COMPLETED").length;
  const regionCount = jobs.reduce((total, job) => total + (job.outputJson?.predictions?.regions?.length ?? 0), 0);

  useEffect(() => {
    if (!session) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([listOrganizations(session), listProjects(session)])
      .then(([nextOrganizations, nextProjects]) => {
        if (!active) {
          return;
        }

        setOrganizations(nextOrganizations);
        setProjects(nextProjects);
        setSelectedOrganizationId((current) => current || nextOrganizations.find((organization) => ["OWNER", "ADMIN", "MANAGER"].includes(organization.role))?.id || "");
        setSelectedProjectId((current) => current || nextProjects.find((project) => project.canManage || project.canCreateDataset)?.id || "");
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load AI workspace.");
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
  }, [session]);

  useEffect(() => {
    if (!session || (!selectedProjectId && !selectedOrganizationId)) {
      setProviders([]);
      setJobs([]);
      setDatasets([]);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      listModelProviders(session, selectedProjectId ? { projectId: selectedProjectId } : { organizationId: selectedOrganizationId }),
      selectedProjectId ? listAIJobs(session, { projectId: selectedProjectId }) : Promise.resolve([] as AIJobSummary[]),
      selectedProjectId ? listDatasets(session, selectedProjectId) : Promise.resolve([] as DatasetSummary[])
    ])
      .then(([nextProviders, nextJobs, nextDatasets]) => {
        if (!active) {
          return;
        }

        setProviders(nextProviders);
        setJobs(nextJobs);
        setDatasets(nextDatasets);
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load AI providers.");
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
  }, [selectedOrganizationId, selectedProjectId, session]);

  async function handleSaveProvider() {
    if (!session || !providerName.trim()) {
      return;
    }

    const config = parseProviderConfig(providerConfig);

    if (!config.ok) {
      setError(config.error);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const provider = editingProviderId
        ? await updateModelProvider(session, editingProviderId, {
            configJson: config.value,
            name: providerName,
            type: providerType
          })
        : await createModelProvider(session, {
            configJson: config.value,
            name: providerName,
            organizationId: selectedProjectId ? undefined : selectedOrganizationId,
            projectId: selectedProjectId || undefined,
            type: providerType
          });
      setProviders((current) => editingProviderId
        ? current.map((candidate) => candidate.id === provider.id ? provider : candidate)
        : [provider, ...current]);
      setProviderName("");
      setProviderConfig(emptyConfig);
      setEditingProviderId(null);
      setMessage(editingProviderId ? "AI provider updated." : "AI provider saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create AI provider.");
    } finally {
      setSaving(false);
    }
  }

  function handleEditProvider(provider: ModelProviderSummary) {
    setEditingProviderId(provider.id);
    setProviderName(provider.name);
    setProviderType(provider.type);
    setProviderConfig(JSON.stringify(provider.configJson ?? {}, null, 2));
    setMessage(null);
    setError(null);
  }

  function handleCancelEditProvider() {
    setEditingProviderId(null);
    setProviderName("");
    setProviderType("OPENAI");
    setProviderConfig(emptyConfig);
  }

  async function handleToggleProvider(provider: ModelProviderSummary) {
    if (!session) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updated = await updateModelProvider(session, provider.id, {
        active: !provider.active
      });
      setProviders((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update provider.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    if (!session || (!selectedProjectId && !selectedOrganizationId)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextProviders, nextJobs] = await Promise.all([
        listModelProviders(session, selectedProjectId ? { projectId: selectedProjectId } : { organizationId: selectedOrganizationId }),
        selectedProjectId ? listAIJobs(session, { projectId: selectedProjectId }) : Promise.resolve([] as AIJobSummary[])
      ]);
      setProviders(nextProviders);
      setJobs(nextJobs);
      setMessage("AI workspace refreshed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refresh AI workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateProjectMock() {
    if (!session || !selectedProjectId) {
      return;
    }

    setMocking(true);
    setError(null);
    setMessage(null);

    try {
      const datasetId = datasets[0]?.id;

      if (!datasetId) {
        setError("Choose a project with at least one dataset to generate test prelabels.");
        return;
      }

      const result = await generateMockDatasetAIPredictions(session, {
        datasetId,
        limit: 10
      });
      setJobs((current) => [...result.jobs, ...current]);
      setMessage(`Generated ${result.importedCount} test prelabel jobs.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to generate test prelabels.");
    } finally {
      setMocking(false);
    }
  }

  return (
    <section className="page-stack ai-page">
      {(error || message) && <p className={error ? "form-error" : "form-success"}>{error ?? message}</p>}
      <section className="panel ai-command-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">AI workspace</p>
            <h2>Pre-labeling setup</h2>
          </div>
          <button className="secondary-button compact-button" disabled={loading} onClick={() => void handleRefresh()} type="button">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="secondary-button compact-button" disabled={mocking || !selectedProjectId} onClick={() => void handleGenerateProjectMock()} type="button">
            <Bot size={16} />
            {mocking ? "Generating" : "Run test prelabels"}
          </button>
        </div>
        <div className="ai-scope-grid">
          <label>
            Organization
            <select
              onChange={(event) => {
                setSelectedOrganizationId(event.currentTarget.value);
                setSelectedProjectId("");
              }}
              value={selectedOrganizationId}
            >
              <option value="">Choose organization</option>
              {manageableOrganizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project scope
            <select onChange={(event) => setSelectedProjectId(event.currentTarget.value)} value={selectedProjectId}>
              <option value="">Organization level</option>
              {manageableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ai-kpi-grid">
          <Metric label="Providers" value={providers.length} />
          <Metric label="Jobs" value={jobs.length} />
          <Metric label="Completed" value={completedJobs} />
          <Metric label="Regions" value={regionCount} />
        </div>
      </section>

      <div className="ai-workspace-grid">
        <section className="panel ai-provider-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Providers</p>
              <h2>Future model connections</h2>
            </div>
            <BrainCircuit size={20} />
          </div>
          <div className="ai-provider-form">
            <label>
              Provider name
              <input onChange={(event) => setProviderName(event.currentTarget.value)} placeholder="OpenAI vision pre-labeler" value={providerName} />
            </label>
            <label>
              Type
              <select onChange={(event) => setProviderType(event.currentTarget.value)} value={providerType}>
                {providerTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatEnum(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Config JSON
              <textarea onChange={(event) => setProviderConfig(event.currentTarget.value)} value={providerConfig} />
            </label>
            <div className="ai-provider-form-actions">
              <button className="primary-button" disabled={saving || !providerName.trim() || (!selectedProjectId && !selectedOrganizationId)} onClick={() => void handleSaveProvider()} type="button">
                <Plus size={17} />
                {editingProviderId ? "Update provider" : "Save provider"}
              </button>
              {editingProviderId ? (
                <button className="secondary-button" disabled={saving} onClick={handleCancelEditProvider} type="button">
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
          <div className="ai-provider-list">
            {providers.map((provider) => (
              <article className="ai-provider-card" key={provider.id}>
                <span className={provider.active ? "ai-provider-icon active" : "ai-provider-icon"}>
                  {provider.active ? <CheckCircle2 size={17} /> : <CircleSlash size={17} />}
                </span>
                <span>
                  <strong>{provider.name}</strong>
                  <small>
                    {formatEnum(provider.type)} · {provider.projectId ? "Project" : "Organization"} scope
                  </small>
                </span>
                <button className="secondary-button compact-button" disabled={saving} onClick={() => void handleToggleProvider(provider)} type="button">
                  {provider.active ? "Pause" : "Activate"}
                </button>
                <button className="secondary-button compact-button" disabled={saving} onClick={() => handleEditProvider(provider)} type="button">
                  Edit
                </button>
              </article>
            ))}
            {providers.length === 0 && <p className="muted-copy">No AI providers configured for this scope.</p>}
          </div>
        </section>

        <section className="panel ai-jobs-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Prediction jobs</p>
              <h2>{jobScopeLabel}</h2>
            </div>
            <Search size={20} />
          </div>
          <div className="ai-job-list">
            {jobs.map((job) => (
              <article className="ai-job-row" key={job.id}>
                <span className="ai-job-type">
                  <Bot size={16} />
                  <strong>{formatEnum(job.type)}</strong>
                </span>
                <span>
                  <strong>{job.dataset?.name ?? job.task?.id ?? "Project job"}</strong>
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
            {jobs.length === 0 && (
              <div className="empty-state compact">
                <Bot size={28} />
                <strong>No AI jobs yet</strong>
                <span>Import predictions from a task to see the project job ledger here.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <span>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function parseProviderConfig(value: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!value.trim()) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Provider config must be a JSON object." };
    }

    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Provider config JSON is not valid." };
  }
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
