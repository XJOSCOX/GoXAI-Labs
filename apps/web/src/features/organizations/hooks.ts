import { useCallback, useEffect, useState } from "react";

import { getOrganization, listOrganizations, type OrganizationDetail, type OrganizationSummary } from "../../api";
import { type AuthSession, getSessionKey, useLatestSessionRef } from "../shared/resourceSession";

export function useOrganizations(session: AuthSession) {
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

export function useOrganization(session: AuthSession, organizationId: string) {
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
