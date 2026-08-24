"use client";

import Link from "next/link";
import { FormEvent, useLayoutEffect, useRef, useState } from "react";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { consumeAccountTokenFragment } from "@/lib/auth/token-links";
import styles from "../account-access.module.css";

export function ResetPasswordForm() {
  const fragmentRead = useRef(false);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useLayoutEffect(() => {
    if (fragmentRead.current) return;
    fragmentRead.current = true;
    const fragmentToken = consumeAccountTokenFragment(window.location, (url) => {
      window.history.replaceState(window.history.state, "", url);
    });
    setToken(fragmentToken);
    setReady(true);
    if (!fragmentToken) setError("This reset link is incomplete.");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, passwordConfirmation }),
      });
      const body = await response.json() as { error?: string; message?: string };

      if (!response.ok) throw new Error(body.error ?? "Password reset failed.");
      setMessage(body.message ?? "Password updated. You can now sign in.");
      setPassword("");
      setPasswordConfirmation("");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Password reset failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <Link className={styles.brand} href="/">Mint Binder</Link>
        <h1>Choose a new password</h1>
        <p>Use a unique password that you do not use for another website.</p>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            New password
            <input
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <p className={styles.hint}>At least {PASSWORD_MIN_LENGTH} characters. Password managers and passphrases are welcome.</p>
          <label className={styles.field}>
            Confirm new password
            <input
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="passwordConfirmation"
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              required
              type="password"
              value={passwordConfirmation}
            />
          </label>
          <button className={styles.button} disabled={pending || !ready || !token} type="submit">
            {pending ? "Updating…" : "Update password"}
          </button>
        </form>
        {message ? <p aria-live="polite" className={styles.message}>{message}</p> : null}
        {error ? <p aria-live="assertive" className={styles.error}>{error}</p> : null}
        <Link className={styles.link} href="/">Back to sign in</Link>
      </section>
    </main>
  );
}
