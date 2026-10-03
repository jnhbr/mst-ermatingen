/* ============================================================
   MST Spieltag – Statistik aus der Historie (ohne Firebase)
   ============================================================
   Historie-Dokument (spieltagHistory/<jahr>):
     rows:   [{ name, pids, pts:[…pro Disziplin], total, rank }]
     teams:  [{ catId, members:[pid], points }]            – ab 2026
     duels:  [{ catId, a:[pid], b:[pid], w:"a"|"b"|null, sa, sb }] – ab 2026 (Tischtennis), sonst ab 2027
     raw:    { catId: { label, dir, scores:{ pid:wert } } } – Rohresultate (Schläge, Punkte …)
   ============================================================ */
(function(root){
"use strict";

const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

/* Mit wem hat pid in Partner-/Kleingruppen (2–3 Personen) am meisten Punkte geholt? */
function partners(history, pid){
  const acc = {};
  history.forEach(y => (y.teams || []).forEach(t => {
    if(!t.members.includes(pid) || t.members.length < 2 || t.members.length > 3) return;
    t.members.filter(p => p !== pid).forEach(p => {
      (acc[p] = acc[p] || { pid:p, pts:[], games:[] }).pts.push(t.points || 0);
      acc[p].games.push(y.year + " " + t.catId);
    });
  }));
  return Object.values(acc).map(x => ({ pid:x.pid, n:x.pts.length, avg:avg(x.pts) }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n);
}

/* Direkte Duelle: gegen wen gewinnt/verliert pid? */
function rivals(history, pid){
  const acc = {};
  history.forEach(y => (y.duels || []).forEach(d => {
    if(!d.w) return;
    const mine = d.a.includes(pid) ? "a" : d.b.includes(pid) ? "b" : null;
    if(!mine) return;
    const opp = mine === "a" ? d.b : d.a;
    opp.forEach(p => {
      const r = acc[p] = acc[p] || { pid:p, won:0, lost:0 };
      if(d.w === mine) r.won++; else r.lost++;
    });
  }));
  const list = Object.values(acc);
  const nemesis = list.filter(r => r.lost > r.won).sort((a, b) => (b.lost - b.won) - (a.lost - a.won) || b.lost - a.lost)[0] || null;
  const favourite = list.filter(r => r.won > r.lost).sort((a, b) => (b.won - b.lost) - (a.won - a.lost) || b.won - a.won)[0] || null;
  return { list, nemesis, favourite };
}

/* Rekorde und Bestenlisten über alle Jahre. */
function records(history, catalog){
  const catName = id => ((catalog || []).find(c => c.id === id) || {}).name || id;
  const out = {};
  // Meiste Punkte an einem Spieltag
  const days = [];
  history.forEach(y => (y.rows || []).forEach(r => days.push({ year:y.year, name:r.name, pids:r.pids, total:r.total, n:(y.rows || []).length })));
  out.bestDays = days.sort((a, b) => b.total - a.total).slice(0, 5);
  // Pro Person: Tagessiege, Teilnahmen, Serie, Disziplinensiege
  const per = {};
  const P = pid => per[pid] = per[pid] || { pid, wins:0, years:[], discWins:0, discWinList:[] };
  history.forEach(y => {
    (y.rows || []).forEach(r => (r.pids || []).forEach(pid => { const p = P(pid); p.years.push(y.year); if(r.rank === 1) p.wins++; }));
    (y.disciplines || []).forEach((d, i) => {
      const vals = (y.rows || []).map(r => r.pts && r.pts[i]).filter(v => v != null);
      if(!vals.length) return;
      const max = Math.max(...vals);
      if(max <= 0) return;
      (y.rows || []).forEach(r => { if(r.pts && r.pts[i] === max) (r.pids || []).forEach(pid => { const p = P(pid); p.discWins++; p.discWinList.push(y.year + " " + d.name); }); });
    });
  });
  const people = Object.values(per);
  people.forEach(p => {
    const ys = [...new Set(p.years)].sort();
    let best = 0, cur = 0, prev = null;
    ys.forEach(y => { cur = prev != null && y === prev + 1 ? cur + 1 : 1; best = Math.max(best, cur); prev = y; });
    p.streak = best; p.count = ys.length;
  });
  out.mostWins = people.filter(p => p.wins).sort((a, b) => b.wins - a.wins).slice(0, 5);
  out.mostYears = people.slice().sort((a, b) => b.count - a.count || b.streak - a.streak).slice(0, 5);
  out.discKings = people.filter(p => p.discWins).sort((a, b) => b.discWins - a.discWins).slice(0, 5);
  // Grösste Verbesserung im Rang (relativ zur Teilnehmerzahl) von einem Jahr aufs nächste
  const jumps = [];
  const rankOf = {};
  history.forEach(y => (y.rows || []).forEach(r => (r.pids || []).forEach(pid => { (rankOf[pid] = rankOf[pid] || []).push({ year:y.year, rank:r.rank, n:y.rows.length }); })));
  Object.entries(rankOf).forEach(([pid, list]) => {
    list.sort((a, b) => a.year - b.year);
    for(let i = 1; i < list.length; i++){
      if(list[i].year !== list[i - 1].year + 1) continue;
      jumps.push({ pid, from:list[i - 1], to:list[i], gain:list[i - 1].rank - list[i].rank });
    }
  });
  out.bigJumps = jumps.sort((a, b) => b.gain - a.gain).slice(0, 5);
  // Spezialisten: höchster Durchschnitt pro Disziplin (mind. 2 Mal gespielt)
  const disc = {};
  history.forEach(y => (y.disciplines || []).forEach((d, i) => {
    const k = d.catId || d.name;
    (y.rows || []).forEach(r => { if(r.pts && r.pts[i] != null) (r.pids || []).forEach(pid => {
      const m = (disc[k] = disc[k] || {}); (m[pid] = m[pid] || []).push(r.pts[i]);
    }); });
  }));
  out.specialists = Object.entries(disc).map(([k, m]) => {
    const best = Object.entries(m).filter(([, l]) => l.length >= 2).map(([pid, l]) => ({ pid, avg:avg(l), n:l.length }))
      .sort((a, b) => b.avg - a.avg || b.n - a.n)[0];
    return best ? Object.assign({ catId:k, name:catName(k) }, best) : null;
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "de"));
  // Rohresultat-Rekorde (z. B. Minigolf mit den wenigsten Schlägen)
  const rawBest = {};
  history.forEach(y => Object.entries(y.raw || {}).forEach(([k, r]) => {
    Object.entries(r.scores || {}).forEach(([pid, v]) => {
      if(v == null) return;
      const cur = rawBest[k];
      const better = !cur || (r.dir === "asc" ? v < cur.value : v > cur.value);
      if(better) rawBest[k] = { catId:k, name:catName(k), label:r.label, dir:r.dir, value:v, pids:[pid], year:y.year };
      else if(cur.value === v && !cur.pids.includes(pid)) cur.pids.push(pid);
    });
  }));
  out.rawRecords = Object.values(rawBest);
  return out;
}

/* Spieltag für die Historie zusammenstellen (beim Abschliessen). */
function archiveYear(E, year, games, gameData, participants, nameOf){
  const ctx = { participants };
  const ov = E.overall(games, gameData, ctx);
  const pids = [...new Set(participants.concat(ov.rows.filter(r => r.total > 0).map(r => r.pid)))];
  const rows = pids.map(pid => ({
    name:nameOf(pid), pids:[pid],
    pts:games.map(g => { const v = ov.evals[g.id].personPoints[pid]; return v == null ? null : v; }),
    total:games.reduce((s, g) => s + (ov.evals[g.id].personPoints[pid] || 0), 0)
  })).sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1);
  const teams = [], duels = [], raw = {};
  games.forEach(g => {
    const ev = ov.evals[g.id];
    const catId = g.catId || g.id;
    const members = id => { const u = ev.units.find(x => x.id === id); return u ? u.members.slice() : []; };
    if(!E.isSolo(g)) ev.units.forEach(u => teams.push({ catId, members:u.members.slice(), points:ev.personPoints[u.members[0]] || 0 }));
    const v = ev.view || {};
    const add = (m) => {
      if(!m || !m.a || !m.b || !m.res) return;
      const w = m.res.sa > m.res.sb ? "a" : m.res.sb > m.res.sa ? "b" : null;
      duels.push({ catId, a:members(m.a), b:members(m.b), w, sa:m.res.sa, sb:m.res.sb });
    };
    (v.groups || []).forEach(gr => gr.games.forEach(add));
    (v.games || []).forEach(add);
    (v.placement || []).forEach(add);
    if(v.bracket){ v.bracket.rounds.forEach(r => r.matches.forEach(m => { if(!m.bye) add(m); })); add(v.bracket.third); }
    if(g.mode === "rangliste" && E.isSolo(g) && v.rows){
      const sc = {};
      v.rows.forEach(r => { if(r.total != null) sc[r.id] = r.total; });
      raw[catId] = { label:g.scoreLabel, dir:g.scoreDir, scores:sc };
    }
  });
  return {
    year:parseInt(year, 10), edition:parseInt(year, 10) - 2019,
    disciplines:games.map(g => ({ name:g.name, catId:g.catId || g.id })),
    rows, teams, duels, raw
  };
}

const api = { partners, rivals, records, archiveYear };
if(typeof module !== "undefined" && module.exports) module.exports = api;
else root.SpieltagStats = api;
})(this);
