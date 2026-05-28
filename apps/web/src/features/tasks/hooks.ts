import { useCallback, useEffect, useState } from "react";

import {
  createTaskView,
  deleteTaskView,
  getTaskColumnSettings,
  getTask,
  getTaskStats,
  listTaskFolders,
  listTaskPage,
  listTasks,
  listTaskViews,
  updateTaskColumnSettings,
  updateTaskView,
  type TaskDatasetFolderSummary,
  type TaskProjectFolderSummary,
  type TaskQueueColumnKey,
  type TaskQueueFilters,
  type TaskSavedView,
  type TaskStatsSummary,
  type TaskSummary
} from "../../api";
import { type AuthSession, getSessionKey, useLatestSessionRef } from "../shared/resourceSession";

export function useTasks(session: AuthSession, input: { datasetId?: string; projectId?: string } = {}) {
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
  session: AuthSession,
  input: { datasetId?: string; page?: number; pageSize?: number; projectId?: string; queue?: "review" | "work" } & TaskQueueFilters = {}
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
  const [queueCounts, setQueueCounts] = useState<Partial<Record<NonNullable<TaskQueueFilters["quality"]>, number>>>({});

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setTasks([]);
      setPageInfo((current) => ({ ...current, total: 0, totalPages: 1 }));
      setQueueCounts({});
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
      setQueueCounts(result.queueCounts ?? {});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [
    input.assignment,
    input.datasetId,
    input.due,
    input.minPriority,
    input.page,
    input.pageSize,
    input.projectId,
    input.quality,
    input.queue,
    input.search,
    input.status,
    sessionKey,
    sessionRef
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    pageInfo,
    queueCounts,
    reload,
    setError,
    tasks
  };
}

export function useTaskFolders(session: AuthSession, input: { projectId?: string; queue?: "review" | "work" } = {}) {
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
  }, [input.projectId, input.queue, sessionKey, sessionRef]);

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

export function useTaskViews(session: AuthSession, input: { datasetId?: string; projectId?: string; queue?: "review" | "work" } = {}) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [views, setViews] = useState<TaskSavedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setViews([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listTaskViews(activeSession, input);
      setViews(result.views);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load saved task views.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, input.queue, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (view: { datasetId?: string; filters: TaskQueueFilters; name: string; projectId?: string; queue: "review" | "work" }) => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      throw new Error("Authentication required.");
    }

    const saved = await createTaskView(activeSession, view);
    await reload();
    return saved;
  }, [reload, sessionRef]);

  const update = useCallback(async (viewId: string, view: Partial<{ datasetId: string; filters: TaskQueueFilters; name: string; projectId: string; queue: "review" | "work" }>) => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      throw new Error("Authentication required.");
    }

    const saved = await updateTaskView(activeSession, viewId, view);
    await reload();
    return saved;
  }, [reload, sessionRef]);

  const remove = useCallback(async (viewId: string) => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      throw new Error("Authentication required.");
    }

    await deleteTaskView(activeSession, viewId);
    await reload();
  }, [reload, sessionRef]);

  return {
    error,
    loading,
    reload,
    remove,
    save,
    setError,
    update,
    views
  };
}

export function useTaskColumnSettings(session: AuthSession, input: { datasetId?: string; projectId?: string; queue?: "review" | "work" } = {}) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [columns, setColumns] = useState<TaskQueueColumnKey[]>(["status", "priority", "price", "due", "assigned", "reviewer", "action"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getTaskColumnSettings(activeSession, input);
      setColumns(result.columns);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load task columns.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, input.queue, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (nextColumns: TaskQueueColumnKey[]) => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      throw new Error("Authentication required.");
    }

    setColumns(nextColumns);
    const result = await updateTaskColumnSettings(activeSession, {
      ...input,
      columns: nextColumns
    });
    setColumns(result.columns);
    return result.columns;
  }, [input.datasetId, input.projectId, input.queue, sessionRef]);

  return {
    columns,
    error,
    loading,
    reload,
    save,
    setColumns,
    setError
  };
}

export function useTaskStats(session: AuthSession, input: { datasetId?: string; projectId?: string } = {}) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [stats, setStats] = useState<TaskStatsSummary>({
    active: 0,
    approved: 0,
    done: 0,
    pending: 0,
    rejected: 0,
    review: 0,
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
        approved: 0,
        done: 0,
        pending: 0,
        rejected: 0,
        review: 0,
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

export function useTask(session: AuthSession, taskId: string) {
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
