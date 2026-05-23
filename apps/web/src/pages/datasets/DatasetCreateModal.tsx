import { type FormEvent, useEffect, useState } from "react";
import { Database, X } from "lucide-react";
import { createDataset, type ProjectSummary } from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { useFormDraft } from "../../hooks/useResources";

export function DatasetCreateModal({
  defaultProjectId,
  onClose,
  onCreated,
  projects,
  session,
  setPageError
}: {
  defaultProjectId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  projects: ProjectSummary[];
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="dataset-modal-title"
        aria-modal="true"
        className="modal-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Datasets</p>
            <h2 id="dataset-modal-title">Create dataset</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dataset form">
            <X size={17} />
          </button>
        </div>
        {modalError && <p className="form-error">{modalError}</p>}
        <DatasetForm
          defaultProjectId={defaultProjectId}
          embedded
          onCreated={async () => {
            setModalError(null);
            setPageError(null);
            await onCreated();
            onClose();
          }}
          projects={projects}
          session={session}
          setPageError={(error) => {
            setModalError(error);
            if (!error) {
              setPageError(null);
            }
          }}
        />
      </section>
    </div>
  );
}

function DatasetForm({
  defaultProjectId,
  embedded = false,
  onCreated,
  projects,
  session,
  setPageError
}: {
  defaultProjectId?: string;
  embedded?: boolean;
  onCreated: () => Promise<void>;
  projects: ProjectSummary[];
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const datasetDraft = useFormDraft(
    defaultProjectId ? `goxai-draft-dataset-${defaultProjectId}` : "goxai-draft-dataset"
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      const dataset = await createDataset(session, {
        projectId: defaultProjectId ?? getFormValue(event, "projectId"),
        name: getFormValue(event, "name"),
        description: getFormValue(event, "description")
      });

      form.reset();
      datasetDraft.clearDraft();
      setSavedMessage(`${dataset.name} was created as a draft.`);
      await onCreated();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to create dataset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={embedded ? "dataset-form" : "panel dataset-form"}
      onChange={datasetDraft.saveDraft}
      onSubmit={handleSubmit}
      ref={datasetDraft.formRef}
    >
      {!defaultProjectId && (
        <label>
          Project
          <select name="projectId" defaultValue={projects[0]?.id ?? ""} required>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={defaultProjectId ? "wide" : undefined}>
        Dataset name
        <input name="name" placeholder="Training set v1" required />
      </label>
      <label className="wide">
        Description
        <textarea name="description" placeholder="Source, scope, or ingestion notes" rows={3} />
      </label>
      {savedMessage && <p className="form-success wide">{savedMessage}</p>}
      <button className="primary-button wide" type="submit" disabled={saving || projects.length === 0}>
        <Database size={18} />
        {saving ? "Creating" : "Create draft dataset"}
      </button>
    </form>
  );
}
