import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAdminOverview,
  reviewAdminApplication,
  updateAdminUser,
  type AdminApplicationSummary,
  type AdminOverview,
  type AdminUserSummary
} from "../../api";
import { useAuth } from "../../auth";
import { formatDate, formatEnum } from "../../utils/format";

export function AdminPage() {
  const { dbUser, session } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
          <section className="stat-grid">
            <Stat label="Users" value={overview.counts.users} />
            <Stat label="Pending verification" value={overview.counts.pendingVerification} />
            <Stat label="Pending creators" value={overview.counts.pendingCreators} />
            <Stat label="Organizations" value={overview.counts.organizations} />
          </section>

          <ApplicationPanel
            applications={[...overview.verificationApplications, ...overview.creatorApplications]}
            onReview={handleReview}
          />

          <section className="panel table-panel">
            <div className="table-toolbar">
              <div>
                <p className="eyebrow">Users</p>
                <h2>Platform accounts</h2>
                <p className="muted-copy">Update status and access while the full admin console grows.</p>
              </div>
            </div>
            <div className="admin-user-list">
              {overview.users.map((user) => (
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
                      onChange={(event) => void handleUserUpdate(user, "verificationStatus", event.currentTarget.value)}
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
                      onChange={(event) => void handleUserUpdate(user, "creatorStatus", event.currentTarget.value)}
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
                    <select value={user.globalRole} onChange={(event) => void handleUserUpdate(user, "globalRole", event.currentTarget.value)}>
                      <option value="USER">User</option>
                      <option value="SUPER_ADMIN">Super admin</option>
                      <option value="SYSTEM">System</option>
                    </select>
                  </label>
                  <label>
                    Status
                    <select value={user.status} onChange={(event) => void handleUserUpdate(user, "status", event.currentTarget.value)}>
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
      <div className="table-toolbar">
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
