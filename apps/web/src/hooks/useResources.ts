import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  getDataset,
  getOrganization,
  getProject,
  getTask,
  listAssets,
  listDatasets,
  listOrganizations,
  listProjects,
  listTasks,
  type AssetSummary,
  type DatasetSummary,
  type OrganizationDetail,
  type OrganizationSummary,
  type ProjectSummary,
  type TaskSummary
} from "../api";
import { useAuth } from "../auth";

export function useOrganizations(session: ReturnType<typeof useAuth>["session"]) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setOrganizations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setOrganizations(await listOrganizations(activeSession));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load organizations.");
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    organizations,
    reload,
    setError
  };
}

export function useProjects(session: ReturnType<typeof useAuth>["session"]) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setProjects([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProjects(await listProjects(activeSession));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load projects.");
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    projects,
    reload,
    setError
  };
}

export function useOrganization(session: ReturnType<typeof useAuth>["session"], organizationId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !organizationId) {
      setOrganization(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setOrganization(await getOrganization(activeSession, organizationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load organization.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    organization,
    reload,
    setError
  };
}

export function useProject(session: ReturnType<typeof useAuth>["session"], projectId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !projectId) {
      setProject(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProject(await getProject(activeSession, projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load project.");
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    project,
    reload
  };
}

export function useDatasets(session: ReturnType<typeof useAuth>["session"], projectId?: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setDatasets([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setDatasets(await listDatasets(activeSession, projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load datasets.");
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    datasets,
    error,
    loading,
    reload,
    setError
  };
}

export function useDataset(session: ReturnType<typeof useAuth>["session"], datasetId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !datasetId) {
      setDataset(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setDataset(await getDataset(activeSession, datasetId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dataset.");
    } finally {
      setLoading(false);
    }
  }, [datasetId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    dataset,
    error,
    loading,
    reload
  };
}

export function useAssets(
  session: ReturnType<typeof useAuth>["session"],
  input: { datasetId?: string; projectId?: string } = {}
) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setAssets([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setAssets(await listAssets(activeSession, input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load assets.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    assets,
    error,
    loading,
    reload,
    setError
  };
}

export function useTasks(
  session: ReturnType<typeof useAuth>["session"],
  input: { datasetId?: string; projectId?: string } = {}
) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setTasks([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setTasks(await listTasks(activeSession, input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    reload,
    setError,
    tasks
  };
}

export function useTask(session: ReturnType<typeof useAuth>["session"], taskId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [annotation, setAnnotation] = useState<Awaited<ReturnType<typeof getTask>>["annotation"]>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !taskId) {
      setAnnotation(null);
      setTask(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getTask(activeSession, taskId);
      setAnnotation(result.annotation);
      setTask(result.task);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load task.");
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionRef, taskId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    annotation,
    error,
    loading,
    reload,
    setAnnotation,
    setError,
    setTask,
    task
  };
}

function useLatestSessionRef(session: ReturnType<typeof useAuth>["session"]) {
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  return sessionRef;
}

function getSessionKey(session: ReturnType<typeof useAuth>["session"]) {
  return session?.user.id ?? "signed-out";
}

export function useFormDraft(key: string) {
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const form = formRef.current;

    if (!form) {
      return;
    }

    const rawDraft = localStorage.getItem(key);

    if (!rawDraft) {
      return;
    }

    try {
      const draft = JSON.parse(rawDraft) as Record<string, string>;

      for (const [name, value] of Object.entries(draft)) {
        const field = form.elements.namedItem(name);

        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLSelectElement ||
          field instanceof HTMLTextAreaElement
        ) {
          if (field instanceof HTMLInputElement && field.type === "file") {
            continue;
          }

          field.value = value;
        }
      }
    } catch {
      localStorage.removeItem(key);
    }
  }, [key]);

  const saveDraft = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const draft: Record<string, string> = {};

      for (const [name, value] of formData.entries()) {
        if (typeof value === "string") {
          draft[name] = value;
        }
      }

      localStorage.setItem(key, JSON.stringify(draft));
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
  }, [key]);

  return {
    clearDraft,
    formRef,
    saveDraft
  };
}
