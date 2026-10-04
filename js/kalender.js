/* ============================================================
   MST Ermatingen – Vereinskalender (gemeinsam für Kalender-Seite und Startseite)

   Quelle der Wahrheit ist der Google Kalender «MST». Die Seite spricht über
   eine Google-Apps-Script-Web-App mit ihm (apps-script/kalender/Code.gs):
   lesen ohne Login, schreiben nur mit Vorstand-Login (Firebase-Token).
   ============================================================ */
const KAL = {
  /* URL der Apps-Script-Web-App (Bereitstellen → Web-App → …/exec) */
  API: "https://script.google.com/macros/s/AKfycbx0X4sktOkDG8HpoWK5UOU3zOMSomAb547kcJH_byOpAK9uRqO2XJb_cNKe5phzl679/exec",
  TZ: "Europe/Zurich",
  CACHE: "mst-kalender-v1",

  api(){
    // Zum lokalen Testen (private/kalender/mock-server.mjs): ?api=http://localhost:…
    // – nur auf localhost, damit niemand einen fremden Server unterschieben kann.
    if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
      const o = new URLSearchParams(location.search).get("api");
      if(o) return o;
    }
    return this.API;
  },
  ready(){ return !!this.api(); },
  /* lokaler Test als Vorstand (nur zusammen mit ?api= auf localhost) */
  testVorstand(){ return this.api() !== this.API && new URLSearchParams(location.search).get("als") === "vorstand"; },

  /* ---------- Daten ---------- */
  cached(){
    try{ const c = JSON.parse(localStorage.getItem(this.CACHE) || "null"); return c && Array.isArray(c.events) ? c : null; }catch(e){ return null; }
  },
  remember(events){
    try{ localStorage.setItem(this.CACHE, JSON.stringify({ events, at:Date.now() })); }catch(e){}
  },
  async load(fresh){
    const r = await fetch(this.api() + (fresh ? "?fresh=1" : ""), { cache:"no-store" });
    const d = await r.json();
    if(!d.ok) throw new Error(d.error || "Kalender nicht erreichbar");
    this.remember(d.events);
    return d.events;
  },
  /* action = "save" | "delete"; nur Vorstand. Antwort enthält die frische Terminliste. */
  async write(action, event, byName){
    const u = auth.currentUser;
    if(!this.testVorstand() && (!u || u.isAnonymous)) throw new Error("Nur mit Vorstand-Login");
    const idToken = this.testVorstand() ? "test-token" : await u.getIdToken();
    // text/plain = «einfache» Anfrage ohne CORS-Vorabprüfung (Apps Script kann darauf nicht antworten)
    const r = await fetch(this.api(), { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" },
      body:JSON.stringify({ action, event, idToken, byName }) });
    const d = await r.json();
    if(!d.ok) throw new Error(d.error || "Speichern fehlgeschlagen");
    this.remember(d.events);
    return d;
  },

  /* ---------- Abo ---------- */
  feedUrl(){ return this.api() + "?format=ics"; },
  webcalUrl(){ return this.feedUrl().replace(/^https?:\/\//, "webcal://"); },
  googleUrl(){ return "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(this.webcalUrl()); },

  /* ---------- Datum ---------- */
  /* Tag als "YYYY-MM-DD" in Schweizer Zeit */
  dayKey(d){ return new Intl.DateTimeFormat("en-CA", { timeZone:this.TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(d); },
  today(){ return this.dayKey(new Date()); },
  keyDate(k){ return new Date(k + "T12:00:00"); },          // Mittag – sicher vor Zeitumstellungen
  addDays(k, n){ const d = this.keyDate(k); d.setDate(d.getDate() + n); return this.dayKey(d); },
  firstDay(ev){ return ev.allDay ? ev.start : this.dayKey(new Date(ev.start)); },
  lastDay(ev){ return ev.allDay ? ev.end : this.dayKey(new Date(new Date(ev.end).getTime() - 1)); },
  isPast(ev){ return ev.allDay ? ev.end < this.today() : new Date(ev.end) < new Date(); },
  daysUntil(ev){ return Math.round((this.keyDate(this.firstDay(ev)) - this.keyDate(this.today())) / 864e5); },
  time(iso){ return new Date(iso).toLocaleTimeString("de-CH", { timeZone:this.TZ, hour:"2-digit", minute:"2-digit" }); },
  fmtDay(k, opts){ return this.keyDate(k).toLocaleDateString("de-CH", Object.assign({ weekday:"short", day:"numeric", month:"short" }, opts || {})); },
  /* «Sa, 21. Nov. · ganztägig», «Sa, 15. – So, 16. Feb.», «Di, 7. Apr. · 12:30–13:30» */
  when(ev, withYear){
    const y = withYear ? { year:"numeric" } : {};
    const a = this.firstDay(ev), b = this.lastDay(ev);
    if(ev.allDay) return a === b ? `${this.fmtDay(a, y)} · ganztägig` : `${this.fmtDay(a)} – ${this.fmtDay(b, y)}`;
    if(a === b) return `${this.fmtDay(a, y)} · ${this.time(ev.start)}–${this.time(ev.end)}`;
    return `${this.fmtDay(a)} ${this.time(ev.start)} – ${this.fmtDay(b, y)} ${this.time(ev.end)}`;
  },
  /* Datum des Termins «Minispieltag <jahr>» im Kalender ("JJJJ-MM-TT") – davon hängt der Anmeldeschluss ab */
  spieltagDay(events, year){
    const ev = (events || []).filter(e => /minispieltag/i.test(e.title) && this.firstDay(e).startsWith(String(year)))
      .sort((a, b) => this.firstDay(a).localeCompare(this.firstDay(b)))[0];
    return ev ? this.firstDay(ev) : null;
  },
  countdown(ev){
    if(!this.isPast(ev) && this.firstDay(ev) <= this.today()) return "heute";
    const n = this.daysUntil(ev);
    return n === 1 ? "morgen" : n < 0 ? "vorbei" : `in ${n} Tagen`;
  },

  /* ---------- Darstellung ---------- */
  KINDS: [
    [/spieltag/i, "🏆", "spieltag/"],
    [/afterwork|\bawb\b/i, "🍺", "afterworkbar/"],
    [/\bgv\b|generalversammlung/i, "📋", "gv/"],
    [/padel|training/i, "🎾", "padel/"],
    [/ski/i, "⛷️", ""],
    [/winter/i, "❄️", ""],
    [/krach am bach|fest|bar\b/i, "🎉", ""],
    [/bastel/i, "✂️", ""],
    [/auslosung|besprechung|sitzung/i, "🗓️", ""]
  ],
  kind(ev){
    const k = this.KINDS.find(([re]) => re.test(ev.title));
    return { icon:k ? k[1] : "📅", link:k ? k[2] : "" };
  },
  /* Text sicher als HTML, Links klickbar */
  linkify(s){
    return esc(s).replace(/https?:\/\/[^\s<>"]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>`).replace(/\n/g, "<br>");
  },
  mapsUrl(loc){ return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(loc); },

  /* ---------- Zu-/Absagen (Firestore, nur Mitglieder) ----------
     rsvp/<id> = { title, day, <memberId>: { s:"ja"|"vielleicht"|"nein", at, n? } }
     id = Termin-Schlüssel (bei Serien mit Datum). Jedes Mitglied ändert nur sein eigenes Feld (firestore.rules).
     Spieltag (eigene Anmeldung) und Padel (eigene Verfügbarkeit) haben keine Zusage im Kalender. */
  RSVP: { ja:{ label:"Bin dabei", short:"dabei", icon:"✓" }, vielleicht:{ label:"Vielleicht", short:"vielleicht", icon:"?" }, nein:{ label:"Kann nicht", short:"nein", icon:"✗" } },
  rsvpId(ev){ return String(ev.key || ev.id).replace(/[^A-Za-z0-9@._|:+-]/g, "_").slice(0, 400); },
  rsvpAllowed(ev){ return !this.isPast(ev) && !/^(spieltag|padel)\//.test(this.kind(ev).link); },
  rsvps: {},            // id -> Dokument
  _rsvpOff: null,
  /* live mitlesen (nur eingeloggt); cb() bei jeder Änderung */
  watchRsvps(cb){
    if(this._rsvpOff) this._rsvpOff();
    this._rsvpOff = db.collection("rsvp").onSnapshot(s => {
      this.rsvps = {};
      s.forEach(d => { this.rsvps[d.id] = d.data(); });
      cb && cb();
    }, e => console.warn("Zusagen", e));
  },
  myRsvp(ev, memberId){ const d = this.rsvps[this.rsvpId(ev)]; return d && memberId && d[memberId] ? d[memberId] : null; },
  /* { ja:[{id, n, at}], vielleicht:[…], nein:[…] } */
  rsvpList(ev){
    const d = this.rsvps[this.rsvpId(ev)] || {}, out = { ja:[], vielleicht:[], nein:[] };
    Object.entries(d).forEach(([k, v]) => { if(/^m\d+$/.test(k) && v && out[v.s]) out[v.s].push({ id:k, n:v.n || "", at:v.at || 0 }); });
    Object.values(out).forEach(l => l.sort((a, b) => a.at - b.at));
    return out;
  },
  /* s = "ja" | "vielleicht" | "nein" | null (Antwort zurückziehen) */
  setRsvp(ev, memberId, s, note){
    const ref = db.collection("rsvp").doc(this.rsvpId(ev));
    const val = s ? Object.assign({ s, at:Date.now() }, note ? { n:String(note).slice(0, 100) } : {}) : firebase.firestore.FieldValue.delete();
    return MST.quick(ref.set({ title:String(ev.title).slice(0, 120), day:this.firstDay(ev), [memberId]:val }, { merge:true }));
  },
  /* kleines Abzeichen für Listen: eigene Antwort + Anzahl Zusagen */
  rsvpBadge(ev, memberId){
    if(!this.rsvpAllowed(ev)) return "";
    const mine = this.myRsvp(ev, memberId), n = this.rsvpList(ev).ja.length;
    const me = mine ? `<span class="rsvp-badge ${mine.s}">${this.RSVP[mine.s].icon} ${this.RSVP[mine.s].short}</span>`
      : memberId ? '<span class="rsvp-badge open">zusagen?</span>' : "";
    return me + (n ? `<span class="rsvp-count">${n} dabei</span>` : "");
  },
  /* Knöpfe «Bin dabei / Vielleicht / Kann nicht» (data-rsvp="<s>") */
  rsvpButtons(ev, memberId){
    const mine = this.myRsvp(ev, memberId);
    return `<div class="rsvp-btns">${Object.entries(this.RSVP).map(([k, r]) =>
      `<button type="button" class="rsvp-btn ${k} ${mine && mine.s === k ? "on" : ""}" data-rsvp="${k}">${r.icon} ${r.label}</button>`).join("")}</div>`;
  }
};
