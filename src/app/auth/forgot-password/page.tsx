"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "../account-access.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json() as { error?: string; message?: string };

      if (!response.ok) throw new Error(body.error ?? "Password reset is temporarily unavailable.");
      setMessage(body.message ?? "Check your email for a password reset link.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Password reset is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <Link className={styles.brand} href="/">Mint Binder</Link>
        <h1>Reset your password</h1>
        <p>Enter the email address for your account. For privacy, the response is the same whether or not it is registered.</p>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            Email address
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <button className={styles.button} disabled={pending} type="submit">
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
        {message ? <p aria-live="polite" className={styles.message}>{message}</p> : null}
        {error ? <p aria-live="assertive" className={styles.error}>{error}</p> : null}
        <Link className={styles.link} href="/">Back to sign in</Link>
      </section>
    </main>
  );
}
