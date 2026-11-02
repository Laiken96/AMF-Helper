import { VAPID_PUBLIC_KEY } from "../core/push-config";

const BASE = import.meta.env.BASE_URL;
const ONBOARDING_KEY = "nfl-dashboard:onboarding-gesehen";

/** Wandelt den öffentlichen VAPID Schlüssel (Base64url) in Bytes für applicationServerKey um. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normal);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS meldet sich als Mac, hat aber Touch.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Am iPhone geht Push nur aus der App auf dem Home Bildschirm. */
export function needsHomeScreen(): boolean {
  return isIos() && !isStandalone();
}

export function onboardingSeen(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    // Ohne Storage erscheint das Onboarding beim nächsten Start erneut.
  }
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registriert sw.js einmalig mit Scope gleich BASE_URL. Liefert null ohne Unterstützung oder bei Fehler. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  registrationPromise ??= navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE })
    .catch((err: unknown) => {
      console.warn("Service Worker Registrierung fehlgeschlagen", err);
      registrationPromise = null;
      return null;
    });
  return registrationPromise;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await registerServiceWorker();
  if (!reg) throw new PushError("Der Service Worker konnte nicht gestartet werden. Bitte die Seite neu laden.");
  const timeout = new Promise<never>((_, reject) =>
    window.setTimeout(() => reject(new PushError("Der Service Worker startet nicht. Bitte die Seite neu laden.")), 10000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export class PushError extends Error {}

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission | "nicht verfügbar";
  serviceWorkerActive: boolean;
  subscription: PushSubscriptionJSON | null;
}

export async function readStatus(): Promise<PushStatus> {
  const supported = pushSupported();
  const permission = "Notification" in window ? Notification.permission : "nicht verfügbar";
  let serviceWorkerActive = false;
  let subscription: PushSubscriptionJSON | null = null;
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration(BASE);
      serviceWorkerActive = Boolean(reg?.active);
      if (reg && "pushManager" in reg) {
        const sub = await reg.pushManager.getSubscription();
        subscription = sub ? sub.toJSON() : null;
      }
    } catch {
      // Status bleibt auf den Grundwerten.
    }
  }
  return { supported, permission, serviceWorkerActive, subscription };
}

function describeSubscribeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Push ist für diese Seite blockiert. Bitte in den Browser Einstellungen erlauben.";
  if (name === "AbortError" || name === "NotSupportedError")
    return "Die Anmeldung beim Push Dienst des Browsers ist gescheitert. Bitte später erneut versuchen. Im privaten Modus funktioniert Push nicht.";
  if (name === "InvalidStateError") return "Die bestehende Anmeldung passt nicht. Bitte \"Neu anmelden\" wählen.";
  return "Die Anmeldung für Push ist fehlgeschlagen. Bitte später erneut versuchen.";
}

/** Fragt die Erlaubnis ab, meldet das Gerät an und zeigt eine lokale Testnachricht. */
export async function enablePush(options: { renew?: boolean } = {}): Promise<PushSubscriptionJSON> {
  if (!pushSupported()) {
    throw new PushError(
      needsHomeScreen()
        ? "Am iPhone geht Push nur aus der App auf dem Home Bildschirm."
        : "Dieser Browser unterstützt kein Web Push.",
    );
  }
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    throw new PushError("Die Erlaubnis konnte nicht abgefragt werden.");
  }
  if (permission !== "granted") {
    throw new PushError(
      permission === "denied"
        ? "Mitteilungen sind blockiert. Bitte in den Einstellungen des Geräts für diese App erlauben."
        : "Die Erlaubnis wurde nicht erteilt.",
    );
  }
  const reg = await readyRegistration();
  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (sub && options.renew) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch (err) {
    console.warn("Push Anmeldung fehlgeschlagen", err);
    throw new PushError(describeSubscribeError(err));
  }
  await showTestNotification();
  return sub.toJSON();
}

/** Lokale Testnachricht direkt über den Service Worker, ohne Server. */
export async function showTestNotification(): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    throw new PushError("Für eine Testnachricht braucht es zuerst die Erlaubnis für Mitteilungen.");
  }
  const reg = await readyRegistration();
  try {
    await reg.showNotification("NFL Tipps", {
      body: "Testnachricht. So sehen die Erinnerungen vor dem Tippschluss aus.",
      tag: "nfl-test",
      icon: `${BASE}icons/icon-192.png`,
      data: { url: "#einstellungen" },
    });
  } catch {
    throw new PushError("Die Testnachricht konnte nicht angezeigt werden.");
  }
}
