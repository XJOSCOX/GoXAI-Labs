import { useCallback, useEffect, useState } from "react";

import { getProject, listProjects, type ProjectSummary } from "../../api";
import { type AuthSession, getSessionKey, useLatestSessionRef } from "../shared/resourceSession";

export function useProjects(session: AuthSession) {
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

export function useProject(session: AuthSession, projectId: string) {
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
