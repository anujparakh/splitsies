import { useState } from "react";
import { api } from "../api";

interface LoginProps {
  onSignedIn: () => void;
}

/**
 * The sign-in screen. A single password field — no username, because the
 * password alone identifies the person and the screen should reveal nothing
 * about who uses the app.
 */
export function Login({ onSignedIn }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      setPassword("");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Splitsies</h1>
        <p className="login-tagline">Shared expenses, kept simple.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
