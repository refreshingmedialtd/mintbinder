"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export const APP_UPDATE_READY_EVENT = "mintbinder:app-update-ready";
export const APP_UPDATE_RELOAD_GUARD_EVENT = "mintbinder:before-app-update";
export const APP_UPDATE_ACTIVATE_MESSAGE = "mintbinder:activate-update";

type UpdateState = "idle" | "ready" | "blocked" | "activating" | "error";

export function ServiceWorkerRegistration() {
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const registrationRef = useRef<Awaited<ReturnType<ServiceWorkerContainer["register"]>> | null>(null);
  const readyWorkerRef = useRef<ServiceWorker | null>(null);
  const announcedWorkerRef = useRef<ServiceWorker | null>(null);
  const reloadRequestedRef = useRef(false);
  const reloadStartedRef = useRef(false);
  const activationTimeoutRef = useRef<number | null>(null);

  const reloadOnce = useCallback(() => {
    if (reloadStartedRef.current) {
      return;
    }

    reloadStartedRef.current = true;
    if (activationTimeoutRef.current !== null) {
      window.clearTimeout(activationTimeoutRef.current);
      activationTimeoutRef.current = null;
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    let updateTimer: ReturnType<typeof setInterval> | undefined;
    let detachRegistrationListeners: () => void = () => undefined;
    let disposed = false;

    const handleControllerChange = () => {
      if (reloadRequestedRef.current) {
        reloadOnce();
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (disposed) {
          return;
        }

        registrationRef.current = registration;

        const announceWaitingWorker = () => {
          const waitingWorker = registration.waiting;

          if (!waitingWorker || !navigator.serviceWorker.controller) {
            return;
          }

          readyWorkerRef.current = waitingWorker;
          setUpdateState((current) => current === "activating" ? current : "ready");

          if (announcedWorkerRef.current !== waitingWorker) {
            announcedWorkerRef.current = waitingWorker;
            window.dispatchEvent(new CustomEvent(APP_UPDATE_READY_EVENT));
          }
        };
        const checkForUpdate = () => registration.update().catch(() => undefined);
        const handleUpdateFound = () => {
          const installingWorker = registration.installing;

          installingWorker?.addEventListener("statechange", () => {
            if (installingWorker.state === "installed") {
              announceWaitingWorker();
            }
          });
        };

        registration.addEventListener("updatefound", handleUpdateFound);
        detachRegistrationListeners = () => registration.removeEventListener("updatefound", handleUpdateFound);

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
      detachRegistrationListeners();
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      registrationRef.current = null;

      if (updateTimer) {
        clearInterval(updateTimer);
      }
      if (activationTimeoutRef.current !== null) {
        window.clearTimeout(activationTimeoutRef.current);
        activationTimeoutRef.current = null;
      }
    };
  }, [reloadOnce]);

  const activateUpdate = useCallback(() => {
    if (updateState === "activating") {
      return;
    }

    const mayReload = window.dispatchEvent(new CustomEvent(
      APP_UPDATE_RELOAD_GUARD_EVENT,
      { cancelable: true },
    ));

    if (!mayReload) {
      setUpdateState("blocked");
      return;
    }

    const waitingWorker = registrationRef.current?.waiting ?? readyWorkerRef.current;

    if (!waitingWorker) {
      setUpdateState("error");
      return;
    }

    reloadRequestedRef.current = true;
    setUpdateState("activating");

    if (waitingWorker.state === "activated") {
      reloadOnce();
      return;
    }

    try {
      waitingWorker.postMessage({ type: APP_UPDATE_ACTIVATE_MESSAGE });
      activationTimeoutRef.current = window.setTimeout(() => {
        if (!reloadStartedRef.current) {
          reloadRequestedRef.current = false;
          setUpdateState("error");
        }
      }, 12_000);
    } catch (error) {
      console.warn("Mint Binder update activation failed.", error);
      reloadRequestedRef.current = false;
      setUpdateState("error");
    }
  }, [reloadOnce, updateState]);

  if (updateState === "idle") {
    return null;
  }

  const message = updateState === "blocked"
    ? "Update paused to protect unsaved binder changes. Save them, or choose update again and confirm that they can be discarded."
    : updateState === "error"
      ? "The update could not be activated yet. Try again in a moment."
      : updateState === "activating"
        ? "Updating Mint Binder. This page will reload automatically."
        : "A new Mint Binder version is ready with the latest fixes.";

  return (
    <aside
      aria-atomic="true"
      aria-busy={updateState === "activating"}
      aria-label="Mint Binder update available"
      aria-live="polite"
      className={`app-update-banner ${updateState}`}
      role="status"
    >
      <span className="app-update-icon" aria-hidden="true">
        <RefreshCw className={updateState === "activating" ? "spin" : ""} size={20} />
      </span>
      <span className="app-update-copy">
        <strong>{updateState === "activating" ? "Applying update" : "Update available"}</strong>
        <span>{message}</span>
      </span>
      <button
        className="button primary app-update-action"
        disabled={updateState === "activating"}
        onClick={activateUpdate}
        type="button"
      >
        <RefreshCw size={17} />
        {updateState === "activating" ? "Updating" : updateState === "error" ? "Try again" : "Update and reload"}
      </button>
    </aside>
  );
}
