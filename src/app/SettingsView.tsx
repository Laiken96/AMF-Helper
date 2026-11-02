import { useCallback, useEffect, useRef, useState } from "react";
import {
  PushError,
  enablePush,
  isIos,
  isStandalone,
  needsHomeScreen,
  readStatus,
  registerServiceWorker,
  showTestNotification,
  type PushStatus,
} from "./push";
import { PageHeader } from "./ui";

const SECRETS_URL = "https://github.com/Laiken96/AMF-Helper/settings/secrets/actions";

const PERMISSION_TEXT: Record<PushStatus["permission"], string> = {
  granted: "erteilt",
  denied: "blockiert",
  default: "noch nicht gefragt",
  "nicht verfügbar": "nicht verfügbar",
};

function messageOf(err: unknown): string {
  return err instanceof PushError ? err.message : "Unerwarteter Fehler. Bitte erneut versuchen.";
}

/** Lädt den Push Status und hält ihn aktuell. */
function usePushStatus() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const refresh = useCallback(async () => {
    setStatus(await readStatus());
  }, []);

  useEffect(() => {
    let active = true;
    const update = () => {
      readStatus().then((s) => active && setStatus(s), () => undefined);
    };
    update();
    registerServiceWorker().then(update, update);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(update, () => undefined);
      navigator.serviceWorker.addEventListener("controllerchange", update);
    }
    return () => {
      active = false;
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", update);
    };
  }, []);

  return { status, refresh };
}

type Feedback = { kind: "ok" | "error"; text: string } | null;

/** Erlaubnis, Anmeldung, Testnachricht und Anmeldung als JSON zum Kopieren. */
function PushPanel({ status, refresh }: { status: PushStatus | null; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setFeedback(null);
    try {
      setFeedback({ kind: "ok", text: await action() });
    } catch (err) {
      setFeedback({ kind: "error", text: messageOf(err) });
    } finally {
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  };

  const subscribe = (renew: boolean) =>
    run(async () => {
      await enablePush({ renew });
      return renew
        ? "Neu angemeldet. Die neue Anmeldung unten als Secret ersetzen."
        : "Push ist eingerichtet. Eine Testnachricht wurde angezeigt.";
    });

  const test = () =>
    run(async () => {
      await showTestNotification();
      return "Testnachricht wurde angezeigt.";
    });

  if (needsHomeScreen()) {
    return (
      <p className="push-hint">
        Push ist erst möglich, wenn die App vom Home Bildschirm aus geöffnet wird.
      </p>
    );
  }
  if (status && !status.supported) {
    return <p className="push-hint">Dieser Browser unterstützt kein Web Push.</p>;
  }

  const subscribed = Boolean(status?.subscription);
  return (
    <div className="push-panel">
      <div className="button-row">
        {!subscribed && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => subscribe(false)}>
            Push erlauben
          </button>
        )}
        {subscribed && (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={test}>
              Testnachricht
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => subscribe(true)}>
              Neu anmelden
            </button>
          </>
        )}
      </div>
      {busy && <p className="push-hint">Bitte warten …</p>}
      {feedback && (
        <p className={feedback.kind === "ok" ? "feedback feedback-ok" : "feedback feedback-error"} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.text}
        </p>
      )}
      {status?.subscription && <SubscriptionBox json={JSON.stringify(status.subscription)} />}
    </div>
  );
}

function SubscriptionBox({ json }: { json: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copyText, setCopyText] = useState<string | null>(null);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("keine Zwischenablage");
      await navigator.clipboard.writeText(json);
      setCopyText("Kopiert.");
    } catch {
      ref.current?.focus();
      ref.current?.select();
      setCopyText("Kopieren nicht möglich. Der Text ist markiert und kann von Hand kopiert werden.");
    }
  };

  return (
    <div className="subscription">
      <h3>Anmeldung dieses Geräts</h3>
      <textarea ref={ref} readOnly rows={5} value={json} aria-label="Anmeldung als JSON" onFocus={(e) => e.currentTarget.select()} />
      <div className="button-row">
        <button type="button" className="btn" onClick={copy}>
          Anmeldung kopieren
        </button>
      </div>
      {copyText && <p className="push-hint" role="status">{copyText}</p>}
      <ol className="steps">
        <li>
          Auf GitHub das Repo öffnen, dann Settings, Secrets and variables, Actions.
        </li>
        <li>New repository secret wählen.</li>
        <li>
          Als Name <code>PUSH_SUBSCRIPTION</code> eintragen, als Wert die kopierte Anmeldung einfügen und speichern.
        </li>
      </ol>
      <p>
        <a href={SECRETS_URL} target="_blank" rel="noreferrer">
          Direkt zu den Secrets auf GitHub
        </a>
      </p>
      <p className="push-hint">Nach "Neu anmelden" muss das Secret mit der neuen Anmeldung ersetzt werden.</p>
    </div>
  );
}

function HomeScreenGuide() {
  return (
    <ol className="steps">
      <li>Diese Seite in Safari öffnen.</li>
      <li>Unten auf Teilen tippen.</li>
      <li>Zum Home Bildschirm wählen und hinzufügen.</li>
      <li>Die App NFL Tipps vom Home Bildschirm aus öffnen und Push dort erlauben.</li>
    </ol>
  );
}

export function SettingsView({ onShowOnboarding }: { onShowOnboarding: () => void }) {
  const { status, refresh } = usePushStatus();
  const appMode = isStandalone() ? "App vom Home Bildschirm" : "Browser";

  return (
    <>
      <PageHeader title="Einstellungen" meta="Erinnerungen per Push vor jedem Tippschluss" />

      <section className="slot">
        <h2>Status</h2>
        <dl className="status-list" data-testid="push-status">
          <div>
            <dt>Erlaubnis</dt>
            <dd>{status ? PERMISSION_TEXT[status.permission] : "wird geprüft"}</dd>
          </div>
          <div>
            <dt>Anmeldung</dt>
            <dd>{status ? (status.subscription ? "vorhanden" : "keine") : "wird geprüft"}</dd>
          </div>
          <div>
            <dt>Service Worker</dt>
            <dd>{status ? (status.serviceWorkerActive ? "aktiv" : "nicht aktiv") : "wird geprüft"}</dd>
          </div>
          <div>
            <dt>Modus</dt>
            <dd>{appMode}</dd>
          </div>
        </dl>
      </section>

      {needsHomeScreen() && (
        <section className="slot">
          <h2>iPhone</h2>
          <HomeScreenGuide />
        </section>
      )}

      <section className="slot">
        <h2>Push</h2>
        <PushPanel status={status} refresh={refresh} />
      </section>

      <section className="slot">
        <h2>Daten</h2>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Aktualisieren
        </button>
      </section>

      <section className="slot">
        <h2>Einführung</h2>
        <button type="button" className="btn" onClick={onShowOnboarding}>
          Einführung erneut anzeigen
        </button>
      </section>
    </>
  );
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { status, refresh } = usePushStatus();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ios = isIos();
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="overlay-card">
        <div className="overlay-head">
          <h1 id="onboarding-title">Willkommen bei NFL Tipps</h1>
          <button type="button" ref={closeRef} className="btn btn-close" onClick={onClose} aria-label="Einführung schliessen">
            Schliessen
          </button>
        </div>

        <section>
          <h2>1. Erinnerungen per Push</h2>
          <p>
            Vor jedem Tippschluss kommt eine Mitteilung mit den Spielen, Ausfällen und Tippänderungen. Am Donnerstag
            kommt zusätzlich die fertige Tippliste der Woche.
          </p>
        </section>

        {ios && (
          <section>
            <h2>2. iPhone</h2>
            {needsHomeScreen() ? (
              <>
                <p>Am iPhone funktioniert Push nur, wenn die App auf dem Home Bildschirm liegt.</p>
                <HomeScreenGuide />
              </>
            ) : (
              <p>Die App läuft vom Home Bildschirm aus. Push kann jetzt erlaubt werden.</p>
            )}
          </section>
        )}

        <section>
          <h2>{ios ? "3." : "2."} Push erlauben</h2>
          <p>Nach der Erlaubnis meldet sich das Gerät an und zeigt eine Testnachricht.</p>
          <PushPanel status={status} refresh={refresh} />
        </section>

        <p className="push-hint">Die Einführung ist jederzeit unter Einstellungen erneut abrufbar.</p>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
