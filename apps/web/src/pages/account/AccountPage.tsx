import { Bell, CheckCircle2, KeyRound, Send, Save, ShieldCheck, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  getNotificationPreferences,
  getMyApplications,
  submitCreatorApplication,
  submitVerificationApplication,
  updateNotificationPreferences,
  type NotificationPreferenceSummary,
  type UserApplicationSummary
} from "../../api";
import { useAuth } from "../../auth";
import { formatDate, formatEnum } from "../../utils/format";

export function AccountPage() {
  const { dbUser, loading, refreshUser, session, updateProfile } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferenceSummary[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [verificationApplication, setVerificationApplication] = useState<UserApplicationSummary | null>(null);
  const [creatorApplication, setCreatorApplication] = useState<UserApplicationSummary | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadApplications() {
      if (!session) {
        return;
      }

      setApplicationsLoading(true);

      try {
        const result = await getMyApplications(session);

        if (mounted) {
          setVerificationApplication(result.verificationApplication);
          setCreatorApplication(result.creatorApplication);
        }
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "Unable to load account applications.");
        }
      } finally {
        if (mounted) {
          setApplicationsLoading(false);
        }
      }
    }

    void loadApplications();

    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    let mounted = true;

    async function loadNotificationPreferences() {
      if (!session) {
        return;
      }

      setNotificationsLoading(true);

      try {
        const preferences = await getNotificationPreferences(session);

        if (mounted) {
          setNotificationPreferences(preferences);
        }
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "Unable to load notification preferences.");
        }
      } finally {
        if (mounted) {
          setNotificationsLoading(false);
        }
      }
    }

    void loadNotificationPreferences();

    return () => {
      mounted = false;
    };
  }, [session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    const form = new FormData(event.currentTarget);
    const firstName = getString(form, "firstName");
    const lastName = getString(form, "lastName");
    const jobTitle = getString(form, "jobTitle");

    try {
      await updateProfile({ firstName, lastName, jobTitle });
      setMessage("Account updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update account.");
    }
  }

  async function handleVerificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setMessage(null);
    setError(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const form = new FormData(formElement);

    try {
      const application = await submitVerificationApplication(session, {
        fullName: getString(form, "fullName"),
        reason: getString(form, "reason"),
        intendedUse: getString(form, "intendedUse")
      });
      setVerificationApplication(application);
      await refreshUser();
      setMessage("Verification application submitted.");
      formElement.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit verification application.");
    }
  }

  async function handleCreatorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setMessage(null);
    setError(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const form = new FormData(formElement);

    try {
      const application = await submitCreatorApplication(session, {
        reason: getString(form, "reason"),
        intendedUse: getString(form, "intendedUse")
      });
      setCreatorApplication(application);
      await refreshUser();
      setMessage("Creator rights application submitted.");
      formElement.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit creator application.");
    }
  }

  async function handleNotificationPreferenceChange(event: string, field: "email" | "inApp", checked: boolean) {
    if (!session) {
      setError("Authentication required.");
      return;
    }

    const nextPreferences = notificationPreferences.map((preference) =>
      preference.event === event ? { ...preference, [field]: checked } : preference
    );

    setNotificationPreferences(nextPreferences);
    setMessage(null);
    setError(null);
    setNotificationsLoading(true);

    try {
      const saved = await updateNotificationPreferences(session, nextPreferences);
      setNotificationPreferences(saved);
      setMessage("Notification preferences updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update notification preferences.");
    } finally {
      setNotificationsLoading(false);
    }
  }

  if (!dbUser) {
    return (
      <div className="page-stack account-page">
        <section className="panel empty-state compact-empty">
          <UserRound size={28} />
          <strong>Account unavailable</strong>
          <span>Sign in again to manage your account.</span>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack account-page">
      {error && <div className="form-error">{error}</div>}
      {message && <div className="form-success">{message}</div>}

      <section className="detail-layout account-layout">
        <form className="panel account-form" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Profile</p>
            <h2>Account details</h2>
            <p className="muted-copy">Update the identity shown across GoXAi Lab.</p>
          </div>

          <div className="management-grid">
            <label>
              First name
              <input name="firstName" defaultValue={dbUser.firstName ?? ""} placeholder="Esaie" />
            </label>
            <label>
              Last name
              <input name="lastName" defaultValue={dbUser.lastName ?? ""} placeholder="Joseph" />
            </label>
            <label>
              Role or title
              <input name="jobTitle" defaultValue={dbUser.jobTitle ?? ""} placeholder="CEO, Director, Data lead..." />
            </label>
            <label>
              Email
              <input value={dbUser.email} readOnly />
            </label>
          </div>

          <button className="primary-button account-save-button" type="submit" disabled={loading}>
            <Save size={16} />
            {loading ? "Saving" : "Save account"}
          </button>
        </form>

        <aside className="content-column">
          <section className="panel notification-preferences-panel">
            <div className="account-code-head">
              <Bell size={18} />
              <div>
                <p className="eyebrow">Notifications</p>
                <h2>Notification preferences</h2>
              </div>
            </div>
            <p className="muted-copy">Choose which workflow events should appear in the app. Email is saved for future delivery support.</p>
            <div className="notification-preference-list">
              {notificationPreferences.map((preference) => (
                <article className="notification-preference-row" key={preference.event}>
                  <div>
                    <strong>{preference.label}</strong>
                    <small>{preference.description}</small>
                  </div>
                  <label className="toggle-row compact-toggle">
                    <input
                      checked={preference.inApp}
                      disabled={notificationsLoading}
                      onChange={(event) => void handleNotificationPreferenceChange(preference.event, "inApp", event.currentTarget.checked)}
                      type="checkbox"
                    />
                    In app
                  </label>
                  <label className="toggle-row compact-toggle">
                    <input
                      checked={preference.email}
                      disabled={notificationsLoading}
                      onChange={(event) => void handleNotificationPreferenceChange(preference.event, "email", event.currentTarget.checked)}
                      type="checkbox"
                    />
                    Email
                  </label>
                </article>
              ))}
              {notificationPreferences.length === 0 && (
                <p className="empty-state compact-empty">No notification preferences are available yet.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="account-status">
              <span className="account-status-icon">
                {dbUser.isVerified ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
              </span>
              <div>
                <p className="eyebrow">Status</p>
                <h2>{dbUser.isVerified ? "Verified account" : "Unverified account"}</h2>
                <p className="muted-copy">
                  {dbUser.isVerified
                    ? "This user has been verified by GoXAi Lab."
                    : "Submit a verification request before applying for creator rights."}
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <p className="eyebrow">Access</p>
            <dl className="detail-list account-detail-list">
              <div>
                <dt>User role</dt>
                <dd>{formatEnum(dbUser.globalRole)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatEnum(dbUser.status)}</dd>
              </div>
              <div>
                <dt>Verification</dt>
                <dd>{formatEnum(dbUser.verificationStatus)}</dd>
              </div>
              <div>
                <dt>Creator rights</dt>
                <dd>{formatEnum(dbUser.creatorStatus)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(dbUser.createdAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDate(dbUser.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <p className="eyebrow">Applications</p>
            <h2>Verification request</h2>
            <p className="muted-copy">
              {verificationApplication
                ? `Latest request: ${formatEnum(verificationApplication.status)}`
                : "Ask GoXAi Lab admins to verify your account status."}
            </p>
            {verificationApplication?.reviewerNotes && <p className="form-error">{verificationApplication.reviewerNotes}</p>}
            {dbUser.verificationStatus === "VERIFIED" ? (
              <p className="form-success">Account verification is approved.</p>
            ) : verificationApplication?.status === "SUBMITTED" || verificationApplication?.status === "REVIEWING" ? (
              <p className="form-success">Verification is waiting for admin review.</p>
            ) : (
              <form className="account-application-form" onSubmit={handleVerificationSubmit}>
                <label>
                  Full name
                  <input name="fullName" defaultValue={[dbUser.firstName, dbUser.lastName].filter(Boolean).join(" ")} />
                </label>
                <label>
                  Reason
                  <textarea name="reason" placeholder="Tell us why this account should be verified." required />
                </label>
                <label>
                  Intended use
                  <textarea name="intendedUse" placeholder="How will you use GoXAi Lab?" />
                </label>
                <button className="primary-button" type="submit" disabled={applicationsLoading}>
                  <Send size={16} />
                  Submit verification
                </button>
              </form>
            )}
          </section>

          <section className="panel">
            <p className="eyebrow">Creator access</p>
            <h2>Organization and project rights</h2>
            <p className="muted-copy">
              {creatorApplication
                ? `Latest request: ${formatEnum(creatorApplication.status)}`
                : "Verified users can apply to create organizations and projects."}
            </p>
            {creatorApplication?.reviewerNotes && <p className="form-error">{creatorApplication.reviewerNotes}</p>}
            {dbUser.creatorStatus === "APPROVED" ? (
              <p className="form-success">Creator rights are approved.</p>
            ) : dbUser.verificationStatus !== "VERIFIED" && dbUser.globalRole !== "SUPER_ADMIN" ? (
              <p className="muted-copy">Complete verification before applying for creator rights.</p>
            ) : creatorApplication?.status === "SUBMITTED" || creatorApplication?.status === "REVIEWING" ? (
              <p className="form-success">Creator rights are waiting for admin review.</p>
            ) : (
              <form className="account-application-form" onSubmit={handleCreatorSubmit}>
                <label>
                  Reason
                  <textarea name="reason" placeholder="Why do you need organization and project creation rights?" required />
                </label>
                <label>
                  Intended use
                  <textarea name="intendedUse" placeholder="What kind of work will you create or manage?" />
                </label>
                <button className="primary-button" type="submit" disabled={applicationsLoading}>
                  <Send size={16} />
                  Apply for creator rights
                </button>
              </form>
            )}
          </section>

          <section className="panel">
            <div className="account-code-head">
              <KeyRound size={18} />
              <div>
                <p className="eyebrow">Codes</p>
                <h2>Referral and API code</h2>
              </div>
            </div>
            <dl className="detail-list account-detail-list">
              <div>
                <dt>Referral code</dt>
                <dd>{dbUser.referralCode ?? "Not assigned"}</dd>
              </div>
              <div>
                <dt>API code</dt>
                <dd>{dbUser.apiCode ?? "Not assigned"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>
    </div>
  );
}

function getString(form: FormData, key: string) {
  const value = form.get(key);

  return typeof value === "string" ? value.trim() : "";
}
