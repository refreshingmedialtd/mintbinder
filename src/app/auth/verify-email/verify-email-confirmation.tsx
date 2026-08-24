"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { consumeAccountTokenFragment } from "@/lib/auth/token-links";
import styles from "../account-access.module.css";

export function VerifyEmailConfirmation() {
  const fragmentRead = useRef(false);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    if (fragmentRead.current) return;
    fragmentRead.current = true;
    const fragmentToken = consumeAccountTokenFragment(window.location, (url) => {
      window.history.replaceState(window.history.state, "", url);
    });
    setToken(fragmentToken);
    setReady(true);
    if (!fragmentToken) setError("This verification link is incomplete.");
  }, []);

  async function confirm() {
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/verification", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json() as { error?: string; message?: string };

      if (!response.ok) throw new Error(body.error ?? "Email verification failed.");
      setMessage(body.message ?? "Email verified.");
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : "Email verification failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <Link className={styles.brand} href="/">Mint Binder</Link>
        <h1>{message ? "Email verified" : "Confirm your email"}</h1>
        <p>
          {message
            ? "Your account recovery and notification settings are now fully enabled."
            : "Confirm this address to secure account recovery and receive any alerts you enable."}
        </p>
        {!message ? (
          <button className={styles.button} disabled={pending || !ready || !token} onClick={confirm} type="button">
            {pending ? "Confirming…" : "Verify email"}
          </button>
        ) : null}
        {message ? <p aria-live="polite" className={styles.message}>{message}</p> : null}
        {error ? <p aria-live="assertive" className={styles.error}>{error}</p> : null}
        <Link className={styles.link} href="/">Return to Mint Binder</Link>
      </section>
    </main>
  );
}
