import { LayoutDiagnostics } from "./LayoutDiagnostics";
import { revalidateData } from "./data";
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
import { useLayoutValue } from "./layout";
import { playerChoices, usePlayer, useStandings } from "./player";
import { PageHeader, Segmented, PageSplitMark } from "./ui";
import { TIME_ZONE_TEXT } from "./wording";

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
      <>
        <p className="push-hint">Am iPhone geht Push nur aus der App auf dem Home Bildschirm:</p>
        <HomeScreenGuide />
      </>
    );
  }
  if (status && !status.supported) {
    return <p className="push-hint">Dieser Browser unterstützt kein Web Push.</p>;
  }

  const subscribed = Boolean(status?.subscription);
  return (
    <div className="push-panel">
      {status?.permission === "denied" && <DeniedHint />}
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
    </div>
  );
}

/** Erlaubnis verweigert: auf dem iPhone lässt sie sich nur in den Einstellungen des Geräts wieder erteilen. */
function DeniedHint() {
  return (
    <p className="feedback feedback-error" role="status">
      {isIos()
        ? "Mitteilungen sind blockiert. Auf dem iPhone: Einstellungen öffnen, Mitteilungen, NFL Tipps wählen und Mitteilungen erlauben. Danach hier Push erlauben."
        : "Mitteilungen sind blockiert. Bitte in den Einstellungen des Browsers für diese Seite erlauben."}
    </p>
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
      <li>
        Unten auf <strong>Teilen</strong> tippen (Quadrat mit Pfeil nach oben).
      </li>
      <li>
        <strong>Zum Home Bildschirm</strong> wählen und hinzufügen.
      </li>
      <li>
        Die App <strong>NFL Tipps vom Home Bildschirm</strong> aus öffnen, nicht aus Safari, und Push dort erlauben.
      </li>
    </ol>
  );
}

/** So liest du die Tipps: Kurzanleitung für Onboarding und Einstellungen. */
function ReadingGuide() {
  return (
    <ul className="legend">
      <li>
        <strong>Vorschlag</strong> der App ist immer der Favorit, also das Team mit der höheren Siegwahrscheinlichkeit.
        Ziel sind möglichst viele Punkte.
      </li>
      <li>
        <strong>Prozent</strong> ist die Siegwahrscheinlichkeit des getippten Teams, berechnet aus den Wettquoten.
      </li>
      <li>
        <span className="legend-tag legend-klar">klar</span> ab 75 %, <span className="legend-tag legend-favorit">Favorit</span> ab
        60 %, <span className="legend-tag legend-unklar">unklar</span> darunter, also fast ein Münzwurf.
      </li>
      <li>
        <strong>Abweichung</strong> entscheidest du selbst: im Spielblatt mit dem Knopf Aussenseiter tippen. Die App
        markiert knappe Spiele mit selten getipptem Aussenseiter als Abweichung möglich und zeigt Signale dazu. Im
        Mittel kostet eine Abweichung Punkte, sie bleibt deine Wahl. Ab Kickoff ist die Wahl gesperrt.
      </li>
      <li>
        <strong>Tiebreaker</strong>: für das Thursday Night Game (TNF) und das Monday Night Game (MNF) zusätzlich das
        Resultat tippen, Auswärts : Heim.
      </li>
    </ul>
  );
}

/** Eigenes Kürzel wählen (D050). Rangliste und eigene Abweichungen gelten für diese Person (D052). */
function PlayerPicker({ compact = false }: { compact?: boolean }) {
  const standings = useStandings();
  const { player, main, other, choose } = usePlayer(standings);
  const choices = playerChoices(standings);
  return (
    <div className="player-picker">
      <Segmented
        label="Eigenes Kürzel"
        value={player ?? ""}
        onChange={choose}
        disabled={!standings}
        options={choices.map((id) => ({ value: id, label: id }))}
      />
      {!standings ? (
        <p className="push-hint">Rangliste wird geladen …</p>
      ) : (
        <p className="push-hint player-picker-text" aria-live="polite">
          {other
            ? `Rangliste und eigene Abweichungen gelten für ${player}. Der Vorschlag der App ist für alle gleich.`
            : `Rangliste und eigene Abweichungen gelten für ${player}.`}
          {!compact && main && ` Push Erinnerungen und die Tippliste im Push gelten immer für ${main}.`}
        </p>
      )}
    </div>
  );
}

export function SettingsView({ onShowOnboarding }: { onShowOnboarding: () => void }) {
  const { status, refresh } = usePushStatus();
  const appMode = isStandalone() ? "App vom Home Bildschirm" : "Browser";
  const wide = useLayoutValue() === "wide";

  // Aus den Tipps: #einstellungen/spieler springt zur Spielerwahl
  useEffect(() => {
    if (window.location.hash.endsWith("/spieler")) document.getElementById("spieler")?.scrollIntoView({ block: "start" });
  }, []);

  const header = <PageHeader title="Einstellungen" meta="Erinnerungen per Push vor jedem Tippschluss" />;
  const playerSection = (
    <section className="slot" id="spieler" aria-labelledby="spieler-title">
      <h2 id="spieler-title">Spieler</h2>
      <PlayerPicker />
    </section>
  );
  const pushSection = (
      <section className="slot">
        <h2>Push</h2>
        <dl className="status-list" data-testid="push-status">
          <div>
            <dt>Erlaubnis</dt>
            <dd>{status ? PERMISSION_TEXT[status.permission] : "wird geprüft"}</dd>
          </div>
          <div>
            <dt>Dieses Gerät angemeldet</dt>
            <dd>{status ? (status.subscription ? "ja" : "nein") : "wird geprüft"}</dd>
          </div>
        </dl>
        <PushPanel status={status} refresh={refresh} />
      </section>
  );
  const rest = (
    <>
      <section className="slot">
        <h2>Anzeige</h2>
        <p className="push-hint settings-line">{TIME_ZONE_TEXT} (Europe/Zurich, Sommer und Winterzeit automatisch).</p>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void revalidateData()}>
            Daten aktualisieren
          </button>
          <button type="button" className="btn" onClick={onShowOnboarding}>
            Einführung erneut anzeigen
          </button>
        </div>
      </section>

      <section className="slot">
        <h2>So liest du die Tipps</h2>
        <ReadingGuide />
      </section>

      <details className="slot tech-details">
        <summary>Technik</summary>
        <dl className="status-list">
          <div>
            <dt>Hintergrunddienst (Service Worker)</dt>
            <dd>{status ? (status.serviceWorkerActive ? "aktiv" : "nicht aktiv") : "wird geprüft"}</dd>
          </div>
          <div>
            <dt>Modus</dt>
            <dd>{appMode}</dd>
          </div>
        </dl>
        {status?.subscription && <SubscriptionBox json={JSON.stringify(status.subscription)} />}
        <LayoutDiagnostics />
      </details>
    </>
  );

  // Duo quer: links Spieler und Push bis zum Falz, rechts Anzeige, Leseanleitung und Technik
  if (wide) {
    return (
      <div className="duo-split settings-split">
        <PageSplitMark />
        <div className="pane pane-detail settings-pane">
          {header}
          {playerSection}
          {pushSection}
        </div>
        <div className="fold" aria-hidden="true" />
        <div className="pane pane-list settings-pane">{rest}</div>
      </div>
    );
  }
  return (
    <>
      {header}
      {playerSection}
      {pushSection}
      {rest}
    </>
  );
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { status, refresh } = usePushStatus();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const homeScreen = needsHomeScreen();
  const unsupported = !homeScreen && status !== null && !status.supported;
  const subscribed = Boolean(status?.subscription);
  const allow = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await enablePush();
      setFeedback({ kind: "ok", text: "Push ist eingerichtet. Eine Testnachricht wurde angezeigt." });
    } catch (err) {
      setFeedback({ kind: "error", text: messageOf(err) });
    } finally {
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  };
  // Primäraktion: Push erlauben, solange das möglich und noch nicht erledigt ist, sonst schliessen
  const canAllow = !homeScreen && !unsupported && !subscribed && status?.permission !== "denied";

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="overlay-card">
        <div className="overlay-head">
          <h1 id="onboarding-title">Willkommen bei NFL Tipps</h1>
          <button type="button" ref={closeRef} className="icon-close" onClick={onClose} aria-label="Einführung schliessen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <section>
          <h2>1. Wer bist du</h2>
          <p>
            Wähle dein Kürzel aus der Rangliste. Die App schlägt immer den Favoriten vor, eine Abweichung wählst du
            selbst. Deine Wahl wird pro Kürzel auf diesem Gerät gespeichert.
          </p>
          <PlayerPicker compact />
        </section>

        <section>
          <h2>2. So liest du die Tipps</h2>
          <ReadingGuide />
        </section>

        <section>
          <h2>3. Erinnerungen per Push</h2>
          <p>
            Vor jedem Tippschluss kommt eine Mitteilung mit den Spielen, Ausfällen und Tippänderungen. Am Donnerstag
            kommt zusätzlich die fertige Tippliste der Woche.
          </p>
          {homeScreen && (
            <>
              <p className="onboarding-ios">Am iPhone geht Push nur aus der App auf dem Home Bildschirm:</p>
              <HomeScreenGuide />
            </>
          )}
          {unsupported && <p className="push-hint">Dieser Browser unterstützt kein Web Push.</p>}
          {status?.permission === "denied" && <DeniedHint />}
          {feedback && (
            <p className={feedback.kind === "ok" ? "feedback feedback-ok" : "feedback feedback-error"} role={feedback.kind === "error" ? "alert" : "status"}>
              {feedback.text}
            </p>
          )}
        </section>

        <div className="onboarding-actions">
          {canAllow ? (
            <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void allow()}>
              {busy ? "Bitte warten …" : "Push erlauben"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {subscribed ? "Fertig" : "Verstanden"}
            </button>
          )}
          {canAllow && (
            <button type="button" className="btn-text" onClick={onClose}>
              Später
            </button>
          )}
        </div>
        <p className="push-hint onboarding-foot">Die Einführung ist jederzeit unter Einstellungen erneut abrufbar.</p>
      </div>
    </div>
  );
}
