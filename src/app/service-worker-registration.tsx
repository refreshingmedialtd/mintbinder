"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    let updateTimer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (disposed) {
          return;
        }

        const announceWaitingWorker = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent("mintbinder:app-update-ready"));
          }
        };
        const checkForUpdate = () => registration.update().catch(() => undefined);

        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;

          installingWorker?.addEventListener("statechange", () => {
            if (installingWorker.state === "installed") {
              announceWaitingWorker();
            }
          });
        });

        announceWaitingWorker();
        void checkForUpdate();

        // Check periodically without forcing a newly downloaded worker to take
        // control of an in-progress collection or billing session.
        updateTimer = setInterval(() => {
          if (document.visibilityState === "visible") {
            void checkForUpdate();
          }
        }, 60 * 60 * 1_000);
      })
      .catch((error) => {
        console.warn("Mint Binder service worker registration failed.", error);
      });

    return () => {
      disposed = true;

      if (updateTimer) {
        clearInterval(updateTimer);
      }
    };
  }, []);

  return null;
}
