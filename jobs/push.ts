// Push Job (D029): entscheidet, welche Meldungen fällig sind, sendet sie mit web-push und schreibt data/push-log.json.
// Liest data/current.json, die Woche, data/teams.json, die Tippdatei und die Ausfall Datei von jobs/watch.ts.
// Ohne Secrets VAPID_PRIVATE_KEY und PUSH_SUBSCRIPTION: nur Log, push-log unverändert, Exit 0.
// Aufruf: npm run job:push [-- --test]. Mit --test kommt sofort eine Testnachricht ohne Log Eintrag.
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { z } from "zod";
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT, type PushPayload } from "../src/core/push-config";
import { CurrentFileSchema, TeamsFileSchema, WeekFileSchema, weekFilePath, type Team } from "../src/core/schema";
import { TipsFileSchema, tipsFilePath } from "../src/core/tips-schema";
import { InjuriesFileSchema, injuriesFilePath } from "../src/core/injuries";
import {
  EMPTY_PUSH_LOG,
  PushLogFileSchema,
  appendLog,
  dueMessages,
  type DueMessage,
} from "../src/core/push-messages";
import { DATA_DIR, type MainDeps } from "./fetch-schedule";
import { toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

export const PUSH_LOG_PATH = "push-log.json";
export const EXPIRED_MESSAGE = "Anmeldung abgelaufen, im Onboarding neu anmelden und Secret ersetzen";
export const TEST_PAYLOAD: PushPayload = {
  title: "Test aus GitHub Actions",
  body: "Push kommt an. Erinnerungen vor jedem Tippschluss sind aktiv.",
  url: "#einstellungen",
  tag: "test",
};

export const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export const SEND_TIMEOUT_MS = 15_000;
export const TEST_TTL_S = 3600;
export const MAIN_REF = "refs/heads/main";

/** Sendet eine Meldung. Wirft bei Fehler, ein HTTP Status steht in statusCode. */
export type SendFn = (subscription: Subscription, payload: PushPayload, vapid: VapidKeys, ttlSeconds: number) => Promise<void>;

export interface PushDeps extends MainDeps {
  env?: Record<string, string | undefined>;
  send?: SendFn;
}

const defaultSend: SendFn = async (subscription, payload, vapid, ttlSeconds) => {
  const mod = (await import("web-push")) as unknown as { default?: typeof import("web-push") } & typeof import("web-push");
  const webpush = mod.default ?? mod;
  await webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: vapid,
    TTL: ttlSeconds,
    urgency: "high",
    timeout: SEND_TIMEOUT_MS,
  });
};

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "statusCode" in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    if (typeof code === "number") return code;
  }
  return undefined;
}

type SendResult = "ok" | "expired" | "failed";

async function trySend(
  send: SendFn,
  sub: Subscription,
  payload: PushPayload,
  vapid: VapidKeys,
  ttlSeconds: number,
  error: (msg: string) => void,
): Promise<SendResult> {
  try {
    await send(sub, payload, vapid, ttlSeconds);
    return "ok";
  } catch (err) {
    const code = statusOf(err);
    if (code === 404 || code === 410) {
      error(`HTTP ${code}: ${EXPIRED_MESSAGE}`);
      return "expired";
    }
    error(`Senden fehlgeschlagen${code ? ` HTTP ${code}` : ""}: ${describeError(err)}`);
    return "failed";
  }
}

interface Loaded {
  messages: DueMessage[];
  log: z.infer<typeof PushLogFileSchema>;
}

/** Liest alle Daten und berechnet die fälligen Meldungen. Wirft bei ungültigen Pflichtdateien. */
async function loadDue(dataDir: string, now: string, log: (msg: string) => void): Promise<Loaded> {
  const current = CurrentFileSchema.parse(await readJsonStrict(join(dataDir, "current.json")));
  const { season, seasonType, week } = current;
  const weekFile = WeekFileSchema.parse(await readJsonStrict(join(dataDir, weekFilePath(season, seasonType, week))));
  const teamsFile = TeamsFileSchema.parse(await readJsonStrict(join(dataDir, "teams.json")));
  const teams = new Map<string, Team>(teamsFile.teams.map((t) => [t.id, t]));

  const tipsRaw = await readJsonStrict(join(dataDir, tipsFilePath(season, seasonType, week)));
  const tips = tipsRaw === undefined ? null : TipsFileSchema.parse(tipsRaw);
  if (!tips) log(`Keine Tippdatei für ${season}-${seasonType}-${week}`);

  // Die Ausfall Datei ist optional. Ist sie kaputt, kommen die Slot Meldungen trotzdem, nur ohne Ausfälle.
  let injuries = null;
  try {
    const raw = await readJsonStrict(join(dataDir, injuriesFilePath(season, seasonType, week)));
    if (raw !== undefined) injuries = InjuriesFileSchema.parse(raw);
  } catch (err) {
    log(`Ausfall Datei ungültig, Meldungen ohne Ausfälle. ${describeError(err)}`);
  }
  if (!injuries?.baseline) log("Kein Grundstand, Slot Meldungen ohne Ausfälle");

  const logRaw = await readJsonStrict(join(dataDir, PUSH_LOG_PATH));
  const pushLog = logRaw === undefined ? EMPTY_PUSH_LOG : PushLogFileSchema.parse(logRaw);
  const messages = dueMessages({ games: weekFile.games, tips, injuries, teams, now, log: pushLog });
  return { messages, log: pushLog };
}

/** Führt den Push Job aus und liefert den Exit Code. */
export async function main(argv: readonly string[], deps: PushDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  const env = deps.env ?? process.env;
  const send = deps.send ?? defaultSend;

  const unknown = argv.filter((a) => a !== "--test");
  if (unknown.length > 0) {
    error(`Unbekanntes Argument: ${unknown.join(" ")}`);
    return 1;
  }
  const test = argv.includes("--test");

  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subRaw = env.PUSH_SUBSCRIPTION?.trim();
  const hasSecrets = Boolean(privateKey && subRaw);

  if (test && !hasSecrets) {
    log("Secrets VAPID_PRIVATE_KEY oder PUSH_SUBSCRIPTION fehlen, keine Testnachricht gesendet.");
    return 0;
  }

  let loaded: Loaded | null = null;
  if (!test) {
    try {
      loaded = await loadDue(dataDir, now, log);
    } catch (err) {
      const msg = `Daten fehlen oder sind ungültig, push-log bleibt unverändert. ${describeError(err)}`;
      if (!hasSecrets) {
        log(msg);
        return 0;
      }
      error(msg);
      return 1;
    }
    if (loaded.messages.length === 0) {
      log("Keine Meldung fällig.");
      return 0;
    }
    for (const m of loaded.messages) log(`Fällig ${m.key}\n  ${m.payload.title}\n  ${m.payload.body}`);
    if (!hasSecrets) {
      log("Secrets VAPID_PRIVATE_KEY oder PUSH_SUBSCRIPTION fehlen, nichts gesendet, push-log unverändert.");
      return 0;
    }
    // Echter Versand nur auf main, damit Testläufe auf Branches nichts senden und kein Log schreiben.
    if (env.GITHUB_REF !== MAIN_REF) {
      log(`Kein Versand auf ${env.GITHUB_REF ?? "lokal"}, nur ${MAIN_REF} sendet. Testnachricht geht überall.`);
      return 0;
    }
  }

  let sub: Subscription;
  try {
    sub = SubscriptionSchema.parse(JSON.parse(subRaw!));
  } catch {
    // Keine Fehlerdetails ausgeben, sie könnten Teile des Secrets enthalten.
    error("PUSH_SUBSCRIPTION ist kein gültiges Anmelde JSON. Im Onboarding kopieren und Secret ersetzen.");
    return 1;
  }
  const vapid: VapidKeys = { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: privateKey! };

  if (test) {
    const r = await trySend(send, sub, TEST_PAYLOAD, vapid, TEST_TTL_S, error);
    if (r === "ok") log("Testnachricht gesendet.");
    return r === "ok" ? 0 : 1;
  }

  const sent: Array<{ message: DueMessage; sentAt: string }> = [];
  let exit = 0;
  for (const message of loaded!.messages) {
    const r = await trySend(send, sub, message.payload, vapid, message.ttlSeconds, error);
    if (r === "ok") {
      sent.push({ message, sentAt: now });
      log(`Gesendet ${message.key}`);
      continue;
    }
    exit = 1;
    if (r === "expired") break;
  }
  if (sent.length > 0) {
    await writeFiles(dataDir, [{ path: PUSH_LOG_PATH, content: toJson(appendLog(loaded!.log, sent)) }]);
    log(`  geschrieben data/${PUSH_LOG_PATH}`);
  }
  return exit;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler im Push Job, push-log bleibt unverändert.", err);
      process.exitCode = 1;
    },
  );
}
