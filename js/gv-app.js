/* ===================== GV – Generalversammlung =====================
   Alles für die GV an einem Ort; druckt wie die GV-Übersicht 2026 (Calibri, 1,5).
   Daten (Firestore, nur für Mitglieder lesbar):
     config/verein                 { vorstand:{praesident,aktuar,kassier}, stimmenzaehler, fee, discount, twint }
     gv/<jahr>                     { edition, date, place, traktanden:[{id,title,text,vote,antraege}], essen:[…], rueckblick,
                                     (Archiv-PDF: chunks, fileName, title) }
     gv/<jahr>/antraege/<id>       Traktanden-Vorschläge der Mitglieder { title, text, by, byName, at, status }
     gv/<jahr>/protokoll/main      Protokoll des Aktuars { eck, att, notes, votes }
     finance/<jahr>                Vereinsjahr (endet mit der GV <jahr>) { vjStart, vjEnd, opening, openingCash, cash, awb }
     finance/<jahr>/bookings/<id>  Kontobewegungen { date, text, cat, out, in }
     finance/<jahr>/fees/<m..>     Jahresbeitrag <jahr> { status:offen|angefordert|bezahlt|erlassen, paidAt, note, awb, aufbau, amount }
   Rollen: Vorstand (E-Mail-Login) bearbeitet GV, Kassier Finanzen/Beiträge, Aktuar Protokoll.
   Läuft auf zwei Seiten: gv/ (Traktanden, Mitglieder, Protokoll, Druck) und finanzen/ (<div id="app" data-mode="finanzen">:
   Jahresbeiträge, Kontobewegungen, AWB-Abrechnung). */
const MODE = document.getElementById("app").dataset.mode === "finanzen" ? "finanzen" : "gv";
let me = null, Y = null, years = [], tab = MODE === "finanzen" ? "beitraege" : "uebersicht";
let verein = {}, gv = null, prot = {}, antraege = [], fin = null, bookings = [], fees = {}, shifts = [], histY = null, beerY = [];
let unsub = [], saveTimer = null, saveState = "";
let contacts = {}, contactsWatch = null;   // Handynummern (nur Vorstand)
const db2 = () => db;

/* ---------- Hilfen ---------- */
const CHF = n => "CHF " + (n < 0 ? "−" : "") + Math.abs(Math.round(n * 100) / 100).toLocaleString("de-CH", { minimumFractionDigits:2, maximumFractionDigits:2 });
const CHFr = n => "CHF " + Math.round(n).toLocaleString("de-CH") + ".–";
const num = v => { const x = parseFloat(String(v == null ? "" : v).replace(/[’'\s]/g, "").replace(",", ".")); return isNaN(x) ? 0 : x; };
const dCH = iso => iso ? iso.split("-").reverse().join(".") : "";
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const uid = () => Math.random().toString(36).slice(2, 9);
const isMemberId = id => /^m\d+$/.test(id) && id !== "m999";
const memberName = id => (MST.directory[id] || {}).name || id;
const V = () => Object.assign({ vorstand:{ praesident:"m10", aktuar:"m5", kassier:"m19" }, stimmenzaehler:"m11", fee:100, discount:30, twint:"" }, verein);
const vorstandIds = () => Object.values(V().vorstand);
const edition = () => (gv && gv.edition) || (parseInt(Y, 10) - 2023);
const vjStart = () => (fin && fin.vjStart) || `${parseInt(Y, 10) - 1}-10-01`;
const vjEnd = () => (fin && fin.vjEnd) || `${Y}-09-30`;
const vjLabel = () => `${parseInt(Y, 10) - 1}/${String(Y).slice(2)}`;
const gvWhen = () => gv && gv.date ? `${parseInt(gv.date.slice(8), 10)}. ${MONTHS[parseInt(gv.date.slice(5, 7), 10) - 1]} ${Y}` : `Oktober ${Y}`;
const gvMonth = () => gv && gv.date ? `${MONTHS[parseInt(gv.date.slice(5, 7), 10) - 1]} ${Y}` : `Oktober ${Y}`;
const canGV = () => !!(me && me.vorstand);
const canFin = () => !!(me && me.kassier);
const canProt = () => !!(me && me.aktuar);
// Finanzen: während des Vereinsjahrs nur Vorstand; an der GV gibt der Kassier sie frei (finance/<jahr>.shared)
const finVisible = () => !!(me && me.vorstand) || !!(fin && fin.shared);
const shareToggle = () => canFin() ? `<label class="check-label small" style="margin:0 0 12px; display:flex; gap:8px; align-items:center">
    <input type="checkbox" id="finShare" ${fin && fin.shared ? "checked" : ""}> Finanzen ${esc(vjLabel())} für alle Mitglieder freigeben (an der GV) – sonst sieht sie nur der Vorstand</label>` : "";
function bindShareToggle(){
  const t = document.getElementById("finShare");
  if(t) t.onchange = async () => {
    await MST.quick(db.collection("finance").doc(Y).set({ shared:t.checked }, { merge:true }));
    MST.log("finanzen", `Finanzen ${vjLabel()} ${t.checked ? "für Mitglieder freigegeben" : "nur noch für den Vorstand"}`);
  };
}

/* ---------- Start ---------- */
MST.start(async user => {
  me = user;
  if(me.vorstand) contactsWatch = db.collection("contacts").onSnapshot(s => { contacts = {}; s.docs.forEach(d => contacts[d.id] = d.data()); if(!isTyping()) draw(); }, () => {});
  db.collection("config").doc("verein").onSnapshot(d => { verein = d.exists ? d.data() : {}; draw(); });
  db.collection("gv").onSnapshot(s => {
    years = s.docs.map(d => d.id).filter(id => /^\d{4}$/.test(id)).sort();
    const wanted = new URLSearchParams(location.search).get("jahr");
    if(!Y || !years.includes(Y)) openYear(years.includes(wanted) ? wanted : years[years.length - 1]);
    else draw();
  });
});
function openYear(y){
  unsub.forEach(f => f()); unsub = [];
  Y = y; gv = null; prot = {}; antraege = []; fin = null; bookings = []; fees = {}; shifts = []; histY = null; beerY = [];
  if(!y){ draw(); return; }
  const g = db.collection("gv").doc(y), f = db.collection("finance").doc(y);
  unsub.push(g.onSnapshot(d => { gv = d.exists ? d.data() : {}; draw(); }));
  unsub.push(g.collection("protokoll").doc("main").onSnapshot(d => { prot = d.exists ? d.data() : {}; if(!isTyping()) draw(); }));
  unsub.push(g.collection("antraege").onSnapshot(s => { antraege = s.docs.map(d => Object.assign({ id:d.id }, d.data())).sort((a, b) => a.at - b.at); draw(); }));
  // Mitglieder dürfen die Finanzen erst lesen, wenn sie freigegeben sind – Fehler dann einfach leer lassen
  const none = () => {};
  unsub.push(f.onSnapshot(d => { fin = d.exists ? d.data() : null; draw(); }, () => { fin = null; draw(); }));
  unsub.push(f.collection("bookings").onSnapshot(s => { bookings = s.docs.map(d => Object.assign({ id:d.id }, d.data())); if(!isTyping()) draw(); }, none));
  unsub.push(f.collection("fees").onSnapshot(s => { fees = {}; s.docs.forEach(d => fees[d.id] = d.data()); if(!isTyping()) draw(); }, none));
  db.collection("awb").doc(y).collection("shifts").get().then(s => { shifts = s.docs.map(d => d.data()); draw(); }).catch(() => {});
  db.collection("spieltagHistory").doc(y).get().then(d => { histY = d.exists ? d.data() : null; draw(); }).catch(() => {});
  db.collection("spieltag").doc(y).collection("beer").get().then(s => { beerY = s.docs.map(d => d.data()); draw(); }).catch(() => {});
  draw();
}
const isTyping = () => { const a = document.activeElement; return a && a.closest && a.closest("#content") && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox")); };
document.addEventListener("focusout", () => setTimeout(() => { if(!isTyping()) draw(); }, 50));

/* ---------- Berechnungen ---------- */
function members(){
  const cut = (gv && gv.date) || vjEnd();
  return Object.entries(MST.directory).filter(([id, m]) => isMemberId(id) && !(m.left && m.left <= cut))
    .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)));
}
function mutations(){
  const s = vjStart(), e = (gv && gv.date) || vjEnd();
  const all = Object.entries(MST.directory).filter(([id]) => isMemberId(id));
  return {
    in:all.filter(([, m]) => m.joined && m.joined >= s && m.joined <= e).map(([id, m]) => ({ id, m, d:m.joined })),
    out:all.filter(([, m]) => m.left && m.left >= s && m.left <= e).map(([id, m]) => ({ id, m, d:m.left })),
    late:all.filter(([, m]) => m.joined && m.joined > e && !m.left).map(([id, m]) => ({ id, m, d:m.joined }))
  };
}
function helperFlags(id){
  const f = fees[id] || {};
  const fromPlan = { awb:shifts.some(s => s.assignee === id && (s.kind === "schicht" || s.kind === "sonder")), aufbau:shifts.some(s => s.assignee === id && s.kind === "aufbau") };
  return { awb:f.awb != null ? f.awb : fromPlan.awb, aufbau:f.aufbau != null ? f.aufbau : fromPlan.aufbau, manual:f.awb != null || f.aufbau != null };
}
function feeOf(id){
  const v = V();
  if(vorstandIds().includes(id)) return { amount:0, vorstand:true, label:"Vorstand" };
  const f = fees[id] || {};
  if(f.status === "erlassen") return { amount:0, label:"erlassen" };
  if(f.amount != null && f.amount !== "") return { amount:num(f.amount), label:"" };
  const m = MST.directory[id] || {};
  if(m.joined && m.joined > ((gv && gv.date) || vjEnd())) return { amount:num(v.fee), label:"Eintritt im laufenden Jahr – voller Beitrag" };
  const h = helperFlags(id);
  return { amount:Math.max(0, num(v.fee) - num(v.discount) * ((h.awb ? 1 : 0) + (h.aufbau ? 1 : 0))), label:"" };
}
function feeList(){
  const list = members().map(([id, m]) => ({ id, m }));
  mutations().late.forEach(x => { if(!list.some(l => l.id === x.id)) list.push({ id:x.id, m:x.m }); });
  return list.map(x => Object.assign(x, { fee:feeOf(x.id), st:(fees[x.id] || {}).status || "offen", h:helperFlags(x.id) }));
}
function feeTotals(){
  const l = feeList().filter(x => !x.fee.vorstand);
  const expected = l.reduce((s, x) => s + x.fee.amount, 0);
  const paid = l.filter(x => x.st === "bezahlt").reduce((s, x) => s + x.fee.amount, 0);
  const payers = l.filter(x => x.fee.amount > 0).length;
  return { expected, paid, open:expected - paid, payers, avg:payers ? expected / payers : 0,
    helpAwb:feeList().filter(x => x.h.awb).length, helpAuf:feeList().filter(x => x.h.aufbau).length };
}
function finance(){
  const f = fin || {};
  const sorted = bookings.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.at || 0) - (b.at || 0));
  const sumIn = sorted.reduce((s, b) => s + num(b.in), 0), sumOut = sorted.reduce((s, b) => s + num(b.out), 0);
  const opening = num(f.opening), openingCash = num(f.openingCash), cash = num(f.cash);
  const closing = opening + sumIn - sumOut;
  const total = closing + cash;
  const cats = (key) => {
    const m = {};
    sorted.forEach(b => { const v = num(b[key]); if(v) m[b.cat || "Diverses"] = (m[b.cat || "Diverses"] || 0) + v; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const awb = f.awb || {};
  const awbCost = (awb.costs || []).reduce((s, x) => s + num(x.betrag), 0);
  const awbInc = (awb.income || []).reduce((s, x) => s + num(x.betrag), 0);
  return { sorted, sumIn, sumOut, opening, openingCash, cash, closing, total, prevTotal:opening + openingCash, delta:total - (opening + openingCash),
    inCats:cats("in"), outCats:cats("out"), awb, awbCost, awbInc, awbProfit:awbInc - awbCost };
}
/* Platzhalter in Traktanden-Texten */
function tokens(){
  const F = finance(), v = V(), mu = mutations(), T = feeTotals();
  const nm = id => memberName(id);
  const mutText = [mu.in.length ? "Eintritte: " + mu.in.map(x => x.m.name).join(", ") : "", mu.out.length ? "Austritte: " + mu.out.map(x => x.m.name).join(", ") : ""].filter(Boolean).join(" · ") || "keine Ein- und Austritte";
  return {
    jahr:Y, kurz:String(Y).slice(2), vorjahr:String(parseInt(Y, 10) - 1), naechstes:String(parseInt(Y, 10) + 1), edition:String(edition()), vereinsjahr:vjLabel(),
    ...(finVisible() ? { gewinnAWB:CHF(F.awbProfit), vermoegen:CHF(F.total), kontostand:CHF(F.closing), kasse:CHF(F.cash) }
      : { gewinnAWB:"(an der GV)", vermoegen:"(an der GV)", kontostand:"(an der GV)", kasse:"(an der GV)" }),
    beitrag:CHFr(num(v.fee)), rabatt:CHFr(num(v.discount)), twint:v.twint || "", beitraegeErwartet:CHF(T.expected), beitraegeOffen:finVisible() ? CHF(T.open) : "(an der GV)",
    praesident:nm(v.vorstand.praesident), aktuar:nm(v.vorstand.aktuar), kassier:nm(v.vorstand.kassier), stimmenzaehler:nm(v.stimmenzaehler),
    mitglieder:String(members().length), mutationen:mutText
  };
}
const fill = s => String(s || "").replace(/\{(\w+)\}/g, (m, k) => { const t = tokens(); return t[k] != null ? t[k] : m; });
/* «Text → Frage» als Paar */
function parseItems(text){
  const items = [];
  String(text || "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim()).forEach(l => {
    const sub = /^\s*[-–]\s*/.test(l);
    const t = fill(l.replace(/^\s*[-–•▪]\s*/, ""));
    if(sub && items.length) items[items.length - 1].sub.push(t);
    else items.push({ t, sub:[] });
  });
  return items;
}
function traktanden(){
  const list = ((gv && gv.traktanden) || []).map(t => Object.assign({}, t, { items:parseItems(t.text) }));
  const acc = antraege.filter(a => a.status === "aufgenommen");
  list.forEach(t => { if(t.antraege && acc.length) t.items.push({ t:"Eingereichte Anträge", sub:acc.map(a => `${a.title} (${a.byName})`) }); });
  return list;
}
const arrowHtml = t => { const [a, ...rest] = t.split("→"); return rest.length ? `${esc(a.trim())} <span class="arrow">→ ${esc(rest.map(x => x.trim()).join(" → "))}</span>` : esc(t); };
const qPart = t => { const [a, ...rest] = t.split("→"); return [a.trim(), rest.map(x => x.trim()).join(" → ")]; };

/* ---------- Gerüst ---------- */
function draw(){
  const app = document.getElementById("app");
  if(!me) return;
  const fm = MODE === "finanzen";
  const tabs = fm ? [["beitraege", "Jahresbeiträge"], ["konto", "Kontobewegungen & AWB"]]
    : [["uebersicht", "Übersicht & Druck"], ["traktanden", "Traktanden"], ["mitglieder", "Mitglieder"], ["protokoll", "Protokoll"]];
  if(!fm && gv && gv.chunks) tabs.push(["archiv", "PDF"]);
  if(!fm && canGV()) tabs.push(["einstellungen", "Einstellungen"]);
  const T = Y ? feeTotals() : null;
  const stats = !Y || (fm && !finVisible()) ? "" : fm ? `
        <div class="stat-chip"><span class="num">${fin ? esc(CHF(finance().total).replace("CHF ", "")) : "–"}</span><span class="lbl">Vermögen CHF</span></div>
        <div class="stat-chip"><span class="num">${feeList().filter(x => !x.fee.vorstand && x.fee.amount > 0 && x.st === "bezahlt").length}/${T.payers}</span><span class="lbl">Beiträge bezahlt</span></div>
        <div class="stat-chip"><span class="num">${esc(CHF(T.open).replace("CHF ", ""))}</span><span class="lbl">offen CHF</span></div>` : `
        <div class="stat-chip"><span class="num">${members().length}</span><span class="lbl">Mitglieder</span></div>
        ${fin ? `<div class="stat-chip"><span class="num">${esc(CHF(finance().total).replace("CHF ", ""))}</span><span class="lbl">Vermögen CHF</span></div>` : ""}
        <div class="stat-chip"><span class="num">${antraege.filter(a => a.status === "neu").length}</span><span class="lbl">neue Vorschläge</span></div>`;
  app.innerHTML = `
    <div class="topbar"><span class="crumbs"><a href="../">MST Ermatingen</a> / ${fm ? "Finanzen" : "GV"}</span><div id="userbar"></div></div>
    <div class="hero">
      <div class="hero-left">
        <img class="hero-logo" src="../assets/logo.png" alt="">
        <div class="hero-titles">
          <span class="eyebrow">${fm ? (Y ? `Vereinsjahr ${dCH(vjStart())} – ${dCH(vjEnd())} · Kassier ${esc(memberName(V().vorstand.kassier))}` : "Vereinsjahr")
            : Y ? `${edition()}. Generalversammlung · ${esc(gvWhen())}` : "Generalversammlung"}</span>
          <h1 class="hero-title">${fm ? `Finanzen ${Y ? esc(vjLabel()) : ""}` : `GV ${esc(Y || "")}`}</h1>
          <p class="hero-sub">${fm ? (fin && fin.shared ? "Jahresbeiträge, Kontobewegungen und Afterworkbar-Abrechnung – an der GV für alle Mitglieder freigegeben" : "Jahresbeiträge, Kontobewegungen und Afterworkbar-Abrechnung – während des Vereinsjahrs nur für den Vorstand") : "Traktanden, Mitglieder und Protokoll – nur für Mitglieder"}</p>
          ${years.length > 1 ? `<select class="season-select" id="yearSelect">${years.slice().reverse().map(y => `<option value="${y}" ${y === Y ? "selected" : ""}>${fm ? `Vereinsjahr ${parseInt(y, 10) - 1}/${y.slice(2)}` : `GV ${y}`}</option>`).join("")}</select>` : ""}
        </div>
      </div>
      ${Y ? `<div class="hero-stats">${stats}
      </div>` : ""}
    </div>
    <div class="court-line"></div>
    <nav class="tabbar">${tabs.map(([k, l]) => `<button class="tabbtn ${tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav>
    <section class="panel" id="content"></section>`;
  MST.renderUserBar();
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); window.scrollTo(0, 0); });
  const ys = document.getElementById("yearSelect");
  if(ys) ys.onchange = () => openYear(ys.value);
  const c = document.getElementById("content");
  if(!Y || !gv){ c.innerHTML = `<div class="card"><p class="muted">${Y ? "lade …" : fm ? 'Noch kein Vereinsjahr – zuerst auf der <a href="../gv/">GV-Seite</a> eine GV anlegen.' : "Noch keine GV angelegt."}</p>${canGV() && !Y && !fm ? '<button class="btn-primary" id="firstGV">GV anlegen</button>' : ""}</div>`; return; }
  if(fm && !finVisible()){ c.innerHTML = `<div class="card"><h3>Nur für den Vorstand</h3><p class="muted">Die Finanzen ${esc(vjLabel())} sieht während des Vereinsjahrs nur der Vorstand. An der GV gibt der Kassier sie für alle frei.</p></div>`; return; }
  const views = fm ? { beitraege:viewFees, konto:viewFinance }
    : { uebersicht:viewOverview, traktanden:viewTraktanden, mitglieder:viewMembers, protokoll:viewProtocol, archiv:viewArchive, einstellungen:viewSettings };
  (views[tab] || Object.values(views)[0])(c);
  if(fm && canFin()){ c.insertAdjacentHTML("afterbegin", shareToggle()); bindShareToggle(); }
}
function scalePages(){
  document.querySelectorAll(".paper").forEach(p => {
    const w = p.clientWidth;
    p.querySelectorAll(".page").forEach(pg => { pg.style.zoom = Math.min(1, (w - 4) / 794); });
  });
}
window.addEventListener("resize", scalePages);
async function doPrint(html){
  const root = document.getElementById("printRoot");
  root.innerHTML = html;
  await Promise.all([...root.querySelectorAll("img")].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  try{ await document.fonts.ready; }catch(e){}
  window.print();
}

/* =================== ÜBERSICHT (Druck) =================== */
function viewOverview(c){
  const T = feeTotals(), F = finance();
  c.innerHTML = `
    <div class="toolbar-row">
      <button class="btn-primary" id="printOv">🖨 Übersicht drucken</button>
      <button class="btn-ghost" id="printProt">🖨 Protokoll ${prot && prot.att && Object.keys(prot.att).length ? "" : "(Vorlage)"} drucken</button>
      <span class="spacer"></span>
      <span class="small muted">Druckt im Stil der GV-Übersicht 2026 (Calibri, A4). Im Druckdialog «Hintergrundgrafiken» einschalten.</span>
    </div>
    <div class="kpi-row">
      ${finVisible() ? `<div class="kpi"><div class="v">${esc(CHF(F.total))}</div><div class="l">Vermögen</div></div>
      <div class="kpi"><div class="v">${esc(CHF(F.awbProfit))}</div><div class="l">Gewinn Afterworkbar</div></div>
      <div class="kpi"><div class="v">${esc(CHF(T.open))}</div><div class="l">Beiträge offen</div></div>` : ""}
      <div class="kpi"><div class="v">${traktanden().length}</div><div class="l">Traktanden</div></div>
    </div>
    ${finVisible() ? "" : '<p class="rule-note">Die Finanzen sieht während des Vereinsjahrs nur der Vorstand – an der GV werden sie für alle freigegeben.</p>'}
    <div class="paper">${buildOverview()}</div>`;
  scalePages();
  document.getElementById("printOv").onclick = () => doPrint(buildOverview());
  document.getElementById("printProt").onclick = () => doPrint(buildProtocol());
}
let pageNo = 0;
function foot(kind){ pageNo++; return `<div class="foot"><img src="../assets/gv-logo-klein.png" alt=""><span>MST Ermatingen · ${kind ? kind + " " : ""}${edition()}. Generalversammlung ${esc(Y)} · Seite ${pageNo}</span></div>`; }
function bar(title, sub){ return `<div class="bar"><div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div><img src="../assets/gv-hundekopf.png" alt=""></div>`; }
function titlePage(tag){
  pageNo = 1;
  return `<div class="page title"><div class="ed">${edition()}. Generalversammlung</div><div class="club">MST Ermatingen</div><div class="when">${esc(gvMonth())}</div>
    <div class="tag">${esc(tag)}</div><div class="art"><img class="logo" src="../assets/gv-logo.png" alt=""><img class="dog" src="../assets/gv-hund.png" alt=""></div></div>`;
}
function tkHtml(t, i){
  return `<div class="tk"><div class="n">${i + 1}</div><div><div class="h">${esc(fill(t.title))}</div>
    <ul>${t.items.map(it => `<li>${arrowHtml(it.t)}${it.sub.length ? `<ul>${it.sub.map(s => `<li>${arrowHtml(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul></div></div>`;
}
function buildOverview(){
  const tks = traktanden();
  const F = finance(), T = feeTotals(), v = V(), mu = mutations();
  let html = titlePage("Traktanden & Finanzen");
  // Traktanden auf Seiten verteilen (grob nach Zeilen)
  const pages = [[]]; let lines = 0;
  tks.forEach((t, i) => {
    const l = 2.5 + t.items.length * 1.1 + t.items.reduce((s, it) => s + it.sub.length, 0);
    if(lines + l > (pages.length === 1 ? 40 : 46) && pages[pages.length - 1].length){ pages.push([]); lines = 0; }
    pages[pages.length - 1].push(i); lines += l;
  });
  pages.forEach((idx, pi) => {
    html += `<div class="page">${pi === 0 ? bar("Traktanden", `${edition()}. Generalversammlung MST Ermatingen · ${gvMonth()}`) : ""}${idx.map(i => tkHtml(tks[i], i)).join("")}${foot()}</div>`;
  });
  // Finanzen (für Mitglieder erst nach der Freigabe an der GV)
  if(finVisible()){
  const maxIn = Math.max(1, ...F.inCats.map(x => x[1])), maxOut = Math.max(1, ...F.outCats.map(x => x[1]));
  const prevProfit = (F.awb.profits || {})[String(parseInt(Y, 10) - 1)];
  html += `<div class="page">${bar(`Finanzen ${vjLabel()}`, `Vereinsjahr ${dCH(vjStart())} – ${dCH(vjEnd())} · Kassier: ${memberName(v.vorstand.kassier)}`)}
    <div class="lbl">Auf einen Blick</div>
    <div class="kpis">
      <div><div class="l">Vermögen</div><div class="v">${CHF(F.total)}</div><div class="s">Konto + Kasse</div></div>
      <div><div class="l">ggü. Vorjahr</div><div class="v ${F.delta < 0 ? "neg" : ""}">${CHF(F.delta)}</div><div class="s">GV ${parseInt(Y, 10) - 1}: ${CHF(F.prevTotal)}</div></div>
      <div><div class="l">Gewinn AWB</div><div class="v">${CHF(F.awbProfit)}</div><div class="s">${prevProfit != null ? "Vorjahr " + CHF(prevProfit) : ""}</div></div>
      <div><div class="l">Beiträge offen</div><div class="v">${CHF(T.open)}</div><div class="s">${T.payers} Zahlende, Ø ${CHF(T.avg)}</div></div>
    </div>
    <div class="lbl">Geldfluss Vereinsjahr ${vjLabel()}</div>
    <table class="t flow"><tbody>
      <tr><td></td><td>Kontostand zu Beginn des Vereinsjahrs (GV ${parseInt(Y, 10) - 1})</td><td class="num">${CHF(F.opening)}</td></tr>
      <tr><td>+</td><td>Einnahmen Vereinsjahr</td><td class="num">${CHF(F.sumIn)}</td></tr>
      <tr><td>−</td><td>Ausgaben Vereinsjahr</td><td class="num">${CHF(F.sumOut)}</td></tr>
      <tr><td>=</td><td><b>Kontostand ${dCH(vjEnd())}</b></td><td class="num"><b>${CHF(F.closing)}</b></td></tr>
      <tr><td>+</td><td>Bargeld in der MST-Kasse</td><td class="num">${CHF(F.cash)}</td></tr>
      <tr class="hl"><td>=</td><td>Total Vereinsvermögen</td><td class="num">${CHF(F.total)}</td></tr>
    </tbody></table>
    <div class="lbl">Einnahmen nach Bereich</div>
    <table class="bars" style="width:100%; border-collapse:collapse"><tbody>${F.inCats.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="bar-cell"><div class="b" style="width:${(x / maxIn * 100).toFixed(1)}%"></div></td><td style="text-align:right; font-weight:700">${CHF(x)}</td></tr>`).join("")}</tbody></table>
    <div class="lbl">Ausgaben nach Bereich</div>
    <table class="bars" style="width:100%; border-collapse:collapse"><tbody>${F.outCats.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="bar-cell"><div class="b dark" style="width:${(x / maxOut * 100).toFixed(1)}%"></div></td><td style="text-align:right; font-weight:700">${CHF(x)}</td></tr>`).join("")}</tbody></table>
    ${foot()}</div>`;
  // Kontobewegungen
  let rows = `<tr class="it"><td></td><td>Kontostand zu Beginn</td><td></td><td class="num">${CHF(F.opening)}</td></tr>`;
  let run = F.opening, lastYear = null;
  F.sorted.forEach(b => {
    const yr = (b.date || "").slice(0, 4);
    if(lastYear && yr !== lastYear) rows += `<tr class="it"><td>31.12.${lastYear}</td><td>Saldo per Ende ${lastYear} – ab hier Buchungen ${yr}</td><td></td><td class="num">${CHF(run)}</td></tr>`;
    lastYear = yr;
    run += num(b.in) - num(b.out);
    rows += `<tr><td>${dCH(b.date)}</td><td>${esc(b.text)}</td><td class="num">${num(b.out) ? CHF(num(b.out)) : ""}</td><td class="num">${num(b.in) ? CHF(num(b.in)) : ""}</td></tr>`;
  });
  html += `<div class="page">${bar("Kontobewegungen", `Abrechnung MST · Vereinsjahr ${dCH(vjStart())} – ${dCH(vjEnd())}`)}
    <table class="t"><thead><tr><th style="width:18mm">Datum</th><th>Was</th><th class="num">Ausgaben</th><th class="num">Einnahmen</th></tr></thead><tbody>${rows}
      <tr class="sum"><td></td><td>Total Ein / Aus Vereinsjahr</td><td class="num">${CHF(F.sumOut)}</td><td class="num">${CHF(F.sumIn)}</td></tr>
      <tr class="hl"><td>${dCH(vjEnd())}</td><td>Saldo gemäss Konto (+ Kasse ${CHF(F.cash).replace("CHF ", "")} = Total ${CHF(F.total).replace("CHF ", "")})</td><td></td><td class="num">${CHF(F.closing)}</td></tr>
    </tbody></table>${foot()}</div>`;
  // Afterworkbar
  if((F.awb.costs || []).length || (F.awb.income || []).length){
    const prof = Object.assign({}, F.awb.profits || {}, { [Y]:F.awbProfit });
    const ys = Object.keys(prof).sort().slice(-4);
    html += `<div class="page">${bar(`Afterworkbar ${Y}`, "Abrechnung · Gewinn im Vergleich zu den Vorjahren")}
      <div class="lbl">Gewinn im Vergleich</div>
      <div class="kpis">${ys.map(y => `<div class="${y === String(Y) ? "hi" : ""}"><div class="l">Gewinn ${y}</div><div class="v">${CHF(prof[y])}</div>${y === String(Y) && prof[String(Y - 1)] != null ? `<div class="s">${CHF(prof[y] - prof[String(Y - 1)])} ggü. Vorjahr</div>` : ""}</div>`).join("")}</div>
      <div class="lbl">Ausgaben</div>
      <table class="t"><thead><tr><th>Was</th><th>Wo</th><th class="num">Betrag</th><th>Bemerkung</th></tr></thead><tbody>
        ${(F.awb.costs || []).map(x => `<tr><td>${esc(x.was)}</td><td>${esc(x.wo || "")}</td><td class="num">${x.betrag === "" || x.betrag == null ? "–" : CHF(num(x.betrag))}</td><td class="small">${esc(x.bem || "")}</td></tr>`).join("")}
        <tr class="sum"><td>Totale Kosten AWB</td><td></td><td class="num">${CHF(F.awbCost)}</td><td></td></tr></tbody></table>
      <div class="lbl">Einnahmen</div>
      <table class="t"><thead><tr><th>Was</th><th class="num">Betrag</th><th></th></tr></thead><tbody>
        ${(F.awb.income || []).map(x => `<tr><td>${esc(x.was)}</td><td class="num">${CHF(num(x.betrag))}</td><td></td></tr>`).join("")}
        <tr class="sum"><td>Zwischentotal</td><td class="num">${CHF(F.awbInc)}</td><td></td></tr>
        <tr class="hl"><td>Gewinn Afterworkbar ${Y}</td><td class="num">${CHF(F.awbProfit)}</td><td class="small" style="color:#FFF200">Einnahmen − Kosten${F.awb.kassenstockNeu ? " · Kassenstock neu: " + CHFr(num(F.awb.kassenstockNeu)) : ""}</td></tr></tbody></table>
      ${foot()}</div>`;
  }
  }
  // Mitglieder & Helfereinsätze
  const fl = feeList();
  html += `<div class="page">${bar("Mitglieder & Helfereinsätze", `Jahresbeitrag ${CHFr(num(v.fee))} · pro Helfereinsatz ${CHFr(num(v.discount))} Rabatt · Vorstand befreit`)}
    <table class="t"><thead><tr><th style="width:9mm">Nr.</th><th>Alias</th><th>Name</th><th class="c">AWB</th><th class="c">Auf-/Abbau</th><th class="num">Beitrag</th>${finVisible() ? '<th class="c">bezahlt</th>' : ""}</tr></thead><tbody>
    ${fl.map(x => `<tr><td>${x.id.slice(1)}</td><td><b>${esc(x.m.alias || x.m.short || "")}</b></td><td>${esc(x.m.name)}${x.fee.label && !x.fee.vorstand ? ` <span class="small">(${esc(x.fee.label)})</span>` : ""}</td>
      <td class="c">${x.h.awb ? "✓" : "–"}</td><td class="c">${x.h.aufbau ? "✓" : "–"}</td>
      <td class="num">${x.fee.vorstand ? '<span class="small">Vorstand</span>' : "<b>" + CHF(x.fee.amount) + "</b>"}</td>
      ${finVisible() ? `<td class="c">${x.fee.vorstand ? "" : `<span class="chk">${x.st === "bezahlt" ? "✓" : ""}</span>`}</td>` : ""}</tr>`).join("")}
    </tbody></table>
    ${mu.in.length || mu.out.length ? `<div class="lbl">Mutationen Vereinsjahr ${vjLabel()}</div><p style="margin:0">${mu.in.length ? "<b>Eintritte:</b> " + mu.in.map(x => `${esc(x.m.name)} (${dCH(x.d)})`).join(", ") : ""}${mu.in.length && mu.out.length ? "<br>" : ""}${mu.out.length ? "<b>Austritte:</b> " + mu.out.map(x => `${esc(x.m.name)} (${dCH(x.d)})`).join(", ") : ""}</p>` : ""}
    ${foot()}</div>`;
  // Jahresrückblick
  html += rueckblickPage();
  // Beschlüsse
  const essen = (gv.essen || []);
  const vac = vacancies();
  html += `<div class="page">${bar("Beschlüsse", "Was machen wir mit dem Geld? · Jahresbeiträge · Wahlen")}
    ${essen.length ? `<div class="lbl">Essen GV – Varianten</div>
    <p style="margin:0 0 2mm">Vereinsvermögen heute: ${CHF(F.total)}. Unter jeder Variante steht, was danach ungefähr übrig bleibt.</p>
    <div class="boxes">${essen.map((e, i) => `<div><div class="bh">Variante ${"ABCDEFG"[i]}</div><div class="bb"><b>${esc(e.title)}</b><div class="big">${e.amount ? "ca. " + CHFr(num(e.amount)) : "…"}</div>
      <div class="small">${e.amount ? "Rest ca. " + CHFr(F.total - num(e.amount)) : esc(e.sub || "Ideen einbringen")}</div></div></div>`).join("")}</div>
    <p style="margin:2mm 0 0"><b>→ Abstimmen</b></p>` : ""}
    <div class="lbl">Jahresbeiträge</div>
    <div class="box-y">Alle twinten den Jahresbeitrag direkt an ${esc(memberName(v.vorstand.kassier))}${v.twint ? `: <b>${esc(v.twint)}</b>` : ""}<br>
      <span style="font-size:8.5pt">${fl.length} Mitglieder (${vorstandIds().length} im Vorstand, ${T.payers} zahlend) · Helfereinsätze: ${T.helpAwb}× AWB, ${T.helpAuf}× Auf-/Abbau · erwartet ${CHF(T.expected)}${vac ? " · vakant: " + vac : ""}</span></div>
    <div class="lbl">Wahl des Vorstands</div>
    <div class="boxes three">${[["Präsident", v.vorstand.praesident], ["Aktuar", v.vorstand.aktuar], ["Kassier", v.vorstand.kassier]].map(([r, id]) => `<div><div class="bh">${r}</div><div class="bb"><b>${esc(memberName(id))}</b><br><span class="chk"></span>gewählt</div></div>`).join("")}</div>
    <div class="merci"><div><b>Merci fürs Mitmachen!</b>Auf ein weiteres starkes MST-Jahr – Prost!</div><img src="../assets/gv-hund.png" alt=""></div>
    ${foot()}</div>`;
  return html;
}
function vacancies(){
  const used = Object.keys(MST.directory).filter(id => isMemberId(id) && !MST.directory[id].left).map(id => parseInt(id.slice(1), 10));
  const max = Math.max(40, ...used), free = [];
  for(let n = 2; n <= max; n++) if(!used.includes(n)) free.push(n);
  // Bereiche zusammenfassen (38–40)
  const out = []; let s = null, p = null;
  free.forEach(n => { if(s == null){ s = p = n; } else if(n === p + 1){ p = n; } else { out.push(s === p ? s : `${s}–${p}`); s = p = n; } });
  if(s != null) out.push(s === p ? s : `${s}–${p}`);
  return out.join(", ");
}
/* Jahresrückblick (Spieltag, Afterworkbar, Mitglieder) */
function rueckblickData(){
  const r = {};
  if(histY && histY.rows){
    const top = histY.rows.filter(x => x.rank <= 3);
    r.spieltag = { n:histY.rows.length, d:(histY.disciplines || []).length, top };
  }
  if(beerY.length){
    const t = {};
    beerY.forEach(b => t[b.pid] = (t[b.pid] || 0) + b.l);
    const best = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
    r.beer = { pid:best[0], l:best[1] };
  }
  const helpers = new Set(shifts.filter(s => s.assignee).map(s => s.assignee));
  if(shifts.length) r.awb = { helpers:helpers.size, filled:shifts.filter(s => s.assignee).length, total:shifts.length };
  r.mu = mutations();
  return r;
}
function rueckblickPage(){
  const r = rueckblickData(), F = finance();
  const pname = pid => (pid || "").startsWith("m") ? ((MST.directory[pid] || {}).alias || (MST.directory[pid] || {}).short || pid) : pid.replace(/^g_/, "").replace(/_[a-z0-9]{4}$/, "");
  const boxes = [];
  if(r.spieltag) boxes.push(`<div><h3>🏆 Minispieltag ${Y}</h3><p>${r.spieltag.n} Teilnehmende, ${r.spieltag.d} Disziplinen</p>
    <p>${r.spieltag.top.map(x => `<b>${x.rank}.</b> ${esc(x.name)} (${x.total})`).join(" · ")}</p>${r.beer ? `<p>🍺 Bierkapitän: <b>${esc(pname(r.beer.pid))}</b> (${r.beer.l.toFixed(2)} l)</p>` : ""}</div>`);
  boxes.push(`<div><h3>🍹 Afterworkbar ${Y}</h3>${finVisible() ? `<p>Gewinn <b>${CHF(F.awbProfit)}</b></p>` : ""}${r.awb ? `<p>${r.awb.helpers} Helfer:innen, ${r.awb.filled} von ${r.awb.total} Einsätzen besetzt</p>` : ""}</div>`);
  boxes.push(`<div><h3>👥 Mitglieder</h3><p>${members().length} Mitglieder</p><p>${r.mu.in.length ? "Neu: " + r.mu.in.map(x => esc(x.m.name)).join(", ") : "keine Eintritte"}${r.mu.out.length ? "<br>Ausgetreten: " + r.mu.out.map(x => esc(x.m.name)).join(", ") : ""}</p></div>`);
  if(finVisible()) boxes.push(`<div><h3>💰 Finanzen</h3><p>Vermögen ${CHF(F.total)} (${F.delta >= 0 ? "+" : ""}${CHF(F.delta).replace("CHF ", "")} ggü. Vorjahr)</p></div>`);
  return `<div class="page">${bar(`Jahresrückblick ${vjLabel()}`, "Was im Vereinsjahr gelaufen ist")}
    <div class="rb">${boxes.join("")}</div>
    ${gv.rueckblick ? `<div class="lbl">Weitere Höhepunkte</div><div style="white-space:pre-wrap">${esc(fill(gv.rueckblick))}</div>` : ""}
    ${foot()}</div>`;
}

/* =================== TRAKTANDEN =================== */
function viewTraktanden(c){
  const tks = (gv.traktanden || []);
  const neu = antraege.filter(a => a.status === "neu");
  c.innerHTML = `<div class="grid2">
    <div class="stack">
      <div class="card"><h3>Traktandum vorschlagen</h3>
        <p class="rule-note">Für die GV ${esc(Y)}. Der Vorstand nimmt es in die Traktanden auf (unter «Anträge der Mitglieder»).</p>
        <form id="antragForm" class="form-grid" style="grid-template-columns:1fr">
          <label>Titel<input name="title" required placeholder="z. B. Neues Vereinsshirt"></label>
          <label>Worum geht es?<textarea name="text" rows="3"></textarea></label>
          <button class="btn-primary" type="submit">Vorschlagen</button>
        </form>
        <p class="form-msg small muted" id="aMsg"></p>
      </div>
      <div class="card"><h3>Vorschläge (${antraege.length})</h3>
        ${antraege.length ? antraege.map(a => `<div class="antrag"><b>${esc(a.title)}</b> <span class="pill ${a.status === "aufgenommen" ? "ok" : a.status === "neu" ? "warn" : ""}">${esc(a.status)}</span>
          ${a.text ? `<div>${esc(a.text)}</div>` : ""}<div class="meta">${esc(a.byName || "")} · ${new Date(a.at).toLocaleDateString("de-CH")}</div>
          ${canGV() ? `<div style="margin-top:4px">${a.status !== "aufgenommen" ? `<button class="btn-small" data-acc="${a.id}">aufnehmen</button>` : ""} ${a.status !== "abgelehnt" ? `<button class="btn-small" data-rej="${a.id}">ablehnen</button>` : ""} <button class="del-btn" data-delA="${a.id}">löschen</button></div>`
            : a.by === me.id && a.status === "neu" ? `<button class="del-btn" data-delA="${a.id}">zurückziehen</button>` : ""}</div>`).join("") : '<p class="muted">Noch keine.</p>'}
      </div>
    </div>
    <div class="card"><h3>Traktanden GV ${esc(Y)}</h3>
      ${canGV() ? `<p class="rule-note">Eine Zeile = Punkt, mit «- » davor = Unterpunkt, «→» für die Frage dahinter. Platzhalter werden automatisch ersetzt:</p>
        <div class="tokens">${Object.keys(tokens()).map(k => `<code>{${k}}</code>`).join(" ")}</div>
        <div id="tkList" style="margin-top:10px">${tks.map((t, i) => `<div class="tk-edit" data-i="${i}">
          <div class="row"><span class="nr">${i + 1}</span><input class="ti" data-f="title" value="${esc(t.title)}">
            <button class="btn-small" data-up="${i}" ${i ? "" : "disabled"}>↑</button><button class="btn-small" data-down="${i}" ${i < tks.length - 1 ? "" : "disabled"}>↓</button><button class="del-btn" data-del="${i}">✕</button></div>
          <textarea data-f="text">${esc(t.text || "")}</textarea>
          <div class="opts"><label><input type="checkbox" data-f="vote" ${t.vote ? "checked" : ""}> Abstimmung im Protokoll</label>
            <label><input type="checkbox" data-f="table" ${t.table ? "checked" : ""}> Unterpunkte als Tabelle im Protokoll</label>
            <label><input type="checkbox" data-f="antraege" ${t.antraege ? "checked" : ""}> aufgenommene Vorschläge hier anhängen</label></div>
        </div>`).join("")}</div>
        <button class="btn-ghost" id="tkAdd">+ Traktandum</button> <span class="save-note" id="tkSave"></span>`
      : `<div class="paper">${traktanden().map((t, i) => `<div style="margin-bottom:10px"><b style="color:var(--yellow)">${i + 1}</b> <b>${esc(fill(t.title))}</b><ul style="margin:4px 0 0">${t.items.map(it => `<li>${esc(it.t)}${it.sub.length ? `<ul>${it.sub.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul></div>`).join("")}</div>`}
    </div></div>`;
  document.getElementById("antragForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await MST.quick(db.collection("gv").doc(Y).collection("antraege").add({ title:f.title.value.trim(), text:f.text.value.trim(), by:me.id, byName:me.short || me.name, at:Date.now(), status:"neu" }));
    MST.log("gv", `Traktandum vorgeschlagen: ${f.title.value.trim()}`);
    f.reset();
  };
  c.querySelectorAll("[data-delA]").forEach(b => b.onclick = () => { if(confirm("Vorschlag löschen?")) db.collection("gv").doc(Y).collection("antraege").doc(b.dataset.dela || b.getAttribute("data-delA")).delete(); });
  c.querySelectorAll("[data-acc]").forEach(b => b.onclick = async () => {
    await MST.quick(db.collection("gv").doc(Y).collection("antraege").doc(b.dataset.acc).update({ status:"aufgenommen" }));
    // sicherstellen, dass ein Traktandum die Vorschläge anzeigt
    const list = (gv.traktanden || []).slice();
    if(!list.some(t => t.antraege)){
      const i = list.findIndex(t => /antr/i.test(t.title));
      if(i >= 0) list[i] = Object.assign({}, list[i], { antraege:true });
      else list.splice(Math.max(0, list.length - 2), 0, { id:uid(), title:"Anträge der Mitglieder", text:"Besprechung und Abstimmung über eingereichte Anträge", vote:true, antraege:true });
      await saveTk(list);
    }
  });
  c.querySelectorAll("[data-rej]").forEach(b => b.onclick = () => db.collection("gv").doc(Y).collection("antraege").doc(b.dataset.rej).update({ status:"abgelehnt" }));
  if(!canGV()) return;
  c.querySelectorAll(".tk-edit [data-f]").forEach(el => {
    const ev = el.type === "checkbox" ? "change" : "input";
    el.addEventListener(ev, () => {
      const i = +el.closest(".tk-edit").dataset.i;
      const list = (gv.traktanden || []).map(t => Object.assign({}, t));
      list[i][el.dataset.f] = el.type === "checkbox" ? el.checked : el.value;
      gv.traktanden = list;
      document.getElementById("tkSave").textContent = "speichert …";
      clearTimeout(saveTimer); saveTimer = setTimeout(() => saveTk(list).then(() => { const s = document.getElementById("tkSave"); if(s) s.textContent = "gespeichert ✓"; }), 700);
    });
  });
  c.querySelectorAll("[data-up],[data-down]").forEach(b => b.onclick = () => {
    const i = +(b.dataset.up || b.dataset.down), j = b.dataset.up != null ? i - 1 : i + 1;
    const list = (gv.traktanden || []).slice(); [list[i], list[j]] = [list[j], list[i]]; saveTk(list);
  });
  c.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { if(confirm("Traktandum löschen?")){ const list = (gv.traktanden || []).slice(); list.splice(+b.dataset.del, 1); saveTk(list); } });
  document.getElementById("tkAdd").onclick = () => saveTk((gv.traktanden || []).concat([{ id:uid(), title:"Neues Traktandum", text:"", vote:false }]));
}
async function saveTk(list){
  await db.collection("gv").doc(Y).set({ traktanden:list }, { merge:true });
}

/* =================== MITGLIEDER (GV) =================== */
function viewMembers(c){
  const mu = mutations(), v = V(), fl = feeList();
  c.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="v">${members().length}</div><div class="l">Mitglieder (${vorstandIds().length} Vorstand)</div></div>
      <div class="kpi"><div class="v">${mu.in.length}</div><div class="l">Eintritte</div></div>
      <div class="kpi"><div class="v">${mu.out.length}</div><div class="l">Austritte</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Mutationen Vereinsjahr ${esc(vjLabel())}</h3>
        <p class="rule-note">Kommt automatisch aus der Mitgliederverwaltung (Eintritt/Austritt) auf der Startseite.</p>
        <p><b>Eintritte:</b> ${mu.in.length ? mu.in.map(x => `${esc(x.m.name)} (${dCH(x.d)})`).join(", ") : "keine"}</p>
        <p><b>Austritte:</b> ${mu.out.length ? mu.out.map(x => `${esc(x.m.name)} (${dCH(x.d)})`).join(", ") : "keine"}</p>
        ${mu.late.length ? `<p><b>Nach der GV eingetreten (zahlen ${esc(CHFr(num(v.fee)))}):</b> ${mu.late.map(x => `${esc(x.m.name)} (${dCH(x.d)})`).join(", ")}</p>` : ""}
        <p class="small muted">Freie Nummern: ${esc(vacancies())}</p>
      </div>
      <div class="card"><h3>Vorstand</h3>
        <p>Präsident: <b>${esc(memberName(v.vorstand.praesident))}</b><br>Aktuar: <b>${esc(memberName(v.vorstand.aktuar))}</b><br>Kassier: <b>${esc(memberName(v.vorstand.kassier))}</b>${v.twint ? ` (Twint ${esc(v.twint)})` : ""}</p>
        ${finVisible() ? `<p class="rule-note" style="margin:10px 0 0">Jahresbeiträge und Kontobewegungen: <a href="../finanzen/${Y ? "?jahr=" + esc(Y) : ""}">Finanzen →</a></p>` : ""}
      </div>
    </div>
    <div class="card" style="margin-top:12px"><h3>Mitgliederliste</h3>
      <div class="tbl-scroll"><table class="lst"><thead><tr><th>Nr.</th><th>Alias</th><th>Name</th><th>AWB</th><th>Auf-/Abbau</th></tr></thead><tbody>
      ${fl.map(x => `<tr><td>${x.id.slice(1)}</td><td><b>${esc(x.m.alias || x.m.short || "")}</b></td><td>${esc(x.m.name)}${x.fee.vorstand ? ' <span class="small muted">Vorstand</span>' : ""}</td>
        <td>${x.h.awb ? "✓" : "–"}</td><td>${x.h.aufbau ? "✓" : "–"}</td></tr>`).join("")}
      </tbody></table></div>
    </div>`;
}

/* =================== JAHRESBEITRÄGE (Finanzen) =================== */
function viewFees(c){
  const fl = feeList(), T = feeTotals(), v = V();
  const edit = canFin();
  const stLabel = { offen:"offen", angefordert:"Twint angefordert", bezahlt:"bezahlt", erlassen:"erlassen" };
  c.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="v">${fl.length}</div><div class="l">Mitglieder (${vorstandIds().length} Vorstand)</div></div>
      <div class="kpi"><div class="v">${esc(CHF(T.expected))}</div><div class="l">Beiträge erwartet</div></div>
      <div class="kpi"><div class="v">${esc(CHF(T.paid))}</div><div class="l">bezahlt</div></div>
      <div class="kpi"><div class="v">${esc(CHF(T.open))}</div><div class="l">offen</div></div>
    </div>
    <div class="card">
      <h3>Jahresbeiträge ${esc(Y)}</h3>
      <p class="rule-note">Beitrag ${esc(CHFr(num(v.fee)))}, pro Helfereinsatz ${esc(CHFr(num(v.discount)))} Rabatt (AWB-Schicht/Sonderjob und Auf-/Abbau, aus dem Einsatzplan der Afterworkbar ${esc(Y)}); Vorstand befreit. Wer nach der GV eintritt, zahlt den vollen aktuellen Beitrag. ${edit ? "Häkchen bei AWB/Aufbau übersteuern den Einsatzplan." : ""}</p>
      ${edit ? `<div class="toolbar-row" style="margin:0 0 10px">
        <button class="btn-primary" id="groupMsg">💬 Sammelnachricht für den Gruppenchat</button>
        <span class="small muted">💬 pro Zeile = WhatsApp an die Person (mit Handynummer direkt, sonst Kontakt auswählen). Danach steht «Twint angefordert».</span></div>` : ""}
      <div class="tbl-scroll"><table class="lst"><thead><tr><th>Nr.</th><th>Alias</th><th>Name</th><th>AWB</th><th>Auf-/Abbau</th><th class="num">Beitrag</th><th>Status</th>${edit ? "<th>Handy</th><th></th><th>Bemerkung</th>" : ""}</tr></thead><tbody>
      ${fl.map(x => `<tr data-m="${x.id}" class="${!x.fee.vorstand && x.st === "bezahlt" ? "paid" : ""}"><td>${x.id.slice(1)}</td><td><b>${esc(x.m.alias || x.m.short || "")}</b></td><td>${esc(x.m.name)}${x.fee.label && !x.fee.vorstand ? `<div class="small muted">${esc(x.fee.label)}</div>` : ""}</td>
        <td>${edit && !x.fee.vorstand ? `<input type="checkbox" data-k="awb" ${x.h.awb ? "checked" : ""}>` : x.h.awb ? "✓" : "–"}</td>
        <td>${edit && !x.fee.vorstand ? `<input type="checkbox" data-k="aufbau" ${x.h.aufbau ? "checked" : ""}>` : x.h.aufbau ? "✓" : "–"}</td>
        <td class="num">${x.fee.vorstand ? '<span class="muted">Vorstand</span>' : esc(CHF(x.fee.amount))}</td>
        <td>${x.fee.vorstand ? "" : edit ? `<select data-k="status">${Object.entries(stLabel).map(([k, l]) => `<option value="${k}" ${x.st === k ? "selected" : ""}>${l}</option>`).join("")}</select>`
          : `<span class="pill ${x.st === "bezahlt" ? "ok" : x.st === "angefordert" ? "warn" : ""}">${stLabel[x.st]}</span>`}${(fees[x.id] || {}).paidAt && x.st === "bezahlt" ? `<div class="small muted">${dCH(fees[x.id].paidAt)}</div>` : ""}</td>
        ${edit ? `<td><input data-phone="${x.id}" value="${esc((contacts[x.id] || {}).phone || "")}" placeholder="079 …" inputmode="tel" style="min-width:110px"></td>
          <td>${!x.fee.vorstand && x.fee.amount > 0 && x.st !== "bezahlt" ? `<button class="btn-small" data-wa="${x.id}" title="${esc(feeMessage(x))}">💬</button>` : ""}</td>
          <td>${x.fee.vorstand ? "" : `<input data-k="note" value="${esc((fees[x.id] || {}).note || "")}" placeholder="z. B. per Twint">`}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>
      ${edit ? `<div class="btn-row" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px"><button class="btn-small" id="reqAll">alle offenen als «Twint angefordert» markieren</button></div>` : ""}
    </div>`;
  if(!edit) return;
  const ref = id => db.collection("finance").doc(Y).collection("fees").doc(id);
  c.querySelectorAll("tr[data-m] [data-k]").forEach(el => el.onchange = async () => {
    const id = el.closest("tr").dataset.m, k = el.dataset.k;
    const patch = {};
    if(el.type === "checkbox") patch[k] = el.checked;
    else patch[k] = el.value;
    if(k === "status") patch.paidAt = el.value === "bezahlt" ? new Date().toISOString().slice(0, 10) : null;
    await MST.quick(ref(id).set(patch, { merge:true }));
    if(k === "status") MST.log("finanzen", `Beitrag ${Y} ${memberName(id)}: ${el.value}`);
  });
  c.querySelectorAll("[data-phone]").forEach(el => el.onchange = async () => {
    await db.collection("contacts").doc(el.dataset.phone).set({ phone:el.value.trim() }, { merge:true });
  });
  c.querySelectorAll("[data-wa]").forEach(b => b.onclick = async () => {
    const x = feeList().find(y => y.id === b.dataset.wa);
    const nr = waNumber((contacts[x.id] || {}).phone);
    window.open(waLink(nr, feeMessage(x)), "_blank");
    await markRequested([x.id]);
    MST.log("finanzen", `Beitrag ${Y} ${x.m.name}: per WhatsApp angefordert`);
  });
  document.getElementById("groupMsg").onclick = () => {
    const open = feeList().filter(x => !x.fee.vorstand && x.fee.amount > 0 && x.st !== "bezahlt" && x.st !== "erlassen");
    let dlg = document.getElementById("waDlg");
    if(!dlg){ dlg = document.createElement("dialog"); dlg.id = "waDlg"; document.body.appendChild(dlg); }
    dlg.style.width = "min(560px, calc(100vw - 24px))";
    dlg.innerHTML = `<form method="dialog"><h3>Sammelnachricht (${open.length} offen)</h3>
      <textarea id="waText" rows="14" style="width:100%; font-family:var(--font-body); font-size:13px">${esc(groupMessage(open))}</textarea>
      <label class="check-label" style="flex-direction:row; gap:8px; align-items:center; text-transform:none; letter-spacing:0; font-size:13px"><input type="checkbox" id="waMark" checked> alle danach als «Twint angefordert» markieren</label>
      <div class="dlg-actions"><button type="button" class="btn-ghost" id="waCopy">Kopieren</button><div class="right"><button type="button" class="btn-ghost" id="waClose">Schliessen</button><button type="button" class="btn-primary" id="waSend">In WhatsApp teilen</button></div></div></form>`;
    const done = async () => { if(document.getElementById("waMark").checked){ await markRequested(open.map(x => x.id)); MST.log("finanzen", `Beiträge ${Y}: Sammelnachricht an ${open.length} Mitglieder`); } };
    dlg.querySelector("#waClose").onclick = () => dlg.close();
    dlg.querySelector("#waCopy").onclick = async () => { try{ await navigator.clipboard.writeText(document.getElementById("waText").value); dlg.querySelector("#waCopy").textContent = "kopiert ✓"; await done(); }catch(e){ alert("Kopieren ging nicht – Text markieren und kopieren."); } };
    dlg.querySelector("#waSend").onclick = async () => { window.open(waLink("", document.getElementById("waText").value), "_blank"); await done(); dlg.close(); };
    dlg.showModal();
  };
  document.getElementById("reqAll").onclick = async () => {
    const open = feeList().filter(x => !x.fee.vorstand && x.st === "offen" && x.fee.amount > 0);
    if(!confirm(`${open.length} Mitglieder als «Twint angefordert» markieren?`)) return;
    const b = db.batch(); open.forEach(x => b.set(ref(x.id), { status:"angefordert" }, { merge:true })); await b.commit();
  };
}

/* ---------- Twint-Anforderung per WhatsApp ---------- */
// direkt api.whatsapp.com statt wa.me: die Weiterleitung von wa.me macht aus Emojis wie 🍻 ein «�»
const waLink = (nr, text) => `https://api.whatsapp.com/send?${nr ? "phone=" + nr + "&" : ""}text=${encodeURIComponent(text)}`;
function waNumber(phone){
  let d = String(phone || "").replace(/[^\d+]/g, "");
  if(d.startsWith("+")) d = d.slice(1);
  else if(d.startsWith("00")) d = d.slice(2);
  else if(d.startsWith("0")) d = "41" + d.slice(1);
  return d.length >= 10 ? d : "";
}
function feeReason(x){
  const parts = [];
  if(x.h.awb) parts.push("Afterworkbar");
  if(x.h.aufbau) parts.push("Auf-/Abbau");
  if(x.fee.label) return ` (${x.fee.label})`;
  return parts.length ? ` (schon mit ${CHFr(num(V().discount) * parts.length)} Rabatt für deinen Einsatz: ${parts.join(" + ")})` : "";
}
function feeMessage(x){
  const v = V(), k = memberName(v.vorstand.kassier);
  return `Hoi ${x.m.alias || x.m.short || x.m.name.split(" ")[0]}! Dein MST-Jahresbeitrag ${Y}: ${CHF(x.fee.amount)}${feeReason(x)}.\n`
    + `Bitte per Twint an ${k}${v.twint ? " (" + v.twint + ")" : ""}. Merci! – ${k.split(" ")[0]}`;
}
function groupMessage(list){
  const v = V(), k = memberName(v.vorstand.kassier);
  return `MST-Jahresbeiträge ${Y} – bitte per Twint an ${k}${v.twint ? " (" + v.twint + ")" : ""}:\n`
    + list.map(x => `• ${x.m.alias || x.m.short} ${CHF(x.fee.amount).replace("CHF ", "CHF ")}`).join("\n")
    + `\n(Rabatt CHF ${num(v.discount)}.– pro Helfereinsatz ist schon abgezogen.) Merci!`;
}
async function markRequested(ids){
  const b = db.batch();
  ids.forEach(id => { if(((fees[id] || {}).status || "offen") === "offen") b.set(db.collection("finance").doc(Y).collection("fees").doc(id), { status:"angefordert", requestedAt:new Date().toISOString().slice(0, 10) }, { merge:true }); });
  await b.commit();
}

/* ---------- Belege (Foto/PDF) zu Buchungen – Base64-Stücke in finance/<jahr>/belege ---------- */
const BELEG_CHUNK = 700000;
async function shrinkImage(file){
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return await new Promise(r => cv.toBlob(r, "image/jpeg", 0.72));
}
async function uploadBeleg(booking, file){
  let blob = file, type = file.type || "application/octet-stream";
  if(type.startsWith("image/")){ try{ blob = await shrinkImage(file); type = "image/jpeg"; }catch(e){ console.warn("Bild nicht verkleinert", e); } }
  if(blob.size > 4 * 1024 * 1024) throw new Error("Datei zu gross (max. 4 MB).");
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for(let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = btoa(bin), n = Math.ceil(b64.length / BELEG_CHUNK);
  const fref = db.collection("finance").doc(Y);
  const old = (booking.beleg && booking.beleg.chunks) || 0;
  for(let i = 0; i < n; i++) await fref.collection("belege").doc(`${booking.id}_${i}`).set({ data:b64.slice(i * BELEG_CHUNK, (i + 1) * BELEG_CHUNK) });
  for(let i = n; i < old; i++) await fref.collection("belege").doc(`${booking.id}_${i}`).delete();
  await fref.collection("bookings").doc(booking.id).set({ beleg:{ name:file.name, type, chunks:n, size:blob.size, at:Date.now(), by:me.id } }, { merge:true });
  MST.log("finanzen", `Beleg zu «${booking.text}» hochgeladen`);
}
async function openBeleg(booking){
  const w = window.open("", "_blank");
  try{
    const parts = await Promise.all([...Array(booking.beleg.chunks).keys()].map(i => db.collection("finance").doc(Y).collection("belege").doc(`${booking.id}_${i}`).get()));
    const bin = atob(parts.map(p => p.data().data).join(""));
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type:booking.beleg.type }));
    if(w) w.location.href = url; else location.href = url;
  }catch(e){ console.error(e); if(w) w.close(); alert("Beleg konnte nicht geladen werden."); }
}
async function deleteBeleg(booking){
  const fref = db.collection("finance").doc(Y);
  for(let i = 0; i < ((booking.beleg && booking.beleg.chunks) || 0); i++) await fref.collection("belege").doc(`${booking.id}_${i}`).delete();
  await fref.collection("bookings").doc(booking.id).set({ beleg:firebase.firestore.FieldValue.delete() }, { merge:true });
}

/* =================== FINANZEN =================== */
function belegCell(b, edit){
  const view = b.beleg ? `<button class="btn-small" data-open-beleg="${b.id}" title="${esc(b.beleg.name || "Beleg")}">${(b.beleg.type || "").includes("pdf") ? "📄" : "🧾"}</button>` : "";
  if(!edit) return view;
  return `${view}<button class="btn-small" data-attach="${b.id}" title="${b.beleg ? "Beleg ersetzen" : "Beleg anhängen"}">📎</button>${b.beleg ? `<button class="del-btn" data-unattach="${b.id}" title="Beleg entfernen">✕</button>` : ""}`;
}
function viewFinance(c){
  if(!fin && !canFin()){ c.innerHTML = '<div class="card"><p class="muted">Für dieses Jahr sind noch keine Finanzen erfasst.</p></div>'; return; }
  const F = finance(), edit = canFin();
  const cats = [...new Set(bookings.map(b => b.cat).filter(Boolean).concat(["Afterworkbar", "Mitgliederbeiträge", "Twint-Einnahmen", "MST Minispieltag", "GV-Essen", "MST Merch", "MST-Winterevent", "Padel-Saison", "Spielmaterial"]))].sort();
  const f = fin || {};
  c.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="v">${esc(CHF(F.total))}</div><div class="l">Vermögen (Konto + Kasse)</div></div>
      <div class="kpi"><div class="v">${esc(CHF(F.delta))}</div><div class="l">ggü. Vorjahr</div></div>
      <div class="kpi"><div class="v">${esc(CHF(F.sumIn))}</div><div class="l">Einnahmen</div></div>
      <div class="kpi"><div class="v">${esc(CHF(F.sumOut))}</div><div class="l">Ausgaben</div></div>
    </div>
    ${edit ? `<div class="card"><h3>Vereinsjahr ${esc(vjLabel())}</h3>
      <form class="form-grid" id="finForm">
        <label>Beginn<input type="date" name="vjStart" value="${esc(vjStart())}"></label>
        <label>Ende<input type="date" name="vjEnd" value="${esc(vjEnd())}"></label>
        <label>Kontostand zu Beginn<input name="opening" value="${esc(f.opening ?? "")}" inputmode="decimal"></label>
        <label>Kasse zu Beginn<input name="openingCash" value="${esc(f.openingCash ?? 0)}" inputmode="decimal"></label>
        <label>Bargeld Kasse jetzt<input name="cash" value="${esc(f.cash ?? 0)}" inputmode="decimal"></label>
        <button class="btn-primary" type="submit">Speichern</button>
      </form></div>` : ""}
    <div class="card" style="margin-top:12px"><h3>Kontobewegungen</h3>
      <div class="tbl-scroll"><table class="lst"><thead><tr><th style="width:130px">Datum</th><th>Was</th><th style="width:170px">Bereich</th><th class="num" style="width:110px">Ausgaben</th><th class="num" style="width:110px">Einnahmen</th><th style="width:70px">Beleg</th>${edit ? "<th></th>" : ""}</tr></thead><tbody>
      ${F.sorted.map(b => edit ? `<tr data-b="${b.id}"><td><input type="date" data-k="date" value="${esc(b.date || "")}"></td><td><input data-k="text" value="${esc(b.text || "")}"></td>
        <td><input data-k="cat" list="catList" value="${esc(b.cat || "")}"></td><td><input data-k="out" inputmode="decimal" value="${num(b.out) ? num(b.out).toFixed(2) : ""}" style="text-align:right"></td>
        <td><input data-k="in" inputmode="decimal" value="${num(b.in) ? num(b.in).toFixed(2) : ""}" style="text-align:right"></td><td>${belegCell(b, true)}</td><td><button class="del-btn" data-delb="${b.id}">✕</button></td></tr>`
        : `<tr><td>${dCH(b.date)}</td><td>${esc(b.text)}</td><td class="small muted">${esc(b.cat || "")}</td><td class="num">${num(b.out) ? esc(CHF(num(b.out))) : ""}</td><td class="num">${num(b.in) ? esc(CHF(num(b.in))) : ""}</td><td>${belegCell(b, false)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>Total</td><td></td><td class="num">${esc(CHF(F.sumOut))}</td><td class="num">${esc(CHF(F.sumIn))}</td><td class="small muted">${F.sorted.filter(b => b.beleg).length}/${F.sorted.length}</td>${edit ? "<td></td>" : ""}</tr>
      </tbody></table></div>
      <datalist id="catList">${cats.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      ${edit ? `<form class="form-grid" id="bookForm" style="margin-top:12px; grid-template-columns:140px 2fr 1fr 110px 110px auto">
        <label>Datum<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
        <label>Was<input name="text" required></label><label>Bereich<input name="cat" list="catList"></label>
        <label>Ausgabe<input name="out" inputmode="decimal"></label><label>Einnahme<input name="in" inputmode="decimal"></label>
        <button class="btn-primary" type="submit">+ Buchen</button>
        <label style="grid-column:1/-1">Beleg (optional, Foto oder PDF)<input name="beleg" type="file" accept="image/*,application/pdf"></label></form>
        <input type="file" id="belegPick" accept="image/*,application/pdf" hidden>
        <p class="form-msg small muted" id="belegMsg"></p>` : ""}
    </div>
    <div class="card" style="margin-top:12px"><h3>Afterworkbar-Abrechnung ${esc(Y)}</h3>
      <p class="rule-note">Gewinn = Einnahmen − Kosten: <b>${esc(CHF(F.awbProfit))}</b>${edit ? " · eine Zeile pro Posten: «Was; Wo; Betrag; Bemerkung» bzw. «Was; Betrag»" : ""}</p>
      ${edit ? `<div class="grid2"><label>Kosten<textarea id="awbCosts" rows="10">${esc((F.awb.costs || []).map(x => [x.was, x.wo || "", x.betrag ?? "", x.bem || ""].join("; ")).join("\n"))}</textarea></label>
        <label>Einnahmen<textarea id="awbInc" rows="10">${esc((F.awb.income || []).map(x => [x.was, x.betrag].join("; ")).join("\n"))}</textarea></label></div>
        <div class="form-grid" style="margin-top:8px"><label>Kassenstock neu<input id="awbKs" value="${esc(F.awb.kassenstockNeu ?? "")}"></label>
        <label>Gewinne Vorjahre (Jahr=Betrag, Komma)<input id="awbProf" value="${esc(Object.entries(F.awb.profits || {}).map(([k, x]) => k + "=" + x).join(", "))}"></label>
        <button class="btn-primary" id="awbSave">Speichern</button></div>`
        : `<table class="lst"><tbody>${(F.awb.costs || []).map(x => `<tr><td>${esc(x.was)}</td><td>${esc(x.wo || "")}</td><td class="num">${esc(CHF(num(x.betrag)))}</td></tr>`).join("")}</tbody></table>`}
    </div>`;
  c.querySelectorAll("[data-open-beleg]").forEach(btn => btn.onclick = () => openBeleg(bookings.find(x => x.id === btn.dataset.openBeleg)));
  if(!edit) return;
  const fref = db.collection("finance").doc(Y);
  document.getElementById("finForm").onsubmit = async e => {
    e.preventDefault(); const t = e.target;
    await fref.set({ vjStart:t.vjStart.value, vjEnd:t.vjEnd.value, opening:num(t.opening.value), openingCash:num(t.openingCash.value), cash:num(t.cash.value) }, { merge:true });
    MST.log("finanzen", `Vereinsjahr ${vjLabel()}: Eckwerte gespeichert`);
  };
  document.getElementById("bookForm").onsubmit = async e => {
    e.preventDefault(); const t = e.target;
    const b = { date:t.date.value, text:t.text.value.trim(), cat:t.cat.value.trim(), out:num(t.out.value), in:num(t.in.value), at:Date.now(), by:me.id };
    if((b.date > vjEnd() || b.date < vjStart()) && !confirm(`Das Datum liegt ausserhalb des Vereinsjahrs ${vjLabel()} (${dCH(vjStart())} – ${dCH(vjEnd())}). Für das neue Vereinsjahr zuerst auf der GV-Seite unter «Einstellungen» die nächste GV anlegen. Trotzdem hier buchen?`)) return;
    await fref.set({ vjStart:vjStart(), vjEnd:vjEnd() }, { merge:true });
    const file = t.beleg.files[0];
    const ref = await fref.collection("bookings").add(b);
    MST.log("finanzen", `Buchung ${dCH(b.date)} ${b.text}: ${b.out ? "−" + b.out : "+" + b.in}`);
    if(file){
      document.getElementById("belegMsg").textContent = "Beleg wird hochgeladen …";
      try{ await uploadBeleg(Object.assign({ id:ref.id }, b), file); document.getElementById("belegMsg").textContent = "Beleg gespeichert ✓"; }
      catch(err){ console.error(err); document.getElementById("belegMsg").textContent = "Beleg ging nicht: " + (err.message || err); }
    }
    t.text.value = ""; t.out.value = ""; t.in.value = ""; t.beleg.value = ""; t.text.focus();
  };
  c.querySelectorAll("tr[data-b] [data-k]").forEach(el => el.onchange = async () => {
    const id = el.closest("tr").dataset.b, k = el.dataset.k;
    const val = k === "out" || k === "in" ? num(el.value) : el.value.trim();
    await fref.collection("bookings").doc(id).set({ [k]:val }, { merge:true });
    MST.log("finanzen", `Buchung geändert: ${k} = ${val}`);
  });
  // Belege anhängen / ersetzen / löschen
  let pickFor = null;
  const pick = document.getElementById("belegPick");
  c.querySelectorAll("[data-attach]").forEach(btn => btn.onclick = () => { pickFor = btn.dataset.attach; pick.click(); });
  pick.onchange = async () => {
    const file = pick.files[0], bk = bookings.find(x => x.id === pickFor);
    if(!file || !bk) return;
    document.getElementById("belegMsg").textContent = "Beleg wird hochgeladen …";
    try{ await uploadBeleg(bk, file); document.getElementById("belegMsg").textContent = `Beleg zu «${bk.text}» gespeichert ✓`; }
    catch(err){ console.error(err); document.getElementById("belegMsg").textContent = "Beleg ging nicht: " + (err.message || err); }
    pick.value = "";
  };
  c.querySelectorAll("[data-unattach]").forEach(btn => btn.onclick = async () => {
    const bk = bookings.find(x => x.id === btn.dataset.unattach);
    if(bk && confirm("Beleg entfernen?")) await deleteBeleg(bk);
  });
  c.querySelectorAll("[data-delb]").forEach(b => b.onclick = async () => {
    if(!confirm("Buchung löschen?")) return;
    const bk = bookings.find(x => x.id === b.dataset.delb);
    if(bk && bk.beleg) await deleteBeleg(bk);
    await fref.collection("bookings").doc(b.dataset.delb).delete();
    MST.log("finanzen", "Buchung gelöscht");
  });
  document.getElementById("awbSave").onclick = async () => {
    const costs = document.getElementById("awbCosts").value.split("\n").filter(l => l.trim()).map(l => { const p = l.split(";").map(s => s.trim()); return { was:p[0] || "", wo:p[1] || "", betrag:p[2] === "" || p[2] == null ? "" : num(p[2]), bem:p[3] || "" }; });
    const income = document.getElementById("awbInc").value.split("\n").filter(l => l.trim()).map(l => { const p = l.split(";").map(s => s.trim()); return { was:p[0] || "", betrag:num(p[1]) }; });
    const profits = {};
    document.getElementById("awbProf").value.split(",").forEach(x => { const [k, v] = x.split("=").map(s => s && s.trim()); if(k && v) profits[k] = num(v); });
    await fref.set({ awb:{ costs, income, kassenstockNeu:document.getElementById("awbKs").value.trim(), profits } }, { merge:true });
    MST.log("finanzen", `Afterworkbar-Abrechnung ${Y} gespeichert`);
  };
}

/* =================== PROTOKOLL =================== */
function protKeys(){
  return traktanden().map(t => ({ t, qs:t.table ? t.items.flatMap((it, i) => it.sub.map((s, j) => ({ key:`q:${t.id}:${i}:${j}`, label:s, head:it.t }))) : [] }));
}
function viewProtocol(c){
  const edit = canProt();
  const P = prot || {}, eck = P.eck || {}, att = P.att || {}, notes = P.notes || {}, votes = P.votes || {};
  const ms = members();
  const da = Object.values(att).filter(x => x === "da").length, ent = Object.values(att).filter(x => x === "entsch").length;
  const v = V();
  if(!edit){
    c.innerHTML = `<div class="toolbar-row"><button class="btn-primary" id="printProt">🖨 Protokoll drucken</button><span class="small muted">Schreibt der Aktuar (${esc(memberName(v.vorstand.aktuar))}) direkt hier.</span></div>
      <div class="paper">${buildProtocol()}</div>`;
    scalePages();
    document.getElementById("printProt").onclick = () => doPrint(buildProtocol());
    return;
  }
  const inp = (k, val, ph, type) => `<input data-e="${k}" value="${esc(val || "")}" ${ph ? `placeholder="${esc(ph)}"` : ""} ${type ? `type="${type}"` : ""}>`;
  c.innerHTML = `<div class="toolbar-row"><button class="btn-primary" id="printProt">🖨 Protokoll drucken</button><span class="save-note" id="pSave">${esc(saveState)}</span>
      <span class="spacer"></span><span class="small muted">Speichert automatisch beim Tippen.</span></div>
    <div class="card"><h3>Eckdaten</h3><div class="form-grid">
      <label>Datum${inp("datum", eck.datum || (gv.date || ""), "", "date")}</label><label>Ort${inp("ort", eck.ort || gv.place, "")}</label>
      <label>Beginn${inp("beginn", eck.beginn, "19:00", "time")}</label><label>Ende${inp("ende", eck.ende, "", "time")}</label>
      <label>Gäste${inp("gaeste", eck.gaeste, "")}</label><label>Stimmenzähler${inp("stimmenzaehler", eck.stimmenzaehler || memberName(v.stimmenzaehler), "")}</label>
    </div><p class="small muted" style="margin:8px 0 0">Anwesend ${da} · entschuldigt ${ent} · stimmberechtigt ${da} · absolutes Mehr ${da ? Math.floor(da / 2) + 1 : "–"}</p></div>
    <div class="card" style="margin-top:12px"><h3>Anwesenheit</h3><div class="att">${ms.map(([id, m]) => `<div class="p"><span>${id.slice(1)} ${esc(m.name)}</span><span class="seg2">
      <button class="btn-small ${att[id] === "da" ? "on" : ""}" data-att="${id}" data-v="da">da</button><button class="btn-small ${att[id] === "entsch" ? "on" : ""}" data-att="${id}" data-v="entsch">entsch.</button></span></div>`).join("")}</div>
      <button class="btn-small" id="allDa" style="margin-top:8px">alle «da» ohne Eintrag</button></div>
    <div style="margin-top:12px">${protKeys().map(({ t, qs }, n) => `<div class="prot-tk"><h4><span>${n + 1}</span>${esc(fill(t.title))}</h4>
      ${qs.length ? qs.map(q => `<div class="q"><div><b>${esc(qPart(q.label)[0])}</b>${qPart(q.label)[1] ? `<div class="small muted">${esc(qPart(q.label)[1])}</div>` : ""}</div><textarea data-n="${esc(q.key)}" placeholder="Entscheid / Notizen">${esc(notes[q.key] || "")}</textarea></div>`).join("") : ""}
      ${t.vote ? `<div class="vote"><label>Ja<input data-v2="${t.id}:ja" inputmode="numeric" value="${esc((votes[t.id] || {}).ja ?? "")}"></label><label>Nein<input data-v2="${t.id}:nein" inputmode="numeric" value="${esc((votes[t.id] || {}).nein ?? "")}"></label>
        <label>Enthaltungen<input data-v2="${t.id}:enth" inputmode="numeric" value="${esc((votes[t.id] || {}).enth ?? "")}"></label>
        <label>Resultat<select data-v2="${t.id}:res"><option value="">–</option><option ${((votes[t.id] || {}).res) === "angenommen" ? "selected" : ""}>angenommen</option><option ${((votes[t.id] || {}).res) === "abgelehnt" ? "selected" : ""}>abgelehnt</option></select></label></div>` : ""}
      <textarea data-n="t:${esc(t.id)}" placeholder="Notizen">${esc(notes["t:" + t.id] || "")}</textarea></div>`).join("")}</div>`;
  document.getElementById("printProt").onclick = () => doPrint(buildProtocol());
  const ref = db.collection("gv").doc(Y).collection("protokoll").doc("main");
  const save = (patch) => {
    saveState = "speichert …"; const s = document.getElementById("pSave"); if(s) s.textContent = saveState;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try{ await ref.set(Object.assign(patch(), { updatedAt:Date.now(), by:me.id }), { merge:true }); saveState = "gespeichert ✓ " + new Date().toLocaleTimeString("de-CH", { hour:"2-digit", minute:"2-digit" }); }
      catch(e){ console.error(e); saveState = "⚠ nicht gespeichert"; }
      const s2 = document.getElementById("pSave"); if(s2) s2.textContent = saveState;
    }, 600);
  };
  const pending = { eck:{}, notes:{}, votes:{} };
  const flush = () => { const p = JSON.parse(JSON.stringify(pending)); pending.eck = {}; pending.notes = {}; pending.votes = {}; return p; };
  c.querySelectorAll("[data-e]").forEach(el => el.oninput = () => { pending.eck[el.dataset.e] = el.value; prot.eck = Object.assign({}, prot.eck, { [el.dataset.e]:el.value }); save(flush); });
  c.querySelectorAll("[data-n]").forEach(el => el.oninput = () => { pending.notes[el.dataset.n] = el.value; prot.notes = Object.assign({}, prot.notes, { [el.dataset.n]:el.value }); save(flush); });
  c.querySelectorAll("[data-v2]").forEach(el => {
    el[el.tagName === "SELECT" ? "onchange" : "oninput"] = () => {
      const [tid, k] = el.dataset.v2.split(":");
      pending.votes[tid] = Object.assign({}, pending.votes[tid], { [k]:el.value });
      prot.votes = Object.assign({}, prot.votes); prot.votes[tid] = Object.assign({}, prot.votes[tid], { [k]:el.value });
      save(flush);
    };
  });
  c.querySelectorAll("[data-att]").forEach(b => b.onclick = async () => {
    const id = b.dataset.att, val = att[id] === b.dataset.v ? firebase.firestore.FieldValue.delete() : b.dataset.v;
    await ref.set({ att:{ [id]:val }, updatedAt:Date.now(), by:me.id }, { merge:true });
  });
  document.getElementById("allDa").onclick = async () => {
    const add = {}; ms.forEach(([id]) => { if(!att[id]) add[id] = "da"; });
    await ref.set({ att:add, updatedAt:Date.now(), by:me.id }, { merge:true });
  };
}
function buildProtocol(){
  const P = prot || {}, eck = P.eck || {}, att = P.att || {}, notes = P.notes || {}, votes = P.votes || {}, v = V();
  const ms = members();
  const da = Object.values(att).filter(x => x === "da").length, ent = Object.values(att).filter(x => x === "entsch").length;
  const filled = da + ent > 0;
  const f = x => x ? esc(x) : "";
  let html = titlePage("Protokoll");
  const half = Math.ceil(ms.length / 2);
  const attRow = ([id, m]) => `<td>${id.slice(1)}</td><td>${esc(m.name)} <span class="small">${esc(m.alias || "")}</span></td><td class="c"><span class="chk">${att[id] === "da" ? "✓" : ""}</span></td><td class="c"><span class="chk">${att[id] === "entsch" ? "✓" : ""}</span></td>`;
  html += `<div class="page">${bar("Protokoll", `${edition()}. Generalversammlung MST Ermatingen${filled ? "" : " · Vorlage für den Protokollführer"}`)}
    <div class="lbl">Eckdaten</div>
    <table class="eck"><tbody>
      <tr><td class="k">Datum</td><td>${f(dCH(eck.datum || gv.date))}</td><td class="k">Ort</td><td>${f(eck.ort || gv.place)}</td></tr>
      <tr><td class="k">Beginn</td><td>${eck.beginn ? f(eck.beginn) + " Uhr" : "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uhr"}</td><td class="k">Ende</td><td>${eck.ende ? f(eck.ende) + " Uhr" : "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uhr"}</td></tr>
      <tr><td class="k">Vorsitz</td><td>${esc(memberName(v.vorstand.praesident))}</td><td class="k">Protokoll</td><td>${esc(memberName(v.vorstand.aktuar))}</td></tr>
      <tr><td class="k">Stimmenzähler</td><td>${f(eck.stimmenzaehler || memberName(v.stimmenzaehler))}</td><td class="k">Gäste</td><td>${f(eck.gaeste)}</td></tr>
      <tr><td class="k">Anwesend</td><td>${filled ? da : ""}</td><td class="k">Entschuldigt</td><td>${filled ? ent : ""}</td></tr>
      <tr><td class="k">Stimmberechtigt</td><td>${filled ? da : ""}</td><td class="k">Absolutes Mehr</td><td>${filled && da ? Math.floor(da / 2) + 1 : ""}</td></tr>
    </tbody></table>
    <div class="lbl">Anwesenheit</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:4mm">
      ${[ms.slice(0, half), ms.slice(half)].map(col => `<table class="t"><thead><tr><th>Nr.</th><th>Name</th><th class="c">da</th><th class="c">entsch.</th></tr></thead><tbody>${col.map(m => `<tr>${attRow(m)}</tr>`).join("")}</tbody></table>`).join("")}
    </div>${foot("Protokoll")}</div>`;
  // Traktanden fliessend auf Seiten
  const blocks = protKeys().map(({ t, qs }, n) => {
    const vt = votes[t.id] || {};
    const voteBox = t.vote ? `<div class="votebox">Abstimmung: <b>${esc(fill(t.title))}</b><br>
      Ja ${vt.ja !== undefined && vt.ja !== "" ? "<b>" + esc(vt.ja) + "</b>" : "________"} &nbsp; Nein ${vt.nein !== undefined && vt.nein !== "" ? "<b>" + esc(vt.nein) + "</b>" : "________"} &nbsp; Enthaltungen ${vt.enth !== undefined && vt.enth !== "" ? "<b>" + esc(vt.enth) + "</b>" : "________"} &nbsp;
      <span class="chk">${vt.res === "angenommen" ? "✓" : ""}</span><b>angenommen</b> &nbsp; <span class="chk">${vt.res === "abgelehnt" ? "✓" : ""}</span><b>abgelehnt</b></div>` : "";
    const qTable = qs.length ? `<table class="t" style="margin-top:2mm"><thead><tr><th style="width:30%">Thema</th><th style="width:28%">Frage</th><th>Entscheid / Notizen</th></tr></thead><tbody>
      ${qs.map(q => `<tr><td><b>${esc(qPart(q.label)[0])}</b></td><td class="small"><i>${esc(qPart(q.label)[1])}</i></td><td style="white-space:pre-wrap">${notes[q.key] ? esc(notes[q.key]) : "<br><br>"}</td></tr>`).join("")}</tbody></table>` : "";
    const nt = notes["t:" + t.id];
    // Höhe in mm schätzen (Kopf, Punkte, Abstimmung, Tabelle, Notizen)
    const shown = t.items.filter(it => !it.sub.length || !qs.length);
    const ntLines = nt ? nt.split("\n").reduce((s, l) => s + Math.max(1, Math.ceil(l.length / 95)), 0) : 0;
    const qRows = qs.reduce((s, q) => s + Math.max(2, Math.ceil(((notes[q.key] || "").length) / 45) + 1, Math.ceil(q.label.length / 30)), 0);
    const lines = 16 + shown.reduce((s, it) => s + 5.5 * (1 + it.sub.length), 0) + (t.vote ? 17 : 0) + (qs.length ? 8 + qRows * 4.6 : 0) + 6 + (nt ? ntLines * 5.4 + 3 : 20);
    return { lines, html:`<div class="tkp"><div class="hd"><div class="n">${n + 1}</div><div class="h">${esc(fill(t.title))}</div></div>
      <ul>${t.items.filter(it => !it.sub.length || !qs.length).map(it => `<li>${arrowHtml(it.t)}${it.sub.length ? `<ul>${it.sub.map(s => `<li>${arrowHtml(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>
      ${voteBox}${qTable}<div class="notes-h">Notizen</div>${nt ? `<div class="notes">${esc(nt)}</div>` : '<div class="lines"></div><div class="lines"></div><div class="lines"></div>'}</div>` };
  });
  let cur = [], lines = 0;
  const flushPage = () => { if(cur.length){ html += `<div class="page">${cur.join("")}${foot("Protokoll")}</div>`; cur = []; lines = 0; } };
  blocks.forEach(b => { if(lines + b.lines > 250 && cur.length) flushPage(); cur.push(b.html); lines += b.lines; });
  cur.push(`<div style="margin-top:10mm; display:grid; grid-template-columns:1fr 1fr; gap:10mm">
    <div><div class="lines"></div><div class="small">Ort, Datum · Protokoll: ${esc(memberName(v.vorstand.aktuar))}</div></div>
    <div><div class="lines"></div><div class="small">Präsident: ${esc(memberName(v.vorstand.praesident))}</div></div></div>`);
  flushPage();
  return html;
}

/* =================== ARCHIV (PDF) =================== */
async function viewArchive(c){
  c.innerHTML = '<div class="loading">lade PDF …</div>';
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const parts = await Promise.all([...Array(gv.chunks).keys()].map(i => db.collection("gv").doc(Y).collection("chunks").doc(String(i)).get()));
    const bin = atob(parts.map(p => p.data().data).join(""));
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type:"application/pdf" }));
    c.innerHTML = `<div class="toolbar-row"><span class="muted small">${esc(gv.title || "GV-Übersicht")} (PDF)</span><span class="spacer"></span><a class="btn-ghost" href="${url}" download="${esc(gv.fileName || "GV.pdf")}">PDF herunterladen</a></div><div class="pages" id="pages"></div>`;
    const pdf = await pdfjsLib.getDocument({ data:bytes }).promise;
    const box = document.getElementById("pages");
    for(let n = 1; n <= pdf.numPages; n++){
      const page = await pdf.getPage(n);
      const scale = Math.min(2.5, (Math.min(860, box.clientWidth) / page.getViewport({ scale:1 }).width) * (window.devicePixelRatio || 1));
      const vp = page.getViewport({ scale });
      const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; box.appendChild(cv);
      await page.render({ canvasContext:cv.getContext("2d"), viewport:vp }).promise;
    }
  }catch(e){ console.error(e); c.innerHTML = '<div class="card"><p class="muted">PDF konnte nicht geladen werden.</p></div>'; }
}

/* =================== EINSTELLUNGEN (Vorstand) =================== */
function viewSettings(c){
  const v = V();
  const opts = sel => members().map(([id, m]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  const essen = gv.essen || [];
  c.innerHTML = `<div class="grid2">
    <div class="stack">
      <div class="card"><h3>GV ${esc(Y)}</h3><form class="form-grid" id="gvForm">
        <label>Nr. der GV<input name="edition" type="number" value="${edition()}"></label>
        <label>Datum<input name="date" type="date" value="${esc(gv.date || "")}"></label>
        <label>Ort<input name="place" value="${esc(gv.place || "")}"></label>
        <button class="btn-primary" type="submit">Speichern</button></form>
        <label style="margin-top:12px">Weitere Höhepunkte im Jahresrückblick<textarea id="rbText" rows="4" style="width:100%">${esc(gv.rueckblick || "")}</textarea></label>
        <button class="btn-ghost" id="rbSave" style="margin-top:8px">Speichern</button></div>
      <div class="card"><h3>Essen GV – Varianten</h3><p class="rule-note">Eine Zeile pro Variante: «Titel; Betrag» (Betrag leer = «Andere Vorschläge»). Der Rest wird aus dem Vermögen gerechnet.</p>
        <textarea id="essen" rows="5" style="width:100%">${esc(essen.map(e => [e.title, e.amount || ""].join("; ")).join("\n"))}</textarea>
        <button class="btn-ghost" id="essenSave" style="margin-top:8px">Speichern</button></div>
      <div class="card"><h3>Neue GV anlegen</h3><p class="rule-note">Übernimmt die Traktanden und Varianten dieser GV; das neue Vereinsjahr startet mit dem Schlussbestand von hier (${esc(CHF(finance().closing))} Konto, ${esc(CHF(finance().cash))} Kasse).</p>
        <button class="btn-primary" id="newGV">GV ${parseInt(years[years.length - 1] || Y, 10) + 1} anlegen</button></div>
    </div>
    <div class="stack">
      <div class="card"><h3>Verein</h3>${me.admin ? `<form class="form-grid" id="vForm">
        <label>Präsident<select name="praesident">${opts(v.vorstand.praesident)}</select></label>
        <label>Aktuar<select name="aktuar">${opts(v.vorstand.aktuar)}</select></label>
        <label>Kassier<select name="kassier">${opts(v.vorstand.kassier)}</select></label>
        <label>Stimmenzähler<select name="stimmenzaehler">${opts(v.stimmenzaehler)}</select></label>
        <label>Jahresbeitrag CHF<input name="fee" value="${esc(v.fee)}"></label>
        <label>Rabatt pro Einsatz CHF<input name="discount" value="${esc(v.discount)}"></label>
        <label>Twint-Nummer Kassier<input name="twint" value="${esc(v.twint)}"></label>
        <button class="btn-primary" type="submit">Speichern</button></form>
        <p class="rule-note" style="margin:10px 0 0">Logins für Kassier und Aktuar: auf der Startseite unter «Vorstand-Logins».</p>`
        : `<p>Ändern kann der Admin.</p>`}</div>
      ${me.admin ? `<div class="card"><h3>Original-PDF hochladen</h3><p class="rule-note">Optional: fertige Übersicht als PDF archivieren (erscheint im Reiter «PDF»).</p>
        <form id="uploadForm" class="upload"><label>PDF<input name="file" type="file" accept="application/pdf" required></label><button class="btn-primary" type="submit">Hochladen</button></form>
        <p class="form-msg small muted" id="upMsg"></p></div>` : ""}
    </div></div>`;
  const gref = db.collection("gv").doc(Y);
  document.getElementById("gvForm").onsubmit = async e => { e.preventDefault(); const t = e.target; await gref.set({ edition:parseInt(t.edition.value, 10) || edition(), date:t.date.value || null, place:t.place.value.trim() }, { merge:true }); MST.log("gv", `GV ${Y}: Datum/Ort gespeichert`); };
  document.getElementById("rbSave").onclick = () => gref.set({ rueckblick:document.getElementById("rbText").value }, { merge:true });
  document.getElementById("essenSave").onclick = () => gref.set({ essen:document.getElementById("essen").value.split("\n").filter(l => l.trim()).map(l => { const p = l.split(";").map(s => s.trim()); return { title:p[0], amount:p[1] ? num(p[1]) : null }; }) }, { merge:true });
  document.getElementById("newGV").onclick = newGV;
  const vf = document.getElementById("vForm");
  if(vf) vf.onsubmit = async e => {
    e.preventDefault(); const t = e.target;
    await db.collection("config").doc("verein").set({ vorstand:{ praesident:t.praesident.value, aktuar:t.aktuar.value, kassier:t.kassier.value }, stimmenzaehler:t.stimmenzaehler.value,
      fee:num(t.fee.value), discount:num(t.discount.value), twint:t.twint.value.trim() }, { merge:true });
    MST.log("verein", "Vereinsangaben (Vorstand, Beitrag) gespeichert");
  };
  const up = document.getElementById("uploadForm");
  if(up) up.onsubmit = uploadPdf;
}
async function newGV(){
  const ny = String(parseInt(years[years.length - 1] || Y, 10) + 1);
  if(years.includes(ny)){ openYear(ny); return; }
  if(!confirm(`GV ${ny} anlegen?`)) return;
  const F = finance();
  const tk = (gv.traktanden || []).map(t => Object.assign({}, t, { id:uid() }));
  await db.collection("gv").doc(ny).set({ edition:edition() + 1, date:null, place:gv.place || "", traktanden:tk, essen:gv.essen || [], rueckblick:"" });
  if(canFin() || me.admin){
    const prof = Object.assign({}, F.awb.profits || {}, { [Y]:Math.round(F.awbProfit * 100) / 100 });
    await db.collection("finance").doc(ny).set({ vjStart:(gv.date || `${Y}-10-01`), vjEnd:`${ny}-09-30`, opening:Math.round(F.closing * 100) / 100, openingCash:F.cash, cash:F.cash, awb:{ costs:[], income:[], profits:prof } });
  }
  MST.log("gv", `GV ${ny} angelegt`);
  openYear(ny);
}
async function uploadPdf(e){
  e.preventDefault();
  const f = e.target, msg = document.getElementById("upMsg"), file = f.file.files[0];
  if(!file) return;
  if(file.size > 5 * 1024 * 1024){ msg.textContent = "Zu gross (max. 5 MB)."; return; }
  msg.textContent = "lade hoch …";
  const CHUNK = 700000;
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ""; for(let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = btoa(bin), n = Math.ceil(b64.length / CHUNK), ref = db.collection("gv").doc(Y);
  for(let i = 0; i < n; i++) await ref.collection("chunks").doc(String(i)).set({ data:b64.slice(i * CHUNK, (i + 1) * CHUNK) });
  await ref.set({ title:`GV-Übersicht ${Y}`, fileName:file.name, chunks:n, size:file.size, uploadedAt:Date.now() }, { merge:true });
  MST.log("gv", `PDF GV ${Y} hochgeladen`);
  msg.textContent = "Hochgeladen.";
}
