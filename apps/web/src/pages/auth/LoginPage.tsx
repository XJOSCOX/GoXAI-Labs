import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ShieldCheck, UserRoundPlus } from "lucide-react";
import { getFormValue, useAuth } from "../../auth";
import { AuthFrame } from "../../components/auth/AuthFrame";

export function LoginPage() {
  const { error, loading, login, session } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  if (session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    try {
      await login(getFormValue(event, "email"), getFormValue(event, "password"));
      navigate("/");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to log in.");
    }
  }

  return (
    <AuthFrame title="Login" subtitle="Access your labeling operations workspace.">
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email or organization email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {(formError ?? error) && <p className="form-error">{formError ?? error}</p>}
        <button className="primary-button" type="submit" disabled={loading}>
          <ShieldCheck size={18} />
          {loading ? "Signing in" : "Sign in"}
        </button>
      </form>
      <p className="auth-switch">
        New workspace? <Link to="/register">Create an account</Link>
      </p>
    </AuthFrame>
  );
}
