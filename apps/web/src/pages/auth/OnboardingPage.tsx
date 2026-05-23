import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, CheckCircle2, LogOut } from "lucide-react";
import { getFormValue, useAuth } from "../../auth";
import { ThemeToggle } from "../../components/layout/ThemeToggle";
import { planOptions } from "../../constants/options";
import { useOrganizations } from "../../hooks/useResources";
import { updateOrganization, updateUserProfile } from "../../api";

export function OnboardingPage() {
  const { logout, session } = useAuth();
  const { loading, organizations } = useOrganizations(session);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const organization = organizations.find((item) => item.role === "OWNER" && item.onboardingComplete === false);

  if (loading) {
    return (
      <section className="page-stack">
        <section className="panel empty-state compact-empty">
          <Building2 size={28} />
          <strong>Preparing onboarding</strong>
          <span>Loading your organization setup.</span>
        </section>
      </section>
    );
  }

  if (!organization) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError(null);

    if (!session || !organization) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);
    const jobTitle = getFormValue(event, "jobTitle");
    const description = getFormValue(event, "description");
    const organizationType = getFormValue(event, "type");
    const planTier = getFormValue(event, "plan");

    try {
      await updateUserProfile(session, {
        jobTitle
      });
      await updateOrganization(session, organization.id, {
        description,
        type: organizationType,
        planTier,
        completeOnboarding: true
      });
      window.location.assign(`/organization/${organization.id}`);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to complete onboarding.");
      setSaving(false);
    }
  }

  return (
    <main className="onboarding-screen">
      <section className="onboarding-card">
        <div className="onboarding-card-head">
          <div>
            <p className="eyebrow">Onboarding</p>
            <h1>Finish {organization.name}</h1>
          </div>
          <div className="onboarding-actions">
            <ThemeToggle />
            <button className="secondary-button danger-button compact-button" type="button" onClick={() => void logout()}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
        {pageError && <p className="form-error">{pageError}</p>}
        <form className="setup-form onboarding-form" onSubmit={handleSubmit}>
          <div className="wide">
            <p className="eyebrow">Required setup</p>
            <h2>Tell us how this organization should be configured.</h2>
          </div>
          <label>
            Your role or title
            <input name="jobTitle" placeholder="CEO, Director, Data lead..." required />
          </label>
          <label>
            Organization type
            <select name="type" defaultValue={organization.type || "COMPANY"}>
              <option value="COMPANY">Company</option>
              <option value="ENTERPRISE">Enterprise</option>
              <option value="MARKETPLACE_VENDOR">Marketplace vendor</option>
              <option value="PERSONAL">Personal</option>
            </select>
          </label>
          <label className="wide">
            Organization description
            <textarea
              name="description"
              placeholder="What does the organization do, and what kind of AI/data work will it run?"
              required
            />
          </label>
          <fieldset className="plan-picker wide">
            <legend>Plan</legend>
            <div className="plan-option-row">
              {planOptions.map((plan) => (
                <label className="plan-option" key={plan.value}>
                  <input name="plan" type="radio" value={plan.value} defaultChecked={plan.value === organization.planTier} />
                  <strong>{plan.label}</strong>
                  <span>{plan.price}</span>
                  <small>{plan.detail}</small>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="primary-button wide" type="submit" disabled={saving}>
            <CheckCircle2 size={18} />
            {saving ? "Saving setup" : "Complete onboarding"}
          </button>
        </form>
      </section>
    </main>
  );
}
