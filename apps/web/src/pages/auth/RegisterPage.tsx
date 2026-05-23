import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, UserRoundPlus } from "lucide-react";
import { getFormValue, useAuth } from "../../auth";
import { AuthFrame } from "../../components/auth/AuthFrame";
import { getPasswordChecks, getPasswordPolicyError, splitFullName } from "../../utils/format";

export function RegisterPage() {
  const { error, loading, register, session } = useAuth();
  const navigate = useNavigate();
  const [signupType, setSignupType] = useState<"user" | "organization">("user");
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const passwordChecks = getPasswordChecks(passwordDraft);

  if (session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFormError(null);

    try {
      const fullName = getFormValue(event, "fullName");
      const { firstName, lastName } = splitFullName(fullName);
      const organizationName = getFormValue(event, "organizationName");
      const organizationEmail = getFormValue(event, "organizationEmail");
      const password = getFormValue(event, "password");
      const confirmPassword = getFormValue(event, "confirmPassword");
      const passwordError = getPasswordPolicyError(password);

      if (passwordError) {
        setFormError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setFormError("Password and confirm password must match.");
        return;
      }

      if (signupType === "organization" && !organizationName) {
        setFormError("Organization name is required.");
        return;
      }

      if (signupType === "organization" && !organizationEmail) {
        setFormError("Organization email is required.");
        return;
      }

      const result = await register({
        signupType,
        email: getFormValue(event, "email"),
        password,
        firstName,
        lastName,
        organizationName,
        organizationEmail
      });

      if (result === "signed-in") {
        navigate(signupType === "organization" ? "/onboarding" : "/");
      } else {
        setMessage("Check your email to confirm the account before signing in.");
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to register.");
    }
  }

  return (
    <AuthFrame title="Register" subtitle="Create your GoXAi Lab identity and choose whether this is a personal or organization account.">
      <form className="auth-form two-column" onSubmit={handleSubmit}>
        <fieldset className="signup-type-picker wide">
          <legend>Account type</legend>
          <label>
            <input
              checked={signupType === "user"}
              name="signupType"
              onChange={() => setSignupType("user")}
              type="radio"
              value="user"
            />
            <span>
              <strong>Simple user</strong>
              <small>Personal account without an organization.</small>
            </span>
          </label>
          <label>
            <input
              checked={signupType === "organization"}
              name="signupType"
              onChange={() => setSignupType("organization")}
              type="radio"
              value="organization"
            />
            <span>
              <strong>Organization</strong>
              <small>Create the organization and become its owner.</small>
            </span>
          </label>
        </fieldset>
        <label className="wide">
          Full name
          <input name="fullName" autoComplete="name" placeholder="Esaie Joseph" required />
        </label>
        <label className="wide">
          User email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        {signupType === "organization" && (
          <>
            <label className="wide">
              Organization name
              <input name="organizationName" placeholder="GoXAi Lab" required />
            </label>
            <label className="wide">
              Organization email
              <input name="organizationEmail" type="email" placeholder="ops@example.com" required />
            </label>
          </>
        )}
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            onChange={(event) => setPasswordDraft(event.currentTarget.value)}
            pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[A-Za-z])(?=.*[^A-Za-z0-9]).{10,}"
            required
          />
        </label>
        <label>
          Confirm password
          <input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required />
        </label>
        <ul className="password-rules wide" aria-label="Password requirements">
          {passwordChecks.map((check) => (
            <li className={check.met ? "met" : ""} key={check.label}>
              <CheckCircle2 size={13} />
              {check.label}
            </li>
          ))}
        </ul>
        {(formError ?? error) && <p className="form-error wide">{formError ?? error}</p>}
        {message && <p className="form-success wide">{message}</p>}
        <button className="primary-button wide" type="submit" disabled={loading}>
          <UserRoundPlus size={18} />
          {loading ? "Creating account" : "Create account"}
        </button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
