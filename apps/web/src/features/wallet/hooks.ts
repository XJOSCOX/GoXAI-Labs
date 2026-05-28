import { useCallback, useEffect, useState } from "react";

import {
  getCreatorWalletSummary,
  getWorkerWalletSummary,
  type CreatorWalletSummary,
  type WorkerWalletSummary
} from "../../api";
import { type AuthSession, getSessionKey, useLatestSessionRef } from "../shared/resourceSession";

const emptyCreatorWallet: CreatorWalletSummary = {
  availableBalance: 0,
  currency: "USD",
  datasetReports: [],
  ledgerEntries: [],
  paidToAnnotators: 0,
  refundedBalance: 0,
  reservedBalance: 0,
  underReviewBalance: 0,
  walletCount: 0
};

const emptyWorkerWallet: WorkerWalletSummary = {
  approvedBalance: 0,
  approvedCreditCount: 0,
  availableBalance: 0,
  availableCreditCount: 0,
  currency: "USD",
  holdDays: 7,
  nextAvailableAt: null,
  paidWithdrawalBalance: 0,
  pendingWithdrawalBalance: 0,
  pendingWithdrawalCount: 0,
  payouts: [],
  recentEvents: [],
  totalEarnedBalance: 0,
  underReviewBalance: 0,
  underReviewCreditCount: 0,
  withdrawnBalance: 0
};

export function useCreatorWalletSummary(session: AuthSession) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [wallet, setWallet] = useState<CreatorWalletSummary>(emptyCreatorWallet);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setWallet(emptyCreatorWallet);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setWallet(await getCreatorWalletSummary(activeSession));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load creator wallet.");
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
    reload,
    setError,
    wallet
  };
}

export function useWorkerWalletSummary(session: AuthSession) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [wallet, setWallet] = useState<WorkerWalletSummary>(emptyWorkerWallet);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setWallet(emptyWorkerWallet);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setWallet(await getWorkerWalletSummary(activeSession));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load worker wallet.");
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
    reload,
    setError,
    wallet
  };
}
