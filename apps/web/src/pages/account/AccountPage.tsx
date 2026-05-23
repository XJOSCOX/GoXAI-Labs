import { CheckCircle2, KeyRound, Save, ShieldCheck, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useAuth } from "../../auth";
import { formatDate, formatEnum } from "../../utils/format";

export function AccountPage() {
  const { dbUser, loading, updateProfile } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <section className="panel">
            <div className="account-status">
              <span className="account-status-icon">
                {dbUser.isVerified ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
              </span>
              <div>
                <p className="eyebrow">Status</p>
                <h2>{dbUser.isVerified ? "Verified account" : "Unverified account"}</h2>
                <p className="muted-copy">
                  {dbUser.isVerified ? "This user has been verified by GoXAi Lab." : "Verification can be granted by an approved site admin."}
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
