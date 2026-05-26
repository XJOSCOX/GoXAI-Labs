import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  getDataset,
  getOrganization,
  getProject,
  getTask,
  getTaskStats,
  listAssets,
  listDatasets,
  listOrganizations,
  listProjects,
  listTaskFolders,
  listTaskPage,
  listTasks,
  type AssetSummary,
  type DatasetSummary,
  type OrganizationDetail,
  type OrganizationSummary,
  type ProjectSummary,
  type TaskDatasetFolderSummary,
  type TaskProjectFolderSummary,
  type TaskStatsSummary,
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

export function useTaskPage(
  session: ReturnType<typeof useAuth>["session"],
  input: { datasetId?: string; page?: number; pageSize?: number; projectId?: string; queue?: "review" | "work" } = {}
) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 25,
    total: 0,
    totalPages: 1
  });

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setTasks([]);
      setPageInfo((current) => ({ ...current, total: 0, totalPages: 1 }));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listTaskPage(activeSession, input);
      setTasks(result.tasks);
      setPageInfo({
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.page, input.pageSize, input.projectId, input.queue, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    pageInfo,
    reload,
    setError,
    tasks
  };
}

export function useTaskFolders(
  session: ReturnType<typeof useAuth>["session"],
  input: { projectId?: string } = {}
) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [projects, setProjects] = useState<TaskProjectFolderSummary[]>([]);
  const [datasets, setDatasets] = useState<TaskDatasetFolderSummary[]>([]);
  const [project, setProject] = useState<{ id: string; name: string; slug: string; status: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setProjects([]);
      setDatasets([]);
      setProject(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listTaskFolders(activeSession, input);
      setProjects(result.projects ?? []);
      setDatasets(result.datasets ?? []);
      setProject(result.project ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load task folders.");
    } finally {
      setLoading(false);
    }
  }, [input.projectId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    datasets,
    error,
    loading,
    project,
    projects,
    reload,
    setError
  };
}

export function useTaskStats(
  session: ReturnType<typeof useAuth>["session"],
  input: { datasetId?: string; projectId?: string } = {}
) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [stats, setStats] = useState<TaskStatsSummary>({
    active: 0,
    done: 0,
    pending: 0,
    total: 0,
    unassigned: 0
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setStats({
        active: 0,
        done: 0,
        pending: 0,
        total: 0,
        unassigned: 0
      });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setStats(await getTaskStats(activeSession, input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load task stats.");
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
    stats
  };
}

export function useTask(session: ReturnType<typeof useAuth>["session"], taskId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [annotation, setAnnotation] = useState<Awaited<ReturnType<typeof getTask>>["annotation"]>(null);
  const [annotationHistory, setAnnotationHistory] = useState<Awaited<ReturnType<typeof getTask>>["annotationHistory"]>([]);
  const [comments, setComments] = useState<Awaited<ReturnType<typeof getTask>>["comments"]>([]);
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof getTask>>["reviews"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !taskId) {
      setAnnotation(null);
      setAnnotationHistory([]);
      setComments([]);
      setReviews([]);
      setTask(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getTask(activeSession, taskId);
      setAnnotation(result.annotation);
      setAnnotationHistory(result.annotationHistory);
      setComments(result.comments);
      setReviews(result.reviews);
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
    annotationHistory,
    comments,
    error,
    loading,
    reload,
    reviews,
    setAnnotation,
    setAnnotationHistory,
    setComments,
    setError,
    setReviews,
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
