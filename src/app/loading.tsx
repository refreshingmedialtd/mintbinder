import styles from "./status-page.module.css";

export default function Loading() {
  return (
    <main className={styles.shell} aria-live="polite" aria-busy="true">
      <section className={styles.card}>
        <div className={styles.loader} aria-hidden="true" />
        <p className={styles.eyebrow}>Mint Binder</p>
        <h1>Opening your collection…</h1>
        <p>Loading the latest catalogue, holdings and pricing evidence.</p>
      </section>
    </main>
  );
}
