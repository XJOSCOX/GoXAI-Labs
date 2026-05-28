import { useCallback, useEffect, useState } from "react";

import {
  getDataset,
  listAssets,
  listDatasets,
  type AssetSummary,
  type DatasetSummary
} from "../../api";
import { type AuthSession, getSessionKey, useLatestSessionRef } from "../shared/resourceSession";

export function useDatasets(session: AuthSession, projectId?: string) {
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

export function useDataset(session: AuthSession, datasetId: string) {
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

export function useAssets(session: AuthSession, input: { datasetId?: string; projectId?: string } = {}) {
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
