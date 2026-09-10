// Service worker d'Iris — PUSH SEULEMENT (décision PO 2026-09-10).
//
// Aucun gestionnaire `fetch`, aucun cache : Iris ne fonctionne pas hors ligne
// et ne sert jamais une version périmée depuis un cache. Ce fichier existe pour
// une seule chose : recevoir les Web Push envoyés par l'edge function
// `notifications-push` et ouvrir la demande au clic. Il n'est enregistré que
// quand l'utilisateur active « Notifications sur cet appareil ».
//
// Servi tel quel depuis `public/` à `/sw.js` (portée `/`). Pas de bundling :
// il ne dépend de rien, et son URL doit rester stable.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  // Un push sans contenu lisible (ou un push de test) affiche quand même une
  // carte : Chrome l'exige (`userVisibleOnly`), et « Iris » vaut mieux que
  // « Ce site a été mis à jour en arrière-plan ».
  const title = (data && typeof data.title === "string" && data.title) || "Iris";
  const options = {
    body: (data && typeof data.body === "string") ? data.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: (data && typeof data.tag === "string") ? data.tag : undefined,
    renotify: Boolean(data && data.tag),
    data: { url: (data && typeof data.url === "string") ? data.url : "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const origin = self.location.origin;
    const target = new URL(url, origin);
    const same = all.find((c) => c.url && c.url.startsWith(origin));
    if (same) {
      // L'application est ouverte : on la ramène au premier plan et on lui
      // demande de naviguer (une SPA préfère être avertie que rechargée).
      try { await same.focus(); } catch { /* onglet non focalisable */ }
      try {
        same.postMessage({ type: "iris:navigate", url: target.pathname + target.search });
      } catch {
        if ("navigate" in same) await same.navigate(target.href);
      }
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// Le navigateur a renouvelé l'abonnement (rotation de clés du service de push) :
// on se réabonne avec la même clé serveur et on prévient l'application, qui
// réenregistrera la nouvelle adresse au prochain chargement — le service
// worker, lui, n'a pas de session pour le faire.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old && old.options && old.options.applicationServerKey;
    if (!key) return;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) c.postMessage({ type: "iris:push-resubscribed", subscription: sub.toJSON() });
  })());
});
