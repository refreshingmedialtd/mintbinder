"use client";

import Link from "next/link";
import styles from "./status-page.module.css";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Mint Binder · Recovery</p>
        <h1>That page could not be loaded.</h1>
        <p>Nothing was removed from your collection. Retry the request, or return to the app if the problem continues.</p>
        <div className={styles.actions}>
          <button type="button" onClick={reset}>Try again</button>
          <Link href="/">Return to Mint Binder</Link>
        </div>
      </section>
    </main>
  );
}
