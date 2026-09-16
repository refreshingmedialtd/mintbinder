export const PRICE_HELP_GROUP = "collection-price-confidence";

export function closeOtherPriceHelp(root: Pick<Document, "querySelectorAll">, except?: HTMLDetailsElement) {
  root.querySelectorAll<HTMLDetailsElement>(`details[name="${PRICE_HELP_GROUP}"][open]`)
    .forEach((details) => {
      if (details !== except) details.open = false;
    });
}

export function positionPriceHelp(details: HTMLDetailsElement) {
  const anchor = details.querySelector("summary");
  const popup = details.querySelector<HTMLElement>(".market-help-popover");
  if (!anchor || !popup) return;
  const box = anchor.getBoundingClientRect();
  const { width, height } = popup.getBoundingClientRect();
  const margin = 16;
  const left = Math.max(margin, Math.min(box.right - width, window.innerWidth - width - margin));
  const preferredTop = box.top - height - 9 >= margin ? box.top - height - 9 : box.bottom + 9;
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
  Object.assign(popup.style, {
    position: "fixed", left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto",
  });
}
