import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOptimizableCatalogueImageUrl } from "@/lib/catalogue/image-url";
import { getSharedBinder } from "@/lib/db/binders";
import styles from "./shared-binder.module.css";

type RouteContext = { params: Promise<{ slug: string }> };
type SharedBinder = NonNullable<Awaited<ReturnType<typeof getSharedBinder>>>;
type SharedSlot = SharedBinder["pages"][number]["slots"][number];

export async function generateMetadata(context: RouteContext): Promise<Metadata> {
  const { slug } = await context.params;
  const binder = await getSharedBinder(slug);

  return {
    title: binder ? `${binder.name} - shared binder` : "Shared binder",
    description: binder?.description ?? "A private link to a collector's Mint Binder.",
    robots: { index: false, follow: false },
  };
}

export default async function SharedBinderPage(context: RouteContext) {
  const { slug } = await context.params;
  const binder = await getSharedBinder(slug);

  if (!binder) {
    notFound();
  }

  return (
    <main className={styles.shell} data-cover={binder.coverStyle}>
      <nav className={styles.nav}>
        <Link href="/">Mint Binder</Link>
        <span>Read-only shared binder</span>
      </nav>

      <header className={styles.cover}>
        <span className={styles.eyebrow}>Collector binder</span>
        <h1>{binder.name}</h1>
        {binder.description ? <p>{binder.description}</p> : null}
        <p className={styles.updated}>Updated {formatDate(binder.updatedAt)}</p>
      </header>

      <section className={styles.pageScroller} aria-label={`${binder.name} pages`}>
        {binder.pages.map((page) => (
          <article className={styles.page} key={page.position} aria-label={`Page ${page.position + 1}`}>
            <span className={styles.pageNumber}>{page.position + 1}</span>
            <div className={styles.pocketGrid}>
              {page.slots.map((slot) => (
                <BinderPocket key={slot.position} slot={slot} />
              ))}
            </div>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>
        <p>Prices and collection details can change. This link is a read-only snapshot of the current binder layout.</p>
        <Link href="/">Organise your own collection with Mint Binder</Link>
      </footer>
    </main>
  );
}

function BinderPocket({ slot }: { slot: SharedSlot }) {
  const item = slot.collectionItem;
  const card = item?.cardPrinting;
  const sealed = item?.sealedProduct;
  const imageUrl = card?.imageSmallUrl ?? sealed?.imageUrl;
  const title = card?.name ?? sealed?.name;
  const subtitle = card
    ? `${card.cardSet.name} · ${card.number}`
    : sealed?.relatedCardSet?.name ?? sealed?.productType.replaceAll("_", " ");

  return (
    <div className={styles.pocket} data-filled={Boolean(item)}>
      {imageUrl && title ? (
        <div className={styles.imageWrap}>
          <Image
            alt={title}
            fill
            loading="lazy"
            sizes="(max-width: 720px) 25vw, 150px"
            src={imageUrl}
            unoptimized={!isOptimizableCatalogueImageUrl(imageUrl)}
          />
        </div>
      ) : item ? (
        <div className={styles.placeholder} aria-hidden="true">MB</div>
      ) : (
        <span className={styles.emptyPocket} aria-label="Empty pocket" />
      )}
      {title ? (
        <div className={styles.caption}>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}
