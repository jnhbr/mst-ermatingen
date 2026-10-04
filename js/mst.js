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

  async loadDirectory(){
    const snap = await db.collection("memberDirectory").get();
    this.directory = {};
    snap.forEach(d => { this.directory[d.id] = d.data(); });
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
  /* offen = Schalter in der Organisation; solange der nie gesetzt wurde: offen, sobald ein Anmeldeschluss gespeichert ist
     (gleich wie in firestore.rules) */
  signupFlag(y){ return !!y && (y.signupOpen != null ? !!y.signupOpen : !!y.signupUntil); },
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
    return db.collection("log").add({ at:Date.now(), by:this.user.id, byName:this.user.name, area, text, ...(extra || {}) })
      .catch(e => console.warn("Protokoll fehlgeschlagen", e));
  },

  /* Startet die Seite: zeigt bei Bedarf das Login und ruft danach onReady(user) auf. */
  start(onReady){
    this._onReady = onReady;
    auth.onAuthStateChanged(async (u) => {
      if(this._loggingIn) return; // memberLogin() führt selbst weiter
      try{
        if(!u){ this.showLogin(); return; }
        if(!u.isAnonymous){
          await this.loadVorstand(u);
          return this.ready();
        }
        const s = await db.collection("sessions").doc(u.uid).get();
        if(!s.exists){ this.showLogin(); return; }
        await this.loadDirectory();
        const id = s.data().memberId;
        const d = this.directory[id] || { name:id, short:id };
        this.user = { id, name:d.name, short:d.short, admin:false };
        this.ready();
      }catch(e){
        console.error(e);
        this.showLogin("Verbindung fehlgeschlagen – bitte nochmals versuchen.");
      }
    });
  },

  /* Vorstand (E-Mail-Login): Rolle aus roles/<e-mail>, ohne Eintrag = Admin (Jan). */
  ROLE_LABEL: { admin:"Admin", kassier:"Kassier", aktuar:"Aktuar" },
  async loadVorstand(u){
    let role = "admin", id = this.ADMIN_MEMBER_ID;
    try{
      const r = await db.collection("roles").doc(String(u.email || "").toLowerCase()).get();
      if(r.exists){ role = r.data().role || "admin"; id = r.data().memberId || id; }
    }catch(e){ console.warn("Rolle", e); }
    await this.loadDirectory();
    const d = this.directory[id] || { name:"Vorstand", short:"Vorstand" };
    this.user = { id, name:d.name, short:d.short, admin:role === "admin", role, vorstand:true,
      kassier:role === "admin" || role === "kassier", aktuar:role === "admin" || role === "aktuar" };
    return this.user;
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
    try{ if(u && u.isAnonymous) await db.collection("sessions").doc(u.uid).delete(); }catch(e){}
    await auth.signOut();
    location.reload();
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
});
