/* ============================================================
   MST Spieltag – Datenzugriff (Firestore oder Testmodus)
   ============================================================
   Firestore (Projekt "minispieltag"):
     spieltagMeta/settings        { currentYear }
     spieltagMeta/catalog         { items:[Disziplin, …] }   – Grundgerüst
     spieltagPersons/<id>         { name, memberId|null }    – m<Nr> = Mitglied, g_… = Gast
     spieltag/<jahr>              { year, edition, date, place, participants:[ids], games:[Spiel, …], closed }
     spieltag/<jahr>/games/<id>   { units, groups, seeds, order, matches, scores, drawnAt, drawMode }
     spieltagHistory/<jahr>       { year, edition, disciplines:[{name, catId}], rows:[{name, pids, pts, total, rank}] }
   Alles öffentlich lesbar (Zuschauer am Spieltag), schreiben nur Admin.

   Testmodus (?test in der Adresse): liest einmal die echten Daten,
   alle Änderungen bleiben nur in diesem Browserfenster.
   ============================================================ */
const SpieltagData = (() => {
  const test = new URLSearchParams(location.search).has("test");
  const mem = {};            // Testmodus: Pfad -> Dokument
  const listeners = {};      // Testmodus: Pfad-Präfix -> [cb]

  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  function deepMerge(target, src){
    Object.entries(src).forEach(([k, v]) => {
      if(v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])){
        deepMerge(target[k], v);
      } else target[k] = clone(v);
    });
    return target;
  }
  function emit(path){
    Object.entries(listeners).forEach(([p, cbs]) => { if(path === p || path.startsWith(p + "/")) cbs.forEach(cb => cb()); });
  }
  function on(prefix, cb){
    (listeners[prefix] = listeners[prefix] || []).push(cb);
    return () => { listeners[prefix] = listeners[prefix].filter(x => x !== cb); };
  }
  function memCollection(prefix){
    const depth = prefix.split("/").length + 1;
    return Object.keys(mem).filter(p => p.startsWith(prefix + "/") && p.split("/").length === depth)
      .map(p => ({ id:p.split("/").pop(), data:clone(mem[p]) }));
  }
  async function preload(path, isCollection){
    if(isCollection){
      const snap = await db.collection(path).get();
      snap.forEach(d => { if(!(path + "/" + d.id in mem)) mem[path + "/" + d.id] = d.data(); });
    } else {
      if(path in mem) return;
      const d = await db.doc(path).get();
      if(d.exists) mem[path] = d.data();
    }
  }
  const loaded = new Set();
  async function ensure(path, isCollection){
    const k = (isCollection ? "c:" : "d:") + path;
    if(loaded.has(k)) return;
    loaded.add(k);
    for(let i = 0; i < 4; i++){
      try{ await preload(path, isCollection); return; }
      catch(e){ console.warn("Testmodus: konnte nicht laden", path, e); await new Promise(r => setTimeout(r, 1500)); }
    }
  }

  /* ---------- Lesen (mit Live-Aktualisierung) ---------- */
  function watchDoc(path, cb){
    if(test){
      let off = () => {};
      ensure(path, false).then(() => { cb(clone(mem[path]) || null); off = on(path, () => cb(clone(mem[path]) || null)); });
      return () => off();
    }
    return db.doc(path).onSnapshot(d => cb(d.exists ? d.data() : null), e => { console.error(path, e); cb(null, e); });
  }
  function watchCollection(path, cb){
    if(test){
      let off = () => {};
      ensure(path, true).then(() => {
        const send = () => cb(memCollection(path));
        send(); off = on(path, send);
      });
      return () => off();
    }
    return db.collection(path).onSnapshot(s => cb(s.docs.map(d => ({ id:d.id, data:d.data() }))), e => { console.error(path, e); cb([], e); });
  }
  async function getCollection(path){
    if(test){ await ensure(path, true); return memCollection(path); }
    const s = await db.collection(path).get();
    return s.docs.map(d => ({ id:d.id, data:d.data() }));
  }
  async function getDoc(path){
    if(test){ await ensure(path, false); return clone(mem[path]) || null; }
    const d = await db.doc(path).get();
    return d.exists ? d.data() : null;
  }

  /* ---------- Schreiben ---------- */
  async function set(path, data){
    if(test){ mem[path] = clone(data); emit(path); return; }
    await db.doc(path).set(data);
  }
  async function merge(path, data){
    if(test){ mem[path] = deepMerge(mem[path] || {}, data); emit(path); return; }
    await db.doc(path).set(data, { merge:true });
  }
  async function remove(path){
    if(test){ delete mem[path]; emit(path); return; }
    await db.doc(path).delete();
  }
  async function batch(ops){
    if(test){ for(const o of ops){ if(o.op === "set") await set(o.path, o.data); else if(o.op === "merge") await merge(o.path, o.data); else await remove(o.path); } return; }
    const b = db.batch();
    ops.forEach(o => {
      const ref = db.doc(o.path);
      if(o.op === "set") b.set(ref, o.data);
      else if(o.op === "merge") b.set(ref, o.data, { merge:true });
      else b.delete(ref);
    });
    await b.commit();
  }

  return { test, watchDoc, watchCollection, getCollection, getDoc, set, merge, remove, batch };
})();

/* ---------- gemeinsame Helfer für Spieltag-Seite und Organisation ---------- */
const ST = {
  persons: {},       // id -> { name, memberId }
  nameOf(pid){ const p = this.persons[pid]; return p ? p.name : "?"; },
  sortByName(ids){ return ids.slice().sort((a, b) => this.nameOf(a).localeCompare(this.nameOf(b), "de", { sensitivity:"base" })); },
  unitLabel(u){
    if(!u) return "–";
    if(u.teamName) return u.teamName;
    const m = u.members || [];
    if(m.length === 1) return this.nameOf(m[0]);
    if(m.length <= 3) return m.map(p => this.nameOf(p)).join(" / ");
    return u.name || "Team";
  },
  edition(year){ return parseInt(year, 10) - 2019; },
  /* Teilnehmende = Liste der Organisation + Selbst-Anmeldungen (ja/nein) der Mitglieder */
  effectiveParticipants(yearDoc, signups){
    const set = new Set((yearDoc && yearDoc.participants) || []);
    Object.values(signups || {}).forEach(s => {
      if(!s || !s.pid) return;
      if(s.status === "ja") set.add(s.pid); else if(s.status === "nein") set.delete(s.pid);
    });
    return [...set];
  },
  pidOfMember(memberId){
    if(!memberId) return null;
    if(this.persons[memberId] && this.persons[memberId].memberId === memberId) return memberId;
    return Object.keys(this.persons).find(id => this.persons[id].memberId === memberId) || null;
  },
  /* Titelverteidiger = Sieger des letzten Spieltags in der Historie vor diesem Jahr */
  champions(history, year){
    const prev = (history || []).filter(h => h.year < parseInt(year, 10)).sort((a, b) => b.year - a.year)[0];
    return prev ? (prev.rows || []).filter(r => r.rank === 1).flatMap(r => r.pids || []) : [];
  },
  /* Startnummer: Titelverteidiger = 1, sonst Vereinsnummer bzw. Gästenummer */
  startNr(pid, champs){
    if((champs || []).includes(pid)) return "1";
    const p = this.persons[pid] || {};
    return p.nr || (p.memberId ? p.memberId.slice(1) : "–");
  },
  byStartNr(a, b){ return String(a).localeCompare(String(b), "de", { numeric:true }); },
  nextGuestNr(){
    const nums = Object.values(this.persons).filter(p => !p.memberId).map(p => parseInt(p.nr, 10)).filter(n => !isNaN(n) && n >= 90);
    return String(nums.length ? Math.max(...nums) + 1 : 90);
  },
  slug(s){
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
  },
  fmtDate(iso){
    if(!iso) return "";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("de-CH", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  },
  /* Punkteverteilung als Vorschau, z. B. «18 · 15 · 12 · 10 · 7 · 4 · 1». */
  pointsPreview(g, n){
    const E = SpieltagEngine;
    g = E.normalizeGame(g);
    if(n < 2) return "";
    if(g.pointsScheme === "resultat") return "Punkte = Resultat";
    const ids = Array.from({ length:n }, (_, i) => "p" + i);
    if(!E.isSolo(g) && E.unitCountFor(n, g) < 2) return "zu wenige für Teams";
    try{
      const d = E.simulate(g, E.drawGame(g, ids), { participants:ids });
      const ev = E.evaluate(g, d, { participants:ids });
      const seen = []; const out = [];
      ev.rows.forEach(r => { const k = r.rank + ":" + r.points; if(!seen.includes(k)){ seen.push(k); out.push(r.points); } });
      if(g.mode === "rangliste" || g.mode === "liga"){
        // bei Ranglisten nur Anfang und Ende zeigen
        const all = [...new Set(Array.from({ length:E.unitCountFor(n, g) }, (_, i) => E.tierPoints(i, E.unitCountFor(n, g), g)))];
        return all.length > 8 ? all.slice(0, 5).join(" · ") + " … " + all.slice(-2).join(" · ") : all.join(" · ");
      }
      return out.join(" · ");
    }catch(e){ console.warn(e); return ""; }
  }
};
