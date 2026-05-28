import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  cancelCreatorPayPalOrder,
  cancelCreatorStripeCheckout,
  captureCreatorPayPalOrder,
  completeCreatorStripeCheckout,
  createCreatorPlaidLinkToken,
  createCreatorPayPalOrder,
  createCreatorStripeAchCheckoutSession,
  createCreatorStripeCheckoutSession,
  disableCreatorFundingSource,
  downloadCreatorWalletExport,
  downloadWalletReceipt,
  getWorkerWalletSummary,
  linkCreatorPlaidStripeBankAccount,
  listCreatorFundingSources,
  listCreatorPaymentIntents,
  listCreatorWalletLedger,
  listWalletReceipts,
  requestWorkerWithdrawal,
  type CreatorWalletExportFormat,
  type CreatorLedgerPageResult,
  type CreatorWalletFundingSourceSummary,
  type CreatorWalletPaymentIntentSummary,
  type WalletReceiptSummary,
  type WorkerWalletSummary
} from "../../api";
import { useAuth } from "../../auth";
import { CreatorLedgerPanel } from "../../features/wallet/CreatorLedgerPanel";
import { CreatorWalletSummaryPanel, CreatorWalletSupportPanels, type CreatorTopUpProvider } from "../../features/wallet/CreatorWalletSummaryPanel";
import { WalletViewSwitcher } from "../../features/wallet/WalletViewSwitcher";
import { WorkerWalletPanels } from "../../features/wallet/WorkerWalletPanels";
import {
  emptyWorkerWallet,
  getLedgerFilter,
  getPageParam,
  getWalletView,
  walletPageSize,
  type WalletQueryUpdate
} from "../../features/wallet/walletUtils";

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        onExit?: (error: unknown) => void;
        onSuccess: (publicToken: string, metadata: {
          accounts?: Array<{
            id?: string;
            mask?: string;
            name?: string;
            subtype?: string;
            type?: string;
          }>;
          institution?: {
            name?: string;
          };
        }) => void;
        token: string;
      }) => {
        destroy?: () => void;
        open: () => void;
      };
    };
  }
}

export function WalletPage() {
  const { features, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ledger, setLedger] = useState<CreatorLedgerPageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<CreatorWalletExportFormat | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpProvider, setTopUpProvider] = useState<CreatorTopUpProvider>("paypal");
  const [toppingUp, setToppingUp] = useState(false);
  const [paypalFinalizing, setPaypalFinalizing] = useState(false);
  const [stripeFinalizing, setStripeFinalizing] = useState(false);
  const [linkingBank, setLinkingBank] = useState(false);
  const [fundingSources, setFundingSources] = useState<CreatorWalletFundingSourceSummary[]>([]);
  const [selectedFundingSourceId, setSelectedFundingSourceId] = useState("");
  const [paymentIntents, setPaymentIntents] = useState<CreatorWalletPaymentIntentSummary[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [receipts, setReceipts] = useState<WalletReceiptSummary[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const [workerWallet, setWorkerWallet] = useState<WorkerWalletSummary>(emptyWorkerWallet());
  const [workerLoading, setWorkerLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = getWalletView(searchParams.get("view"));
  const filter = getLedgerFilter(searchParams.get("filter"));
  const search = searchParams.get("search") ?? "";
  const page = getPageParam(searchParams.get("page"));
  const wallet = ledger?.wallet;
  const paypalStatus = searchParams.get("paypal");
  const paypalPaymentIntentId = searchParams.get("paymentIntentId");
  const paypalOrderId = searchParams.get("token") ?? searchParams.get("paypalOrderId");
  const stripeStatus = searchParams.get("stripe");
  const stripePaymentIntentId = searchParams.get("paymentIntentId");
  const stripeSessionId = searchParams.get("stripeSessionId");

  useEffect(() => {
    let active = true;

    if (!session || view !== "creator") {
      setLedger(null);
      setFundingSources([]);
      setPaymentIntents([]);
      setPaymentsLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);

    setPaymentsLoading(true);

    Promise.all([
      listCreatorWalletLedger(session, {
        filter,
        page,
        pageSize: walletPageSize,
        search
      }),
      listCreatorPaymentIntents(session),
      listCreatorFundingSources(session)
    ])
      .then(([result, payments, sources]) => {
        if (active) {
          setLedger(result);
          setPaymentIntents(payments);
          setFundingSources(sources);
          setSelectedFundingSourceId((current) => current || (sources.find((source) => source.status === "ACTIVE" && source.processor === "stripe")?.id ?? ""));
        }
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load wallet ledger.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setPaymentsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [filter, page, search, session?.access_token, view]);

  useEffect(() => {
    const hasAchSource = fundingSources.some((source) => source.status === "ACTIVE" && source.processor === "stripe");

    if ((topUpProvider === "stripe" || topUpProvider === "ach") && !features.payments.stripeEnabled) {
      setTopUpProvider(features.payments.paypalEnabled ? "paypal" : "stripe");
    }

    if (topUpProvider === "paypal" && !features.payments.paypalEnabled && features.payments.stripeEnabled) {
      setTopUpProvider("stripe");
    }

    if (topUpProvider === "ach" && !hasAchSource) {
      setTopUpProvider(features.payments.stripeEnabled ? "stripe" : "paypal");
    }
  }, [features.payments.paypalEnabled, features.payments.stripeEnabled, fundingSources, topUpProvider]);

  useEffect(() => {
    let active = true;

    async function finalizePayPalTopUp() {
      if (!session || view !== "creator" || !paypalStatus) {
        return;
      }

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("paypal");
      nextParams.delete("paymentIntentId");
      nextParams.delete("paypalOrderId");
      nextParams.delete("token");
      nextParams.delete("PayerID");

      if (paypalStatus === "cancel") {
        if (paypalPaymentIntentId) {
          await cancelCreatorPayPalOrder(session, { paymentIntentId: paypalPaymentIntentId }).catch(() => null);
          const payments = await listCreatorPaymentIntents(session).catch(() => null);

          if (active && payments) {
            setPaymentIntents(payments);
          }
        }
        setMessage("PayPal checkout was cancelled.");
        setSearchParams(nextParams, { replace: true });
        return;
      }

      if (!paypalOrderId || !paypalPaymentIntentId) {
        setError("PayPal did not return enough information to finish the top-up.");
        setSearchParams(nextParams, { replace: true });
        return;
      }

      setPaypalFinalizing(true);
      setError(null);
      setMessage(null);

      try {
        const result = await captureCreatorPayPalOrder(session, {
          orderId: paypalOrderId,
          paymentIntentId: paypalPaymentIntentId
        });

        if (!active) {
          return;
        }

        setLedger((current) => current ? { ...current, wallet: result.wallet } : current);
        setMessage(result.receiptNumber ? `PayPal top-up complete. Receipt ${result.receiptNumber}.` : "PayPal top-up complete.");
        setSearchParams(nextParams, { replace: true });

        const nextLedger = await listCreatorWalletLedger(session, {
          filter,
          page,
          pageSize: walletPageSize,
          search
        });

        if (active) {
          setLedger(nextLedger);
        }

        const payments = await listCreatorPaymentIntents(session);

        if (active) {
          setPaymentIntents(payments);
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to finish PayPal top-up.");
          setSearchParams(nextParams, { replace: true });
        }
      } finally {
        if (active) {
          setPaypalFinalizing(false);
        }
      }
    }

    void finalizePayPalTopUp();

    return () => {
      active = false;
    };
  }, [filter, page, paypalOrderId, paypalPaymentIntentId, paypalStatus, search, searchParams, session, setSearchParams, view]);

  useEffect(() => {
    let active = true;

    async function finalizeStripeTopUp() {
      if (!session || view !== "creator" || !stripeStatus) {
        return;
      }

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("stripe");
      nextParams.delete("paymentIntentId");
      nextParams.delete("stripeSessionId");

      if (stripeStatus === "cancel") {
        if (stripePaymentIntentId) {
          await cancelCreatorStripeCheckout(session, { paymentIntentId: stripePaymentIntentId }).catch(() => null);
          const payments = await listCreatorPaymentIntents(session).catch(() => null);

          if (active && payments) {
            setPaymentIntents(payments);
          }
        }
        setMessage("Stripe checkout was cancelled.");
        setSearchParams(nextParams, { replace: true });
        return;
      }

      if (!stripePaymentIntentId || !stripeSessionId) {
        setError("Stripe did not return enough information to finish the top-up.");
        setSearchParams(nextParams, { replace: true });
        return;
      }

      setStripeFinalizing(true);
      setError(null);
      setMessage(null);

      try {
        const result = await completeCreatorStripeCheckout(session, {
          paymentIntentId: stripePaymentIntentId,
          sessionId: stripeSessionId
        });

        if (!active) {
          return;
        }

        setLedger((current) => current ? { ...current, wallet: result.wallet } : current);
        setMessage(result.receiptNumber ? `Stripe top-up complete. Receipt ${result.receiptNumber}.` : "Stripe checkout returned. Wallet will update after Stripe confirms payment.");
        setSearchParams(nextParams, { replace: true });

        const nextLedger = await listCreatorWalletLedger(session, {
          filter,
          page,
          pageSize: walletPageSize,
          search
        });

        if (active) {
          setLedger(nextLedger);
        }

        const payments = await listCreatorPaymentIntents(session);

        if (active) {
          setPaymentIntents(payments);
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to finish Stripe top-up.");
          setSearchParams(nextParams, { replace: true });
        }
      } finally {
        if (active) {
          setStripeFinalizing(false);
        }
      }
    }

    void finalizeStripeTopUp();

    return () => {
      active = false;
    };
  }, [filter, page, search, searchParams, session, setSearchParams, stripePaymentIntentId, stripeSessionId, stripeStatus, view]);

  useEffect(() => {
    let active = true;

    if (!session) {
      setReceipts([]);
      setReceiptsLoading(false);
      return () => {
        active = false;
      };
    }

    setReceiptsLoading(true);

    listWalletReceipts(session)
      .then((result) => {
        if (active) {
          setReceipts(result);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load wallet receipts.");
        }
      })
      .finally(() => {
        if (active) {
          setReceiptsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [session?.access_token, view]);

  useEffect(() => {
    let active = true;

    if (!session || view !== "worker") {
      setWorkerWallet(emptyWorkerWallet());
      return () => {
        active = false;
      };
    }

    setWorkerLoading(true);
    setError(null);

    getWorkerWalletSummary(session)
      .then((result) => {
        if (active) {
          setWorkerWallet(result);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load worker earnings.");
        }
      })
      .finally(() => {
        if (active) {
          setWorkerLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [session?.access_token, view]);

  function updateQuery(next: WalletQueryUpdate) {
    const params = new URLSearchParams(searchParams);

    if (next.view !== undefined) {
      if (next.view === "creator") {
        params.delete("view");
      } else {
        params.set("view", next.view);
      }
      params.delete("filter");
      params.delete("page");
      params.delete("search");
    }

    if (next.filter !== undefined) {
      if (next.filter === "all") {
        params.delete("filter");
      } else {
        params.set("filter", next.filter);
      }
      params.set("page", "1");
    }

    if (next.search !== undefined) {
      if (next.search.trim()) {
        params.set("search", next.search);
      } else {
        params.delete("search");
      }
      params.set("page", "1");
    }

    if (next.page !== undefined) {
      if (next.page <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(next.page));
      }
    }

    setSearchParams(params);
  }

  async function handleWorkerWithdrawal() {
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    setWithdrawing(true);

    try {
      const result = await requestWorkerWithdrawal(session);
      setWorkerWallet(result.wallet);
      setMessage(result.payoutIds.length > 1 ? "Withdrawal requests created." : "Withdrawal request created.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to request withdrawal.");
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleExport(format: CreatorWalletExportFormat) {
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    setExporting(format);

    try {
      const result = await downloadCreatorWalletExport(session, format);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Creator ledger ${format.toUpperCase()} export downloaded.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to export creator ledger.");
    } finally {
      setExporting(null);
    }
  }

  async function handleReceiptDownload(receipt: WalletReceiptSummary) {
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    setDownloadingReceiptId(receipt.id);

    try {
      const result = await downloadWalletReceipt(session, receipt.id);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Receipt ${receipt.receiptNumber} downloaded.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to download receipt.");
    } finally {
      setDownloadingReceiptId(null);
    }
  }

  async function handleCreatorTopUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const amount = Number(topUpAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a top-up amount greater than 0.");
      return;
    }

    if ((topUpProvider === "stripe" || topUpProvider === "ach") && !features.payments.stripeEnabled) {
      setError("Stripe wallet top-ups are disabled.");
      return;
    }

    if (topUpProvider === "ach" && !selectedFundingSourceId) {
      setError("Choose a linked bank account before starting an ACH top-up.");
      return;
    }

    if (topUpProvider === "paypal" && !features.payments.paypalEnabled) {
      setError("PayPal wallet top-ups are disabled.");
      return;
    }

    setToppingUp(true);

    try {
      if (topUpProvider === "ach") {
        const result = await createCreatorStripeAchCheckoutSession(session, {
          amount,
          currency: wallet?.currency ?? "USD",
          fundingSourceId: selectedFundingSourceId
        });
        setMessage("Opening ACH checkout.");
        window.location.assign(result.checkoutUrl);
      } else if (topUpProvider === "stripe") {
        const result = await createCreatorStripeCheckoutSession(session, {
          amount,
          currency: wallet?.currency ?? "USD"
        });
        setMessage("Opening Stripe checkout.");
        window.location.assign(result.checkoutUrl);
      } else {
        const result = await createCreatorPayPalOrder(session, {
          amount,
          currency: wallet?.currency ?? "USD"
        });
        setMessage("Opening PayPal checkout.");
        window.location.assign(result.approvalUrl);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to start ${topUpProvider === "ach" ? "ACH" : topUpProvider === "stripe" ? "Stripe" : "PayPal"} checkout.`);
    } finally {
      setToppingUp(false);
    }
  }

  async function handleDisableFundingSource(sourceId: string) {
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    try {
      const disabled = await disableCreatorFundingSource(session, sourceId);
      setFundingSources((current) => current.map((source) => source.id === disabled.id ? disabled : source));
      setSelectedFundingSourceId((current) => current === disabled.id ? "" : current);
      setMessage("Funding source disabled.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to disable funding source.");
    }
  }

  async function handleBankLink() {
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    if (!features.payments.plaidEnabled) {
      setError("Plaid bank linking is disabled.");
      return;
    }

    setLinkingBank(true);

    try {
      const [{ linkToken }] = await Promise.all([createCreatorPlaidLinkToken(session), loadPlaidScript()]);
      const plaid = window.Plaid?.create({
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          const account = metadata.accounts?.[0];
          const accountId = account?.id;

          if (!accountId) {
            setError("Plaid did not return a bank account.");
            setLinkingBank(false);
            return;
          }

          linkCreatorPlaidStripeBankAccount(session, {
            accountId,
            accountMask: account?.mask,
            accountName: account?.name,
            accountSubtype: account?.subtype,
            accountType: account?.type,
            institutionName: metadata.institution?.name,
            publicToken
          })
            .then((result) => {
              setFundingSources((current) => [result.fundingSource, ...current.filter((source) => source.id !== result.fundingSource.id)]);
              setSelectedFundingSourceId(result.fundingSource.id);
              setTopUpProvider("ach");
              setMessage("Bank account linked. You can now start ACH funding through Stripe.");
            })
            .catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Unable to link bank account.");
            })
            .finally(() => {
              setLinkingBank(false);
            });
        },
        onExit: () => {
          setLinkingBank(false);
        }
      });

      if (!plaid) {
        throw new Error("Plaid Link failed to initialize.");
      }

      plaid.open();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start Plaid bank link.");
      setLinkingBank(false);
    }
  }

  const walletSwitcher = (
    <WalletViewSwitcher onChange={(nextView) => updateQuery({ view: nextView })} view={view} />
  );

  return (
    <section className="page-stack wallet-page">
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {view === "creator" ? (
        <section className="wallet-layout">
          <CreatorWalletSummaryPanel
            linkingBank={linkingBank}
            fundingSources={fundingSources}
            onBankLink={() => void handleBankLink()}
            onDisableFundingSource={(sourceId) => void handleDisableFundingSource(sourceId)}
            onFundingSourceChange={setSelectedFundingSourceId}
            onProviderChange={setTopUpProvider}
            onTopUp={(event) => void handleCreatorTopUp(event)}
            onTopUpAmountChange={setTopUpAmount}
            provider={topUpProvider}
            providerAvailability={features.payments}
            sessionAvailable={Boolean(session)}
            selectedFundingSourceId={selectedFundingSourceId}
            topUpAmount={topUpAmount}
            toppingUp={toppingUp || paypalFinalizing || stripeFinalizing}
            wallet={wallet}
            walletSwitcher={walletSwitcher}
          />
          <CreatorLedgerPanel
            downloadingReceiptId={downloadingReceiptId}
            exporting={exporting}
            filter={filter}
            ledger={ledger}
            loading={loading}
            onExport={(format) => void handleExport(format)}
            onQueryChange={updateQuery}
            onReceiptDownload={(receipt) => void handleReceiptDownload(receipt)}
            receipts={receipts}
            search={search}
          />
          <CreatorWalletSupportPanels
            downloadingReceiptId={downloadingReceiptId}
            onReceiptDownload={(receipt) => void handleReceiptDownload(receipt)}
            paymentIntents={paymentIntents}
            paymentsLoading={paymentsLoading || paypalFinalizing || stripeFinalizing}
            receipts={receipts}
            receiptsLoading={receiptsLoading}
            wallet={wallet}
          />
        </section>
      ) : (
        <WorkerWalletPanels
          downloadingReceiptId={downloadingReceiptId}
          loading={workerLoading}
          onReceiptDownload={(receipt) => void handleReceiptDownload(receipt)}
          onWithdrawal={() => void handleWorkerWithdrawal()}
          receipts={receipts}
          receiptsLoading={receiptsLoading}
          wallet={workerWallet}
          walletSwitcher={walletSwitcher}
          withdrawing={withdrawing}
        />
      )}
    </section>
  );
}

function loadPlaidScript() {
  if (window.Plaid) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>('script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]');

  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Plaid Link failed to load.")), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Plaid Link failed to load.")), { once: true });
    document.head.append(script);
  });
}
