import Link from "next/link";
import styles from "./status-page.module.css";

export default function NotFound() {
  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Mint Binder · 404</p>
        <h1>This page slipped out of its sleeve.</h1>
        <p>The address may be old or incomplete. Your collection data has not been changed.</p>
        <div className={styles.actions}>
          <Link href="/">Return to Mint Binder</Link>
        </div>
      </section>
    </main>
  );
}
