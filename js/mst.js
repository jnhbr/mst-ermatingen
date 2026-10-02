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

  /* Startet die Seite: zeigt bei Bedarf das Login und ruft danach onReady(user) auf. */
  start(onReady){
    this._onReady = onReady;
    auth.onAuthStateChanged(async (u) => {
      if(this._loggingIn) return; // memberLogin() führt selbst weiter
      try{
        if(!u){ this.showLogin(); return; }
        if(!u.isAnonymous){
          await this.loadDirectory();
          const d = this.directory[this.ADMIN_MEMBER_ID] || { name:"Admin", short:"Admin" };
          this.user = { id:this.ADMIN_MEMBER_ID, name:d.name, short:d.short, admin:true };
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

  ready(){
    document.getElementById("gate").innerHTML = "";
    document.getElementById("gate").hidden = true;
    this.renderUserBar();
    this._onReady(this.user);
  },

  renderUserBar(){
    const el = document.getElementById("userbar");
    if(!el) return;
    el.innerHTML = `<span class="user-chip">${this.user.admin ? '<span class="admin-tag">Admin</span>' : ""}${esc(this.user.name)}</span>
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
        <p class="login-sub">${adminMode ? "Admin-Login" : "Login für Mitglieder"}</p>
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
        <button class="link-btn" id="switchLogin" type="button">${adminMode ? "← Login für Mitglieder" : "Admin-Login"}</button>
      </div>`;
    document.getElementById("switchLogin").onclick = () => this.showLogin("", !adminMode);
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
