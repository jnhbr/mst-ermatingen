/* ============================================================
   MST Ermatingen – Service Worker (Offline für den Spieltag)

   Hält die Seiten selbst auf dem Gerät: HTML, Stile, Skripte, Bilder,
   Firebase-Bibliothek und Schriften. Die Daten (Firestore) speichert
   Firestore selbst (enablePersistence in js/mst.js) – hier geht es nur
   darum, dass die Seite im Funkloch überhaupt öffnet.

   - Seiten (HTML): zuerst Netz (max. 4 s), sonst die gespeicherte Fassung.
   - Eigene Dateien mit ?v=…: aus dem Speicher, sonst Netz. Alte ?v= fliegen raus.
   - Bibliotheken/Schriften (gstatic, cdnjs, Google Fonts): aus dem Speicher.
   - Alles andere (Firestore, Apps Script, Drive) läuft am Speicher vorbei.

   Nach einer erfolgreich geladenen Seite holt er im Hintergrund (höchstens
   alle 6 Stunden) alle Bereiche, damit z. B. der Spieltag offline geht,
   auch wenn man vorher nur die Startseite offen hatte.
   ============================================================ */
const CACHE = "mst-v1";
const PAGES = ["./", "spieltag/", "kalender/", "ich/", "padel/", "afterworkbar/", "karte/", "gv/", "finanzen/", "fotos/", "spieltag/organisation/"];
const STATIC = ["manifest.json", "assets/logo.png", "assets/icon-192.png", "assets/apple-touch-icon.png"];
const LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|cdnjs\.cloudflare\.com\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const WARM_EVERY = 6 * 3600 * 1000;
const scopeUrl = p => new URL(p, self.registration.scope).href;

self.addEventListener("install", e => {
  e.waitUntil(warm(true).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("mst-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(req.mode === "navigate" && url.href.startsWith(self.registration.scope)){
    e.respondWith(page(req, e));
  } else if(url.href.startsWith(self.registration.scope)){
    e.respondWith(own(req));
  } else if(LIBS.test(req.url)){
    e.respondWith(lib(req));
  }
});

/* ---------- Seiten ---------- */
async function page(req, e){
  const cache = await caches.open(CACHE), key = pageKey(req.url);
  const net = fetch(req).then(res => {
    if(res.ok){
      const copy = res.clone();
      e.waitUntil(cache.put(key, copy.clone())
        .then(() => copy.text()).then(html => cacheAssets(cache, html, key)).then(() => maybeWarm()).catch(() => {}));
    }
    return res;
  });
  try{
    return await timeout(net, 4000);
  }catch(err){
    // langsames Netz oder keines: gespeicherte Fassung; gibt es keine, doch noch aufs Netz warten
    const hit = await cache.match(key) || await cache.match(req, { ignoreSearch:true });
    if(hit) return hit;
    try{ return await net; }catch(e2){}
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="background:#141311;color:#f5f3ec;font-family:sans-serif;padding:40px 20px;text-align:center">
      <h2>Offline</h2><p>Diese Seite war auf diesem Handy noch nie offen. Sobald du wieder Empfang hast, einmal öffnen – danach geht sie auch ohne Netz.</p>
      <p><a style="color:#fff139" href="${self.registration.scope}">Zur Startseite</a></p></body>`, { headers:{ "Content-Type":"text/html; charset=utf-8" } });
  }
}
/* Seiten ohne Suchteil speichern (?test, ?jahr= … zeigen dieselbe Datei) */
function pageKey(u){
  const url = new URL(u);
  url.search = ""; url.hash = "";
  if(url.pathname.endsWith("/index.html")) url.pathname = url.pathname.slice(0, -10);
  return url.href;
}

/* ---------- eigene Dateien ---------- */
async function own(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit){
    // ohne Versionsnummer (Bilder, manifest): im Hintergrund auffrischen
    if(!new URL(req.url).searchParams.has("v")) fetch(req).then(r => { if(r.ok) cache.put(req, r); }).catch(() => {});
    return hit;
  }
  try{
    const res = await fetch(req);
    if(res.ok) await cache.put(req, res.clone());
    return res;
  }catch(err){
    // gleiche Datei mit anderer Version ist besser als nichts
    const any = await cache.match(req, { ignoreSearch:true });
    if(any) return any;
    throw err;
  }
}

/* ---------- Bibliotheken & Schriften ---------- */
async function lib(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res.ok || res.type === "opaque") await cache.put(req, res.clone());
  return res;
}

/* ---------- Vorrat ---------- */
/* Alle Dateien, die eine Seite einbindet, speichern; ältere ?v= derselben Datei löschen. */
async function cacheAssets(cache, html, base){
  const urls = new Set();
  html.replace(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"'#]+)["']/gi, (m, u) => {
    try{
      const abs = new URL(u, base);
      if(abs.pathname.length > 1 && (abs.href.startsWith(self.registration.scope) || LIBS.test(abs.href))) urls.add(abs.href);
    }catch(e){}
    return m;
  });
  const keys = await cache.keys();
  await Promise.all([...urls].map(async u => {
    const url = new URL(u);
    if(url.href.startsWith(self.registration.scope) && url.searchParams.has("v")){
      keys.filter(k => { const o = new URL(k.url); return o.pathname === url.pathname && o.search !== url.search; })
        .forEach(k => cache.delete(k));
    }
    if(await cache.match(u)) return;
    try{
      const own = u.startsWith(self.registration.scope);
      const res = await fetch(u, own ? {} : { mode:"no-cors" });
      if(res.ok || res.type === "opaque") await cache.put(u, res);
    }catch(e){}
  }));
}
async function maybeWarm(){
  const cache = await caches.open(CACHE);
  const stamp = await cache.match("__warm");
  const last = stamp ? parseInt(await stamp.text(), 10) : 0;
  if(Date.now() - last < WARM_EVERY) return;
  await warm(false);
}
async function warm(first){
  const cache = await caches.open(CACHE);
  await cache.put("__warm", new Response(String(Date.now())));
  await Promise.all(STATIC.map(async p => {
    try{ const r = await fetch(scopeUrl(p)); if(r.ok) await cache.put(scopeUrl(p), r); }catch(e){}
  }));
  for(const p of PAGES){
    try{
      const u = scopeUrl(p);
      const r = await fetch(u, { cache:first ? "default" : "no-cache" });
      if(!r.ok) continue;
      await cache.put(u, r.clone());
      await cacheAssets(cache, await r.text(), u);
    }catch(e){}
  }
}

function timeout(p, ms){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}
