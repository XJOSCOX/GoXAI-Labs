import { Ban, Bot, CheckCircle2, CircleDollarSign, Clock3, CreditCard, Download, Eye, Loader2, Radio, ShieldCheck, X, XCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  cancelAdminPaymentIntent,
  downloadAdminPaymentReceipts,
  getAdminPaymentIntentDetail,
  getAdminPayoutDetail,
  getAdminOverview,
  downloadAdminPayoutReceipt,
  recordAdminPaymentRefund,
  reviewAdminPayout,
  reviewAdminApplication,
  updateAdminEconomics,
  updateAdminUser,
  updateAdminFeatures,
  type AdminApplicationSummary,
  type AdminOverview,
  type AdminPaymentIntentDetail,
  type AdminPaymentIntentSummary,
  type AdminPayoutDetail,
  type AdminPayoutSummary,
  type AdminUserSummary,
  type PlatformTaskEconomics
} from "../../api";
import { useAuth } from "../../auth";
import { formatDate, formatEnum } from "../../utils/format";

type PayoutDecision = "processing" | "paid" | "cancel" | "fail";
type PayoutReviewInput = {
  adminNotes?: string;
  provider?: string;
  providerRef?: string;
};
type PaymentRefundInput = {
  adminNotes?: string;
  amount?: number;
  providerRef: string;
};
type PayoutStatusFilter = "all" | "requested" | "processing" | "paid" | "failed" | "cancelled";
type AdminTab = "platform" | "payments" | "revenue" | "requests" | "users";

const payoutStatusFilters: Array<{ label: string; value: PayoutStatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Requested", value: "requested" },
  { label: "Processing", value: "processing" },
  { label: "Paid", value: "paid" },
  { label: "Failed", value: "failed" },
  { label: "Cancelled", value: "cancelled" }
];
const adminTabs: Array<{ label: string; value: AdminTab }> = [
  { label: "Platform", value: "platform" },
  { label: "Payments", value: "payments" },
  { label: "Revenue", value: "revenue" },
  { label: "Requests", value: "requests" },
  { label: "Users", value: "users" }
];
const adminTopUpPageSize = 8;

export function AdminPage() {
  const { dbUser, session, setFeatures } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [featureSaving, setFeatureSaving] = useState<string | null>(null);
  const [selectedPaymentIntent, setSelectedPaymentIntent] = useState<AdminPaymentIntentDetail | null>(null);
  const [paymentDetailLoadingId, setPaymentDetailLoadingId] = useState<string | null>(null);
  const [selectedPayout, setSelectedPayout] = useState<AdminPayoutDetail | null>(null);
  const [payoutDetailLoadingId, setPayoutDetailLoadingId] = useState<string | null>(null);
  const [downloadingPayoutId, setDownloadingPayoutId] = useState<string | null>(null);
  const [paymentActionId, setPaymentActionId] = useState<string | null>(null);
  const [paymentRefundingId, setPaymentRefundingId] = useState<string | null>(null);
  const [paymentReceiptDownloadId, setPaymentReceiptDownloadId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("platform");

  async function reload() {
    if (!session || dbUser?.globalRole !== "SUPER_ADMIN") {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setOverview(await getAdminOverview(session));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load admin panel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [session, dbUser?.globalRole]);

  async function handleReview(application: AdminApplicationSummary, decision: "approve" | "reject") {
    if (!session) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      await reviewAdminApplication(session, application.type, application.id, decision);
      setMessage(`${formatEnum(application.type)} application ${decision === "approve" ? "approved" : "rejected"}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review application.");
    }
  }

  async function handleUserUpdate(user: AdminUserSummary, field: "verificationStatus" | "creatorStatus" | "globalRole" | "status", value: string) {
    if (!session) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      await updateAdminUser(session, user.id, { [field]: value });
      setMessage(`${user.name} updated.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update user.");
    }
  }

  async function handleFeatureToggle(aiEnabled: boolean) {
    if (!session || !overview) {
      return;
    }

    setFeatureSaving("aiEnabled");
    setMessage(null);
    setError(null);

    try {
      const features = await updateAdminFeatures(session, { aiEnabled });
      setFeatures(features);
      setOverview({
        ...overview,
        settings: {
          ...overview.settings,
          features
        }
      });
      setMessage(`AI workspace ${features.aiEnabled ? "enabled" : "disabled"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update platform features.");
    } finally {
      setFeatureSaving(null);
    }
  }

  async function handlePaymentProviderToggle(provider: "paypal" | "plaid" | "stripe", enabled: boolean) {
    if (!session || !overview) {
      return;
    }

    setFeatureSaving(provider);
    setMessage(null);
    setError(null);

    try {
      const paymentUpdate =
        provider === "paypal"
          ? { paypalEnabled: enabled }
          : provider === "plaid"
            ? { plaidEnabled: enabled }
            : { stripeEnabled: enabled };
      const features = await updateAdminFeatures(session, {
        aiEnabled: overview.settings.features.aiEnabled,
        payments: paymentUpdate
      });
      setFeatures(features);
      setOverview({
        ...overview,
        settings: {
          ...overview.settings,
          features,
          paymentProviders: {
            ...overview.settings.paymentProviders,
            [provider]: {
              ...overview.settings.paymentProviders[provider],
              enabled
            }
          }
        }
      });
      setMessage(`${formatPaymentProviderName(provider)} ${enabled ? "enabled" : "disabled"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update payment provider.");
    } finally {
      setFeatureSaving(null);
    }
  }

  async function handleEconomicsUpdate(input: PlatformTaskEconomics & { applyToExistingTasks: boolean }) {
    if (!session || !overview) {
      return;
    }

    setFeatureSaving("economics");
    setMessage(null);
    setError(null);

    try {
      const result = await updateAdminEconomics(session, input);
      setOverview({
        ...overview,
        settings: {
          ...overview.settings,
          economics: result.economics
        }
      });
      setMessage(
        result.existingTaskUpdate
          ? `Task economics saved. ${result.existingTaskUpdate.updatedCount} open task${result.existingTaskUpdate.updatedCount === 1 ? "" : "s"} increased.`
          : "Task economics saved for future task funding."
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update task economics.");
    } finally {
      setFeatureSaving(null);
    }
  }

  async function handlePayoutReview(payout: AdminPayoutSummary, decision: PayoutDecision, input: PayoutReviewInput = {}) {
    if (!session) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      await reviewAdminPayout(session, payout.id, decision, input);
      setMessage(`Payout ${decision === "cancel" ? "cancelled" : decision === "fail" ? "failed" : formatEnum(decision)}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update payout.");
    }
  }

  async function handleOpenPayoutDetail(payout: AdminPayoutSummary) {
    if (!session) {
      return;
    }

    setError(null);
    setPayoutDetailLoadingId(payout.id);

    try {
      setSelectedPayout(await getAdminPayoutDetail(session, payout.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load payout detail.");
    } finally {
      setPayoutDetailLoadingId(null);
    }
  }

  async function handleCancelPaymentIntent(payment: AdminPaymentIntentSummary) {
    if (!session) {
      return;
    }

    setPaymentActionId(payment.id);
    setMessage(null);
    setError(null);

    try {
      await cancelAdminPaymentIntent(session, payment.id, {
        adminNotes: payment.staleReason ?? "Cancelled from admin payment operations."
      });
      setMessage("Payment intent cancelled.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to cancel payment intent.");
    } finally {
      setPaymentActionId(null);
    }
  }

  async function handleOpenPaymentIntentDetail(payment: AdminPaymentIntentSummary) {
    if (!session) {
      return;
    }

    setError(null);
    setPaymentDetailLoadingId(payment.id);

    try {
      setSelectedPaymentIntent(await getAdminPaymentIntentDetail(session, payment.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load payment detail.");
    } finally {
      setPaymentDetailLoadingId(null);
    }
  }

  async function handleRecordPaymentRefund(payment: AdminPaymentIntentDetail, input: PaymentRefundInput) {
    if (!session) {
      return;
    }

    setPaymentRefundingId(payment.id);
    setMessage(null);
    setError(null);

    try {
      await recordAdminPaymentRefund(session, payment.id, input);
      setSelectedPaymentIntent(await getAdminPaymentIntentDetail(session, payment.id));
      setMessage("Payment refund recorded.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to record payment refund.");
    } finally {
      setPaymentRefundingId(null);
    }
  }

  async function handleDownloadPaymentReceipts(payment: AdminPaymentIntentDetail) {
    if (!session) {
      return;
    }

    setPaymentReceiptDownloadId(payment.id);
    setMessage(null);
    setError(null);

    try {
      const result = await downloadAdminPaymentReceipts(session, payment.id);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Payment receipts downloaded.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to download payment receipts.");
    } finally {
      setPaymentReceiptDownloadId(null);
    }
  }

  async function handleDownloadPayoutReceipt(payout: AdminPayoutSummary) {
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    setDownloadingPayoutId(payout.id);

    try {
      const result = await downloadAdminPayoutReceipt(session, payout.id);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Payout receipt downloaded.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to download payout receipt.");
    } finally {
      setDownloadingPayoutId(null);
    }
  }

  if (dbUser?.globalRole !== "SUPER_ADMIN") {
    return (
      <section className="page-stack">
        <section className="panel empty-state compact-empty">
          <ShieldCheck size={28} />
          <strong>Admin access required</strong>
          <span>This panel is only available to GoXAi Lab super admins.</span>
        </section>
      </section>
    );
  }

  return (
    <section className="page-stack admin-page">
      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-success">{message}</p>}
      {loading && !overview ? (
        <section className="panel empty-state compact-empty">
          <ShieldCheck size={28} />
          <strong>Loading admin panel</strong>
          <span>Checking platform users and applications.</span>
        </section>
      ) : overview ? (
        <>
          <div className="admin-console-wrapper">
            <div className="admin-console-grid">
              <AdminSummaryRail overview={overview} />
              <main className="admin-workspace">
                <AdminTabBar activeTab={activeTab} onChange={setActiveTab} overview={overview} />

                {activeTab === "platform" ? (
                  <PlatformSettingsPanel
                    aiEnabled={overview.settings.features.aiEnabled}
                    economics={overview.settings.economics}
                    onSaveEconomics={handleEconomicsUpdate}
                    onToggleAI={handleFeatureToggle}
                    onTogglePaymentProvider={handlePaymentProviderToggle}
                    paymentProviders={overview.settings.paymentProviders}
                    saving={featureSaving}
                  />
                ) : null}

                {activeTab === "payments" ? (
                  <PaymentOperationsPanel
                    auditTrail={overview.payments.auditTrail}
                    cancellingPaymentId={paymentActionId}
                    detailLoadingPaymentId={paymentDetailLoadingId}
                    onCancelPaymentIntent={(payment) => void handleCancelPaymentIntent(payment)}
                    onOpenPaymentDetail={(payment) => void handleOpenPaymentIntentDetail(payment)}
                    paymentIntents={overview.payments.paymentIntents}
                    webhookHealth={overview.payments.webhookHealth}
                  />
                ) : null}

                {activeTab === "revenue" ? <PlatformRevenuePanel revenue={overview.payments.platformRevenue} /> : null}

                {activeTab === "requests" ? (
                  <div className="admin-tab-columns">
                    <ApplicationPanel
                      applications={[...overview.verificationApplications, ...overview.creatorApplications]}
                      onReview={handleReview}
                    />

                    <PayoutPanel
                      detailLoadingId={payoutDetailLoadingId}
                      downloadingPayoutId={downloadingPayoutId}
                      onDownloadReceipt={handleDownloadPayoutReceipt}
                      onOpenDetail={handleOpenPayoutDetail}
                      onReview={handlePayoutReview}
                      payouts={overview.payouts}
                    />
                  </div>
                ) : null}

                {activeTab === "users" ? (
                  <UserManagementPanel onUserUpdate={handleUserUpdate} users={overview.users} />
                ) : null}
              </main>
            </div>
          </div>

          {selectedPayout ? (
            <PayoutDetailModal
              downloading={downloadingPayoutId === selectedPayout.id}
              onClose={() => setSelectedPayout(null)}
              onDownloadReceipt={handleDownloadPayoutReceipt}
              payout={selectedPayout}
            />
          ) : null}
          {selectedPaymentIntent ? (
            <PaymentIntentDetailModal
              downloadingReceipts={paymentReceiptDownloadId === selectedPaymentIntent.id}
              onClose={() => setSelectedPaymentIntent(null)}
              onDownloadReceipts={handleDownloadPaymentReceipts}
              onRecordRefund={handleRecordPaymentRefund}
              payment={selectedPaymentIntent}
              refunding={paymentRefundingId === selectedPaymentIntent.id}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <section className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </section>
  );
}

function AdminSummaryRail({ overview }: { overview: AdminOverview }) {
  const revenue = overview.payments.platformRevenue.totals[0] ?? {
    collectedAmount: 0,
    currency: "USD",
    pendingAmount: 0,
    totalAmount: 0
  };
  const enabledProviderCount = Object.values(overview.settings.paymentProviders).filter((provider) => provider.enabled).length;
  const openRequests = getOpenRequestCount(overview);
  const platformFeePercent = `${Math.round(overview.settings.economics.platformFeeRate * 100)}%`;
  const freeTaskPostingFee = formatMoney(overview.settings.economics.freeTaskPostingFeeCredits / 100, revenue.currency);

  return (
    <aside className="panel admin-summary-rail">
      <div>
        <p className="eyebrow">Summary</p>
        <h2>Platform health</h2>
      </div>

      <section className="admin-summary-money">
        <span>Total revenue</span>
        <strong>{formatMoney(revenue.totalAmount, revenue.currency)}</strong>
        <small>{formatMoney(revenue.pendingAmount, revenue.currency)} pending in escrow</small>
      </section>

      <div className="admin-summary-group">
        <p className="eyebrow">People</p>
        <SummaryMetric label="Users" value={overview.counts.users} />
        <SummaryMetric label="Creators" value={overview.counts.approvedCreators} />
        <SummaryMetric label="Pending verification" value={overview.counts.pendingVerification} />
      </div>

      <div className="admin-summary-group">
        <p className="eyebrow">Work</p>
        <SummaryMetric label="Organizations" value={overview.counts.organizations} />
        <SummaryMetric label="Projects" value={overview.counts.projects} />
        <SummaryMetric label="Datasets" value={overview.counts.datasets} />
      </div>

      <div className="admin-summary-group">
        <p className="eyebrow">Operations</p>
        <SummaryMetric label="Open requests" value={openRequests} />
        <SummaryMetric label="Top-ups loaded" value={overview.payments.paymentIntents.length} />
        <SummaryMetric label="Payment providers" value={enabledProviderCount} />
      </div>

      <div className="admin-summary-group">
        <p className="eyebrow">Economics</p>
        <SummaryMetric label="Platform fee" value={platformFeePercent} />
        <SummaryMetric label="Free task fee" value={freeTaskPostingFee} />
      </div>
    </aside>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="admin-summary-metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function getOpenRequestCount(overview: AdminOverview) {
  return getPendingApplicationCount([...overview.verificationApplications, ...overview.creatorApplications]) + overview.counts.requestedPayouts;
}

function getPendingApplicationCount(applications: AdminApplicationSummary[]) {
  return applications.filter((application) => application.status === "SUBMITTED" || application.status === "REVIEWING").length;
}

function AdminTabBar({
  activeTab,
  onChange,
  overview
}: {
  activeTab: AdminTab;
  onChange: (tab: AdminTab) => void;
  overview: AdminOverview;
}) {
  const counts: Partial<Record<AdminTab, number>> = {
    payments: overview.payments.paymentIntents.length,
    requests: getOpenRequestCount(overview),
    revenue: overview.payments.platformRevenue.recentFees.length,
    users: overview.counts.users
  };

  return (
    <nav className="admin-tabs" aria-label="Admin console sections">
      {adminTabs.map((tab) => (
        <button
          className={activeTab === tab.value ? "active" : ""}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          type="button"
        >
          {tab.label}
          {counts[tab.value] !== undefined ? <span>{counts[tab.value]}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function UserManagementPanel({
  onUserUpdate,
  users
}: {
  onUserUpdate: (user: AdminUserSummary, field: "verificationStatus" | "creatorStatus" | "globalRole" | "status", value: string) => Promise<void>;
  users: AdminUserSummary[];
}) {
  return (
    <section className="panel table-panel admin-users-panel">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">Users</p>
          <h2>Platform accounts</h2>
          <p className="muted-copy">Update status and access while the full admin console grows.</p>
        </div>
      </div>
      <div className="admin-user-list">
        {users.map((user) => (
          <article className="admin-user-row" key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
              <small>{formatDate(user.createdAt)}</small>
            </div>
            <label>
              Verification
              <select
                value={user.verificationStatus}
                onChange={(event) => void onUserUpdate(user, "verificationStatus", event.currentTarget.value)}
              >
                <option value="UNVERIFIED">Unverified</option>
                <option value="PENDING">Pending</option>
                <option value="VERIFIED">Verified</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </label>
            <label>
              Creator
              <select
                value={user.creatorStatus}
                onChange={(event) => void onUserUpdate(user, "creatorStatus", event.currentTarget.value)}
              >
                <option value="NONE">None</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </label>
            <label>
              Role
              <select value={user.globalRole} onChange={(event) => void onUserUpdate(user, "globalRole", event.currentTarget.value)}>
                <option value="USER">User</option>
                <option value="SUPER_ADMIN">Super admin</option>
                <option value="SYSTEM">System</option>
              </select>
            </label>
            <label>
              Status
              <select value={user.status} onChange={(event) => void onUserUpdate(user, "status", event.currentTarget.value)}>
                <option value="ACTIVE">Active</option>
                <option value="INVITED">Invited</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="DELETED">Deleted</option>
              </select>
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlatformSettingsPanel({
  aiEnabled,
  economics,
  onSaveEconomics,
  onToggleAI,
  onTogglePaymentProvider,
  paymentProviders,
  saving
}: {
  aiEnabled: boolean;
  economics: AdminOverview["settings"]["economics"];
  onSaveEconomics: (input: PlatformTaskEconomics & { applyToExistingTasks: boolean }) => Promise<void>;
  onToggleAI: (enabled: boolean) => Promise<void>;
  onTogglePaymentProvider: (provider: "paypal" | "plaid" | "stripe", enabled: boolean) => Promise<void>;
  paymentProviders: AdminOverview["settings"]["paymentProviders"];
  saving: string | null;
}) {
  const [platformFeePercent, setPlatformFeePercent] = useState(() => String(Math.round(economics.platformFeeRate * 100)));
  const [freeTaskPostingFee, setFreeTaskPostingFee] = useState(() => formatMoneyDraft(economics.freeTaskPostingFeeCredits / 100));
  const [applyToExistingTasks, setApplyToExistingTasks] = useState(false);

  useEffect(() => {
    setPlatformFeePercent(String(Math.round(economics.platformFeeRate * 100)));
    setFreeTaskPostingFee(formatMoneyDraft(economics.freeTaskPostingFeeCredits / 100));
  }, [economics.freeTaskPostingFeeCredits, economics.platformFeeRate]);

  function handleEconomicsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const feeRate = Number(platformFeePercent);
    const freeFee = Number(freeTaskPostingFee);

    if (!Number.isFinite(feeRate) || !Number.isFinite(freeFee)) {
      return;
    }

    void onSaveEconomics({
      applyToExistingTasks,
      freeTaskPostingFeeCredits: Math.max(0, Math.round(freeFee * 100)),
      platformFeeRate: Math.max(0, Math.min(100, feeRate)) / 100
    });
  }

  return (
    <section className="panel admin-feature-panel">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">Platform settings</p>
          <h2>Feature controls</h2>
          <p className="muted-copy">Keep unfinished modules out of the workspace until they are ready for daily use.</p>
        </div>
      </div>
      <div className="admin-platform-grid">
        <div className="admin-platform-controls">
          <label className="admin-feature-row">
            <span className="feature-icon">
              <Bot size={18} />
            </span>
            <span className="admin-feature-copy">
              <strong>AI workspace and pre-labeling</strong>
              <small>Shows the AI page, dataset AI tab, task prediction panel, and quality AI queues.</small>
            </span>
            <span className={aiEnabled ? "status-pill compact" : "status-pill compact warning"}>{aiEnabled ? "Active" : "Disabled"}</span>
            <input checked={aiEnabled} disabled={saving === "aiEnabled"} onChange={(event) => void onToggleAI(event.currentTarget.checked)} type="checkbox" />
          </label>
          <div className="admin-payment-provider-grid">
            {(["paypal", "stripe", "plaid"] as const).map((provider) => {
              const status = paymentProviders[provider];

              return (
                <label className="admin-feature-row" key={provider}>
                  <span className="feature-icon">
                    <CreditCard size={18} />
                  </span>
                  <span className="admin-feature-copy">
                    <strong>{formatPaymentProviderName(provider)}</strong>
                    <small>
                      {status.configured ? `${formatEnum(status.environment)} configured` : `Missing ${status.missing.join(", ") || "provider keys"}`}
                    </small>
                  </span>
                  <span className={status.enabled ? "status-pill compact" : "status-pill compact warning"}>{status.enabled ? "Enabled" : "Disabled"}</span>
                  <input
                    checked={status.enabled}
                    disabled={saving === provider}
                    onChange={(event) => void onTogglePaymentProvider(provider, event.currentTarget.checked)}
                    type="checkbox"
                  />
                </label>
              );
            })}
          </div>
        </div>
        <form className="admin-economics-form" onSubmit={handleEconomicsSubmit}>
          <div>
            <p className="eyebrow">Task economics</p>
            <h3>Platform task fees</h3>
            <p className="muted-copy">Controls how much GoXAi Lab reserves for platform costs when creators fund task work.</p>
          </div>
          <label>
            Platform fee
            <span className="input-with-suffix">
              <input
                min="0"
                max="100"
                onChange={(event) => setPlatformFeePercent(event.currentTarget.value)}
                type="number"
                value={platformFeePercent}
              />
              <span>%</span>
            </span>
          </label>
          <label>
            Free task posting fee
            <span className="input-with-suffix">
              <input
                min="0"
                onChange={(event) => setFreeTaskPostingFee(event.currentTarget.value)}
                step="0.01"
                type="number"
                value={freeTaskPostingFee}
              />
              <span>USD</span>
            </span>
          </label>
          <div className="admin-economics-modes">
            <label>
              <input
                checked={!applyToExistingTasks}
                onChange={() => setApplyToExistingTasks(false)}
                name="task-economics-mode"
                type="radio"
              />
              <span>
                <strong>Future tasks only</strong>
                <small>New task funding uses this rate. Existing task escrow stays unchanged.</small>
              </span>
            </label>
            <label>
              <input
                checked={applyToExistingTasks}
                onChange={() => setApplyToExistingTasks(true)}
                name="task-economics-mode"
                type="radio"
              />
              <span>
                <strong>Increase existing open tasks</strong>
                <small>Approved tasks stay locked. Open tasks get extra escrow held from creator wallets when needed.</small>
              </span>
            </label>
          </div>
          <button className="primary-button compact-button" disabled={saving === "economics"} type="submit">
            {saving === "economics" ? "Saving" : "Save economics"}
          </button>
        </form>
      </div>
    </section>
  );
}

function formatPaymentProviderName(provider: "paypal" | "plaid" | "stripe") {
  return provider === "paypal" ? "PayPal" : provider === "plaid" ? "Plaid" : "Stripe";
}

function formatWebhookEventCount(count: number) {
  return `${count} event${count === 1 ? "" : "s"}`;
}

function formatWebhookAge(minutes: number) {
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function getWebhookStatusClass(status: AdminOverview["payments"]["webhookHealth"][number]["status"]) {
  if (status === "receiving") {
    return "status-pill compact ready";
  }

  if (status === "retrying") {
    return "status-pill compact warning";
  }

  return "status-pill compact";
}

function PaymentOperationsPanel({
  auditTrail,
  cancellingPaymentId,
  detailLoadingPaymentId,
  onCancelPaymentIntent,
  onOpenPaymentDetail,
  paymentIntents,
  webhookHealth
}: {
  auditTrail: AdminOverview["payments"]["auditTrail"];
  cancellingPaymentId: string | null;
  detailLoadingPaymentId: string | null;
  onCancelPaymentIntent: (payment: AdminPaymentIntentSummary) => void;
  onOpenPaymentDetail: (payment: AdminPaymentIntentSummary) => void;
  paymentIntents: AdminPaymentIntentSummary[];
  webhookHealth: AdminOverview["payments"]["webhookHealth"];
}) {
  const [topUpPage, setTopUpPage] = useState(1);
  const topUpPageCount = Math.max(Math.ceil(paymentIntents.length / adminTopUpPageSize), 1);
  const currentTopUpPage = Math.min(topUpPage, topUpPageCount);
  const topUpStart = (currentTopUpPage - 1) * adminTopUpPageSize;
  const visibleTopUps = paymentIntents.slice(topUpStart, topUpStart + adminTopUpPageSize);

  useEffect(() => {
    setTopUpPage(1);
  }, [paymentIntents.length]);

  return (
    <section className="panel admin-payment-ops-panel">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">Payments</p>
          <h2>Payment operations</h2>
          <p className="muted-copy">Track provider checkouts, receipts, and webhook activity.</p>
        </div>
      </div>

      <div className="admin-payment-layout">
        <aside className="admin-payment-module admin-webhook-column">
          <div className="section-heading-inline">
            <h3>Webhooks</h3>
            <span>{webhookHealth.length}</span>
          </div>
          <div className="admin-webhook-stack">
            {webhookHealth.map((webhook) => (
              <details className="admin-webhook-disclosure" key={webhook.provider} open>
                <summary>
                  <span className="feature-icon">
                    <Radio size={18} />
                  </span>
                  <span>
                    <strong>{formatPaymentProviderName(webhook.provider)}</strong>
                    <small>{formatWebhookEventCount(webhook.count24h)} received in 24h</small>
                  </span>
                  <span className={getWebhookStatusClass(webhook.status)}>
                    {webhook.statusLabel}
                  </span>
                </summary>
                <div className="admin-webhook-detail">
                  <p className="muted-copy">
                    {webhook.lastReceivedAt
                      ? `${webhook.lastEventType ?? "Webhook event"} received ${formatDate(webhook.lastReceivedAt)}${webhook.lastEventAgeMinutes !== null ? ` (${formatWebhookAge(webhook.lastEventAgeMinutes)} ago)` : ""}`
                      : "Waiting for the first webhook event."}
                  </p>
                  <div className="admin-webhook-metrics">
                    <span>
                      <small>Retries</small>
                      <strong>{webhook.duplicateCount}</strong>
                    </span>
                    <span>
                      <small>Last duplicate</small>
                      <strong>{webhook.lastDuplicateAt ? formatDate(webhook.lastDuplicateAt) : "None"}</strong>
                    </span>
                  </div>
                  {webhook.recentEvents.length > 0 ? (
                    <div className="admin-webhook-events">
                      {webhook.recentEvents.map((event) => (
                        <article key={event.id}>
                          <span>
                            <strong>{event.eventType ?? "Webhook event"}</strong>
                            <small>{event.idempotencyKey ?? event.eventId}</small>
                            {event.paymentIntentId || event.providerRef ? (
                              <small>{[event.paymentIntentId ? `Payment ${shortId(event.paymentIntentId)}` : null, event.providerRef ? `Provider ${shortId(event.providerRef)}` : null].filter(Boolean).join(" - ")}</small>
                            ) : null}
                          </span>
                          <span>
                            <strong>{formatDate(event.receivedAt)}</strong>
                            <small>{event.duplicateCount} duplicate{event.duplicateCount === 1 ? "" : "s"}</small>
                            {event.transmissionId ? <small>Transmission {shortId(event.transmissionId)}</small> : null}
                          </span>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </aside>

        <section className="admin-payment-module admin-topup-column">
          <div className="section-heading-inline">
            <h3>Recent top-ups</h3>
            <span>{paymentIntents.length}</span>
          </div>
          <div className="admin-payment-list">
            {paymentIntents.length > 0 ? (
              visibleTopUps.map((payment) => (
                <AdminPaymentRow
                  cancelling={cancellingPaymentId === payment.id}
                  detailLoading={detailLoadingPaymentId === payment.id}
                  key={payment.id}
                  onCancel={() => onCancelPaymentIntent(payment)}
                  onOpenDetail={() => onOpenPaymentDetail(payment)}
                  payment={payment}
                />
              ))
            ) : (
              <p className="muted-copy">No payment intents yet.</p>
            )}
          </div>
          {paymentIntents.length > adminTopUpPageSize ? (
            <div className="admin-topup-pagination">
              <span>
                Showing {topUpStart + 1}-{Math.min(topUpStart + adminTopUpPageSize, paymentIntents.length)} of {paymentIntents.length}
              </span>
              <div>
                <button
                  className="secondary-button compact-button"
                  disabled={currentTopUpPage <= 1}
                  onClick={() => setTopUpPage((page) => Math.max(page - 1, 1))}
                  type="button"
                >
                  Previous
                </button>
                <small>Page {currentTopUpPage} of {topUpPageCount}</small>
                <button
                  className="secondary-button compact-button"
                  disabled={currentTopUpPage >= topUpPageCount}
                  onClick={() => setTopUpPage((page) => Math.min(page + 1, topUpPageCount))}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <AdminPaymentAuditTrail auditTrail={auditTrail} />
    </section>
  );
}

function AdminPaymentRow({
  cancelling,
  detailLoading,
  onCancel,
  onOpenDetail,
  payment
}: {
  cancelling: boolean;
  detailLoading: boolean;
  onCancel: () => void;
  onOpenDetail: () => void;
  payment: AdminPaymentIntentSummary;
}) {
  const hasReconciliationWarning = payment.reconciliationSummary.status === "warning";

  return (
    <article className={`admin-payment-row ${payment.statusGroup === "stale" || hasReconciliationWarning ? "needs-review" : ""}`}>
      <span>
        <strong>{formatMoney(payment.amount, payment.currency)}</strong>
        <small>{formatPaymentProviderLabel(payment.provider)} - {payment.organization?.name ?? "No organization"}</small>
      </span>
      <span>
        <strong>{payment.statusGroup === "stale" ? "Needs review" : formatEnum(payment.status)}</strong>
        <small>{payment.receiptCount} receipts - {formatDate(payment.createdAt)}</small>
        {payment.staleReason ? <small>{payment.staleReason}</small> : null}
      </span>
      <span>
        <strong>{payment.createdBy?.name ?? "System"}</strong>
        <small>{payment.providerRef ?? payment.id}</small>
        <small className={`admin-reconciliation-chip ${hasReconciliationWarning ? payment.reconciliationSummary.severity : "balanced"}`}>
          {hasReconciliationWarning ? `${payment.reconciliationSummary.issueCount} reconciliation issue${payment.reconciliationSummary.issueCount === 1 ? "" : "s"}` : "Balanced"}
        </small>
      </span>
      <span className="admin-payment-actions">
        <button className="ghost-button compact-button" disabled={detailLoading} onClick={onOpenDetail} type="button">
          {detailLoading ? <Loader2 className="spin" size={14} /> : <Eye size={14} />}
          Details
        </button>
        {payment.canCancel ? (
          <button className="ghost-button danger-button compact-button" disabled={cancelling} onClick={onCancel} type="button">
            {cancelling ? <Loader2 className="spin" size={14} /> : <X size={14} />}
            Cancel
          </button>
        ) : (
          <small>{payment.statusGroup === "settled" ? "Settled" : "Closed"}</small>
        )}
      </span>
    </article>
  );
}

function AdminPaymentAuditTrail({ auditTrail }: { auditTrail: AdminOverview["payments"]["auditTrail"] }) {
  return (
    <section className="admin-payment-module admin-audit-trail-panel">
      <div className="section-heading-inline">
        <h3>Operations timeline</h3>
        <span>{auditTrail.length}</span>
      </div>
      <div className="admin-audit-trail-list">
        {auditTrail.length > 0 ? (
          auditTrail.slice(0, 18).map((item) => (
            <article className="admin-audit-trail-row" key={item.id}>
              <span className="feature-icon">
                <Clock3 size={18} />
              </span>
              <span className="admin-audit-trail-main">
                <strong>{formatAdminAuditTitle(item.title)}</strong>
                <small>{item.description}</small>
                <small>{[item.organization, item.actor, item.provider ? formatPaymentProviderLabel(item.provider) : null].filter(Boolean).join(" - ") || "Platform event"}</small>
              </span>
              <span className="admin-audit-trail-meta">
                <strong>{item.amount !== null && item.currency ? formatMoney(item.amount, item.currency) : formatEnum(item.status)}</strong>
                <small>{formatDate(item.createdAt)}</small>
                <small>{item.reference}</small>
              </span>
            </article>
          ))
        ) : (
          <p className="muted-copy">No payment audit events yet.</p>
        )}
      </div>
    </section>
  );
}

function PlatformRevenuePanel({ revenue }: { revenue: AdminOverview["payments"]["platformRevenue"] }) {
  const primaryTotal = revenue.totals[0] ?? {
    collectedAmount: 0,
    currency: "USD",
    pendingAmount: 0,
    totalAmount: 0
  };

  return (
    <section className="panel admin-revenue-panel">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">Revenue</p>
          <h2>Platform fee reporting</h2>
          <p className="muted-copy">Track platform fees collected from approved task funding and fees still pending in open task escrow.</p>
        </div>
      </div>

      <div className="admin-revenue-metrics">
        <article>
          <span>Total platform fees</span>
          <strong>{formatMoney(primaryTotal.totalAmount, primaryTotal.currency)}</strong>
          <small>Collected plus pending open-task fees</small>
        </article>
        <article>
          <span>Collected</span>
          <strong>{formatMoney(primaryTotal.collectedAmount, primaryTotal.currency)}</strong>
          <small>Posted as platform fee ledger entries</small>
        </article>
        <article>
          <span>Pending escrow</span>
          <strong>{formatMoney(primaryTotal.pendingAmount, primaryTotal.currency)}</strong>
          <small>Reserved on open tasks, not finalized</small>
        </article>
        {revenue.totals.length > 1 ? (
          <article>
            <span>Other currencies</span>
            <strong>{revenue.totals.length - 1}</strong>
            <small>{revenue.totals.slice(1).map((total) => `${total.currency} ${formatMoney(total.totalAmount, total.currency)}`).join(" / ")}</small>
          </article>
        ) : null}
      </div>

      <div className="admin-revenue-columns">
        <RevenueBucketList buckets={revenue.byCreator} title="By creator" />
        <RevenueBucketList buckets={revenue.byProject} title="By project" />
        <RevenueBucketList buckets={revenue.byDataset} title="By dataset" />
      </div>

      <section>
        <div className="section-heading-inline">
          <h3>Recent platform fees</h3>
          <span>{revenue.recentFees.length}</span>
        </div>
        <div className="admin-payment-list">
          {revenue.recentFees.length > 0 ? (
            revenue.recentFees.map((fee) => (
              <article className="admin-payment-row admin-revenue-row" key={fee.id}>
                <span>
                  <strong>{formatMoney(fee.amount, fee.currency)}</strong>
                  <small>{fee.creator?.name ?? "Unknown creator"}</small>
                </span>
                <span>
                  {fee.dataset ? <Link to={`/datasets/${fee.dataset.id}`}>{fee.dataset.name}</Link> : <strong>No dataset</strong>}
                  <small>{fee.project?.name ?? "No project"}</small>
                </span>
                <span>
                  <strong>{formatDate(fee.createdAt)}</strong>
                  <small>{fee.reviewId ? `Review ${shortId(fee.reviewId)}` : "No review reference"}</small>
                </span>
                <span>
                  {fee.taskId ? <Link to={`/tasks/${fee.taskId}`}>Task {shortId(fee.taskId)}</Link> : <strong>{shortId(fee.referenceId ?? fee.id)}</strong>}
                  <small>{fee.description ?? "Platform fee ledger entry"}</small>
                </span>
              </article>
            ))
          ) : (
            <p className="muted-copy">No platform fees have been collected yet.</p>
          )}
        </div>
      </section>
    </section>
  );
}

function RevenueBucketList({
  buckets,
  title
}: {
  buckets: AdminOverview["payments"]["platformRevenue"]["byCreator"];
  title: string;
}) {
  return (
    <section>
      <div className="section-heading-inline">
        <h3>{title}</h3>
        <span>{buckets.length}</span>
      </div>
      <div className="admin-revenue-list">
        {buckets.length > 0 ? (
          buckets.map((bucket) => (
            <article className="admin-revenue-bucket" key={`${bucket.currency}:${bucket.id}`}>
              <span>
                <strong>{bucket.name}</strong>
                <small>{bucket.taskCount} task fee{bucket.taskCount === 1 ? "" : "s"}</small>
              </span>
              <RevenueAmountStack bucket={bucket} />
            </article>
          ))
        ) : (
          <p className="muted-copy">No revenue yet.</p>
        )}
      </div>
    </section>
  );
}

function RevenueAmountStack({
  bucket
}: {
  bucket: AdminOverview["payments"]["platformRevenue"]["byCreator"][number];
}) {
  return (
    <span className="admin-revenue-amounts">
      <strong>{formatMoney(bucket.totalAmount, bucket.currency)}</strong>
      <small>{formatMoney(bucket.collectedAmount, bucket.currency)} collected</small>
      <small>{formatMoney(bucket.pendingAmount, bucket.currency)} pending</small>
    </span>
  );
}

function formatPaymentProviderLabel(provider: string) {
  return provider.toLowerCase() === "paypal" ? "PayPal" : provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatAdminAuditTitle(value: string) {
  return value.includes(".") ? formatEnum(value.split(".").pop() ?? value) : formatEnum(value);
}

function PayoutPanel({
  detailLoadingId,
  downloadingPayoutId,
  onDownloadReceipt,
  onOpenDetail,
  onReview,
  payouts
}: {
  detailLoadingId: string | null;
  downloadingPayoutId: string | null;
  onDownloadReceipt: (payout: AdminPayoutSummary) => Promise<void>;
  onOpenDetail: (payout: AdminPayoutSummary) => Promise<void>;
  onReview: (payout: AdminPayoutSummary, decision: PayoutDecision, input?: PayoutReviewInput) => Promise<void>;
  payouts: AdminPayoutSummary[];
}) {
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, Required<PayoutReviewInput>>>({});
  const [statusFilter, setStatusFilter] = useState<PayoutStatusFilter>("requested");
  const payoutCounts = getPayoutStatusCounts(payouts);
  const filteredPayouts = payouts.filter((payout) => payoutStatusMatches(payout.status, statusFilter));
  const getDraft = (payout: AdminPayoutSummary) =>
    paymentDrafts[payout.id] ?? {
      adminNotes: "",
      provider: payout.provider ?? "manual",
      providerRef: payout.providerRef ?? ""
    };
  const updateDraft = (payout: AdminPayoutSummary, field: keyof Required<PayoutReviewInput>, value: string) => {
    setPaymentDrafts((current) => ({
      ...current,
      [payout.id]: {
        ...(current[payout.id] ?? {
          adminNotes: "",
          provider: payout.provider ?? "manual",
          providerRef: payout.providerRef ?? ""
        }),
        [field]: value
      }
    }));
  };

  return (
    <section className="panel table-panel">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">Wallet</p>
          <h2>Worker payout requests</h2>
          <p className="muted-copy">Move requests to processing, mark confirmed payments as paid, or cancel to return credits.</p>
        </div>
      </div>
      <div className="wallet-ledger-filter admin-payout-filter" aria-label="Filter worker payouts">
        {payoutStatusFilters.map((filter) => (
          <button
            className={filter.value === statusFilter ? "active" : ""}
            disabled={payoutCounts[filter.value] === 0 && filter.value !== "all"}
            key={filter.value}
            onClick={() => setStatusFilter(filter.value)}
            type="button"
          >
            {filter.label}
            <span>{payoutCounts[filter.value]}</span>
          </button>
        ))}
      </div>
      {filteredPayouts.length > 0 ? (
        <div className="admin-payout-list">
          {filteredPayouts.map((payout) => (
            payout.status === "REQUESTED" || payout.status === "PROCESSING" ? (
              <ActivePayoutRow
                draft={getDraft(payout)}
                isDownloadingReceipt={downloadingPayoutId === payout.id}
                isDetailLoading={detailLoadingId === payout.id}
                key={payout.id}
                onDownloadReceipt={onDownloadReceipt}
                onOpenDetail={onOpenDetail}
                onReview={onReview}
                onUpdateDraft={updateDraft}
                payout={payout}
              />
            ) : (
              <PayoutHistoryRow
                isDownloadingReceipt={downloadingPayoutId === payout.id}
                isDetailLoading={detailLoadingId === payout.id}
                key={payout.id}
                onDownloadReceipt={onDownloadReceipt}
                onOpenDetail={onOpenDetail}
                payout={payout}
              />
            )
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <CircleDollarSign size={28} />
          <strong>No {statusFilter === "all" ? "" : payoutStatusFilters.find((filter) => filter.value === statusFilter)?.label.toLowerCase()} payouts</strong>
          <span>Worker withdrawal requests and payout history will appear here.</span>
        </div>
      )}
    </section>
  );
}

function PayoutHistoryRow({
  isDownloadingReceipt,
  isDetailLoading,
  onDownloadReceipt,
  onOpenDetail,
  payout
}: {
  isDownloadingReceipt: boolean;
  isDetailLoading: boolean;
  onDownloadReceipt: (payout: AdminPayoutSummary) => Promise<void>;
  onOpenDetail: (payout: AdminPayoutSummary) => Promise<void>;
  payout: AdminPayoutSummary;
}) {
  return (
    <article className="admin-payout-row compact">
      <div className="admin-payout-worker">
        <strong>{payout.user?.name ?? payout.user?.email ?? "Unknown worker"}</strong>
        <small>{payout.user?.email}</small>
        <small>Updated {formatDate(payout.updatedAt)}</small>
      </div>
      <span className="admin-payout-amount">
        <strong>{formatMoney(payout.amount, payout.currency)}</strong>
        <small>{payout.taskCreditEventCount} credit events</small>
      </span>
      <span className="admin-payout-state">
        <strong className={`payout-status-pill ${getPayoutStatusClass(payout.status)}`}>{formatEnum(payout.status)}</strong>
        <small>{payout.providerRef ?? "Manual payout"}</small>
        <small>{payout.receiptCount} receipt{payout.receiptCount === 1 ? "" : "s"}</small>
        {payout.adminNotes ? <small>{payout.adminNotes}</small> : null}
      </span>
      <div className="row-actions">
        {payout.receiptCount > 0 ? (
          <button className="secondary-button compact-button" disabled={isDownloadingReceipt} type="button" onClick={() => void onDownloadReceipt(payout)}>
            <Download size={16} />
            {isDownloadingReceipt ? "Downloading" : "Receipt"}
          </button>
        ) : null}
        <button className="ghost-button compact-button" type="button" onClick={() => void onOpenDetail(payout)}>
          <Eye size={16} />
          {isDetailLoading ? "Loading" : "Details"}
        </button>
      </div>
    </article>
  );
}

function ActivePayoutRow({
  draft,
  isDownloadingReceipt,
  isDetailLoading,
  onDownloadReceipt,
  onOpenDetail,
  onReview,
  onUpdateDraft,
  payout
}: {
  draft: Required<PayoutReviewInput>;
  isDownloadingReceipt: boolean;
  isDetailLoading: boolean;
  onDownloadReceipt: (payout: AdminPayoutSummary) => Promise<void>;
  onOpenDetail: (payout: AdminPayoutSummary) => Promise<void>;
  onReview: (payout: AdminPayoutSummary, decision: PayoutDecision, input?: PayoutReviewInput) => Promise<void>;
  onUpdateDraft: (payout: AdminPayoutSummary, field: keyof Required<PayoutReviewInput>, value: string) => void;
  payout: AdminPayoutSummary;
}) {
  return (
    <article className="admin-payout-row">
      <div className="admin-payout-worker">
        <strong>{payout.user?.name ?? payout.user?.email ?? "Unknown worker"}</strong>
        <small>{payout.user?.email}</small>
        <small>Requested {formatDate(payout.createdAt)}</small>
      </div>
      <span className="admin-payout-amount">
        <strong>{formatMoney(payout.amount, payout.currency)}</strong>
        <small>{payout.taskCreditEventCount} approved credit events</small>
      </span>
      <span className="admin-payout-state">
        <strong className={`payout-status-pill ${getPayoutStatusClass(payout.status)}`}>{formatEnum(payout.status)}</strong>
        <small>{payout.providerRef ?? "Manual payout"}</small>
        <small>{payout.receiptCount} receipt{payout.receiptCount === 1 ? "" : "s"}</small>
      </span>
      <div className="row-actions">
        {payout.receiptCount > 0 ? (
          <button className="secondary-button compact-button" disabled={isDownloadingReceipt} type="button" onClick={() => void onDownloadReceipt(payout)}>
            <Download size={16} />
            {isDownloadingReceipt ? "Downloading" : "Receipt"}
          </button>
        ) : null}
        <button className="ghost-button compact-button" type="button" onClick={() => void onOpenDetail(payout)}>
          <Eye size={16} />
          {isDetailLoading ? "Loading" : "Details"}
        </button>
        {payout.status === "REQUESTED" ? (
          <button className="secondary-button compact-button" type="button" onClick={() => void onReview(payout, "processing")}>
            <Loader2 size={16} />
            Processing
          </button>
        ) : null}
        {payout.status === "PROCESSING" ? (
          <button
            className="primary-button compact-button"
            disabled={!draft.providerRef.trim()}
            type="button"
            onClick={() => void onReview(payout, "paid", draft)}
          >
            <CircleDollarSign size={16} />
            Mark paid
          </button>
        ) : null}
        {payout.status === "PROCESSING" ? (
          <button
            className="secondary-button danger-button compact-button"
            type="button"
            onClick={() => void onReview(payout, "fail", { adminNotes: draft.adminNotes })}
          >
            <XCircle size={16} />
            Failed
          </button>
        ) : null}
        {payout.status === "REQUESTED" ? (
          <button className="ghost-button danger-button compact-button" type="button" onClick={() => void onReview(payout, "cancel")}>
            <Ban size={16} />
            Cancel
          </button>
        ) : null}
      </div>
      {payout.status === "PROCESSING" ? (
        <div className="admin-payout-payment-form">
          <label>
            Payment method
            <input
              value={draft.provider}
              onChange={(event) => onUpdateDraft(payout, "provider", event.currentTarget.value)}
              placeholder="manual, ACH, PayPal..."
            />
          </label>
          <label>
            Payment reference
            <input
              value={draft.providerRef}
              onChange={(event) => onUpdateDraft(payout, "providerRef", event.currentTarget.value)}
              placeholder="Transaction ID or receipt number"
            />
          </label>
          <label>
            Admin note
            <input
              value={draft.adminNotes}
              onChange={(event) => onUpdateDraft(payout, "adminNotes", event.currentTarget.value)}
              placeholder="Optional internal note"
            />
          </label>
        </div>
      ) : null}
    </article>
  );
}

function PaymentIntentDetailModal({
  downloadingReceipts,
  onClose,
  onDownloadReceipts,
  onRecordRefund,
  payment,
  refunding
}: {
  downloadingReceipts: boolean;
  onClose: () => void;
  onDownloadReceipts: (payment: AdminPaymentIntentDetail) => Promise<void>;
  onRecordRefund: (payment: AdminPaymentIntentDetail, input: PaymentRefundInput) => Promise<void>;
  payment: AdminPaymentIntentDetail;
  refunding: boolean;
}) {
  const [refundAmount, setRefundAmount] = useState(() => formatMoneyDraft(payment.refundReadiness.refundableAmount));
  const [refundProviderRef, setRefundProviderRef] = useState("");
  const [refundNotes, setRefundNotes] = useState("");
  const canRecordRefund = payment.refundReadiness.status === "ready" && payment.refundReadiness.refundableAmount > 0;

  useEffect(() => {
    setRefundAmount(formatMoneyDraft(payment.refundReadiness.refundableAmount));
    setRefundProviderRef("");
    setRefundNotes("");
  }, [payment.id, payment.refundReadiness.refundableAmount]);

  function handleRefundSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(refundAmount);

    if (!canRecordRefund || !Number.isFinite(amount) || amount <= 0 || !refundProviderRef.trim()) {
      return;
    }

    void onRecordRefund(payment, {
      amount,
      ...(refundNotes.trim() ? { adminNotes: refundNotes.trim() } : {}),
      providerRef: refundProviderRef.trim()
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel payment-detail-modal" role="dialog" aria-modal="true" aria-label="Payment detail">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Payment detail</p>
            <h2>{formatMoney(payment.amount, payment.currency)}</h2>
            <p className="muted-copy">
              {formatPaymentProviderLabel(payment.provider)} - {formatEnum(payment.status)} - {payment.organization?.name ?? "No organization"}
            </p>
          </div>
          <div className="modal-head-actions">
            {payment.receipts.length > 0 ? (
              <button
                className="secondary-button compact-button"
                disabled={downloadingReceipts}
                onClick={() => void onDownloadReceipts(payment)}
                type="button"
              >
                <Download size={16} />
                {downloadingReceipts ? "Downloading" : "Receipts"}
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close payment detail">
              <X size={18} />
            </button>
          </div>
        </div>

        <dl className="payout-detail-grid payment-detail-grid">
          <div className="highlight">
            <dt>Amount</dt>
            <dd>{formatMoney(payment.amount, payment.currency)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd><span className={`payout-status-pill ${getPaymentStatusClass(payment.statusGroup)}`}>{formatEnum(payment.status)}</span></dd>
          </div>
          <div>
            <dt>Refund readiness</dt>
            <dd>
              <span className={`refund-readiness-pill ${getRefundReadinessClass(payment.refundReadiness.status)}`}>
                {formatRefundReadiness(payment.refundReadiness.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Reconciliation</dt>
            <dd>
              <span className={`refund-readiness-pill ${payment.reconciliation.status === "balanced" ? "ready" : "warning"}`}>
                {payment.reconciliation.status === "balanced" ? "Balanced" : "Needs review"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{formatPaymentProviderLabel(payment.provider)}</dd>
          </div>
          <div>
            <dt>Provider reference</dt>
            <dd>{payment.providerRef ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Client request</dt>
            <dd>{payment.clientRequestId ?? "No idempotency key"}</dd>
          </div>
          <div>
            <dt>Created by</dt>
            <dd>{payment.createdBy?.email ?? payment.createdBy?.name ?? "System"}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(payment.createdAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatOptionalDate(payment.completedAt)}</dd>
          </div>
          <div>
            <dt>Cancelled</dt>
            <dd>{formatOptionalDate(payment.cancelledAt)}</dd>
          </div>
          <div>
            <dt>Receipts</dt>
            <dd>{payment.receipts.length}</dd>
          </div>
          <div>
            <dt>Ledger entries</dt>
            <dd>{payment.ledgerEntries.length}</dd>
          </div>
        </dl>

        <section className="payment-readiness-note">
          <strong>{formatRefundReadiness(payment.refundReadiness.status)}</strong>
          <span>
            {payment.refundReadiness.reason} {formatMoney(payment.refundReadiness.refundedAmount, payment.currency)} refunded,
            {" "}{formatMoney(payment.refundReadiness.refundableAmount, payment.currency)} remaining.
          </span>
        </section>

        <section className={`payment-reconciliation-note ${payment.reconciliation.status}`}>
          <div>
            <p className="eyebrow">Reconciliation</p>
            <h3>{payment.reconciliation.status === "balanced" ? "Payment rows are balanced" : "Payment needs review"}</h3>
          </div>
          <div className="payment-reconciliation-metrics">
            <span>
              <small>Payment</small>
              <strong>{formatMoney(payment.reconciliation.paymentAmount, payment.currency)}</strong>
            </span>
            <span>
              <small>Ledger net</small>
              <strong>{formatMoney(payment.reconciliation.netLedgerAmount, payment.currency)}</strong>
            </span>
            <span>
              <small>Receipt net</small>
              <strong>{formatMoney(payment.reconciliation.netReceiptAmount, payment.currency)}</strong>
            </span>
            <span>
              <small>Refunds</small>
              <strong>{formatMoney(payment.reconciliation.refundLedgerAmount, payment.currency)}</strong>
            </span>
          </div>
          {payment.reconciliation.issues.length > 0 ? (
            <div className="payment-reconciliation-issues">
              {payment.reconciliation.issues.map((issue) => (
                <span className={issue.severity} key={issue.code}>
                  <strong>{formatEnum(issue.code)}</strong>
                  <small>{issue.message}</small>
                </span>
              ))}
            </div>
          ) : (
            <p className="muted-copy">Payment amount, wallet ledger entries, receipts, and refund rows currently agree.</p>
          )}
        </section>

        <form className="payment-refund-form" onSubmit={handleRefundSubmit}>
          <div>
            <p className="eyebrow">Refund tracking</p>
            <h3>Record external refund</h3>
            <p className="muted-copy">Use this after the refund is created in PayPal, Stripe, or the provider dashboard.</p>
          </div>
          <label>
            Amount
            <input
              disabled={!canRecordRefund || refunding}
              max={payment.refundReadiness.refundableAmount}
              min="0.01"
              onChange={(event) => setRefundAmount(event.currentTarget.value)}
              step="0.01"
              type="number"
              value={refundAmount}
            />
          </label>
          <label>
            Refund reference
            <input
              disabled={!canRecordRefund || refunding}
              onChange={(event) => setRefundProviderRef(event.currentTarget.value)}
              placeholder="Provider refund ID"
              value={refundProviderRef}
            />
          </label>
          <label>
            Admin note
            <input
              disabled={!canRecordRefund || refunding}
              onChange={(event) => setRefundNotes(event.currentTarget.value)}
              placeholder="Optional internal note"
              value={refundNotes}
            />
          </label>
          <button className="primary-button compact-button" disabled={!canRecordRefund || refunding || !refundProviderRef.trim()} type="submit">
            {refunding ? <Loader2 className="spin" size={14} /> : <CircleDollarSign size={14} />}
            Record refund
          </button>
        </form>

        <div className="payment-detail-columns">
          <section className="payout-detail-section">
            <div>
              <p className="eyebrow">Receipts</p>
              <h3>Wallet receipts</h3>
            </div>
            <div className="payment-detail-list">
              {payment.receipts.length > 0 ? (
                payment.receipts.map((receipt) => (
                  <article className="payment-detail-row" key={receipt.id}>
                    <span>
                      <strong>{receipt.receiptNumber}</strong>
                      <small>{receipt.description ?? formatEnum(receipt.type)}</small>
                      <small>{formatDate(receipt.issuedAt)}</small>
                    </span>
                    <span>
                      <strong>{formatMoney(receipt.amount, receipt.currency)}</strong>
                      <small>{receipt.providerRef ?? receipt.id}</small>
                    </span>
                  </article>
                ))
              ) : (
                <p className="muted-copy">No wallet receipts have been issued for this payment.</p>
              )}
            </div>
          </section>

          <section className="payout-detail-section">
            <div>
              <p className="eyebrow">Ledger</p>
              <h3>Wallet ledger entries</h3>
            </div>
            <div className="payment-detail-list">
              {payment.ledgerEntries.length > 0 ? (
                payment.ledgerEntries.map((entry) => (
                  <article className="payment-detail-row" key={entry.id}>
                    <span>
                      <strong>{formatEnum(entry.type)}</strong>
                      <small>{entry.description ?? entry.referenceId ?? entry.id}</small>
                      <small>{formatDate(entry.createdAt)}</small>
                    </span>
                    <span>
                      <strong>{formatMoney(entry.amount, entry.currency)}</strong>
                      <small>{entry.organization?.name ?? entry.user?.name ?? entry.walletId}</small>
                    </span>
                  </article>
                ))
              ) : (
                <p className="muted-copy">No wallet ledger entries are linked to this payment.</p>
              )}
            </div>
          </section>
        </div>

        <div className="payment-detail-columns">
          <section className="payout-detail-section">
            <div>
              <p className="eyebrow">Audit</p>
              <h3>Admin and system events</h3>
            </div>
            <div className="payment-detail-list compact">
              {payment.auditTrail.length > 0 ? (
                payment.auditTrail.map((entry) => (
                  <article className="payment-detail-row" key={entry.id}>
                    <span>
                      <strong>{formatAdminAuditTitle(entry.action)}</strong>
                      <small>{entry.description}</small>
                    </span>
                    <span>
                      <strong>{formatDate(entry.createdAt)}</strong>
                      <small>{entry.actor?.name ?? "System"}</small>
                    </span>
                  </article>
                ))
              ) : (
                <p className="muted-copy">No audit events are linked to this payment.</p>
              )}
            </div>
          </section>

          <section className="payout-detail-section">
            <div>
              <p className="eyebrow">Provider</p>
              <h3>Webhook context</h3>
            </div>
            <div className="payment-detail-list compact">
              {payment.webhookEvents.length > 0 ? (
                payment.webhookEvents.map((event) => (
                  <article className="payment-detail-row" key={event.id}>
                    <span>
                      <strong>{event.eventType ?? "Webhook event"}</strong>
                      <small>{event.eventId}</small>
                    </span>
                    <span>
                      <strong>{formatDate(event.receivedAt)}</strong>
                      <small>{event.duplicateCount} duplicate{event.duplicateCount === 1 ? "" : "s"}</small>
                    </span>
                  </article>
                ))
              ) : (
                <p className="muted-copy">No matching provider webhook events were found.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function PayoutDetailModal({
  downloading,
  onClose,
  onDownloadReceipt,
  payout
}: {
  downloading: boolean;
  onClose: () => void;
  onDownloadReceipt: (payout: AdminPayoutSummary) => Promise<void>;
  payout: AdminPayoutDetail;
}) {
  const totalCredits = payout.creditEvents.reduce((total, event) => total + event.credits, 0);
  const totalPoints = payout.creditEvents.reduce((total, event) => total + event.points, 0);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel payout-detail-modal" role="dialog" aria-modal="true" aria-label="Payout detail">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Payout detail</p>
            <h2>{payout.user?.name ?? payout.user?.email ?? "Unknown worker"}</h2>
            <p className="muted-copy">
              {formatMoney(payout.amount, payout.currency)} - {formatEnum(payout.status)} - {payout.taskCreditEventCount} credit events
            </p>
          </div>
          <div className="modal-head-actions">
            {payout.receiptCount > 0 ? (
              <button className="secondary-button compact-button" disabled={downloading} type="button" onClick={() => void onDownloadReceipt(payout)}>
                <Download size={16} />
                {downloading ? "Downloading" : "Receipt"}
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close payout detail">
              <X size={18} />
            </button>
          </div>
        </div>

        <dl className="payout-detail-grid">
          <div className="highlight">
            <dt>Amount</dt>
            <dd>{formatMoney(payout.amount, payout.currency)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd><span className={`payout-status-pill ${getPayoutStatusClass(payout.status)}`}>{formatEnum(payout.status)}</span></dd>
          </div>
          <div>
            <dt>Credits</dt>
            <dd>{totalCredits} credits / {totalPoints} pts</dd>
          </div>
          <div>
            <dt>Worker</dt>
            <dd>{payout.user?.email ?? payout.userId}</dd>
          </div>
          <div>
            <dt>Requested</dt>
            <dd>{formatDate(payout.createdAt)}</dd>
          </div>
          <div>
            <dt>Reviewed</dt>
            <dd>{formatOptionalDate(payout.reviewedAt)}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{payout.provider ?? "Manual"}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{payout.providerRef ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Receipt</dt>
            <dd>{payout.receiptCount > 0 ? `${payout.receiptCount} available` : "Not issued"}</dd>
          </div>
          <div>
            <dt>Admin note</dt>
            <dd>{payout.adminNotes ?? "No note"}</dd>
          </div>
        </dl>

        <section className="payout-detail-section">
          <div>
            <p className="eyebrow">Credit events</p>
            <h3>Approved work in this payout</h3>
          </div>
          <div className="payout-credit-list">
            {payout.creditEvents.length > 0 ? (
              payout.creditEvents.map((event) => (
                <article className="payout-credit-row" key={event.id}>
                  <span>
                    <strong>{event.assetName ?? event.taskId ?? event.id}</strong>
                    <small>
                      {[event.projectName, event.datasetName].filter(Boolean).join(" - ") || "No dataset context"}
                    </small>
                    <small>{event.taskId ? `Task ${event.taskId}` : event.id}</small>
                  </span>
                  <span>
                    <strong>{formatMoney(event.amount, event.currency)}</strong>
                    <small>
                      {event.points} pts - {event.credits} credits
                    </small>
                  </span>
                  <span>
                    <strong>{formatEnum(event.eventType)}</strong>
                    <small>{formatEnum(event.status)}</small>
                    <small>{event.approvedAt ? `Approved ${formatDate(event.approvedAt)}` : `Created ${formatDate(event.createdAt)}`}</small>
                  </span>
                </article>
              ))
            ) : (
              <p className="muted-copy">No credit events are attached to this payout.</p>
            )}
          </div>
        </section>

        <section className="payout-detail-section">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h3>Payout activity</h3>
          </div>
          <div className="payout-audit-list">
            {payout.auditTrail.length > 0 ? (
              payout.auditTrail.map((entry) => (
                <article className="payout-audit-row" key={entry.id}>
                  <strong>{formatEnum(entry.action.replace(/^payout\./, ""))}</strong>
                  <small>{formatDate(entry.createdAt)}</small>
                </article>
              ))
            ) : (
              <p className="muted-copy">No payout audit events yet.</p>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function ApplicationPanel({
  applications,
  onReview
}: {
  applications: AdminApplicationSummary[];
  onReview: (application: AdminApplicationSummary, decision: "approve" | "reject") => Promise<void>;
}) {
  const pending = applications.filter((application) => application.status === "SUBMITTED" || application.status === "REVIEWING");

  return (
    <section className="panel table-panel">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">Applications</p>
          <h2>Pending review</h2>
          <p className="muted-copy">Approve verification and creator rights requests.</p>
        </div>
      </div>
      {pending.length > 0 ? (
        <div className="admin-application-list">
          {pending.map((application) => (
            <article className="admin-application-card" key={`${application.type}-${application.id}`}>
              <div>
                <p className="eyebrow">{formatEnum(application.type)}</p>
                <h3>{application.user?.name ?? "Unknown user"}</h3>
                <small>{application.user?.email}</small>
              </div>
              <p>{application.reason}</p>
              {application.intendedUse && <p className="muted-copy">{application.intendedUse}</p>}
              <div className="row-actions">
                <button className="primary-button compact-button" type="button" onClick={() => void onReview(application, "approve")}>
                  <CheckCircle2 size={16} />
                  Approve
                </button>
                <button className="ghost-button danger-button compact-button" type="button" onClick={() => void onReview(application, "reject")}>
                  <XCircle size={16} />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <ShieldCheck size={28} />
          <strong>No pending applications</strong>
          <span>New verification and creator requests will appear here.</span>
        </div>
      )}
    </section>
  );
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function formatMoneyDraft(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function shortId(value: string) {
  return value.length > 13 ? `${value.slice(0, 7)}...${value.slice(-4)}` : value;
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : "Not reviewed";
}

function getPayoutStatusCounts(payouts: AdminPayoutSummary[]) {
  return payouts.reduce<Record<PayoutStatusFilter, number>>(
    (counts, payout) => {
      counts.all += 1;
      if (payout.status === "REQUESTED") {
        counts.requested += 1;
      } else if (payout.status === "PROCESSING") {
        counts.processing += 1;
      } else if (payout.status === "PAID") {
        counts.paid += 1;
      } else if (payout.status === "FAILED") {
        counts.failed += 1;
      } else if (payout.status === "CANCELLED") {
        counts.cancelled += 1;
      }

      return counts;
    },
    {
      all: 0,
      cancelled: 0,
      failed: 0,
      paid: 0,
      processing: 0,
      requested: 0
    }
  );
}

function getPayoutStatusClass(status: string) {
  if (status === "PAID") {
    return "paid";
  }

  if (status === "PROCESSING") {
    return "processing";
  }

  if (status === "FAILED" || status === "CANCELLED") {
    return "failed";
  }

  return "requested";
}

function getPaymentStatusClass(statusGroup: AdminPaymentIntentSummary["statusGroup"]) {
  if (statusGroup === "settled") {
    return "paid";
  }

  if (statusGroup === "open" || statusGroup === "stale") {
    return "processing";
  }

  return "failed";
}

function getRefundReadinessClass(status: AdminPaymentIntentDetail["refundReadiness"]["status"]) {
  if (status === "ready") {
    return "ready";
  }

  if (status === "fully_refunded") {
    return "ready";
  }

  if (status === "needs_provider_reference" || status === "needs_reconciliation") {
    return "warning";
  }

  return "blocked";
}

function formatRefundReadiness(status: AdminPaymentIntentDetail["refundReadiness"]["status"]) {
  if (status === "ready") {
    return "Refund trackable";
  }

  if (status === "needs_provider_reference") {
    return "Needs provider ref";
  }

  if (status === "needs_reconciliation") {
    return "Needs reconciliation";
  }

  if (status === "fully_refunded") {
    return "Fully refunded";
  }

  return "Not refundable";
}

function payoutStatusMatches(status: string, filter: PayoutStatusFilter) {
  return filter === "all" || status.toLowerCase() === filter;
}
