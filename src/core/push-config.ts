// Web Push Konfiguration (D029). Der öffentliche VAPID Schlüssel ist nicht geheim und darf im Repo stehen.
// Der private Schlüssel liegt nur als GitHub Secret VAPID_PRIVATE_KEY, die Geräte Anmeldung als Secret PUSH_SUBSCRIPTION.
export const VAPID_PUBLIC_KEY = "BIHK696zAYGuGoEmGyyU9li7BBCKvoEA34SoAeKgxK1W610k-_rLfrZeypDn7Ff3lxGSDocPOwLO5dZYqOeblOA";
export const VAPID_SUBJECT = "https://laiken96.github.io/AMF-Helper/";

/** Push Nachricht, wie sie der Service Worker erwartet. */
export interface PushPayload {
  title: string;
  body: string;
  url: string; // relativ zur App, z. B. "#tipps"
  tag: string; // gleiche Tags ersetzen sich auf dem Gerät
}
