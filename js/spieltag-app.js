/* ===================== Spieltag – Live-Seite =====================
   Öffentlich: Rangliste, Spiele, Zeitplan, Historie, TV-Ansicht.
   Mitglied (Login Nummer + Vorname): selbst an-/abmelden, «Mein Spieltag»,
     Bierkapitän, Resultate eintragen an den eigenen Stationen (Stationsleitung).
   Admin: zusätzlich Spiele einstellen, auslosen, Teams anpassen, Stationsleitung, Zeitplan.
   Personen, Gäste und die Teilnehmerliste: Organisation. */
const E = SpieltagEngine, D = SpieltagData, S = SpieltagStats;
const qs = new URLSearchParams(location.search);
const LOCAL_ME = "mst-spieltag-ich";
const PUBLIC_URL = new URL("./", location.href).href.split("?")[0];

/* Wer schaut zu? Im Testmodus: Admin (Jan) oder mit ?als=m5 ein Mitglied */
let viewer = { admin:false, memberId:null };
if(D.test) viewer = qs.get("als") ? { admin:false, memberId:qs.get("als") } : { admin:true, memberId:"m10" };
let settings = null, YEAR = null, yearDoc = undefined, gameData = {}, signups = {}, beer = [], beerErr = false;
let catalog = [], HIST = [], strength = {};
let unsubYear = [], unsubBeer = null, editTeams = {}, pending = false, msg = "";
let tvIndex = 0, tvTimer = null, clockTimer = null;
let mineFor = null;   // «Mein Spieltag» für eine andere Person (aus dem Profil)

const isAdmin = () => viewer.admin;
const games = () => ((yearDoc && yearDoc.games) || []).map(E.normalizeGame);
const participants = () => ST.effectiveParticipants(yearDoc, signups);
const gamePath = id => `spieltag/${YEAR}/games/${id}`;
const ctx = () => ({ participants:participants() });
const leadersOf = id => ((gameData[id] || {}).leaders) || [];
const entryOpen = () => !!(yearDoc && yearDoc.entryOpen);
const isLeader = g => !!viewer.memberId && leadersOf(g.id).includes(viewer.memberId);
const canEnter = g => isAdmin() || isLeader(g) || (!!viewer.memberId && entryOpen());
const canSeeBeer = () => !!(yearDoc && yearDoc.beerOn) && (isAdmin() || !!viewer.memberId);
function myPid(){
  const p = ST.pidOfMember(viewer.memberId);
  if(p) return p;
  if(viewer.memberId) return null;
  try{ const l = localStorage.getItem(LOCAL_ME); return l && ST.persons[l] ? l : null; }catch(e){ return null; }
}
const champs = () => ST.champions(HIST, YEAR);
/* Hat der Spieltag begonnen? = irgendwo ein Resultat eingetragen */
function dayStarted(ov){
  return games().some(g => { const ev = ov.evals[g.id]; return ev.done > 0 || (ev.view.rows || []).some(r => r.total != null); });
}
function leaderNames(id){
  return leadersOf(id).map(mid => { const p = ST.pidOfMember(mid); return p ? ST.nameOf(p) : (MST.directory[mid] || {}).short || mid; });
}

/* ---------- Start ---------- */
MST._onReady = () => refreshViewer(auth.currentUser);
auth.onAuthStateChanged(u => refreshViewer(u));
async function refreshViewer(u){
  if(!D.test){
    let v = { admin:false, memberId:null };
    if(u && !u.isAnonymous){ const usr = await MST.loadVorstand(u); v = { admin:usr.admin, memberId:usr.id, vorstand:true }; }
    else if(u){
      try{ const s = await db.collection("sessions").doc(u.uid).get(); if(s.exists) v.memberId = s.data().memberId; }catch(e){}
    }
    viewer = v;
  }
  if(viewer.memberId && !viewer.vorstand){
    try{
      await MST.loadDirectory();
      const d = MST.directory[viewer.memberId] || {};
      MST.user = { id:viewer.memberId, name:d.name || viewer.memberId, short:d.short || "", admin:viewer.admin };
    }catch(e){ MST.user = { id:viewer.memberId, name:viewer.memberId, short:"", admin:viewer.admin }; }
  }
  const gate = document.getElementById("gate");
  if(viewer.memberId && !gate.hidden){ gate.hidden = true; gate.innerHTML = ""; }
  watchBeer();
  render();
}
D.watchDoc("spieltagMeta/settings", s => {
  settings = s || {};
  const y = qs.get("jahr") || settings.currentYear || null;
  if(y !== YEAR) openYear(y);
});
D.watchCollection("spieltagPersons", docs => { ST.persons = {}; docs.forEach(d => ST.persons[d.id] = d.data); render(); });
D.watchDoc("spieltagMeta/catalog", c => { catalog = (c && c.items) || E.DEFAULT_CATALOG; });
D.getCollection("spieltagHistory").then(docs => {
  HIST = docs.map(d => d.data).sort((a, b) => a.year - b.year);
  strength = E.strengthFromHistory(HIST);
  render();
}).catch(e => console.warn("Historie", e));

function openYear(y){
  unsubYear.forEach(f => f()); unsubYear = [];
  YEAR = y; yearDoc = undefined; gameData = {}; signups = {};
  if(!y){ yearDoc = null; render(); return; }
  unsubYear.push(D.watchDoc(`spieltag/${y}`, d => { yearDoc = d; watchBeer(); render(); }));
  unsubYear.push(D.watchCollection(`spieltag/${y}/games`, docs => {
    gameData = {};
    docs.forEach(d => {
      const tn = d.data.teamNames || {};
      (d.data.units || []).forEach(u => { if(tn[u.id]) u.teamName = tn[u.id]; });
      gameData[d.id] = d.data;
    });
    render();
  }));
  unsubYear.push(D.watchCollection(`spieltag/${y}/signups`, docs => { signups = {}; docs.forEach(d => signups[d.id] = d.data); render(); }));
}
function watchBeer(){
  const want = canSeeBeer() ? YEAR : null;
  if(unsubBeer && unsubBeer.year === want) return;
  if(unsubBeer){ unsubBeer(); unsubBeer = null; }
  beer = [];
  if(!want) return;
  const off = D.watchCollection(`spieltag/${want}/beer`, (docs, err) => {
    beerErr = !!err;
    beer = docs.map(d => Object.assign({ id:d.id }, d.data)).sort((a, b) => a.at - b.at);
    render();
  });
  unsubBeer = () => off();
  unsubBeer.year = want;
}

/* Neu zeichnen – aber nicht, während jemand gerade tippt. */
function render(){
  const a = document.activeElement;
  if(a && a.closest && a.closest("#content, dialog") && (a.tagName === "INPUT" || a.tagName === "SELECT")){ pending = true; return; }
  pending = false;
  draw();
}
document.addEventListener("focusout", () => setTimeout(() => { if(pending) render(); }, 30));
window.addEventListener("hashchange", () => { draw(); window.scrollTo(0, 0); });

function route(){
  const h = location.hash.replace(/^#/, "");
  const [view, arg] = h.split("/");
  return { view:view || "rangliste", arg:arg ? decodeURIComponent(arg) : null };
}

/* ---------- Gerüst ---------- */
function draw(){
  const app = document.getElementById("app");
  if(yearDoc === undefined || settings === null) return;
  const r = route();
  if(r.view === "tv"){ drawTV(); return; }
  if(r.view === "siegerehrung"){ drawCeremony(); return; }
  stopTV();
  const gs = games();
  const ov = yearDoc ? E.overall(gs, gameData, ctx()) : null;
  const done = ov ? gs.filter(g => ov.evals[g.id].final).length : 0;
  const started = ov && dayStarted(ov);
  const tabs = [["rangliste", "Rangliste"], ["spiele", "Spiele"], ["zeitplan", "Zeitplan"]];
  if(canSeeBeer()) tabs.push(["bier", "Bierkapitän"]);
  tabs.push(["historie", "Historie"]);
  const activeTab = r.view === "spiel" ? "spiele" : r.view === "ich" ? "zeitplan" : (r.view === "person" || r.view === "jahr") ? "historie" : r.view;
  const who = viewer.memberId ? (ST.pidOfMember(viewer.memberId) ? ST.nameOf(ST.pidOfMember(viewer.memberId)) : (MST.user && (MST.user.short || MST.user.name)) || "") : "";
  app.innerHTML = `
    <div class="topbar">
      <span class="crumbs"><a href="../">MST Ermatingen</a> / Spieltag</span>
      <div id="userbar">${isAdmin()
        ? `<span class="user-chip"><span class="admin-tag">Admin</span>${esc(who)}</span>${D.test ? "" : '<a class="link-btn" href="organisation/">Organisation</a><button class="link-btn" id="logoutBtn" type="button">Abmelden</button>'}`
        : viewer.memberId
          ? `<span class="user-chip">${esc(who)}</span>${D.test ? "" : '<button class="link-btn" id="logoutBtn" type="button">Abmelden</button>'}`
          : '<button class="link-btn" id="loginBtn" type="button">Login</button>'}</div>
    </div>
    ${D.test ? `<div class="test-banner"><span>🧪 Testmodus${viewer.admin ? " als Admin" : " als Mitglied " + esc(viewer.memberId)} – Änderungen bleiben nur in diesem Fenster.</span><a href="./${YEAR ? "?jahr=" + YEAR : ""}">Testmodus beenden</a></div>` : ""}
    <div class="hero">
      <div class="hero-left">
        <img class="hero-logo" src="../assets/logo.png" alt="">
        <div class="hero-titles">
          <span class="eyebrow">${YEAR ? `${ST.edition(YEAR)}. Ermatinger Minispieltag` : "Ermatinger Minispieltag"}</span>
          <h1 class="hero-title">Spieltag ${esc(YEAR || "")}</h1>
          <p class="hero-sub">${yearDoc ? esc([ST.fmtDate(yearDoc.date), yearDoc.place].filter(Boolean).join(" · ") || "Datum folgt") : ""}</p>
        </div>
      </div>
      ${yearDoc ? `<div class="hero-stats">
        <div class="stat-chip"><span class="num">${participants().length}</span><span class="lbl">Teilnehmende</span></div>
        <div class="stat-chip"><span class="num">${done}/${gs.length}</span><span class="lbl">Spiele fertig</span></div>
        ${started ? `<div class="stat-chip"><span class="num">${esc(ST.nameOf(ov.rows[0].pid))}</span><span class="lbl">führt</span></div>` : ""}
      </div>` : ""}
    </div>
    <div class="court-line"></div>
    <nav class="tabbar">${tabs.map(([k, l]) => `<button class="tabbtn ${activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav>
    <section class="panel" id="content"></section>
    <p class="footer-note">MST Ermatingen · Spieltag live · <a href="#tv">📺 TV-Ansicht</a></p>`;
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { mineFor = null; location.hash = b.dataset.tab; });
  const lb = document.getElementById("loginBtn");
  if(lb) lb.onclick = () => MST.showLogin("");
  const lo = document.getElementById("logoutBtn");
  if(lo) lo.onclick = () => MST.logout();

  const c = document.getElementById("content");
  if(!yearDoc && !["historie", "person", "jahr"].includes(r.view)){
    c.innerHTML = `<div class="card"><h3>Noch kein Spieltag angelegt</h3><p class="muted">${isAdmin() ? 'In der <a href="organisation/">Organisation</a> unter «Spieltage» einen neuen Spieltag anlegen.' : "Sobald der nächste Spieltag geplant ist, erscheint er hier."}</p></div>`;
    return;
  }
  if(r.view === "spiele") viewGames(c, ov);
  else if(r.view === "spiel") viewGame(c, r.arg, ov);
  else if(r.view === "zeitplan") viewSchedule(c, ov);
  else if(r.view === "ich") viewMine(c, ov);
  else if(r.view === "bier") viewBeer(c);
  else if(r.view === "historie") viewHistory(c);
  else if(r.view === "jahr") viewYear(c, r.arg);
  else if(r.view === "person") viewPerson(c, r.arg, ov);
  else viewOverall(c, ov);
}

/* ---------- Gesamtrangliste (vor dem Start: Startliste nach Startnummer) ---------- */
function sortedOverall(ov){
  const ch = champs();
  const started = dayStarted(ov);
  const rows = ov.rows.map(r => Object.assign({}, r, { nr:ST.startNr(r.pid, ch) }));
  if(!started) rows.sort((a, b) => ST.byStartNr(a.nr, b.nr));
  return { rows, started, ch };
}
function viewOverall(c, ov){
  const gs = games();
  const top = topCards(ov);
  if(!participants().length){ c.innerHTML = top + '<div class="card"><p class="muted">Noch keine Teilnehmenden eingetragen.</p></div>'; bindTopCards(); return; }
  const { rows, started, ch } = sortedOverall(ov);
  const me = myPid();
  const medal = r => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "";
  const body = rows.map(row => {
    const cells = gs.map(g => {
      const ev = ov.evals[g.id];
      const pts = ev.personPoints[row.pid];
      const unitRow = ev.rows.find(x => (x.members || []).includes(row.pid));
      if(pts == null || (!pts && !(unitRow && unitRow.rank))) return '<td class="num muted">–</td>';
      return `<td class="num ${unitRow && unitRow.final ? "" : "prov"}">${pts}</td>`;
    }).join("");
    return `<tr class="click ${started && row.rank === 1 ? "top1" : ""} ${row.pid === me ? "me" : ""}" data-pid="${esc(row.pid)}">
      <td class="pos">${started ? row.rank : esc(row.nr)}</td>
      <td class="who sticky"><span class="medal">${started ? medal(row.rank) : ""}</span>${esc(ST.nameOf(row.pid))}${ch.includes(row.pid) ? '<span class="champ">Titelverteidiger</span>' : ""}</td>${cells}<td class="total">${row.total}</td></tr>`;
  }).join("");
  c.innerHTML = top + `
    <div class="card">
      <div class="card-head"><h3>${started ? "Gesamtrangliste" : "Startliste"} ${esc(YEAR)}</h3><span><a class="btn-small" href="#tv" style="text-decoration:none">📺 TV-Ansicht</a>${isAdmin() ? ' <a class="btn-small" href="#siegerehrung" style="text-decoration:none">🏆 Siegerehrung</a>' : ""}</span></div>
      <p class="rule-note" style="margin:0 0 10px">${started
        ? "Graue, schräge Zahlen sind vorläufig (Spiel läuft noch – im K.o. sind es die schon sicheren Punkte)."
        : "Noch keine Resultate – sortiert nach Startnummer (Titelverteidiger = Nr. 1, sonst Vereins- bzw. Gästenummer). Sobald gespielt wird, sortiert die Liste nach Punkten."}</p>
      <div class="tbl-scroll"><table class="rank">
        <thead><tr><th>${started ? "#" : "Nr."}</th><th class="sticky">Name</th>${gs.map(g => `<th class="num gh" title="${esc(g.name)}"><a href="#spiel/${esc(g.id)}">${esc(g.icon || "")}<br>${esc(g.name)}</a></th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
  c.querySelectorAll("[data-pid]").forEach(tr => tr.onclick = () => { location.hash = "person/" + encodeURIComponent(tr.dataset.pid); });
  bindTopCards();
}

/* Karten oben: Anmeldung, Mein Spieltag, meine Stationen */
function topCards(ov){
  let html = "";
  const pid = myPid();
  // Selbst-Anmeldung
  if(viewer.memberId && yearDoc.signupOpen){
    const inList = pid && participants().includes(pid);
    const s = signups[viewer.memberId];
    html += `<div class="card"><h3>Anmeldung ${esc(YEAR)}</h3>
      <div class="big-next">${inList ? '<span class="ok">✓ Du bist dabei</span>' : s && s.status === "nein" ? "Du hast abgesagt" : "Bist du dabei?"}</div>
      <div class="small muted">${yearDoc.date ? esc(ST.fmtDate(yearDoc.date)) : "Datum folgt"}${yearDoc.place ? " · " + esc(yearDoc.place) : ""}</div>
      <div class="btn-row">
        ${inList ? "" : '<button class="btn-primary" id="signYes">Ich bin dabei</button>'}
        ${inList ? '<button class="btn-ghost" id="signNo">Ich kann doch nicht</button>' : s && s.status === "nein" ? "" : '<button class="btn-ghost" id="signNo">Ich kann nicht</button>'}
      </div></div>`;
  }
  // Mein Spieltag
  if(pid && participants().includes(pid) && games().length){
    const next = nextFor(pid, ov);
    const pts = (ov.rows.find(r => r.pid === pid) || {}).total || 0;
    html += `<div class="card"><h3>Mein Spieltag · ${esc(ST.nameOf(pid))}</h3>
      ${next ? `<div class="small muted">Dein nächstes Spiel${next.time != null ? " · ca. " + E.fmtTime(next.time) : ""}</div><div class="big-next">${nextText(next)}</div>`
             : `<div class="big-next">${dayStarted(ov) ? "Alles gespielt 🎉" : "Noch nichts ausgelost"}</div>`}
      <div class="small muted">${pts} Punkte bisher</div>
      <div class="btn-row"><a class="btn-small" href="#ich" style="text-decoration:none">Mein ganzer Tag →</a>
      ${!viewer.memberId ? '<button class="btn-small" id="notMe">nicht ich</button>' : ""}</div></div>`;
  } else if(!viewer.memberId && participants().length){
    html += `<div class="card"><h3>Mein Spieltag</h3><p class="small muted" style="margin:0 0 8px">Wähl deinen Namen – dann siehst du dein nächstes Spiel (bleibt auf diesem Handy gespeichert). Mitglieder können sich auch einloggen.</p>
      <select id="pickMe"><option value="">Ich bin …</option>${ST.sortByName(participants()).map(p => `<option value="${esc(p)}">${esc(ST.nameOf(p))}</option>`).join("")}</select></div>`;
  }
  // Stationsleitung
  if(viewer.memberId){
    const mine = games().filter(g => leadersOf(g.id).includes(viewer.memberId));
    if(mine.length) html += `<div class="card"><h3>Deine Stationen</h3><p class="small muted" style="margin:0 0 8px">Hier darfst du die Resultate eintragen.</p>
      ${mine.map(g => `<a class="btn-small" href="#spiel/${esc(g.id)}" style="text-decoration:none; display:inline-block; margin:0 6px 6px 0">${esc(g.icon || "")} ${esc(g.name)}</a>`).join("")}</div>`;
  }
  return html ? `<div class="top-cards">${html}</div>` : "";
}
function bindTopCards(){
  const y = document.getElementById("signYes"), n = document.getElementById("signNo");
  if(y) y.onclick = () => signup("ja");
  if(n) n.onclick = () => signup("nein");
  const pm = document.getElementById("pickMe");
  if(pm) pm.onchange = () => { try{ localStorage.setItem(LOCAL_ME, pm.value); }catch(e){} draw(); };
  const nm = document.getElementById("notMe");
  if(nm) nm.onclick = () => { try{ localStorage.removeItem(LOCAL_ME); }catch(e){} draw(); };
}
/* Mitglied hat noch keinen Spielnamen → Person für sich anlegen (Regeln erlauben das) */
async function ensureMyPerson(){
  let pid = ST.pidOfMember(viewer.memberId);
  if(pid) return pid;
  const d = MST.directory[viewer.memberId] || {};
  const name = d.short || (d.name || "").split(" ")[0] || viewer.memberId;
  await D.set(`spieltagPersons/${viewer.memberId}`, { name, memberId:viewer.memberId });
  ST.persons[viewer.memberId] = { name, memberId:viewer.memberId };
  return viewer.memberId;
}
async function signup(status){
  try{
    const pid = await ensureMyPerson();
    await D.set(`spieltag/${YEAR}/signups/${viewer.memberId}`, { pid, status, at:Date.now() });
    if(!D.test) MST.log("spieltag", `Spieltag ${YEAR}: ${status === "ja" ? "angemeldet" : "abgemeldet"}`);
  }catch(e){ console.error(e); alert("Hat nicht geklappt – ist die Anmeldung noch offen?"); }
}

/* ---------- «Mein Spieltag»: alle Spiele einer Person in zeitlicher Reihenfolge ---------- */
function agenda(pid, ov){
  const out = [];
  games().forEach((g, gi) => {
    const ev = ov.evals[g.id];
    const start = E.parseTime(g.start);
    const u = ev.units.find(x => (x.members || []).includes(pid));
    const base = { g, gi, unit:u, points:ev.personPoints[pid], final:ev.final };
    if(g.mode === "rangliste"){
      const row = u && (ev.view.rows || []).find(r => r.id === u.id);
      out.push(Object.assign(base, { kind:"station", time:start, done:!!(row && row.complete), row }));
    } else if(!ev.drawn || !u){
      out.push(Object.assign(base, { kind:"wait", time:start, done:false }));
    } else {
      const tl = E.timeline(g, ev);
      const mine = tl.items.filter(it => it.a === u.id || it.b === u.id);
      mine.forEach(it => out.push(Object.assign({}, base, { kind:"match", time:it.time, field:it.field, done:it.done, it, opp:it.a === u.id ? it.b : it.a, ev })));
      if(!mine.some(it => !it.done) && !ev.final){
        // im K.o. noch dabei, aber nächster Gegner noch offen
        const row = ev.rows.find(r => r.unitId === u.id);
        if(row && !row.final) out.push(Object.assign({}, base, { kind:"wait", time:tl.end, done:false, waiting:true }));
      }
    }
  });
  return out.sort((a, b) => (a.time == null ? 9999 : a.time) - (b.time == null ? 9999 : b.time) || a.gi - b.gi);
}
function nextFor(pid, ov){
  return agenda(pid, ov).find(x => !x.done && (x.kind === "station" || (x.kind === "match" && x.it.a && x.it.b))) || null;
}
function nextText(x){
  if(x.kind === "station") return `${esc(x.g.icon || "")} ${esc(x.g.name)}${x.g.place ? ` · <b>${esc(x.g.place)}</b>` : ""}`;
  const opp = x.opp ? ST.unitLabel(x.ev.units.find(u => u.id === x.opp)) : "offen";
  return `${esc(x.g.icon || "")} ${esc(x.g.name)} gegen <b>${esc(opp)}</b>${x.g.fields > 1 ? ` · Feld ${x.field}` : ""}${x.g.place ? " · " + esc(x.g.place) : ""}`;
}
function viewMine(c, ov){
  const pid = mineFor && ST.persons[mineFor] ? mineFor : myPid();
  const pick = `<select id="pickMe2" style="max-width:220px"><option value="">Ich bin …</option>${ST.sortByName(participants()).map(p => `<option value="${esc(p)}" ${p === pid ? "selected" : ""}>${esc(ST.nameOf(p))}</option>`).join("")}</select>`;
  if(!pid || !participants().includes(pid)){
    c.innerHTML = `<a class="back" href="#zeitplan">← Zeitplan</a><div class="card"><h3>Mein Spieltag</h3><p class="muted">Wähl deinen Namen:</p>${viewer.memberId ? '<p class="muted">Du bist noch nicht angemeldet.</p>' : pick}</div>`;
    const pm = document.getElementById("pickMe2");
    if(pm) pm.onchange = () => { mineFor = null; try{ localStorage.setItem(LOCAL_ME, pm.value); }catch(e){} draw(); };
    return;
  }
  const list = agenda(pid, ov);
  const next = nextFor(pid, ov);
  const total = (ov.rows.find(r => r.pid === pid) || {}).total || 0;
  c.innerHTML = `<a class="back" href="#zeitplan">← Zeitplan</a>
    <div class="game-head"><span class="gicon">🙋</span><div><h2>${esc(ST.nameOf(pid))}</h2><div class="sub">Startnummer ${esc(ST.startNr(pid, champs()))} · ${total} Punkte</div></div>
    ${!viewer.memberId ? `<span style="margin-left:auto">${pick}</span>` : ""}</div>
    ${next ? `<div class="notice"><span>Als Nächstes${next.time != null ? " (ca. " + E.fmtTime(next.time) + ")" : ""}: ${nextText(next)}</span></div>` : ""}
    <div class="card">${list.map(x => {
      const t = x.time != null ? E.fmtTime(x.time) : "–";
      let what = "", res = "";
      if(x.kind === "station"){
        what = x.g.place ? "Station · " + esc(x.g.place) : "Station";
        res = x.row && x.row.total != null ? `${x.row.total} ${esc(x.g.scoreLabel)}` : "";
      } else if(x.kind === "wait"){
        what = x.waiting ? "noch im Rennen – nächster Gegner offen" : "wird noch ausgelost";
      } else {
        const opp = x.opp ? ST.unitLabel(x.ev.units.find(u => u.id === x.opp)) : "Gegner offen";
        const mates = x.unit.members.filter(p => p !== pid).map(p => ST.nameOf(p));
        what = `${esc(x.it.label)} gegen <b>${esc(opp)}</b>${x.g.fields > 1 ? ` · Feld ${x.field}` : ""}${mates.length ? ` <span class="small muted">mit ${esc(mates.join(", "))}</span>` : ""}`;
        if(x.it.res){ const mineA = x.it.a === x.unit.id; const a = mineA ? x.it.res.sa : x.it.res.sb, b = mineA ? x.it.res.sb : x.it.res.sa; res = `${a > b ? "✓" : a < b ? "✗" : "="} ${a}:${b}`; }
      }
      return `<div class="tl-row click ${x.done ? "done" : ""}" data-game="${esc(x.g.id)}"><span class="tl-time">${t}</span><span>${esc(x.g.icon || "")}</span>
        <div><div class="tl-name">${esc(x.g.name)}</div><div class="sub">${what}</div></div><span class="small">${res}${x.final && x.points != null ? ` <b style="color:var(--yellow)">${x.points}</b>` : ""}</span></div>`;
    }).join("")}</div>`;
  c.querySelectorAll("[data-game]").forEach(el => el.onclick = () => { location.hash = "spiel/" + encodeURIComponent(el.dataset.game); });
  const pm = document.getElementById("pickMe2");
  if(pm) pm.onchange = () => { try{ localStorage.setItem(LOCAL_ME, pm.value); }catch(e){} draw(); };
}

/* ---------- Spiele-Übersicht ---------- */
function statusChip(ev){
  if(!ev.drawn) return '<span class="chip">nicht ausgelost</span>';
  if(ev.status === "fertig") return '<span class="chip done">fertig</span>';
  if(ev.status === "läuft") return `<span class="chip live">läuft ${ev.done}/${ev.total}</span>`;
  return '<span class="chip">bereit</span>';
}
function whenWhere(g){
  return [g.start ? g.start + " Uhr" : "", g.place, g.fields > 1 ? g.fields + " Felder" : ""].filter(Boolean).join(" · ");
}
function viewGames(c, ov){
  const gs = games();
  const n = participants().length;
  const byCat = { Einzel:[], Partner:[], Gruppe:[] };
  gs.forEach((g, i) => byCat[E.category(g)].push({ g, i }));
  const catNames = { Einzel:"Einzelwettkämpfe", Partner:"Partnerwettkämpfe", Gruppe:"Gruppenwettkämpfe" };
  let html = isAdmin() ? `<div class="notice"><span>Vor dem Spieltag: Spiele wechseln, Spielmodus und Teamgrösse wählen (✎), dann im Spiel auslosen. Zeiten und Orte: <a href="#zeitplan">Zeitplan</a>. Personen und Gäste: <a href="organisation/">Organisation</a>.</span></div>` : "";
  Object.entries(byCat).forEach(([cat, list]) => {
    if(!list.length) return;
    html += `<div class="cat-title">${catNames[cat]}</div><div class="games">`;
    list.forEach(({ g, i }) => {
      const ev = ov.evals[g.id];
      const leader = ev.drawn && ev.rows.length && ev.rows[0].points > 0 && ev.done > 0
        ? `<div class="gcard-lead">${ev.final ? "Sieger" : "vorne"}: <b>${esc(ST.unitLabel(ev.units.find(u => u.id === ev.rows[0].unitId)))}</b></div>` : "";
      const lead = leaderNames(g.id);
      html += `<div class="gcard" data-game="${esc(g.id)}">
        <div class="gcard-head"><span class="gcard-icon">${esc(g.icon || "🎲")}</span><span class="gcard-name">${esc(g.name)}</span>${statusChip(ev)}</div>
        <div class="gcard-sub">${esc(E.summary(g))}</div>
        <div class="gcard-sub">${esc(E.describeUnits(n, g))}${E.describeFormat(E.unitCountFor(n, g), g) ? " · " + esc(E.describeFormat(E.unitCountFor(n, g), g)) : ""}</div>
        ${whenWhere(g) || lead.length ? `<div class="gcard-sub">${esc(whenWhere(g))}${lead.length ? `${whenWhere(g) ? " · " : ""}Leitung: ${esc(lead.join(", "))}` : ""}</div>` : ""}
        ${leader}
        ${isAdmin() ? `<div class="gcard-admin">
          <button class="btn-small" data-up="${i}" ${i === 0 ? "disabled" : ""} title="nach oben">↑</button>
          <button class="btn-small" data-down="${i}" ${i === gs.length - 1 ? "disabled" : ""} title="nach unten">↓</button>
          <button class="btn-small" data-edit="${i}">✎ einstellen</button>
        </div>` : ""}
      </div>`;
    });
    html += `</div>`;
  });
  if(isAdmin()) html += `<div class="games" style="margin-top:12px;"><button class="add-game" id="addGame">+ Spiel hinzufügen</button></div>`;
  c.innerHTML = html;
  c.querySelectorAll("[data-game]").forEach(el => el.onclick = (e) => {
    if(e.target.closest("button")) return;
    location.hash = "spiel/" + encodeURIComponent(el.dataset.game);
  });
  if(!isAdmin()) return;
  c.querySelectorAll("[data-up]").forEach(b => b.onclick = () => moveGame(+b.dataset.up, -1));
  c.querySelectorAll("[data-down]").forEach(b => b.onclick = () => moveGame(+b.dataset.down, 1));
  c.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editGame(+b.dataset.edit));
  document.getElementById("addGame").onclick = addGame;
}
async function saveGames(list){
  await D.merge(`spieltag/${YEAR}`, { games:list.map(g => JSON.parse(JSON.stringify(g))) });
}
async function moveGame(i, d){
  const list = (yearDoc.games || []).slice();
  const j = i + d;
  if(j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await saveGames(list);
}
/* Auslosung + Resultate löschen, Stationsleitung behalten */
async function clearGame(id){
  const l = leadersOf(id);
  if(l.length) await D.set(gamePath(id), { leaders:l });
  else await D.remove(gamePath(id));
}
function editGame(i){
  const list = (yearDoc.games || []).slice();
  const old = list[i];
  const hasDraw = !!(gameData[old.id] && (gameData[old.id].units || []).length || Object.keys((gameData[old.id] || {}).scores || {}).length);
  GameDialog.open(old, {
    title:`${old.name} einstellen`, catalog, participants:participants().length, allowCatalogPick:true,
    warn: hasDraw ? "Schon ausgelost: Änderungen an Teamgrösse oder Modus löschen Auslosung und Resultate dieses Spiels." : "",
    onSave: async (g) => {
      if(hasDraw && GameDialog.structuralChange(old, g)){
        if(!confirm("Teamgrösse/Modus geändert – Auslosung und Resultate dieses Spiels werden gelöscht. Weiter?")) return false;
        await clearGame(old.id);
      }
      // Zeit/Ort bleiben beim Wechsel der Disziplin erhalten
      list[i] = Object.assign({}, g, { id:old.id, start:old.start || "", place:old.place || "", fields:old.fields || 1, matchMinutes:old.matchMinutes || g.matchMinutes || 10 });
      await saveGames(list);
    },
    onDelete: async () => {
      await D.remove(gamePath(old.id));
      list.splice(i, 1);
      await saveGames(list);
    }
  });
}
function addGame(){
  const used = new Set((yearDoc.games || []).map(g => g.catId || g.id));
  const first = catalog.find(c => !used.has(c.id)) || catalog[0] || { name:"Neues Spiel" };
  GameDialog.open(Object.assign({}, first, { catId:first.id }), {
    title:"Spiel hinzufügen", catalog, participants:participants().length, allowCatalogPick:true,
    onSave: async (g) => {
      const list = (yearDoc.games || []).slice();
      let id = ST.slug(g.catId || g.name), k = 2;
      while(list.some(x => x.id === id)) id = ST.slug(g.catId || g.name) + "_" + k++;
      list.push(Object.assign({}, g, { id }));
      await saveGames(list);
    }
  });
}

/* ---------- Ein Spiel ---------- */
function viewGame(c, id, ov){
  const g = games().find(x => x.id === id);
  if(!g){ c.innerHTML = '<a class="back" href="#spiele">← alle Spiele</a><div class="card"><p class="muted">Dieses Spiel gibt es nicht (mehr).</p></div>'; return; }
  const ev = ov.evals[g.id];
  const data = gameData[g.id] || {};
  const solo = E.isSolo(g);
  const n = participants().length;
  const needsDraw = !(solo && g.mode === "rangliste");
  const hasResults = Object.values(data.matches || {}).some(m => m && m.sa != null) || Object.keys(data.scores || {}).length > 0;
  const lead = leaderNames(g.id);
  const tl = ev.drawn ? E.timeline(g, ev) : null;
  let html = `<a class="back" href="#spiele">← alle Spiele</a>
    <div class="game-head"><span class="gicon">${esc(g.icon || "🎲")}</span>
      <div><h2>${esc(g.name)}</h2><div class="sub">${esc(E.summary(g))} · max. ${g.maxPoints} Punkte</div>
      <div class="sub">${esc(E.describeUnits(n, g))}${ev.drawn && E.describeFormat(ev.units.length, g) ? " · " + esc(E.describeFormat(ev.units.length, g)) : ""}</div>
      ${whenWhere(g) || lead.length ? `<div class="sub">${esc(whenWhere(g))}${tl && tl.end != null && tl.items.length ? ` – ca. ${E.fmtTime(tl.end)}` : ""}${lead.length ? `${whenWhere(g) ? " · " : ""}Stationsleitung: ${esc(lead.join(", "))}` : ""}</div>` : ""}</div>
      <span style="margin-left:auto">${statusChip(ev)}</span></div>`;

  if(isAdmin()){
    html += `<div class="admin-bar">
      ${needsDraw ? `<button class="btn-primary" id="drawBtn">${ev.drawn ? "Neu auslosen" : "Auslosen"}</button>
        <select id="drawMode" class="season-select" style="margin:0">
          <option value="zufall" ${g.draw !== "stark" ? "selected" : ""}>zufällig, neue Partner</option>
          <option value="stark" ${g.draw === "stark" ? "selected" : ""}>ausgeglichen (Historie)</option>
        </select>` : ""}
      ${ev.drawn && needsDraw && !solo ? `<button class="btn-ghost" id="teamsBtn">${editTeams[g.id] ? "Teams fertig" : "Teams anpassen"}</button>` : ""}
      <button class="btn-ghost" id="cfgBtn">✎ Einstellen</button>
      <button class="btn-ghost" id="leadBtn">👤 Stationsleitung</button>
      ${ev.drawn && (hasResults || needsDraw) ? `<button class="btn-ghost" id="resetBtn">Zurücksetzen</button>` : ""}
      ${D.test && ev.drawn && ev.status !== "fertig" ? `<button class="btn-ghost" id="simBtn">🎲 Zufallsresultate</button>` : ""}
    </div>`;
    if(msg){ html += `<div class="notice"><span>${esc(msg)}</span></div>`; msg = ""; }
    if(ev.drawn && needsDraw){
      const inUnits = new Set((data.units || []).flatMap(u => u.members));
      const fresh = participants().filter(p => !inUnits.has(p));
      const gone = [...inUnits].filter(p => !participants().includes(p));
      if(fresh.length){
        html += `<div class="notice"><span>Neu dabei und noch nicht eingeteilt: <b>${esc(fresh.map(p => ST.nameOf(p)).join(", "))}</b></span>
          ${!solo ? `<button class="btn-small" id="addLateBtn">in die kleinsten Teams einteilen</button>`
            : hasResults ? `<span class="small">Schon Resultate eingetragen – nur mit «Neu auslosen» möglich.</span>` : `<button class="btn-small" id="redrawLate">neu auslosen</button>`}</div>`;
      }
      if(gone.length){
        html += `<div class="notice red"><span>Nicht mehr angemeldet: <b>${esc(gone.map(p => ST.nameOf(p)).join(", "))}</b></span>
          ${!solo ? `<button class="btn-small" id="rmGoneBtn">aus den Teams nehmen</button>` : ""}</div>`;
      }
    }
  } else if(isLeader(g)){
    html += `<div class="notice"><span>👤 Du leitest diese Station – Resultate kannst du direkt eintragen.</span></div>`;
  } else if(canEnter(g)){
    html += `<div class="notice"><span>✍️ Resultate eintragen ist für alle Mitglieder offen. Jede Änderung wird mit deinem Namen protokolliert.</span></div>`;
  } else if(!viewer.memberId && entryOpen()){
    html += `<div class="notice"><span>Resultate eintragen kannst du nach dem <a href="#" onclick="MST.showLogin('');return false;">Login</a> (Nummer + Vorname).</span></div>`;
  }

  if(!ev.drawn){
    html += `<div class="card"><p class="muted">${isAdmin() ? "Noch nicht ausgelost. Oben auf «Auslosen» tippen – Teams, Gruppen und Spielplan entstehen automatisch, auch bei ungerader Anzahl." : "Wird noch ausgelost."}</p></div>`;
    c.innerHTML = html; bindGame(g, ev, data); return;
  }

  const me = myPid();
  if(!solo){
    const edit = isAdmin() && editTeams[g.id];
    const canName = u => isAdmin() || isLeader(g) || (!!viewer.memberId && u.members.includes(me) && entryOpen());
    html += `<div class="card"><h3>Teams</h3><div class="units">${ev.units.map(u => `
      <div class="unit ${u.members.includes(me) ? "mine" : ""}"><div class="unit-name">${esc(u.teamName || u.name || "Team")} <small>${u.members.length}er</small>
        ${canName(u) ? `<button class="link-btn" data-tname="${esc(u.id)}" title="Teamname ändern" style="font-size:11px; padding:0 4px">✎</button>` : ""}</div>
        ${u.members.map(p => `<div class="unit-m"><span>${esc(ST.nameOf(p))}</span>${edit ? `<select data-move="${esc(p)}" data-from="${esc(u.id)}">
          <option value="">verschieben …</option>${ev.units.filter(x => x.id !== u.id).map(x => `<option value="${esc(x.id)}">→ ${esc(x.name)}</option>`).join("")}</select>` : ""}</div>`).join("")}
      </div>`).join("")}</div>
      ${edit ? '<p class="rule-note" style="margin:10px 0 0">Person in ein anderes Team verschieben. Gespielte Resultate bleiben beim Team.</p>' : ""}</div>`;
  }

  html += materialCard(g);
  // Alle Partien, bei denen beide Gegner feststehen – praktisch auf dem Handy
  if(g.mode !== "rangliste" && ev.status !== "fertig"){
    const open = tl.items.filter(it => it.a && it.b && !it.done);
    if(open.length) html += `<div class="card" style="margin:12px 0"><h3>Jetzt spielbar (${open.length})</h3>
      ${open.map(m => matchRow(g, ev, Object.assign({ res:null }, m), m.key.startsWith("K") || m.key.startsWith("PL"), m)).join("")}</div>`;
  }
  if(g.mode === "rangliste") html += rangView(g, ev, data);
  else if(g.mode === "ko") html += `<div class="card"><h3>K.o.-Raster</h3>${bracketView(g, ev.view.bracket, ev)}</div>`;
  else if(g.mode === "gruppen_ko") html += groupsView(g, ev);
  else if(g.mode === "liga") html += ligaView(g, ev);

  if(g.mode !== "rangliste") html += placementTable(g, ev);
  c.innerHTML = html;
  bindGame(g, ev, data);
}

/* Material & Helfer der Station (Material aus den Spieleinstellungen, abhaken: Admin + Stationsleitung) */
function materialCard(g){
  const items = String(g.material || "").split("\n").map(x => x.trim()).filter(Boolean);
  const lead = leaderNames(g.id);
  if(!items.length && !lead.length && !isAdmin()) return "";
  const done = (gameData[g.id] || {}).materialDone || {};
  const can = isAdmin() || isLeader(g);
  return `<div class="card" style="margin:12px 0"><h3>Material & Helfer</h3>
    <p class="small muted" style="margin:0 0 6px">${lead.length ? "Stationsleitung: <b>" + esc(lead.join(", ")) + "</b>" : "Noch keine Stationsleitung."}${g.place ? " · " + esc(g.place) : ""}${g.start ? " · ab " + esc(g.start) : ""}</p>
    ${items.length ? items.map((it, i) => `<label class="drinker ${done[i] ? "on" : ""}" style="margin:0 6px 6px 0"><input type="checkbox" data-mat="${i}" ${done[i] ? "checked" : ""} ${can ? "" : "disabled"}>${esc(it)}${done[i] ? ` <span class="small muted">✓ ${esc(done[i])}</span>` : ""}</label>`).join("")
      : `<p class="small muted">${isAdmin() ? "Material unter «✎ Einstellen» eintragen (eine Zeile pro Posten)." : ""}</p>`}</div>`;
}
function unitById(ev, id){ return ev.units.find(u => u.id === id); }
function label(ev, id){ return id ? ST.unitLabel(unitById(ev, id)) : ""; }

function rangView(g, ev, data){
  const rows = ev.view.rows || [];
  const place = {}; ev.rows.forEach(r => place[r.unitId] = r);
  const edit = canEnter(g);
  const list = edit
    ? (E.isSolo(g) ? ST.sortByName(rows.map(r => r.id)).map(id => rows.find(r => r.id === id)) : rows)
    : rows.slice().sort((a, b) => ((place[a.id] || {}).rank || 999) - ((place[b.id] || {}).rank || 999));
  const head = Array.from({ length:g.entries }, (_, i) => `<th class="num">${g.entries > 1 ? (i + 1) + "." : esc(g.scoreLabel)}</th>`).join("");
  const me = myPid();
  const body = list.map(r => {
    const p = place[r.id] || {};
    const cells = Array.from({ length:g.entries }, (_, i) => {
      const v = r.vals[i];
      return edit
        ? `<td class="num"><input inputmode="decimal" data-score="${esc(r.id)}" data-i="${i}" value="${v == null ? "" : v}"></td>`
        : `<td class="num">${v == null ? '<span class="muted">–</span>' : v}</td>`;
    }).join("");
    const mine = (unitById(ev, r.id) || { members:[] }).members.includes(me);
    return `<tr class="${p.rank === 1 ? "top1" : ""} ${mine ? "me" : ""}"><td class="pos">${p.rank || ""}</td><td class="who">${esc(label(ev, r.id))}</td>${cells}
      ${g.entries > 1 ? `<td class="num">${r.total == null ? "" : r.total}</td>` : ""}<td class="total ${p.final ? "" : "prov"}">${p.points != null && r.total != null ? p.points : ""}</td></tr>`;
  }).join("");
  return `<div class="card"><h3>${edit ? "Resultate eintragen" : "Rangliste"}</h3>
    <p class="rule-note">${esc(g.scoreLabel)}: ${g.scoreDir === "asc" ? "weniger ist besser" : "mehr ist besser"}${g.entries > 1 ? ` · ${g.entries} Durchgänge, zählt die Summe` : ""}${edit ? " · speichert beim Verlassen des Feldes" : ""}</p>
    <div class="tbl-scroll"><table class="rank"><thead><tr><th>#</th><th>${E.isSolo(g) ? "Name" : "Team"}</th>${head}${g.entries > 1 ? '<th class="num">Total</th>' : ""}<th class="num">Pkt</th></tr></thead>
    <tbody>${body}</tbody></table></div></div>`;
}

function matchRow(g, ev, m, noDraw, slot){
  const res = m.res;
  const wa = res && res.sa > res.sb, wb = res && res.sb > res.sa;
  const edit = canEnter(g);
  let mid;
  if(edit && g.resultType === "winner"){
    mid = `<div class="score"><button class="wbtn ${wa ? "win" : ""}" data-gid="${esc(g.id)}" data-win="a" data-key="${m.key}" data-a="${esc(m.a)}" data-b="${esc(m.b)}">◀</button>
      <span class="res ${res ? "" : "open"}">${res ? "Sieg" : "vs"}</span>
      <button class="wbtn ${wb ? "win" : ""}" data-gid="${esc(g.id)}" data-win="b" data-key="${m.key}" data-a="${esc(m.a)}" data-b="${esc(m.b)}">▶</button></div>`;
  } else if(edit){
    mid = `<div class="score" data-gid="${esc(g.id)}" data-match="${m.key}" data-a="${esc(m.a)}" data-b="${esc(m.b)}" data-nodraw="${noDraw ? 1 : 0}">
      <input inputmode="numeric" data-side="a" value="${res ? res.sa : ""}"> : <input inputmode="numeric" data-side="b" value="${res ? res.sb : ""}"></div>`;
  } else {
    mid = `<div class="score"><span class="res ${res ? "" : "open"}">${res ? (g.resultType === "winner" ? "✓" : res.sa + " : " + res.sb) : "vs"}</span></div>`;
  }
  const meta = slot ? [slot.label, g.fields > 1 ? "Feld " + slot.field : "", slot.time != null ? "ca. " + E.fmtTime(slot.time) : ""].filter(Boolean).join(" · ") : "";
  return `<div class="match"><span class="ma ${wa ? "win" : wb ? "lose" : ""}">${esc(label(ev, m.a))}</span>${mid}<span class="mb ${wb ? "win" : wa ? "lose" : ""}">${esc(label(ev, m.b))}</span>${meta ? `<span class="match-meta">${esc(meta)}</span>` : ""}</div>`;
}

function groupsView(g, ev){
  const letters = "ABCDEFGHIJKL";
  let html = `<div class="split">`;
  ev.view.groups.forEach((gr, gi) => {
    const q = g.qualifiers;
    const rounds = [...new Set(gr.games.map(m => m.round))];
    html += `<div class="card"><h3>Gruppe ${letters[gi] || gi + 1}</h3>
      <div class="tbl-scroll"><table class="rank"><thead><tr><th>#</th><th>Team</th><th class="num">Sp</th><th class="num">Diff</th><th class="num">Pkt</th></tr></thead><tbody>
      ${gr.table.map((row, pos) => `<tr class="${pos < q ? "top1" : ""}"><td class="pos">${row.rank}</td><td class="who">${esc(label(ev, row.id))}</td><td class="num">${row.played}</td><td class="num">${row.diff > 0 ? "+" : ""}${row.diff}</td><td class="num">${row.pts}</td></tr>`).join("")}
      </tbody></table></div>
      ${rounds.map(r => `<div class="round-title">Runde ${r + 1}${gr.byes[r] ? ` · frei: ${esc(label(ev, gr.byes[r]))}` : ""}</div>` + gr.games.filter(m => m.round === r).map(m => matchRow(g, ev, m, false)).join("")).join("")}
    </div>`;
  });
  html += `</div>`;
  html += `<div class="card" style="margin-top:12px"><h3>K.o.-Phase</h3>${ev.view.bracket
    ? bracketView(g, ev.view.bracket, ev)
    : `<p class="muted">Startet automatisch, sobald alle Gruppenspiele eingetragen sind (${ev.view.qualCount} Teams kommen weiter).</p>`}</div>`;
  return html;
}

function ligaView(g, ev){
  const v = ev.view;
  let html = `<div class="split"><div class="card"><h3>Tabelle</h3><div class="tbl-scroll"><table class="rank">
    <thead><tr><th>#</th><th>Team</th><th class="num">Sp</th><th class="num">S</th><th class="num">U</th><th class="num">N</th><th class="num">Diff</th><th class="num">Pkt</th></tr></thead><tbody>
    ${v.table.map(r => `<tr class="${r.rank === 1 ? "top1" : ""}"><td class="pos">${r.rank}</td><td class="who">${esc(label(ev, r.id))}</td><td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.draw}</td><td class="num">${r.lost}</td><td class="num">${r.diff > 0 ? "+" : ""}${r.diff}</td><td class="num">${r.pts}</td></tr>`).join("")}
    </tbody></table></div><p class="rule-note" style="margin:8px 0 0">Sieg 3, Unentschieden 1, Niederlage 0 · bei Gleichstand zählt die Differenz.</p></div>
    <div class="card"><h3>Spiele</h3>
    ${v.rounds.map((rd, ri) => `<div class="round-title">Runde ${ri + 1}${rd.bye ? ` · frei: ${esc(label(ev, rd.bye))}` : ""}</div>` + v.games.filter(m => m.round === ri).map(m => matchRow(g, ev, m, false)).join("")).join("")}
    </div></div>`;
  if(v.placement){
    html += `<div class="card" style="margin-top:12px"><h3>Platzierungsspiele</h3>
      ${v.placement.map(m => `<div class="round-title">um Platz ${m.places[0]} / ${m.places[1]}</div>` + (m.ready ? matchRow(g, ev, m, true) : `<p class="muted small">nach der letzten Runde</p>`)).join("")}</div>`;
  }
  return html;
}

function bracketView(g, br, ev){
  if(!br || !br.rounds.length) return br && br.champion ? `<p>Sieger: <b>${esc(label(ev, br.champion))}</b></p>` : '<p class="muted">Zu wenige Teams.</p>';
  const edit = canEnter(g);
  const slot = (m, side) => {
    const id = side === "a" ? m.a : m.b;
    const res = m.res;
    if(id === undefined) return `<div class="bslot tbd"><span class="nm">offen</span></div>`;
    if(id === null) return `<div class="bslot tbd"><span class="nm">Freilos</span></div>`;
    const cls = m.winner === id ? "win" : (m.winner !== undefined && m.winner !== null && !m.bye) ? "lose" : "";
    let right = "";
    const playable = m.a && m.b && !m.bye;
    if(playable && edit){
      right = g.resultType === "winner"
        ? `<button class="wbtn ${m.winner === id ? "win" : ""}" data-win="${side}" data-key="${m.key}" data-a="${esc(m.a)}" data-b="${esc(m.b)}">Sieg</button>`
        : `<input inputmode="numeric" data-bm="${m.key}" data-side="${side}" value="${res ? (side === "a" ? res.sa : res.sb) : ""}">`;
    } else if(playable && res){
      right = `<span class="sc">${g.resultType === "winner" ? (m.winner === id ? "✓" : "") : (side === "a" ? res.sa : res.sb)}</span>`;
    }
    return `<div class="bslot ${cls}"><span class="nm">${esc(label(ev, id))}</span>${right}</div>`;
  };
  const box = m => `<div class="bmatch ${m.bye ? "bye" : ""}" ${m.a && m.b && !m.bye ? `data-bmatch="${m.key}" data-a="${esc(m.a)}" data-b="${esc(m.b)}"` : ""}>${slot(m, "a")}${slot(m, "b")}</div>`;
  let html = `<div class="bracket">`;
  br.rounds.forEach(r => {
    if(r.matches.every(m => m.bye)) return;
    html += `<div class="bcol"><div class="bcol-title">${esc(r.label)}</div>${r.matches.map(box).join("")}</div>`;
  });
  if(br.third) html += `<div class="bcol"><div class="bcol-title">um Platz 3</div>${box(br.third)}</div>`;
  html += `</div>`;
  if(br.champion) html += `<p style="margin:10px 0 0">🏆 Sieger: <b style="color:var(--yellow)">${esc(label(ev, br.champion))}</b></p>`;
  return html;
}

function placementTable(g, ev){
  const rows = ev.rows.filter(r => r.points > 0 || r.rank);
  if(!rows.length) return "";
  return `<div class="card" style="margin-top:12px"><h3>${ev.final ? "Schlussrangliste" : "Stand & sichere Punkte"}</h3>
    <div class="tbl-scroll"><table class="rank"><thead><tr><th>#</th><th>${E.isSolo(g) ? "Name" : "Team"}</th><th>Stufe</th><th class="num">Punkte</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.rank === 1 ? "top1" : ""}"><td class="pos">${r.rank || ""}</td><td class="who">${esc(ST.unitLabel(unitById(ev, r.unitId)))}${!E.isSolo(g) && r.members.length > 3 ? `<div class="small muted">${esc(r.members.map(p => ST.nameOf(p)).join(", "))}</div>` : ""}</td>
      <td class="small muted">${esc(r.label || "")}</td><td class="total ${r.final ? "" : "prov"}">${r.points}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

/* ---------- Aktionen im Spiel ---------- */
function bindGame(g, ev, data){
  const $ = id => document.getElementById(id);
  if(isAdmin()){
    if($("cfgBtn")) $("cfgBtn").onclick = () => editGame((yearDoc.games || []).findIndex(x => x.id === g.id));
    if($("leadBtn")) $("leadBtn").onclick = () => editLeaders(g);
    if($("drawBtn")) $("drawBtn").onclick = () => doDraw(g, $("drawMode").value);
    if($("redrawLate")) $("redrawLate").onclick = () => doDraw(g, $("drawMode") ? $("drawMode").value : g.draw, true);
    if($("teamsBtn")) $("teamsBtn").onclick = () => { editTeams[g.id] = !editTeams[g.id]; draw(); };
    if($("resetBtn")) $("resetBtn").onclick = async () => {
      if(!confirm(`Auslosung und alle Resultate von «${g.name}» löschen?`)) return;
      await clearGame(g.id);
    };
    if($("simBtn")) $("simBtn").onclick = async () => { await D.set(gamePath(g.id), E.simulate(g, data, ctx())); };
    if($("addLateBtn")) $("addLateBtn").onclick = async () => {
      const units = JSON.parse(JSON.stringify(data.units));
      const inUnits = new Set(units.flatMap(u => u.members));
      participants().filter(p => !inUnits.has(p)).forEach(p => {
        const min = Math.min(...units.map(u => u.members.length));
        const cands = units.filter(u => u.members.length === min);
        cands[Math.floor(Math.random() * cands.length)].members.push(p);
      });
      await D.merge(gamePath(g.id), { units });
    };
    if($("rmGoneBtn")) $("rmGoneBtn").onclick = async () => {
      const units = JSON.parse(JSON.stringify(data.units)).map(u => Object.assign(u, { members:u.members.filter(p => participants().includes(p)) }));
      const empty = units.filter(u => !u.members.length);
      if(empty.length && !confirm(`${empty.map(u => u.name).join(", ")} wäre leer und fällt weg (zählt als verloren). Weiter?`)) return;
      await D.merge(gamePath(g.id), { units:units.filter(u => u.members.length) });
    };
    document.querySelectorAll("[data-move]").forEach(sel => sel.onchange = async () => {
      if(!sel.value) return;
      const units = JSON.parse(JSON.stringify(data.units));
      const from = units.find(u => u.id === sel.dataset.from), to = units.find(u => u.id === sel.value);
      from.members = from.members.filter(p => p !== sel.dataset.move);
      to.members.push(sel.dataset.move);
      sel.blur();
      await D.merge(gamePath(g.id), { units:units.filter(u => u.members.length) });
    });
  }
  document.querySelectorAll("[data-mat]").forEach(cb => cb.onchange = async () => {
    const who = (MST.user && (MST.user.short || MST.user.name)) || "Admin";
    await D.merge(gamePath(g.id), { materialDone:{ [cb.dataset.mat]:cb.checked ? who : null } });
  });
  document.querySelectorAll("[data-tname]").forEach(b => b.onclick = async () => {
    const u = (data.units || []).find(x => x.id === b.dataset.tname);
    const name = prompt("Teamname:", u.teamName || "");
    if(name === null) return;
    const clean = name.trim().slice(0, 40);
    await writeResult(g, { teamNames:{ [u.id]:clean || null } }, `${g.name}: Teamname ${u.name}`, u.teamName || null, clean || null);
  });
  if(!canEnter(g)) return;
  document.querySelectorAll("[data-score]").forEach(inp => inp.onchange = async () => {
    const uid = inp.dataset.score, i = +inp.dataset.i;
    const arr = ((data.scores || {})[uid] || []).slice();
    while(arr.length < g.entries) arr.push(null);
    const v = inp.value.trim().replace(",", ".");
    if(v !== "" && isNaN(Number(v))){ inp.value = ""; return; }
    arr[i] = v === "" ? null : Number(v);
    const before = ((data.scores || {})[uid] || []).filter(x => x != null).join("+") || null;
    data.scores = Object.assign({}, data.scores, { [uid]:arr });
    await writeResult(g, { scores:{ [uid]:arr } }, `${g.name}: ${label(ev, uid)}`, before, arr.filter(x => x != null).join("+") || null);
  });
  document.querySelectorAll("[data-match]").forEach(box => box.querySelectorAll("input").forEach(inp => inp.onchange = () => {
    const [ia, ib] = box.querySelectorAll("input");
    saveMatch(g, ev, box.dataset.match, box.dataset.a, box.dataset.b, ia.value, ib.value, box.dataset.nodraw === "1");
  }));
  document.querySelectorAll("[data-bmatch]").forEach(box => {
    box.querySelectorAll("input[data-bm]").forEach(inp => inp.onchange = () => {
      const a = box.querySelector('input[data-side="a"]'), b = box.querySelector('input[data-side="b"]');
      saveMatch(g, ev, box.dataset.bmatch, box.dataset.a, box.dataset.b, a.value, b.value, true);
    });
  });
  document.querySelectorAll("[data-win]").forEach(btn => btn.onclick = async () => {
    const key = btn.dataset.key, cur = (data.matches || {})[key];
    const aWins = btn.dataset.win === "a";
    const same = cur && cur.a === btn.dataset.a && cur.b === btn.dataset.b && cur.sa != null && ((cur.sa > cur.sb) === aWins);
    await writeResult(g, { matches:{ [key]:{ a:btn.dataset.a, b:btn.dataset.b, sa:same ? null : (aWins ? 1 : 0), sb:same ? null : (aWins ? 0 : 1), at:Date.now() } } },
      `${g.name}: ${label(ev, btn.dataset.a)} – ${label(ev, btn.dataset.b)}`, prevMatch(g, key), same ? null : "Sieg " + label(ev, aWins ? btn.dataset.a : btn.dataset.b));
  });
}
async function writeResult(g, patch, text, before, after){
  try{
    await D.merge(gamePath(g.id), patch);
    if(!D.test && MST.user) MST.log("spieltag", text, { game:g.id, before:before == null ? null : String(before), after:after == null ? null : String(after) });
  }catch(e){ console.error(e); alert("Speichern hat nicht geklappt – bist du noch eingeloggt? (Resultate eintragen geht nur, solange sie offen sind.)"); }
}
const prevMatch = (g, key) => { const m = ((gameData[g.id] || {}).matches || {})[key]; return m && m.sa != null ? `${m.sa}:${m.sb}` : null; };
async function saveMatch(g, ev, key, a, b, va, vb, noDraw){
  va = String(va).trim(); vb = String(vb).trim();
  const what = `${g.name}: ${label(ev, a)} – ${label(ev, b)}`;
  if(va === "" && vb === ""){ await writeResult(g, { matches:{ [key]:{ a, b, sa:null, sb:null, at:Date.now() } } }, what, prevMatch(g, key), null); return; }
  if(va === "" || vb === "") return;
  const sa = Number(va), sb = Number(vb);
  if(isNaN(sa) || isNaN(sb)) return;
  if(noDraw && sa === sb){ alert("Unentschieden geht hier nicht – es braucht einen Sieger."); return; }
  await writeResult(g, { matches:{ [key]:{ a, b, sa, sb, at:Date.now() } } }, what, prevMatch(g, key), `${sa}:${sb}`);
}
async function doDraw(g, mode, silent){
  const data = gameData[g.id];
  const hasResults = data && (Object.values(data.matches || {}).some(m => m && m.sa != null) || Object.keys(data.scores || {}).length);
  if(hasResults && !confirm(`«${g.name}» neu auslosen? Alle Resultate dieses Spiels werden gelöscht.`)) return;
  if(!hasResults && data && (data.units || []).length && !silent && !confirm(`«${g.name}» neu auslosen?`)) return;
  const ids = participants();
  if(ids.length < 2 || E.unitCountFor(ids.length, g) < 2){ alert("Zu wenige Teilnehmende für dieses Spiel."); return; }
  const others = games().filter(x => x.id !== g.id).map(x => gameData[x.id]).filter(Boolean);
  const d = E.drawGame(g, ids, { mode, strength, pairs:E.pairHistory(others) });
  d.leaders = leadersOf(g.id);
  if(!E.isSolo(g)){
    const before = E.pairHistory(others);
    const repeats = Object.keys(E.pairHistory([d])).filter(k => before[k]).length;
    if(repeats) msg = `${repeats} Paarung${repeats > 1 ? "en" : ""} gab es heute schon in einem anderen Spiel${mode === "zufall" ? " (ging nicht ganz ohne)" : ""}.`;
  }
  await D.set(gamePath(g.id), d);
}
/* Stationsleitung: welche Mitglieder dürfen bei diesem Spiel Resultate eintragen? */
function editLeaders(g){
  const cur = new Set(leadersOf(g.id));
  const members = ST.sortByName(Object.keys(ST.persons).filter(p => ST.persons[p].memberId));
  const parts = new Set(participants());
  let dlg = document.getElementById("leadDlg");
  if(!dlg){ dlg = document.createElement("dialog"); dlg.id = "leadDlg"; dlg.className = "game-dlg"; document.body.appendChild(dlg); }
  const item = p => `<label class="drinker ${cur.has(ST.persons[p].memberId) ? "on" : ""}"><input type="checkbox" value="${esc(ST.persons[p].memberId)}" ${cur.has(ST.persons[p].memberId) ? "checked" : ""}>${esc(ST.nameOf(p))}</label>`;
  dlg.innerHTML = `<form method="dialog"><h3>Stationsleitung ${esc(g.name)}</h3>
    <p class="dlg-sub">Diese Mitglieder dürfen nach dem Login hier Resultate eintragen (nicht auslosen oder umstellen). Gäste brauchen ein Mitglied als Leitung.</p>
    <div class="drinkers">${members.filter(p => parts.has(p)).map(item).join("")}</div>
    <details><summary class="small muted">weitere Mitglieder (nicht angemeldet)</summary><div class="drinkers">${members.filter(p => !parts.has(p)).map(item).join("")}</div></details>
    <div class="dlg-actions"><span></span><div class="right"><button type="button" class="btn-ghost" id="lCancel">Abbrechen</button><button class="btn-primary" type="submit">Speichern</button></div></div></form>`;
  dlg.querySelectorAll("input[type=checkbox]").forEach(cb => cb.onchange = () => cb.closest("label").classList.toggle("on", cb.checked));
  dlg.querySelector("#lCancel").onclick = () => dlg.close();
  dlg.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const leaders = [...dlg.querySelectorAll("input:checked")].map(cb => cb.value);
    await D.merge(gamePath(g.id), { leaders });
    dlg.close();
  };
  dlg.showModal();
}

/* ---------- Zeitplan ---------- */
function scheduleRows(ov){
  return games().map((g, gi) => {
    const ev = ov.evals[g.id];
    const tl = E.timeline(g, ev);
    return { g, gi, ev, tl, start:E.parseTime(g.start) };
  }).sort((a, b) => (a.start == null ? 9999 : a.start) - (b.start == null ? 9999 : b.start) || a.gi - b.gi);
}
function upcoming(ov, limit){
  const list = [];
  games().forEach(g => {
    const ev = ov.evals[g.id];
    if(!ev.drawn || g.mode === "rangliste") return;
    E.timeline(g, ev).items.filter(it => it.a && it.b && !it.done).forEach(it => list.push({ g, ev, it }));
  });
  return list.sort((x, y) => (x.it.time == null ? 9999 : x.it.time) - (y.it.time == null ? 9999 : y.it.time)).slice(0, limit || 12);
}
function programRows(){
  return String((yearDoc && yearDoc.program) || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^(\d{1,2}[:.]\d{2})\s+(.*)$/.exec(l);
    return m ? { start:E.parseTime(m[1]), text:m[2] } : { start:null, text:l };
  });
}
function viewSchedule(c, ov){
  const rows = scheduleRows(ov);
  const prog = programRows();
  const timeline = rows.map(x => ({ t:x.start, x })).concat(prog.map(p => ({ t:p.start, p })))
    .sort((a, b) => (a.t == null ? 9999 : a.t) - (b.t == null ? 9999 : b.t));
  const nexts = upcoming(ov, 12);
  let html = `<div class="top-cards"><div class="card"><h3>Mein Spieltag</h3><p class="small muted" style="margin:0 0 8px">Alle deine Spiele mit Zeit, Feld und Gegner.</p><a class="btn-primary" href="#ich" style="text-decoration:none; display:inline-block">Öffnen →</a></div></div>`;
  html += `<div class="split"><div class="card"><h3>Tagesablauf</h3>
    ${timeline.map(({ x, p }) => p ? `<div class="tl-row"><span class="tl-time">${p.start != null ? E.fmtTime(p.start) : "–"}</span><span>📌</span><div><div class="tl-name">${esc(p.text)}</div></div><span></span></div>` : `<div class="tl-row click ${x.ev.final ? "done" : ""}" data-game="${esc(x.g.id)}">
      <span class="tl-time">${x.start != null ? E.fmtTime(x.start) : "–"}${x.tl.end != null && x.tl.items.length ? `<small> –${E.fmtTime(x.tl.end)}</small>` : ""}</span><span>${esc(x.g.icon || "")}</span>
      <div><div class="tl-name">${esc(x.g.name)}</div><div class="sub">${esc([x.g.place, x.g.fields > 1 ? x.g.fields + " Felder" : "", leaderNames(x.g.id).length ? "Leitung: " + leaderNames(x.g.id).join(", ") : ""].filter(Boolean).join(" · ") || E.summary(x.g))}</div></div>
      ${statusChip(x.ev)}</div>`).join("")}
    <p class="rule-note" style="margin:10px 0 0">Endzeiten geschätzt aus Anzahl Partien, Feldern und Minuten pro Partie.</p></div>
    <div class="card"><h3>Als Nächstes</h3>${nexts.length ? nexts.map(x => matchRow(x.g, x.ev, Object.assign({}, x.it), /^(K|PL)/.test(x.it.key), Object.assign({}, x.it, { label:x.g.icon + " " + x.g.name + " · " + x.it.label }))).join("") : '<p class="muted">Keine offenen Partien.</p>'}</div></div>`;
  if(isAdmin()){
    html += `<div class="card" style="margin-top:12px"><h3>Zeiten & Orte einstellen</h3>
      <p class="rule-note">Start, Ort, Anzahl Felder/Tische und Minuten pro Partie – daraus rechnet die Seite Feld und Uhrzeit jeder Partie und «Dein nächstes Spiel».</p>
      <div class="tl-edit head"><span></span><span>Spiel</span><span>Start</span><span>Ort</span><span>Felder</span><span>Min.</span></div>
      ${games().map(g => `<div class="tl-edit" data-g="${esc(g.id)}"><span>${esc(g.icon || "")}</span><span>${esc(g.name)}</span>
        <input type="time" data-k="start" value="${esc(g.start || "")}"><input data-k="place" value="${esc(g.place || "")}" placeholder="z. B. Halle">
        <input type="number" min="1" max="20" data-k="fields" value="${g.fields || 1}"><input type="number" min="1" max="120" data-k="matchMinutes" value="${g.matchMinutes || 10}"></div>`).join("")}
      <label style="margin-top:12px">Programmpunkte (eine Zeile «HH:MM Text», z. B. «13:00 Mittagessen Minigolfbistro»)<textarea id="progText" rows="5" style="width:100%">${esc((yearDoc && yearDoc.program) || "")}</textarea></label>
      <button class="btn-ghost" id="progSave" style="margin-top:8px">Programm speichern</button>
    </div>`;
  }
  c.innerHTML = html;
  c.querySelectorAll(".tl-row[data-game]").forEach(el => el.onclick = () => { location.hash = "spiel/" + encodeURIComponent(el.dataset.game); });
  const ps = document.getElementById("progSave");
  if(ps) ps.onclick = () => D.merge(`spieltag/${YEAR}`, { program:document.getElementById("progText").value });
  c.querySelectorAll(".tl-edit[data-g] input").forEach(inp => inp.onchange = async () => {
    const id = inp.closest("[data-g]").dataset.g;
    const list = (yearDoc.games || []).slice();
    const i = list.findIndex(x => x.id === id);
    let v = inp.value.trim();
    if(inp.type === "number") v = Math.max(1, parseInt(v, 10) || 1);
    list[i] = Object.assign({}, list[i], { [inp.dataset.k]:v });
    await saveGames(list);
  });
  // Ergebnisse direkt aus «Als Nächstes» eintragen (Admin/Stationsleitung)
  nexts.forEach(x => {
    if(!canEnter(x.g)) return;
    const box = c.querySelector(`[data-gid="${CSS.escape(x.g.id)}"][data-match="${x.it.key}"]`);
    if(box) box.querySelectorAll("input").forEach(inp => inp.onchange = () => {
      const [ia, ib] = box.querySelectorAll("input");
      saveMatch(x.g, x.ev, x.it.key, x.it.a, x.it.b, ia.value, ib.value, /^(K|PL)/.test(x.it.key));
    });
    c.querySelectorAll(`[data-gid="${CSS.escape(x.g.id)}"][data-win][data-key="${x.it.key}"]`).forEach(btn => btn.onclick = async () => {
      const aWins = btn.dataset.win === "a";
      await writeResult(x.g, { matches:{ [x.it.key]:{ a:x.it.a, b:x.it.b, sa:aWins ? 1 : 0, sb:aWins ? 0 : 1, at:Date.now() } } }, `${x.g.name}: ${label(x.ev, x.it.a)} – ${label(x.ev, x.it.b)}`, prevMatch(x.g, x.it.key), "Sieg " + label(x.ev, aWins ? x.it.a : x.it.b));
    });
  });
}

/* ---------- Bierkapitän ---------- */
function beerTable(events){
  const t = {};
  (events || beer).forEach(b => {
    const r = t[b.pid] = t[b.pid] || { pid:b.pid, n5:0, n3:0, l:0 };
    if(b.l === 0.5) r.n5++; else r.n3++;
    r.l += b.l;
  });
  const rows = Object.values(t).sort((a, b) => b.l - a.l);
  rows.forEach((r, i) => r.rank = i > 0 && Math.abs(rows[i - 1].l - r.l) < 1e-9 ? rows[i - 1].rank : i + 1);
  return rows;
}
function beerLeaders(){
  if(!beer.length) return [];
  const out = [];
  const first = new Date(beer[0].at); first.setMinutes(0, 0, 0);
  const lastT = Math.min(Date.now(), beer[beer.length - 1].at + 3600e3);
  for(let t = first.getTime() + 3600e3; t <= lastT; t += 3600e3){
    const tab = beerTable(beer.filter(b => b.at <= t));
    if(tab.length) out.push({ t, leaders:tab.filter(r => r.rank === 1), l:tab[0].l });
  }
  return out;
}
const fmtL = l => l.toFixed(2).replace(/0$/, "") + " l";
function viewBeer(c){
  if(beerErr){ c.innerHTML = '<div class="card"><p class="muted">Der Bierkapitän ist nur für eingeloggte Mitglieder sichtbar.</p></div>'; return; }
  const tab = beerTable();
  const pid = ST.pidOfMember(viewer.memberId);
  const mine = tab.find(r => r.pid === pid);
  const myLast = beer.slice().reverse().find(b => b.by === viewer.memberId && b.pid === pid);
  const leaders = beerLeaders();
  c.innerHTML = `<div class="split">
    <div>
      ${viewer.memberId ? `<div class="card"><h3>Meine Runde${pid ? " · " + esc(ST.nameOf(pid)) : ""}</h3>
        <div class="beer-sum">${fmtL(mine ? mine.l : 0)}</div>
        <div class="small muted">${mine ? `${mine.n5} × 0.5 l · ${mine.n3} × 0.33 l · Rang ${mine.rank}` : "noch nichts"}</div>
        <div class="beer-btns"><button class="btn-primary beer-btn" data-l="0.5">🍺 + 0.5 l</button><button class="btn-primary beer-btn" data-l="0.33">🍺 + 0.33 l</button></div>
        ${myLast ? '<button class="link-btn" id="beerUndo">letzten Eintrag rückgängig</button>' : ""}
      </div>` : ""}
      ${isAdmin() ? `<div class="card"><h3>Für jemand anderen (z. B. Gäste)</h3>
        <div class="inline-form" style="display:flex; gap:8px; flex-wrap:wrap; align-items:end">
          <select id="beerWho">${ST.sortByName(participants()).map(p => `<option value="${esc(p)}">${esc(ST.nameOf(p))}</option>`).join("")}</select>
          <button class="btn-ghost" data-lfor="0.5">+ 0.5 l</button><button class="btn-ghost" data-lfor="0.33">+ 0.33 l</button>
        </div>
        <div class="beer-log" style="margin-top:12px"><ul>${beer.slice().reverse().slice(0, 30).map(b => `<li><span>${new Date(b.at).toLocaleTimeString("de-CH", { hour:"2-digit", minute:"2-digit" })} · ${esc(ST.nameOf(b.pid))} ${b.l} l</span><button class="del-btn" data-del="${esc(b.id)}">×</button></li>`).join("")}</ul></div>
      </div>` : ""}
      <div class="card"><h3>Leaderzeiten</h3>${leaders.length ? `<ul class="list-plain">${leaders.map(x => `<li><span class="yr">${new Date(x.t).toLocaleTimeString("de-CH", { hour:"2-digit", minute:"2-digit" })}</span><span><b>${esc(x.leaders.map(r => ST.nameOf(r.pid)).join(" & "))}</b> · ${fmtL(x.l)}</span></li>`).join("")}</ul>` : '<p class="muted">Jede volle Stunde wird festgehalten, wer vorne liegt.</p>'}</div>
    </div>
    <div class="card"><h3>Bierkapitän ${esc(YEAR)}</h3>
      <p class="rule-note">Nur für eingeloggte Mitglieder sichtbar. Jeder zählt für sich selbst; Gäste trägt der Admin ein.</p>
      ${tab.length ? `<table class="rank"><thead><tr><th>#</th><th>Name</th><th class="num">0.5</th><th class="num">0.33</th><th class="num">Liter</th></tr></thead><tbody>
        ${tab.map(r => `<tr class="${r.rank === 1 ? "top1" : ""} ${r.pid === pid ? "me" : ""}"><td class="pos">${r.rank === 1 ? "🍺" : r.rank}</td><td class="who">${esc(ST.nameOf(r.pid))}</td><td class="num">${r.n5}</td><td class="num">${r.n3}</td><td class="total">${fmtL(r.l)}</td></tr>`).join("")}
      </tbody></table>` : '<p class="muted">Noch keine Einträge.</p>'}</div>
  </div>`;
  c.querySelectorAll("[data-l]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try{
      const p = await ensureMyPerson();
      await D.set(`spieltag/${YEAR}/beer/${viewer.memberId}_${Date.now()}`, { pid:p, l:Number(b.dataset.l), at:Date.now(), by:viewer.memberId });
    }catch(e){ console.error(e); alert("Hat nicht geklappt."); b.disabled = false; }
  });
  const u = document.getElementById("beerUndo");
  if(u) u.onclick = () => D.remove(`spieltag/${YEAR}/beer/${myLast.id}`);
  c.querySelectorAll("[data-lfor]").forEach(b => b.onclick = () => {
    const who = document.getElementById("beerWho").value;
    if(who) D.set(`spieltag/${YEAR}/beer/a_${Date.now()}`, { pid:who, l:Number(b.dataset.lfor), at:Date.now(), by:viewer.memberId });
  });
  c.querySelectorAll("[data-del]").forEach(b => b.onclick = () => D.remove(`spieltag/${YEAR}/beer/${b.dataset.del}`));
}

/* ---------- Siegerehrung (Beamer): Plätze von hinten aufdecken ---------- */
let cerStep = 0;
function ceremonySteps(ov){
  const rows = ov.rows.filter(r => r.total > 0);
  const steps = [{ kind:"intro" }];
  const rest = rows.filter(r => r.rank > 10);
  if(rest.length) steps.push({ kind:"rest", rows:rest });
  [...new Set(rows.filter(r => r.rank <= 10).map(r => r.rank))].sort((a, b) => b - a).forEach(rk => steps.push({ kind:"rank", rank:rk, rows:rows.filter(r => r.rank === rk) }));
  if(canSeeBeer() && beer.length) steps.push({ kind:"beer" });
  steps.push({ kind:"end", rows:rows.filter(r => r.rank === 1) });
  return steps;
}
function drawCeremony(){
  document.body.classList.add("tv-mode");
  const app = document.getElementById("app");
  if(!yearDoc){ app.innerHTML = ""; return; }
  const ov = E.overall(games(), gameData, ctx());
  const steps = ceremonySteps(ov);
  cerStep = Math.max(0, Math.min(cerStep, steps.length - 1));
  const st = steps[cerStep];
  const shown = steps.slice(1, cerStep + 1).filter(x => x.kind === "rank" || x.kind === "rest").flatMap(x => x.rows);
  const big = r => `<div class="tv-row first" style="font-size:5vh; padding:1.2vh 0"><span class="p">${r.rank}.</span><span class="n">${esc(ST.nameOf(r.pid))}</span><span class="t">${r.total}</span></div>`;
  let body;
  if(st.kind === "intro") body = `<div style="text-align:center; margin-top:8vh"><div class="tv-big" style="font-size:14vh">Siegerehrung</div><p class="muted" style="font-size:2.6vh">${ST.edition(YEAR)}. Ermatinger Minispieltag · ${participants().length} Teilnehmende · ${games().length} Disziplinen</p><p class="muted" style="font-size:2vh">Leertaste oder Klick = nächster Platz · ← zurück · Esc beenden</p></div>`;
  else if(st.kind === "rank" && st.rank <= 3) body = `<div style="text-align:center; margin-top:4vh"><div class="tv-eyebrow" style="font-size:3vh">${st.rank === 1 ? "🏆 Sieger" : st.rank === 2 ? "🥈 Platz 2" : "🥉 Platz 3"}</div>
    <div class="tv-big" style="font-size:${st.rank === 1 ? 16 : 11}vh; margin:2vh 0">${esc(st.rows.map(r => ST.nameOf(r.pid)).join(" & "))}</div><p style="font-size:4vh; font-family:var(--font-mono); color:var(--yellow)">${st.rows[0].total} Punkte</p></div>`;
  else if(st.kind === "beer"){ const t = beerTable()[0]; body = `<div style="text-align:center; margin-top:6vh"><div class="tv-eyebrow" style="font-size:3vh">🍺 Bierkapitän ${esc(YEAR)}</div><div class="tv-big" style="font-size:13vh; margin:2vh 0">${esc(ST.nameOf(t.pid))}</div><p style="font-size:4vh; font-family:var(--font-mono); color:var(--yellow)">${fmtL(t.l)}</p></div>`; }
  else if(st.kind === "end") body = `<div style="text-align:center; margin-top:6vh"><div class="tv-eyebrow" style="font-size:3vh">Titelverteidiger ${parseInt(YEAR, 10) + 1} · Startnummer 1</div><div class="tv-big" style="font-size:14vh; margin:2vh 0">${esc(st.rows.map(r => ST.nameOf(r.pid)).join(" & "))}</div><p class="muted" style="font-size:2.6vh">Merci fürs Mitmachen – Prost! 🍻</p></div>`;
  else body = `<h2>Rangliste</h2><div class="tv-cols">${shown.slice().sort((a, b) => a.rank - b.rank).map(r => `<div class="tv-row ${r.rank <= 3 ? "first" : ""}"><span class="p">${r.rank}</span><span class="n">${esc(ST.nameOf(r.pid))}</span><span class="t">${r.total}</span></div>`).join("")}</div>`;
  app.innerHTML = `<div class="tv" id="cer">
    <button class="tv-close" onclick="location.hash='rangliste'" title="Beenden (Esc)">✕</button>
    <div class="tv-head"><img src="../assets/logo.png" alt=""><div><div class="tv-eyebrow">${ST.edition(YEAR)}. Ermatinger Minispieltag</div><div class="tv-title">Siegerehrung ${esc(YEAR)}</div></div>
      <div class="tv-clock" style="font-size:2.4vh">${cerStep}/${steps.length - 1}</div></div>
    <div class="tv-main" style="grid-template-columns:1fr"><div class="tv-panel">${body}</div></div>
    <div class="tv-dots">${steps.map((x, i) => `<span class="${i === cerStep ? "on" : ""}"></span>`).join("")}</div></div>`;
  document.getElementById("cer").onclick = e => { if(!e.target.closest(".tv-close")){ cerStep++; drawCeremony(); } };
  document.onkeydown = e => {
    if(route().view !== "siegerehrung") return;
    if(e.key === " " || e.key === "ArrowRight" || e.key === "Enter"){ e.preventDefault(); cerStep++; drawCeremony(); }
    else if(e.key === "ArrowLeft"){ cerStep--; drawCeremony(); }
    else if(e.key === "Escape") location.hash = "rangliste";
  };
}

/* ---------- TV-Ansicht (Beamer/Fernseher) ---------- */
function stopTV(){
  if(tvTimer){ clearInterval(tvTimer); tvTimer = null; }
  if(clockTimer){ clearInterval(clockTimer); clockTimer = null; }
  document.body.classList.remove("tv-mode");
}
function tvPanels(){
  const list = ["rangliste", "jetzt", "zeitplan"];
  if(canSeeBeer() && beer.length) list.push("bier");
  return list;
}
function drawTV(){
  document.body.classList.add("tv-mode");
  if(!tvTimer){
    tvTimer = setInterval(() => { tvIndex++; drawTV(); }, 15000);
    clockTimer = setInterval(() => { const el = document.getElementById("tvClock"); if(el) el.textContent = new Date().toLocaleTimeString("de-CH", { hour:"2-digit", minute:"2-digit" }); }, 10000);
    document.onkeydown = e => { if(e.key === "Escape" && route().view === "tv") location.hash = "rangliste"; };
  }
  const app = document.getElementById("app");
  if(!yearDoc){ app.innerHTML = '<div class="tv"><div class="tv-big">Spieltag folgt</div></div>'; return; }
  const ov = E.overall(games(), gameData, ctx());
  const panels = tvPanels();
  const which = panels[tvIndex % panels.length];
  let body = "";
  if(which === "rangliste"){
    const { rows, started, ch } = sortedOverall(ov);
    const top = rows.slice(0, 30);
    body = `<h2>${started ? "Gesamtrangliste" : "Startliste"}</h2><div class="tv-cols">${top.map((r, i) => `<div class="tv-row ${started && r.rank === 1 ? "first" : ""}"><span class="p">${started ? r.rank : r.nr}</span><span class="n">${esc(ST.nameOf(r.pid))}${ch.includes(r.pid) ? " 🏆" : ""}</span><span class="t">${started ? r.total : ""}</span></div>`).join("")}</div>`;
  } else if(which === "jetzt"){
    const nexts = upcoming(ov, 10);
    const running = games().filter(g => ov.evals[g.id].status === "läuft");
    body = `<h2>Als Nächstes</h2>${nexts.length ? nexts.map(x => `<div class="tv-match"><span class="tm">${x.it.time != null ? E.fmtTime(x.it.time) : ""}${x.g.fields > 1 ? " · F" + x.it.field : ""}</span>
      <span>${esc(x.g.icon || "")} ${esc(label(x.ev, x.it.a))} – ${esc(label(x.ev, x.it.b))} <small>${esc(x.g.name)} · ${esc(x.it.label)}</small></span></div>`).join("")
      : `<p class="muted" style="font-size:2.4vh">${running.length ? "Läuft: " + esc(running.map(g => g.name).join(", ")) : "Gerade keine offenen Partien."}</p>`}`;
  } else if(which === "zeitplan"){
    body = `<h2>Tagesablauf</h2>${scheduleRows(ov).map(x => `<div class="tv-match"><span class="tm">${x.start != null ? E.fmtTime(x.start) : "–"}</span>
      <span>${esc(x.g.icon || "")} ${esc(x.g.name)} <small>${esc([x.g.place, x.ev.final ? "✓ fertig" : x.ev.status === "läuft" ? "läuft" : ""].filter(Boolean).join(" · "))}</small></span></div>`).join("")}`;
  } else if(which === "bier"){
    const tab = beerTable().slice(0, 10);
    body = `<h2>🍺 Bierkapitän</h2>${tab.map(r => `<div class="tv-row ${r.rank === 1 ? "first" : ""}"><span class="p">${r.rank}</span><span class="n">${esc(ST.nameOf(r.pid))}</span><span class="t">${fmtL(r.l)}</span></div>`).join("")}`;
  }
  app.innerHTML = `<div class="tv">
    <button class="tv-close" onclick="location.hash='rangliste'" title="TV-Ansicht beenden (Esc)">✕</button>
    <div class="tv-head"><img src="../assets/logo.png" alt=""><div><div class="tv-eyebrow">${ST.edition(YEAR)}. Ermatinger Minispieltag</div><div class="tv-title">Spieltag ${esc(YEAR)}</div></div>
      <div class="tv-clock" id="tvClock">${new Date().toLocaleTimeString("de-CH", { hour:"2-digit", minute:"2-digit" })}</div></div>
    <div class="tv-main"><div class="tv-panel">${body}</div>
      <div class="tv-side"><div class="tv-qr" id="tvQr"></div><p>Live auf dem Handy:<br>QR-Code scannen</p></div></div>
    <div class="tv-dots">${panels.map((p, i) => `<span class="${i === tvIndex % panels.length ? "on" : ""}"></span>`).join("")}</div>
  </div>`;
  try{ new QRCode(document.getElementById("tvQr"), { text:PUBLIC_URL, width:180, height:180, colorDark:"#141311", colorLight:"#ffffff" }); }catch(e){}
}

/* ---------- Historie ---------- */
function allTime(){
  const acc = {};
  HIST.forEach(y => (y.rows || []).forEach(r => (r.pids || []).forEach(pid => {
    const a = acc[pid] = acc[pid] || { pid, years:0, total:0, wins:0, podium:0 };
    a.years++; a.total += r.total || 0;
    if(r.rank === 1) a.wins++;
    if(r.rank && r.rank <= 3) a.podium++;
  })));
  return Object.values(acc).sort((a, b) => b.total - a.total);
}
const names = pids => (pids || []).map(p => ST.nameOf(p)).join(" & ");
function viewHistory(c){
  if(!HIST.length){ c.innerHTML = '<div class="card"><p class="muted">Historie wird geladen …</p></div>'; return; }
  const at = allTime();
  const rec = S.records(HIST, catalog);
  const discs = {};
  HIST.forEach(y => (y.disciplines || []).forEach(d => {
    const k = d.catId || ST.slug(d.name);
    const cat = catalog.find(x => x.id === k) || {};
    discs[k] = discs[k] || { name:cat.name || d.name, icon:cat.icon || "", years:new Set() };
    discs[k].years.add(y.year);
  }));
  const yrs = HIST.map(y => y.year);
  c.innerHTML = `
    <div class="hist-grid">
      <div>
        <div class="card"><h3>Ewige Rangliste ${yrs[0]}–${yrs[yrs.length - 1]}</h3>
          <p class="rule-note">Summe aller Spieltag-Punkte (nur Punkte – in der alten Excel-Liste wurden die Ränge mitgezählt). Antippen für das Profil mit bestem Partner und Angstgegner.</p>
          <div class="tbl-scroll"><table class="rank"><thead><tr><th>#</th><th>Name</th><th class="num">Teiln.</th><th class="num">Siege</th><th class="num">Podest</th><th class="num">Ø</th><th class="num">Total</th></tr></thead><tbody>
          ${at.map((a, i) => `<tr class="click ${i === 0 ? "top1" : ""}" data-pid="${esc(a.pid)}"><td class="pos">${i + 1}</td><td class="who">${esc(ST.nameOf(a.pid))}</td><td class="num">${a.years}</td><td class="num">${a.wins || ""}</td><td class="num">${a.podium || ""}</td><td class="num">${Math.round(a.total / a.years)}</td><td class="total">${a.total}</td></tr>`).join("")}
          </tbody></table></div></div>
      </div>
      <div>
        <div class="card"><h3>Tagessieger</h3><ul class="list-plain">
          ${HIST.slice().reverse().map(y => {
            const w = (y.rows || []).filter(r => r.rank === 1);
            return `<li><span><span class="yr">${y.year}</span> · <a href="#jahr/${y.year}">${ST.edition(y.year)}. Spieltag, ${(y.rows || []).length} Pers.</a></span><b>${esc(w.map(r => r.name + ((r.pids || []).length > 1 ? " (" + names(r.pids).replace(/ & /g, " + ") + ")" : "")).join(" & "))}</b></li>`;
          }).join("")}
        </ul></div>
        <div class="card"><h3>Rekorde</h3>
          <div class="rec-title">Meiste Punkte an einem Spieltag</div>
          <ul class="list-plain">${rec.bestDays.map(d => `<li><span>${esc(d.name)} <span class="yr">${d.year}</span></span><b>${d.total}</b></li>`).join("")}</ul>
          <div class="rec-title">Meiste Tagessiege</div>
          <ul class="list-plain">${rec.mostWins.map(p => `<li><span>${esc(ST.nameOf(p.pid))}</span><b>${p.wins}×</b></li>`).join("")}</ul>
          <div class="rec-title">Disziplinen-Könige (Disziplin gewonnen)</div>
          <ul class="list-plain">${rec.discKings.map(p => `<li><span>${esc(ST.nameOf(p.pid))}</span><b>${p.discWins}×</b></li>`).join("")}</ul>
          <div class="rec-title">Treueste (Teilnahmen · längste Serie)</div>
          <ul class="list-plain">${rec.mostYears.map(p => `<li><span>${esc(ST.nameOf(p.pid))}</span><b>${p.count}× · ${p.streak} in Folge</b></li>`).join("")}</ul>
          <div class="rec-title">Grösster Sprung nach vorne</div>
          <ul class="list-plain">${rec.bigJumps.map(j => `<li><span>${esc(ST.nameOf(j.pid))} <span class="yr">${j.from.year}→${j.to.year}</span></span><b>${j.from.rank}. → ${j.to.rank}.</b></li>`).join("")}</ul>
          ${rec.rawRecords.length ? `<div class="rec-title">Bestwerte</div><ul class="list-plain">${rec.rawRecords.map(r => `<li><span>${esc(r.name)}: ${esc(names(r.pids))} <span class="yr">${r.year}</span></span><b>${r.value} ${esc(r.label)}</b></li>`).join("")}</ul>` : ""}
        </div>
        <div class="card"><h3>Spezialisten (Ø Punkte, mind. 2×)</h3><ul class="list-plain">
          ${rec.specialists.map(s => `<li><span>${esc(s.name)}</span><span><b>${esc(ST.nameOf(s.pid))}</b> <span class="yr">Ø ${s.avg.toFixed(1)} · ${s.n}×</span></span></li>`).join("")}</ul></div>
        <div class="card"><h3>Disziplinen pro Jahr</h3><div class="tbl-scroll"><table class="rank matrix">
          <thead><tr><th>Disziplin</th>${yrs.map(y => `<th class="num">${String(y).slice(2)}</th>`).join("")}</tr></thead><tbody>
          ${Object.values(discs).sort((a, b) => b.years.size - a.years.size || a.name.localeCompare(b.name)).map(d => `<tr><td>${esc(d.icon)} ${esc(d.name)}</td>${yrs.map(y => `<td class="y ${d.years.has(y) ? "on" : ""}">${d.years.has(y) ? "●" : "·"}</td>`).join("")}</tr>`).join("")}
          </tbody></table></div></div>
      </div>
    </div>`;
  c.querySelectorAll("[data-pid]").forEach(tr => tr.onclick = () => { location.hash = "person/" + encodeURIComponent(tr.dataset.pid); });
}
function viewYear(c, year){
  const y = HIST.find(h => String(h.year) === String(year));
  if(!y){ c.innerHTML = '<a class="back" href="#historie">← Historie</a><div class="card"><p class="muted">Jahr nicht gefunden.</p></div>'; return; }
  const ds = y.disciplines || [];
  const shortName = n => n.length > 10 ? n.split(/[\s/]+/)[0] : n;
  c.innerHTML = `<a class="back" href="#historie">← Historie</a>
    <div class="year-pills">${HIST.map(h => `<a class="btn-small ${h.year === y.year ? "on" : ""}" href="#jahr/${h.year}" style="text-decoration:none">${h.year}</a>`).join("")}</div>
    <div class="card"><h3>${y.year} · ${ST.edition(y.year)}. Minispieltag</h3>
    <div class="tbl-scroll"><table class="rank"><thead><tr><th>#</th><th class="sticky">Name</th>${ds.map(d => `<th class="num gh" title="${esc(d.name)}">${esc(shortName(d.name))}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
    ${(y.rows || []).map(r => `<tr class="click ${r.rank === 1 ? "top1" : ""}" data-pid="${esc((r.pids || [])[0] || "")}"><td class="pos">${r.rank || ""}</td><td class="who sticky">${esc(r.name)}${(r.pids || []).length > 1 ? ` <span class="small muted">(${esc(r.pids.map(p => ST.nameOf(p)).join(" + "))})</span>` : ""}</td>
      ${ds.map((d, i) => `<td class="num">${r.pts && r.pts[i] != null ? r.pts[i] : ""}</td>`).join("")}<td class="total">${r.total}</td></tr>`).join("")}
    </tbody></table></div></div>`;
  c.querySelectorAll("[data-pid]").forEach(tr => tr.onclick = () => { if(tr.dataset.pid) location.hash = "person/" + encodeURIComponent(tr.dataset.pid); });
}
function viewPerson(c, pid, ov){
  const p = ST.persons[pid];
  const rows = [];
  const discAvg = {};
  HIST.forEach(y => (y.rows || []).forEach(r => {
    if(!(r.pids || []).includes(pid)) return;
    rows.push({ year:y.year, rank:r.rank, total:r.total, n:y.rows.length, as:r.pids.length > 1 ? r.name : "" });
    (y.disciplines || []).forEach((d, i) => {
      if(!r.pts || r.pts[i] == null) return;
      const k = d.catId || ST.slug(d.name);
      (discAvg[k] = discAvg[k] || { name:(catalog.find(x => x.id === k) || d).name, list:[] }).list.push(r.pts[i]);
    });
  }));
  let cur = "";
  if(ov && participants().includes(pid)){
    const row = ov.rows.find(r => r.pid === pid);
    cur = `<div class="card"><h3>${YEAR}: ${row && row.total > 0 ? "Rang " + row.rank + " · " : ""}${row ? row.total : 0} Punkte</h3>
      <div class="tbl-scroll"><table class="rank"><tbody>${games().map(g => {
        const ev = ov.evals[g.id];
        const pts = ev.personPoints[pid];
        const u = ev.units.find(x => (x.members || []).includes(pid));
        const ur = u && ev.rows.find(x => x.unitId === u.id);
        const show = pts == null || (!pts && !(ur && ur.rank)) ? "–" : pts;
        return `<tr class="click" data-game="${esc(g.id)}"><td>${esc(g.icon || "")} ${esc(g.name)}</td><td class="small muted">${u && u.members.length > 1 ? esc(u.members.filter(x => x !== pid).map(x => ST.nameOf(x)).join(", ")) : ""}</td><td class="total ${ur && !ur.final ? "prov" : ""}">${show}</td></tr>`;
      }).join("")}</tbody></table></div>
      <a class="btn-small" href="#ich" style="text-decoration:none; display:inline-block; margin-top:10px">Zeitplan von ${esc(ST.nameOf(pid))} →</a></div>`;
  }
  const best = Object.values(discAvg).filter(d => d.list.length >= 2)
    .map(d => ({ name:d.name, avg:d.list.reduce((s, x) => s + x, 0) / d.list.length, n:d.list.length }))
    .sort((a, b) => b.avg - a.avg).slice(0, 5);
  const partners = S.partners(HIST, pid);
  const riv = S.rivals(HIST, pid);
  c.innerHTML = `<a class="back" href="javascript:window.history.back()">← zurück</a>
    <div class="game-head"><span class="gicon">👤</span><div><h2>${esc(p ? p.name : "?")}</h2>
    <div class="sub">${p && p.memberId ? "Vereinsmitglied" : "Gast"} · Startnummer ${esc(ST.startNr(pid, champs()))} · ${rows.length} Spieltag${rows.length === 1 ? "" : "e"} in der Historie</div></div></div>
    ${cur}
    <div class="split" style="margin-top:12px">
      <div class="card"><h3>Bisherige Spieltage</h3>${rows.length ? `<table class="rank"><thead><tr><th>Jahr</th><th class="num">Rang</th><th class="num">Punkte</th></tr></thead><tbody>
        ${rows.slice().reverse().map(r => `<tr class="click" data-year="${r.year}"><td>${r.year}${r.as ? ` <span class="small muted">als «${esc(r.as)}»</span>` : ""}</td><td class="num">${r.rank || "–"} / ${r.n}</td><td class="total">${r.total}</td></tr>`).join("")}
      </tbody></table>` : '<p class="muted">Noch keine.</p>'}</div>
      <div class="card"><h3>Stärkste Disziplinen</h3>${best.length ? `<table class="rank"><thead><tr><th>Disziplin</th><th class="num">Ø Punkte</th><th class="num">mal</th></tr></thead><tbody>
        ${best.map(d => `<tr><td>${esc(d.name)}</td><td class="num">${d.avg.toFixed(1)}</td><td class="num">${d.n}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Braucht mindestens zwei Teilnahmen an einer Disziplin.</p>'}</div>
      <div class="card"><h3>Partner & Gegner</h3>
        <div class="rec-title">Bester Partner (2er/3er-Teams)</div>
        ${partners.length ? `<ul class="list-plain">${partners.slice(0, 3).map(x => `<li><span>${esc(ST.nameOf(x.pid))}</span><span><b>Ø ${x.avg.toFixed(1)}</b> <span class="yr">${x.n}× zusammen</span></span></li>`).join("")}</ul>` : '<p class="muted small">Noch keine Teamdaten (ab 2026).</p>'}
        <div class="rec-title">Angstgegner / Lieblingsgegner</div>
        ${riv.nemesis || riv.favourite ? `<ul class="list-plain">
          ${riv.nemesis ? `<li><span>😱 ${esc(ST.nameOf(riv.nemesis.pid))}</span><b>${riv.nemesis.won}:${riv.nemesis.lost}</b></li>` : ""}
          ${riv.favourite ? `<li><span>😎 ${esc(ST.nameOf(riv.favourite.pid))}</span><b>${riv.favourite.won}:${riv.favourite.lost}</b></li>` : ""}</ul>`
          : '<p class="muted small">Noch keine direkten Duelle (Tischtennis 2026, alles ab 2027).</p>'}
      </div>
    </div>`;
  c.querySelectorAll("[data-game]").forEach(tr => tr.onclick = () => { location.hash = "spiel/" + encodeURIComponent(tr.dataset.game); });
  c.querySelectorAll("[data-year]").forEach(tr => tr.onclick = () => { location.hash = "jahr/" + tr.dataset.year; });
  const link = c.querySelector('a[href="#ich"]');
  if(link) link.onclick = (e) => { e.preventDefault(); mineFor = pid; location.hash = "ich"; };
}
