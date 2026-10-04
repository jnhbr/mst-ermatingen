/* ============================================================
   MST Ermatingen – gemeinsame Basis für alle Bereiche
   Firebase (Projekt "minispieltag"), Login, Kopfzeile.
   ============================================================

   Login:
   - Mitglieder: Vereinsnummer + Vorname. Daraus wird ein SHA-256-Schlüssel
     gebildet; existiert members/<schlüssel>, gibt es eine Sitzung
     sessions/<uid> (anonymer Firebase-Login). Die Firestore-Regeln prüfen
     bei jedem Schreibzugriff über diese Sitzung, wer man ist.
   - Admin: E-Mail + Passwort (das Firebase-Konto, mit dem auch die
     Spieltag-Seite verwaltet wird). Gilt als Mitglied ADMIN_MEMBER_ID.
*/
const firebaseConfig = {
  apiKey: "AIzaSyD30pD_w95TnC4XWuFZ07US6Eg-14fQALo",
  authDomain: "minispieltag.firebaseapp.com",
  projectId: "minispieltag",
  storageBucket: "minispieltag.firebasestorage.app",
  messagingSenderId: "267219151117",
  appId: "1:267219151117:web:2e76de665497c3ada8a844"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
/* Seitenwechsel ohne Hänger. Firestore räumt seinen Gerätespeicher (IndexedDB) erst auf, WÄHREND die Seite
   verschwindet (pagehide). Auf iPhone/Safari bleibt dieses Aufräumen manchmal mittendrin stehen – die nächste Seite
   kann den Speicher dann nicht öffnen und zeigt «lade …», bis man die App neu startet (WebKit-Fehler 226547; die
   Bibliothek umgeht ihn nur für iOS 14–16 und nicht für Apps auf dem Home-Bildschirm). Darum:
   1. Auf WebKit kommt das Aufräumen beim Verschwinden gar nicht erst zum Zug (dieser Zuhörer steht vor dem von Firestore).
   2. Vor jedem Wechsel auf eine andere Seite beenden wir Firestore selbst, solange die Seite noch lebt (leaveClean) –
      die nächste Seite übernimmt den Speicher sofort.
   3. Holt der Browser eine so verlassene Seite aus dem Zwischenspeicher zurück (Zurück-Wischen), lädt sie neu. */
const WEBKIT = /AppleWebKit/.test(navigator.userAgent) && (!/Chrome|Chromium|Edg\/|Android/.test(navigator.userAgent) || /iPhone|iPad|iPod/.test(navigator.userAgent));
let leftClean = null;
function leaveClean(){
  if(!leftClean){
    const end = typeof db.terminate === "function" ? db.terminate().catch(() => {}) : Promise.resolve();
    leftClean = Promise.race([end, new Promise(r => setTimeout(r, 1200))]);
  }
  return leftClean;
}
window.addEventListener("pagehide", e => { if(WEBKIT) e.stopImmediatePropagation(); }, true);
window.addEventListener("pageshow", e => { if(e.persisted && leftClean) location.reload(); });
document.addEventListener("click", e => {
  if(e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest("a[href]");
  if(!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
  let url;
  try{ url = new URL(a.href, location.href); }catch(err){ return; }
  if(url.origin !== location.origin) return;
  if(url.pathname === location.pathname && url.search === location.search) return;   // nur Sprungmarke
  e.preventDefault();
  leaveClean().then(() => { location.href = url.href; });
});

/* Offline (Funkloch am Hörnle): Firestore behält alles Gelesene auf dem Gerät und schickt Änderungen nach,
   sobald wieder Empfang da ist. Muss vor dem ersten Zugriff stehen; geht nicht (privates Fenster) = egal. */
db.enablePersistence({ synchronizeTabs:true }).catch(e => console.warn("Offline-Speicher nicht verfügbar", e.code || e));

const MST = {
  ADMIN_MEMBER_ID: "m10",
  user: null,          // { id, name, short, admin }
  directory: {},       // memberId -> { name, short }

  normalizeVorname(s){
    const first = String(s || "").trim().split(/\s+/)[0] || "";
    return first.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  },
  async loginKey(nr, vorname){
    const raw = `mst-ermatingen|${parseInt(nr, 10)}|${this.normalizeVorname(vorname)}`;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  },

  async fetchDirectory(){
    const snap = await db.collection("memberDirectory").get(), dir = {};
    snap.forEach(d => { dir[d.id] = d.data(); });
    return dir;
  },
  async loadDirectory(){
    this.directory = await this.fetchDirectory();
    const u = auth.currentUser;
    if(u && this.cachedLogin(u.uid)) this.rememberLogin(u.uid);
  },
  nameOf(id){ return (this.directory[id] && this.directory[id].short) || id; },

  /* Spieltag-Anmeldung: Anmeldeschluss spieltag/<jahr>.signupUntil ("JJJJ-MM-TT", Standard 14 Tage vor dem
     Datum; der Tag zählt noch). Die Firestore-Regeln prüfen denselben Schluss. */
  SIGNUP_DAYS_BEFORE: 14,
  signupUntil(y){
    if(!y) return null;
    if(y.signupUntil) return y.signupUntil;
    return y.date ? this.isoMinusDays(y.date, this.SIGNUP_DAYS_BEFORE) : null;
  },
  isoMinusDays(iso, n){
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  /* offen = Schalter in der Organisation (nie gesetzt = offen), nicht abgeschlossen; gleich wie in firestore.rules */
  signupFlag(y){ return !!y && !y.closed && (y.signupOpen != null ? !!y.signupOpen : true); },
  /* Spieltag mit dem Datum aus dem Google Kalender (falls dort eingetragen) */
  withDate(y, day){ return y && day && y.date !== day ? Object.assign({}, y, { date:day }) : y; },
  signupOpenNow(y){
    if(!this.signupFlag(y) || y.closed) return false;
    const u = this.signupUntil(y);
    return !u || new Date() <= new Date(u + "T23:59:59");
  },
  /* Admin: Datum des Spieltags aus dem Google Kalender übernehmen (Termin «Minispieltag <jahr>») und den
     Anmeldeschluss mitziehen, solange er auf dem Standard (14 Tage davor) steht. Gibt true zurück, wenn geändert. */
  async syncSpieltagDate(year, y, day){
    if(!day || !y || y.closed || y.date === day) return false;
    const upd = { date:day };
    if(!y.signupUntil || y.signupUntil === (y.date ? this.isoMinusDays(y.date, this.SIGNUP_DAYS_BEFORE) : null))
      upd.signupUntil = this.isoMinusDays(day, this.SIGNUP_DAYS_BEFORE);
    await db.collection("spieltag").doc(String(year)).set(upd, { merge:true });
    this.log("spieltag", `Spieltag ${year}: Datum ${day} aus dem Google Kalender übernommen` + (upd.signupUntil ? `, Anmeldeschluss ${upd.signupUntil}` : ""));
    return true;
  },
  fmtDay(iso){
    return iso ? new Date(iso + "T12:00:00").toLocaleDateString("de-CH", { weekday:"short", day:"numeric", month:"long", year:"numeric" }) : "";
  },

  /* Eintrag ins Änderungsprotokoll (lesen kann nur der Admin). */
  log(area, text, extra){
    return this.quick(db.collection("log").add({ at:Date.now(), by:this.user.id, byName:this.user.name, area, text, ...(extra || {}) })
      .catch(e => console.warn("Protokoll fehlgeschlagen", e)));
  },

  /* Schreiben ohne auf den Server zu warten: Firestore zeigt die Änderung sofort an und schickt sie nach,
     sobald wieder Empfang da ist. Wer auf die Antwort wartet, hat bei schwachem Netz einen Knopf, der hängt –
     darum höchstens 0,4 s (reicht für eine sofortige Ablehnung). Lehnt der Server später ab (z. B.
     Anmeldeschluss vorbei), erscheint ein Hinweis. */
  quick(p, ms){
    let late = false;
    p.catch(e => { if(late){ console.error(e); this.toast("Eine Änderung wurde nicht gespeichert (keine Berechtigung oder abgelaufen). Bitte nochmals prüfen.", "red", 9000); } });
    return Promise.race([p, new Promise(r => setTimeout(() => { late = true; r(); }, ms || 400))]);
  },
  /* Lesen ohne auf den Server zu warten: liefert sofort, was vom letzten Besuch auf dem Gerät liegt (sonst die
     Antwort vom Server). Der Server wird im Hintergrund gefragt; hat sich etwas geändert → onChange(neu).
     Für alles, was eine Seite beim Öffnen braucht. Nicht für Lesen-dann-Schreiben (dort ref.get()). */
  fast(ref, onChange){
    const sig = s => JSON.stringify(s.docs ? s.docs.map(d => [d.id, d.data()]) : s.exists ? s.data() : null);
    return ref.get({ source:"cache" }).then(c => {
      if(c.docs && c.empty) return ref.get();   // leere Liste: noch nie geholt oder wirklich leer → Server fragen
      ref.get().then(f => { if(onChange && sig(f) !== sig(c)) onChange(f); }).catch(() => {});
      return c;
    }, () => ref.get());
  },
  toast(text, kind, ms){
    let el = document.getElementById("mstToast");
    if(!el){ el = document.createElement("div"); el.id = "mstToast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.className = "mst-toast " + (kind || "");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastT);
    if(ms !== 0) this._toastT = setTimeout(() => { el.hidden = true; }, ms || 3500);
  },

  /* Seite neu laden – zuerst Firestore sauber beenden (siehe leaveClean) */
  reload(){ leaveClean().then(() => location.reload()); },

  /* Startet die Seite: zeigt bei Bedarf das Login und ruft danach onReady(user) auf. */
  start(onReady){
    this._onReady = onReady;
    auth.onAuthStateChanged(async (u) => {
      if(this._loggingIn) return; // memberLogin() führt selbst weiter
      try{
        if(await this.identify(u)) this.ready();
        else this.showLogin();
      }catch(e){
        console.error(e);
        this.showLogin("Verbindung fehlgeschlagen – bitte nochmals versuchen.");
      }
    });
  },

  /* Wer ist eingeloggt? Setzt MST.user/MST.directory und gibt den Nutzer zurück (null = niemand).
     Beim ersten Mal vom Server (Sitzung bzw. Rolle + Mitgliederliste). Danach sofort vom Gerät – sonst wartet
     jede Seite zwei Anfragen lang auf «lade …». Der Server wird im Hintergrund nachgefragt; ist jemand
     ausgetreten oder hat die Rolle gewechselt, lädt die Seite neu. Geschützt sind die Daten ohnehin durch
     die Firestore-Regeln. */
  USER_CACHE: "mst-user-v1",
  cachedLogin(uid){
    try{ const c = JSON.parse(localStorage.getItem(this.USER_CACHE) || "null"); return c && c.uid === uid && c.user && c.directory ? c : null; }catch(e){ return null; }
  },
  rememberLogin(uid){
    try{ localStorage.setItem(this.USER_CACHE, JSON.stringify({ uid, user:this.user, directory:this.directory })); }catch(e){}
  },
  forgetLogin(){ try{ localStorage.removeItem(this.USER_CACHE); }catch(e){} },
  async identify(u){
    if(!u){ this.forgetLogin(); this.user = null; return null; }
    const c = this.cachedLogin(u.uid);
    if(c){
      this.user = c.user; this.directory = c.directory;
      if(!this._checked){
        this._checked = true;   // einmal pro Seite
        this.lookup(u, true).then(r => {
          if(JSON.stringify(r.user) !== JSON.stringify(c.user)){
            if(r.user){ this.user = r.user; this.directory = r.directory; this.rememberLogin(u.uid); } else this.forgetLogin();
            this.reload();
            return;
          }
          this.directory = r.directory; this.rememberLogin(u.uid);
        }).catch(e => console.warn("Login prüfen", e));
      }
      return this.user;
    }
    const r = await this.lookup(u);
    this.user = r.user;
    if(r.user){ this.directory = r.directory; this.rememberLogin(u.uid); }
    return this.user;
  },
  /* Vorstand (E-Mail-Login): Rolle aus roles/<e-mail>, ohne Eintrag = Admin (Jan).
     Mitglied (anonymer Login): Sitzung sessions/<uid>. strict = Fehler weitergeben (Prüfung im Hintergrund). */
  ROLE_LABEL: { admin:"Admin", kassier:"Kassier", aktuar:"Aktuar" },
  async lookup(u, strict){
    if(!u.isAnonymous){
      const [r, dir] = await Promise.all([
        db.collection("roles").doc(String(u.email || "").toLowerCase()).get().catch(e => { if(strict) throw e; console.warn("Rolle", e); return null; }),
        this.fetchDirectory()
      ]);
      let role = "admin", id = this.ADMIN_MEMBER_ID;
      if(r && r.exists){ role = r.data().role || "admin"; id = r.data().memberId || id; }
      const d = dir[id] || { name:"Vorstand", short:"Vorstand" };
      return { directory:dir, user:{ id, name:d.name, short:d.short, admin:role === "admin", role, vorstand:true,
        kassier:role === "admin" || role === "kassier", aktuar:role === "admin" || role === "aktuar" } };
    }
    // Mitgliederliste gleichzeitig holen (ohne Sitzung verweigern die Regeln sie – dann ist es egal)
    const [s, dir0] = await Promise.all([db.collection("sessions").doc(u.uid).get(), this.fetchDirectory().catch(() => null)]);
    if(!s.exists) return { directory:{}, user:null };
    const dir = dir0 || await this.fetchDirectory();
    const id = s.data().memberId, d = dir[id] || { name:id, short:id };
    return { directory:dir, user:{ id, name:d.name, short:d.short, admin:false } };
  },

  ready(){
    document.getElementById("gate").innerHTML = "";
    document.getElementById("gate").hidden = true;
    this.renderUserBar();
    this._onReady(this.user);
  },

  renderUserBar(){
    const el = document.getElementById("userbar");
    if(!el) return;
    el.innerHTML = `<span class="user-chip">${this.user.vorstand ? `<span class="admin-tag">${this.ROLE_LABEL[this.user.role] || "Admin"}</span>` : ""}${esc(this.user.name)}</span>
      <button class="link-btn" id="logoutBtn" type="button">Abmelden</button>`;
    document.getElementById("logoutBtn").onclick = () => this.logout();
  },

  async logout(){
    const u = auth.currentUser;
    this.forgetLogin();
    try{ if(u && u.isAnonymous) await this.quick(db.collection("sessions").doc(u.uid).delete(), 1500); }catch(e){}
    await auth.signOut();
    this.reload();
  },

  showLogin(msg, adminMode){
    const gate = document.getElementById("gate");
    gate.hidden = false;
    gate.innerHTML = `
      <div class="login-card">
        <img class="login-logo" src="${this.base}assets/logo.png" alt="MST Ermatingen">
        <h1 class="login-title">MST Ermatingen</h1>
        <p class="login-sub">${adminMode ? "Login für den Vorstand" : "Login für Mitglieder"}</p>
        <form id="loginForm" autocomplete="on">
          ${adminMode ? `
            <label>E-Mail<input name="email" type="email" required autocomplete="username"></label>
            <label>Passwort<input name="pw" type="password" required autocomplete="current-password"></label>
          ` : `
            <label>Vereinsnummer<input name="nr" inputmode="numeric" pattern="[0-9]*" required autocomplete="off"></label>
            <label>Vorname<input name="vorname" required autocomplete="given-name"></label>
          `}
          <button class="btn-primary" type="submit">Einloggen</button>
          <p class="login-msg" id="loginMsg">${msg ? esc(msg) : ""}</p>
        </form>
        ${adminMode ? '<button class="link-btn" id="pwReset" type="button">Passwort vergessen?</button><br>' : ""}
        <button class="link-btn" id="switchLogin" type="button">${adminMode ? "← Login für Mitglieder" : "Vorstand-Login"}</button>
      </div>`;
    document.getElementById("switchLogin").onclick = () => this.showLogin("", !adminMode);
    const pr = document.getElementById("pwReset");
    if(pr) pr.onclick = async () => {
      const email = document.querySelector("#loginForm [name=email]").value.trim();
      const msgEl = document.getElementById("loginMsg");
      if(!email){ msgEl.textContent = "Zuerst oben die E-Mail-Adresse eintragen."; return; }
      try{
        await auth.sendPasswordResetEmail(email);
        msgEl.textContent = "Mail zum Zurücksetzen ist unterwegs (auch im Spam schauen).";
      }catch(e){ console.error(e); msgEl.textContent = "Ging nicht – stimmt die E-Mail-Adresse?"; }
    };
    document.getElementById("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, msgEl = document.getElementById("loginMsg");
      f.querySelector("button").disabled = true;
      msgEl.textContent = "prüfe …";
      try{
        if(adminMode){
          await auth.signInWithEmailAndPassword(f.email.value.trim(), f.pw.value);
        } else {
          await this.memberLogin(f.nr.value, f.vorname.value);
        }
      }catch(err){
        console.error(err);
        msgEl.textContent = err.userMessage || "Login hat nicht geklappt.";
        f.querySelector("button").disabled = false;
      }
    };
  },

  async memberLogin(nr, vorname){
    if(!/^\d+$/.test(String(nr).trim()) || !this.normalizeVorname(vorname)){
      throw Object.assign(new Error("input"), { userMessage:"Bitte Vereinsnummer und Vorname eingeben." });
    }
    const key = await this.loginKey(nr, vorname);
    this._loggingIn = true;
    try{ return await this._memberLogin(key); } finally { this._loggingIn = false; }
  },
  async _memberLogin(key){
    if(!auth.currentUser) await auth.signInAnonymously();
    const m = await db.collection("members").doc(key).get();
    if(!m.exists){
      throw Object.assign(new Error("nomatch"), { userMessage:"Nummer und Vorname passen nicht zusammen." });
    }
    const uid = auth.currentUser.uid;
    await db.collection("sessions").doc(uid).set({ key, memberId:m.data().id, at:Date.now() });
    await this.loadDirectory();
    const d = this.directory[m.data().id] || { name:m.data().id, short:m.data().id };
    this.user = { id:m.data().id, name:d.name, short:d.short, admin:false };
    this.rememberLogin(uid);
    this.ready();
  },

  base: (document.currentScript && document.currentScript.dataset.base) || ""
};

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

/* Fusszeile mit Social Media auf jeder Seite (ausserhalb von #app, damit sie Neuzeichnen übersteht). */
MST.INSTAGRAM = "https://www.instagram.com/minispieltag/";
MST.instagramIcon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';
document.addEventListener("DOMContentLoaded", () => {
  const f = document.createElement("footer");
  f.className = "site-foot";
  f.innerHTML = `<a href="${MST.INSTAGRAM}" target="_blank" rel="noopener">${MST.instagramIcon}<span>@minispieltag</span></a>`;
  document.body.appendChild(f);
  MST.watchOnline();
});

/* Bleibt «lade …» stehen (kein Empfang beim allerersten Besuch, Speicher des Browsers klemmt), nach 9 s einen
   Ausweg zeigen statt endlos warten zu lassen. */
window.addEventListener("load", () => setTimeout(() => {
  document.querySelectorAll("#gate:not([hidden]) > .loading, #app > .loading").forEach(l => {
    if(!/^lade/.test(l.textContent.trim())) return;
    l.innerHTML = 'Das dauert länger als sonst …<br><br><button class="btn-primary" type="button" onclick="MST.reload()">Neu laden</button>';
  });
}, 9000));

/* Offline-Hinweis: ohne Netz bleibt alles bedienbar, Änderungen gehen nach, sobald wieder Empfang da ist. */
MST.watchOnline = function(){
  const bar = document.createElement("div");
  bar.className = "net-bar";
  bar.hidden = true;
  document.body.appendChild(bar);
  let wasOffline = false, t = null;
  const show = () => {
    clearTimeout(t);
    if(!navigator.onLine){
      wasOffline = true;
      bar.className = "net-bar off";
      bar.textContent = "Offline – du kannst weiter eintragen, alles wird gespeichert, sobald wieder Empfang da ist.";
      bar.hidden = false;
      return;
    }
    if(!wasOffline){ bar.hidden = true; return; }
    wasOffline = false;
    bar.className = "net-bar sync";
    bar.textContent = "Wieder online – synchronisiere …";
    bar.hidden = false;
    db.waitForPendingWrites().then(() => {
      bar.className = "net-bar ok";
      bar.textContent = "✓ Alles gespeichert";
      t = setTimeout(() => { bar.hidden = true; }, 2500);
    }).catch(() => { bar.hidden = true; });
  };
  window.addEventListener("online", show);
  window.addEventListener("offline", show);
  show();
};

/* Service Worker: hält die Seiten selbst (HTML, Stile, Skripte, Firebase) auf dem Gerät, damit sie auch im
   Funkloch öffnen. Nicht auf localhost (dort stört das Zwischenspeichern beim Entwickeln). */
if("serviceWorker" in navigator && location.protocol === "https:"){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(MST.base + "sw.js").catch(e => console.warn("Service Worker", e));
  });
}
