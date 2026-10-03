/* ============================================================
   MST Spieltag – Spiel-Logik (ohne Firebase)
   ============================================================
   Alles, was gerechnet wird: Teams bilden, Gruppen, Spielpläne,
   K.o.-Raster, Tabellen, Platzierungen und Punkte. Gespeichert
   werden nur die Auslosung (Teams/Gruppen/Setzliste) und die
   eingetragenen Resultate – der Rest wird bei jeder Anzeige neu
   berechnet. So gehen Spieltag-Seite und Rangliste nie auseinander.

   Spielmodi (game.mode):
     rangliste   jede Einheit (Person oder Team) liefert ein Resultat,
                 optional mehrere Durchgänge (Summe)
     ko          K.o.-Raster, Freilose für die Besten, falls die Anzahl
                 nicht aufgeht; optional Spiel um Platz 3
     gruppen_ko  Gruppen (jeder gegen jeden), danach K.o. der Besten
     liga        jeder gegen jeden in einer Tabelle, optional nur
                 x Runden und Platzierungsspiele (1 vs 2, 3 vs 4 …)

   Punkte: Platz 1 = maxPoints, letzte Stufe = 1, gleichmässig
   dazwischen (bei 7 Stufen und 18 Punkten: 18/15/12/10/7/4/1 –
   genau die Verteilung aus dem Spielplan 2026). Alternativen:
   eigene Liste oder «Resultat = Punkte».
   ============================================================ */
(function(root){
"use strict";

const MODES = {
  rangliste:  "Rangliste",
  ko:         "K.o.",
  gruppen_ko: "Gruppen + K.o.",
  liga:       "Jeder gegen jeden"
};

/* Grundgerüst aller Disziplinen, die seit 2020 gespielt wurden
   (Einstellungen aus Spielplan_26 bzw. sinnvolle Vorgaben). */
const DEFAULT_CATALOG = [
  // Einzel
  { id:"minigolf",   name:"Minigolf",     icon:"⛳", teamSize:1, mode:"rangliste", scoreLabel:"Schläge", scoreDir:"asc",  maxPoints:18 },
  { id:"pitpat",     name:"Pit-Pat",      icon:"🎱", teamSize:1, mode:"rangliste", scoreLabel:"Schläge", scoreDir:"asc",  maxPoints:18 },
  { id:"leitergolf", name:"Leitergolf",   icon:"🪜", teamSize:1, mode:"rangliste", scoreLabel:"Punkte",  scoreDir:"desc", maxPoints:18, pointsScheme:"resultat" },
  { id:"tischtennis",name:"Tischtennis",  icon:"🏓", teamSize:1, mode:"ko", thirdPlace:true, maxPoints:18 },
  { id:"darts",      name:"Darts",        icon:"🎯", teamSize:1, mode:"rangliste", scoreLabel:"Punkte",  scoreDir:"desc", maxPoints:18 },
  { id:"schaetzen",  name:"Schätzen",     icon:"🤔", teamSize:1, mode:"rangliste", entries:5, scoreLabel:"Differenz", scoreDir:"asc", maxPoints:18 },
  { id:"beertasting",name:"Beer-Tasting", icon:"🍺", teamSize:1, mode:"rangliste", scoreLabel:"Richtige", scoreDir:"desc", maxPoints:18 },
  { id:"basketball", name:"Basketball",   icon:"🏀", teamSize:1, mode:"rangliste", scoreLabel:"Körbe",   scoreDir:"desc", maxPoints:18 },
  { id:"bowling",    name:"Bowling",      icon:"🎳", teamSize:1, mode:"rangliste", scoreLabel:"Punkte",  scoreDir:"desc", maxPoints:18 },
  { id:"boccia",     name:"Boccia",       icon:"⚪", teamSize:1, mode:"rangliste", scoreLabel:"Punkte",  scoreDir:"desc", maxPoints:18 },
  { id:"stiefelwurf",name:"Stiefelwurf",  icon:"👢", teamSize:1, mode:"rangliste", scoreLabel:"Meter",   scoreDir:"desc", maxPoints:18 },
  { id:"laettle",    name:"Lättle",       icon:"🪙", teamSize:1, mode:"rangliste", scoreLabel:"Punkte",  scoreDir:"desc", maxPoints:18 },
  { id:"flick",      name:"Flick-Challenge", icon:"👆", teamSize:1, mode:"rangliste", scoreLabel:"Punkte", scoreDir:"desc", maxPoints:18 },
  { id:"humpen",     name:"Humpen",       icon:"🍻", teamSize:1, mode:"rangliste", scoreLabel:"Sekunden", scoreDir:"desc", maxPoints:18 },
  { id:"archery",    name:"Bogenschiessen", icon:"🏹", teamSize:1, mode:"rangliste", scoreLabel:"Punkte", scoreDir:"desc", maxPoints:18 },
  { id:"saugnapf",   name:"Saugnapf",     icon:"🪠", teamSize:1, mode:"rangliste", scoreLabel:"Punkte",  scoreDir:"desc", maxPoints:18 },
  { id:"nageln",     name:"Nageln",       icon:"🔨", teamSize:1, mode:"rangliste", scoreLabel:"Schläge", scoreDir:"asc",  maxPoints:18 },
  // Partner
  { id:"cornhole",   name:"Cornhole",     icon:"🌽", teamSize:2, mode:"gruppen_ko", groups:4, qualifiers:2, thirdPlace:true, maxPoints:18 },
  { id:"spikeball",  name:"Spikeball",    icon:"🟡", teamSize:2, mode:"gruppen_ko", groups:4, qualifiers:2, thirdPlace:true, maxPoints:18 },
  { id:"beerpong",   name:"Beerpong",     icon:"🥤", teamSize:2, mode:"gruppen_ko", groups:4, qualifiers:2, thirdPlace:true, maxPoints:18 },
  { id:"padel",      name:"Padel",        icon:"🎾", teamSize:2, mode:"gruppen_ko", groups:4, qualifiers:2, thirdPlace:true, maxPoints:18 },
  { id:"kanjam",     name:"KanJam",       icon:"🥏", teamSize:2, mode:"gruppen_ko", groups:4, qualifiers:2, thirdPlace:true, maxPoints:18 },
  { id:"toeggele",   name:"Töggele",      icon:"⚽", teamSize:2, mode:"ko", thirdPlace:true, maxPoints:18 },
  // Gruppe
  { id:"kubb",       name:"Kubb",         icon:"🪵", teamSize:5, mode:"liga", ligaRounds:2, maxPoints:16 },
  { id:"pubquiz",    name:"Pub Quiz",     icon:"🧠", teamSize:4, mode:"rangliste", scoreLabel:"Punkte", scoreDir:"desc", maxPoints:16 },
  { id:"volleyball", name:"Volleyball",   icon:"🏐", teamSize:5, mode:"liga", ligaRounds:2, maxPoints:16 },
  { id:"flunkyball", name:"Flunkyball / Flip Cup", icon:"🍻", teamSize:8, mode:"ko", thirdPlace:true, resultType:"winner", maxPoints:16 }
];
/* Das Grundgerüst des Spieltags (Spielplan 2026). */
const DEFAULT_LINEUP = ["minigolf","pitpat","leitergolf","tischtennis","cornhole","spikeball","beerpong","kubb","pubquiz","volleyball","flunkyball"];

/* Füllt fehlende Felder einer Spiel-Konfiguration mit Standardwerten. */
function normalizeGame(g){
  const x = Object.assign({
    icon:"🎲", unitKind:"size", teamSize:1, teamCount:4, mode:"rangliste",
    entries:1, scoreLabel:"Punkte", scoreDir:"desc",
    groups:4, qualifiers:2, thirdPlace:true, ligaRounds:0, placementGames:false,
    resultType:"score", maxPoints:18, pointsScheme:"linear", customPoints:"", draw:"zufall"
  }, g || {});
  x.teamSize = Math.max(1, parseInt(x.teamSize, 10) || 1);
  x.teamCount = Math.max(2, parseInt(x.teamCount, 10) || 2);
  x.entries = Math.max(1, parseInt(x.entries, 10) || 1);
  x.groups = Math.max(1, parseInt(x.groups, 10) || 1);
  x.qualifiers = Math.max(1, parseInt(x.qualifiers, 10) || 1);
  x.ligaRounds = Math.max(0, parseInt(x.ligaRounds, 10) || 0);
  x.maxPoints = Math.max(1, parseInt(x.maxPoints, 10) || 18);
  if(!MODES[x.mode]) x.mode = "rangliste";
  return x;
}
function isSolo(g){ return g.unitKind !== "count" && g.teamSize <= 1; }
function category(g){
  if(g.unitKind === "count") return "Gruppe";
  return g.teamSize <= 1 ? "Einzel" : g.teamSize === 2 ? "Partner" : "Gruppe";
}

// ---------- Hilfen ----------
function shuffle(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function nextPow2(n){ let s = 1; while(s < n) s *= 2; return s; }

/* Wie viele Teams bei n Personen und Wunschgrösse size?
   Möglichst nah an der Wunschgrösse, aber nie ein Team, das
   kleiner ist als size-1 (und nie ein «Team» aus einer Person). */
function teamCountFor(n, size){
  if(n <= 0) return 0;
  if(size <= 1) return n;
  let t = Math.max(1, Math.round(n / size));
  const minOk = Math.max(2, size - 1);
  while(t > 1 && Math.floor(n / t) < minOk) t--;
  return t;
}
function splitSizes(n, t){
  const base = Math.floor(n / t), extra = n % t;
  return Array.from({ length:t }, (_, i) => base + (i < extra ? 1 : 0));
}

/* Text für «geht es auf?», z. B. «15 Teams: 14 × 2er, 1 × 3er». */
function describeUnits(n, g){
  g = normalizeGame(g);
  if(n === 0) return "noch niemand angemeldet";
  if(isSolo(g)) return `${n} Einzelspieler`;
  const t = teamsFor(n, g);
  const sizes = splitSizes(n, t);
  const cnt = {};
  sizes.forEach(s => cnt[s] = (cnt[s] || 0) + 1);
  const parts = Object.keys(cnt).map(Number).sort((a,b) => a - b).map(s => `${cnt[s]} × ${s}er`);
  return `${t} Teams: ${parts.join(", ")}`;
}
function unitCountFor(n, g){
  g = normalizeGame(g);
  if(isSolo(g)) return n;
  return teamsFor(n, g);
}
/* Anzahl Teams für eine (normalisierte) Spiel-Einstellung – nie ein 1er-Team. */
function teamsFor(n, g){
  if(g.unitKind === "count") return Math.max(1, Math.min(g.teamCount, Math.floor(n / 2)));
  return teamCountFor(n, g.teamSize);
}
/* Zusatzinfo zum Turnierformat (Gruppengrössen, Freilose). */
function describeFormat(units, g){
  g = normalizeGame(g);
  if(units < 2) return "";
  if(g.mode === "ko"){
    const S = nextPow2(units), byes = S - units;
    return byes ? `K.o.-Raster ${S}, ${byes} Freilos${byes > 1 ? "e" : ""}` : `K.o.-Raster ${S}`;
  }
  if(g.mode === "gruppen_ko"){
    const gc = Math.min(g.groups, Math.floor(units / 2) || 1);
    const sizes = splitSizes(units, gc);
    const q = sizes.reduce((s, x) => s + Math.min(g.qualifiers, x), 0);
    const S = nextPow2(q);
    return `${gc} Gruppen (${sizes.join("/")}), ${q} im K.o.${S > q ? `, ${S - q} Freilos${S - q > 1 ? "e" : ""}` : ""}`;
  }
  if(g.mode === "liga"){
    const all = units % 2 ? units : units - 1;
    const r = g.ligaRounds ? Math.min(g.ligaRounds, all) : all;
    return `${r} Runde${r > 1 ? "n" : ""}${units % 2 ? ", pro Runde 1 Team spielfrei" : ""}${g.placementGames ? ", danach Platzierungsspiele" : ""}`;
  }
  return g.entries > 1 ? `${g.entries} Durchgänge (Summe)` : "";
}

// ---------- Auslosung ----------
/* Teams bilden.
   opts.mode     "zufall" | "stark" (ausgeglichen nach Stärke)
   opts.strength personId -> Zahl 0..1 (1 = stark)
   opts.pairs    Map "a|b" -> wie oft a und b heute schon zusammen waren */
function makeUnits(personIds, g, opts){
  g = normalizeGame(g); opts = opts || {};
  const n = personIds.length;
  if(isSolo(g)) return personIds.map(pid => ({ id:pid, members:[pid] }));
  const t = n ? teamsFor(n, g) : 0;
  if(t === 0) return [];
  const sizes = splitSizes(n, t);
  const str = pid => (opts.strength && opts.strength[pid] != null) ? opts.strength[pid] : 0.5;
  let best = null, bestCost = Infinity;
  const tries = opts.mode === "stark" ? 40 : 300;
  for(let k = 0; k < tries; k++){
    let teams;
    if(opts.mode === "stark"){
      // Snake-Verteilung nach Stärke (mit etwas Zufall, damit es nicht jedes Mal gleich ist)
      const order = personIds.map(p => ({ p, s:str(p) + Math.random() * 0.15 })).sort((a,b) => b.s - a.s).map(x => x.p);
      teams = sizes.map(() => []);
      let i = 0, dir = 1, idx = 0;
      while(i < order.length){
        if(teams[idx].length < sizes[idx]){ teams[idx].push(order[i]); i++; }
        idx += dir;
        if(idx >= t){ idx = t - 1; dir = -1; }
        else if(idx < 0){ idx = 0; dir = 1; }
      }
    } else {
      const sh = shuffle(personIds);
      teams = []; let pos = 0;
      sizes.forEach(s => { teams.push(sh.slice(pos, pos + s)); pos += s; });
    }
    const cost = pairCost(teams, opts.pairs) + (opts.mode === "stark" ? balanceCost(teams, str) * 3 : 0);
    if(cost < bestCost){ bestCost = cost; best = teams; if(cost === 0) break; }
  }
  return best.map((members, i) => ({ id:"u" + (i + 1), name:"Team " + (i + 1), members }));
}
function pairCost(teams, pairs){
  if(!pairs) return 0;
  let c = 0;
  teams.forEach(tm => {
    for(let i = 0; i < tm.length; i++) for(let j = i + 1; j < tm.length; j++){
      c += pairs[pairKey(tm[i], tm[j])] || 0;
    }
  });
  return c;
}
function balanceCost(teams, str){
  const avg = teams.map(tm => tm.reduce((s, p) => s + str(p), 0) / Math.max(1, tm.length));
  return Math.max(...avg) - Math.min(...avg);
}
function pairKey(a, b){ return a < b ? a + "|" + b : b + "|" + a; }

/* Wer war heute schon mit wem im Team? (aus allen anderen Spielen) */
function pairHistory(gameDataList){
  const pairs = {};
  (gameDataList || []).forEach(d => (d && d.units || []).forEach(u => {
    const m = u.members || [];
    for(let i = 0; i < m.length; i++) for(let j = i + 1; j < m.length; j++){
      const k = pairKey(m[i], m[j]); pairs[k] = (pairs[k] || 0) + 1;
    }
  }));
  return pairs;
}

function makeGroups(unitIds, count, unitStrength){
  const gc = Math.max(1, Math.min(count, Math.floor(unitIds.length / 2) || 1));
  const order = unitStrength
    ? unitIds.map(u => ({ u, s:unitStrength(u) + Math.random() * 0.1 })).sort((a,b) => b.s - a.s).map(x => x.u)
    : shuffle(unitIds);
  const groups = Array.from({ length:gc }, () => []);
  // Snake, damit Gruppen auch bei Stärke-Reihenfolge ausgeglichen sind
  order.forEach((u, i) => {
    const r = Math.floor(i / gc), c = i % gc;
    groups[r % 2 ? gc - 1 - c : c].push(u);
  });
  return groups;
}

/* Komplette Auslosung für ein Spiel → wird so gespeichert. */
function drawGame(g, personIds, opts){
  g = normalizeGame(g); opts = opts || {};
  const units = isSolo(g) && g.mode === "rangliste" ? [] : makeUnits(personIds, g, opts);
  const data = { units, groups:null, seeds:null, matches:{}, scores:{}, drawnAt:Date.now(), drawMode:opts.mode || "zufall" };
  const ids = (isSolo(g) ? personIds : units.map(u => u.id));
  const ustr = opts.mode === "stark" ? unitStrengthFn(units, isSolo(g), opts.strength) : null;
  if(g.mode === "ko"){
    data.seeds = ustr ? ids.slice().sort((a,b) => ustr(b) - ustr(a)) : shuffle(ids);
    if(isSolo(g)) data.units = ids.map(pid => ({ id:pid, members:[pid] }));
  } else if(g.mode === "gruppen_ko"){
    if(isSolo(g)) data.units = ids.map(pid => ({ id:pid, members:[pid] }));
    data.groups = makeGroups(ids, g.groups, ustr);
  } else if(g.mode === "liga"){
    if(isSolo(g)) data.units = ids.map(pid => ({ id:pid, members:[pid] }));
    data.order = shuffle(ids);
  }
  return data;
}
function unitStrengthFn(units, solo, strength){
  const s = p => (strength && strength[p] != null) ? strength[p] : 0.5;
  if(solo) return s;
  const map = {};
  units.forEach(u => map[u.id] = u.members.reduce((a, p) => a + s(p), 0) / Math.max(1, u.members.length));
  return id => map[id] != null ? map[id] : 0.5;
}

// ---------- Jeder gegen jeden ----------
/* Kreis-Methode: bei ungerader Anzahl hat pro Runde ein Team frei. */
function roundRobin(ids, maxRounds){
  const list = ids.slice();
  if(list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  if(n < 2) return rounds;
  let cur = list.slice();
  for(let r = 0; r < n - 1; r++){
    const pairs = []; let bye = null;
    for(let i = 0; i < n / 2; i++){
      const a = cur[i], b = cur[n - 1 - i];
      if(a != null && b != null) pairs.push(r % 2 ? [b, a] : [a, b]);
      else bye = a != null ? a : b;
    }
    rounds.push({ pairs, bye });
    cur = [cur[0], cur[n - 1]].concat(cur.slice(1, n - 1));
  }
  return maxRounds ? rounds.slice(0, maxRounds) : rounds;
}

function resultOf(matches, key, a, b){
  const m = matches && matches[key];
  if(!m || m.a !== a || m.b !== b) return null;
  if(m.sa == null || m.sb == null || m.sa === "" || m.sb === "") return null;
  return { sa:Number(m.sa), sb:Number(m.sb) };
}

function standings(ids, games){
  const t = {};
  ids.forEach(id => t[id] = { id, played:0, won:0, draw:0, lost:0, scored:0, against:0, diff:0, pts:0 });
  games.forEach(m => {
    if(!m.res) return;
    const a = t[m.a], b = t[m.b];
    if(!a || !b) return;
    const { sa, sb } = m.res;
    a.played++; b.played++;
    a.scored += sa; a.against += sb; b.scored += sb; b.against += sa;
    if(sa > sb){ a.won++; b.lost++; a.pts += 3; }
    else if(sb > sa){ b.won++; a.lost++; b.pts += 3; }
    else { a.draw++; b.draw++; a.pts++; b.pts++; }
  });
  const rows = Object.values(t);
  rows.forEach(r => r.diff = r.scored - r.against);
  const order = ids.slice();
  rows.sort((x, y) => y.pts - x.pts || y.diff - x.diff || y.scored - x.scored || order.indexOf(x.id) - order.indexOf(y.id));
  let last = null;
  rows.forEach((r, i) => {
    const key = r.pts + "|" + r.diff + "|" + r.scored;
    r.rank = (last && last.key === key) ? last.rank : i + 1;
    last = { key, rank:r.rank };
  });
  return rows;
}

// ---------- K.o. ----------
function seedOrder(S){
  let order = [1];
  while(order.length < S){
    const m = order.length * 2 + 1;
    order = order.flatMap(x => [x, m - x]);
  }
  return order;
}
function roundLabel(teams){
  return { 2:"Final", 4:"Halbfinal", 8:"Viertelfinal", 16:"Achtelfinal", 32:"Sechzehntelfinal" }[teams] || `Runde der ${teams}`;
}
/* Ganzer Raster aus Setzliste + Resultaten. undefined = noch offen,
   null = niemand (Freilos). */
function bracket(seeds, matches, thirdPlace, prefix){
  prefix = prefix || "K";
  const n = seeds.length;
  const out = { size:0, rounds:[], third:null, champion:undefined };
  if(n === 0) return out;
  if(n === 1){ out.champion = seeds[0]; return out; }
  const S = nextPow2(n), R = Math.log2(S);
  out.size = S;
  const slots = seedOrder(S).map(p => p <= n ? seeds[p - 1] : null);
  let prev = null;
  for(let r = 0; r < R; r++){
    const m = S >> (r + 1);
    const list = [];
    for(let k = 0; k < m; k++){
      const a = r === 0 ? slots[2 * k] : prev[2 * k].winner;
      const b = r === 0 ? slots[2 * k + 1] : prev[2 * k + 1].winner;
      const mt = { key:`${prefix}${r}_${k}`, round:r, a, b, winner:undefined, loser:undefined, bye:false, res:null };
      if(a === undefined || b === undefined){ /* wartet */ }
      else if(a === null && b === null){ mt.winner = null; mt.loser = null; mt.bye = true; }
      else if(a === null || b === null){ mt.winner = a === null ? b : a; mt.loser = null; mt.bye = true; }
      else {
        const res = resultOf(matches, mt.key, a, b);
        mt.res = res;
        if(res && res.sa !== res.sb){ mt.winner = res.sa > res.sb ? a : b; mt.loser = res.sa > res.sb ? b : a; }
      }
      list.push(mt);
    }
    out.rounds.push({ label:roundLabel(m * 2), teams:m * 2, matches:list });
    prev = list;
  }
  out.champion = prev[0].winner;
  if(thirdPlace && R >= 2){
    const semis = out.rounds[R - 2].matches;
    const la = semis[0].loser, lb = semis[1].loser;
    if(la && lb){
      const mt = { key:`${prefix}P3`, a:la, b:lb, winner:undefined, loser:undefined, res:null };
      const res = resultOf(matches, mt.key, la, lb);
      mt.res = res;
      if(res && res.sa !== res.sb){ mt.winner = res.sa > res.sb ? la : lb; mt.loser = res.sa > res.sb ? lb : la; }
      out.third = mt;
    } else if(la === undefined || lb === undefined){
      out.third = { key:`${prefix}P3`, a:la, b:lb, winner:undefined, loser:undefined, res:null, pending:true };
    }
  }
  return out;
}
/* Stufen eines K.o.: [Sieger, Final, (3., 4.) bzw. 3., Verlierer HF? …]
   Liefert pro Einheit { tier, rank, final } und die Anzahl Stufen. */
function koPlacements(br, thirdPlace){
  const res = {};
  const R = br.rounds.length;
  if(R === 0){
    if(br.champion) res[br.champion] = { tier:0, rank:1, final:true, label:"Sieger" };
    return { places:res, tiers:1, rankOfTier:[1] };
  }
  const tp = thirdPlace && R >= 2;
  // Stufen-Tabelle: 0 Sieger, 1 Final, dann 3 (und 4), dann je Runde rückwärts
  const rankOfTier = [1, 2];
  const labelOfTier = ["Sieger", "Final"];
  if(R >= 2){
    if(tp){ rankOfTier.push(3, 4); labelOfTier.push("3. Platz", "4. Platz"); }
    else { rankOfTier.push(3); labelOfTier.push("Halbfinal"); }
  }
  const tierOfRoundLoser = {};
  tierOfRoundLoser[R - 1] = 1;
  if(R >= 2) tierOfRoundLoser[R - 2] = tp ? 3 : 2;
  for(let r = R - 3; r >= 0; r--){
    tierOfRoundLoser[r] = rankOfTier.length;
    rankOfTier.push((br.size >> (r + 1)) + 1);
    labelOfTier.push(br.rounds[r].label);
  }
  // Wer ist wo ausgeschieden / noch dabei?
  const alive = {};
  br.rounds.forEach((round, r) => round.matches.forEach(m => {
    [m.a, m.b].forEach(u => {
      if(!u) return;
      if(m.loser === u){
        let t = tierOfRoundLoser[r];
        if(r === R - 2 && tp){
          const th = br.third;
          if(!th) t = 2;                                  // kein Spiel um Platz 3 möglich (Freilos)
          else if(th.winner === u) t = 2;
          else if(th.loser === u) t = 3;
          else { alive[u] = { r, tier:3 }; return; }   // spielt noch um Platz 3
          res[u] = { tier:t, rank:rankOfTier[t], final:true, label:labelOfTier[t] };
          return;
        }
        res[u] = { tier:t, rank:rankOfTier[t], final:true, label:labelOfTier[t] };
      } else if(m.winner === u){
        if(r === R - 1) res[u] = { tier:0, rank:1, final:true, label:"Sieger" };
      } else {
        // noch offen: garantiert die Stufe des Verlierers dieser Runde
        alive[u] = { r, tier:tierOfRoundLoser[r] };
      }
    });
  }));
  Object.entries(alive).forEach(([u, a]) => {
    if(!res[u]) res[u] = { tier:a.tier, rank:null, final:false, label:"im Rennen" };
  });
  return { places:res, tiers:rankOfTier.length, rankOfTier, labelOfTier };
}

// ---------- Punkte ----------
function tierPoints(i, T, g){
  if(g.pointsScheme === "liste"){
    const list = String(g.customPoints || "").split(/[^0-9.]+/).filter(Boolean).map(Number);
    if(list.length) return i < list.length ? list[i] : list[list.length - 1];
  }
  if(T <= 1) return g.maxPoints;
  return Math.max(1, Math.round(1 + (g.maxPoints - 1) * (T - 1 - i) / (T - 1)));
}

// ---------- Auswertung eines Spiels ----------
/* ctx.participants = aktuelle Teilnehmer-IDs (für Einzel-Ranglisten)
   Rückgabe: { units, rows:[{unitId, rank, points, final, label}], personPoints,
               status:"offen"|"läuft"|"fertig", done, total, view } */
function evaluate(gIn, data, ctx){
  const g = normalizeGame(gIn);
  data = data || {};
  ctx = ctx || {};
  const matches = data.matches || {};
  const solo = isSolo(g);
  let units = data.units || [];
  if(solo && g.mode === "rangliste"){
    const set = new Set(ctx.participants || []);
    Object.keys(data.scores || {}).forEach(p => set.add(p));
    units = [...set].map(pid => ({ id:pid, members:[pid] }));
  }
  const out = { g, units, rows:[], personPoints:{}, status:"offen", done:0, total:0, view:{} };
  const drawn = (solo && g.mode === "rangliste") || units.length > 0;
  out.drawn = drawn;
  if(!drawn) return out;
  const unitIds = units.map(u => u.id);
  const place = {};   // unitId -> { rank, points, final, label }

  if(g.mode === "rangliste"){
    const rows = units.map(u => {
      const arr = (data.scores || {})[u.id] || [];
      const vals = arr.slice(0, g.entries).map(v => v === "" || v == null ? null : Number(v));
      const filled = vals.filter(v => v != null && !isNaN(v));
      return { id:u.id, vals, total:filled.length ? filled.reduce((s, v) => s + v, 0) : null, complete:filled.length >= g.entries };
    });
    const dir = g.scoreDir === "asc" ? 1 : -1;
    const ranked = rows.filter(r => r.total != null).sort((a, b) => dir * (a.total - b.total));
    let last = null;
    ranked.forEach((r, i) => { r.rank = (last && last.total === r.total) ? last.rank : i + 1; last = r; });
    out.total = rows.length; out.done = rows.filter(r => r.complete).length;
    const allDone = out.done === out.total && out.total > 0;
    ranked.forEach(r => {
      const pts = g.pointsScheme === "resultat" ? Math.round(r.total) : tierPoints(r.rank - 1, rows.length, g);
      place[r.id] = { rank:r.rank, points:pts, final:allDone && r.complete, label:"" };
    });
    out.view.rows = rows;
    out.status = out.done === 0 && ranked.length === 0 ? "bereit" : allDone ? "fertig" : "läuft";
  }

  else if(g.mode === "ko"){
    const seeds = (data.seeds || unitIds).filter(id => unitIds.includes(id));
    unitIds.forEach(id => { if(!seeds.includes(id)) seeds.push(id); });
    const br = bracket(seeds, matches, g.thirdPlace);
    const kp = koPlacements(br, g.thirdPlace);
    out.view.bracket = br;
    countMatches(out, br);
    Object.entries(kp.places).forEach(([u, p]) => {
      place[u] = { rank:p.rank, points:tierPoints(p.tier, kp.tiers, g), final:p.final, label:p.label };
    });
    out.status = br.champion && (!br.third || br.third.winner) ? "fertig" : out.done ? "läuft" : "bereit";
  }

  else if(g.mode === "gruppen_ko"){
    const groups = (data.groups || [unitIds]).map(gr => gr.filter(id => unitIds.includes(id)));
    const gviews = groups.map((ids, gi) => {
      const rr = roundRobin(ids);
      const games = [];
      rr.forEach((rd, ri) => rd.pairs.forEach(([a, b], k) => {
        const key = `G${gi}_${ri}_${k}`;
        games.push({ key, a, b, round:ri, res:resultOf(matches, key, a, b) });
      }));
      return { ids, games, byes:rr.map(r => r.bye), table:standings(ids, games) };
    });
    let gDone = 0, gTotal = 0;
    gviews.forEach(v => v.games.forEach(m => { gTotal++; if(m.res) gDone++; }));
    const groupsComplete = gTotal === gDone;
    out.view.groups = gviews;
    // Qualifikanten, sortiert nach Gruppenrang, dann Leistung
    const q = g.qualifiers;
    let seeds = null;
    if(groupsComplete){
      const quals = [];
      gviews.forEach((v, gi) => v.table.forEach((row, pos) => { if(pos < q) quals.push({ id:row.id, pos, gi, row }); }));
      quals.sort((a, b) => a.pos - b.pos || b.row.pts - a.row.pts || b.row.diff - a.row.diff || b.row.scored - a.row.scored || a.gi - b.gi);
      seeds = avoidSameGroup(quals.map(x => x.id), id => gviews.findIndex(v => v.ids.includes(id)));
    }
    const qualCount = gviews.reduce((s, v) => s + Math.min(q, v.ids.length), 0);
    const br = seeds ? bracket(seeds, matches, g.thirdPlace) : null;
    out.view.bracket = br;
    out.view.qualCount = qualCount;
    out.view.groupsComplete = groupsComplete;
    // Stufen: K.o.-Stufen (aus einem gedachten Raster in Endgrösse) + Gruppenränge
    const koShape = br ? koPlacements(br, g.thirdPlace) : koPlacements(bracket(Array.from({ length:qualCount }, (_, i) => "x" + i), {}, g.thirdPlace), g.thirdPlace);
    const maxGroup = Math.max(...gviews.map(v => v.ids.length));
    const extraLevels = Math.max(0, maxGroup - q);
    const T = koShape.tiers + extraLevels;
    // Rang der Nicht-Qualifizierten: nach den K.o.-Plätzen
    let nextRank = qualCount + 1;
    const levelRank = [];
    for(let l = 0; l < extraLevels; l++){
      levelRank.push(nextRank);
      nextRank += gviews.filter(v => v.ids.length > q + l).length;
    }
    gviews.forEach(v => v.table.forEach((row, pos) => {
      if(pos >= q){
        const l = pos - q;
        place[row.id] = groupsComplete
          ? { rank:levelRank[l], points:tierPoints(koShape.tiers + l, T, g), final:true, label:`Gruppen-${pos + 1}.` }
          : { rank:null, points:0, final:false, label:"Gruppenphase" };
      } else if(!groupsComplete){
        place[row.id] = { rank:null, points:0, final:false, label:"Gruppenphase" };
      }
    }));
    if(br){
      Object.entries(koShape.places).forEach(([u, p]) => {
        place[u] = { rank:p.rank, points:tierPoints(p.tier, T, g), final:p.final, label:p.label };
      });
    }
    out.done = gDone; out.total = gTotal;
    if(br) countMatches(out, br);
    else out.total += Math.max(0, qualCount - 1) + (g.thirdPlace && qualCount >= 4 ? 1 : 0);
    out.status = br && br.champion && (!br.third || br.third.winner) ? "fertig" : out.done ? "läuft" : "bereit";
  }

  else if(g.mode === "liga"){
    const order = (data.order || unitIds).filter(id => unitIds.includes(id));
    unitIds.forEach(id => { if(!order.includes(id)) order.push(id); });
    const rr = roundRobin(order, g.ligaRounds || 0);
    const games = [];
    rr.forEach((rd, ri) => rd.pairs.forEach(([a, b], k) => {
      const key = `L${ri}_${k}`;
      games.push({ key, a, b, round:ri, res:resultOf(matches, key, a, b) });
    }));
    const table = standings(order, games);
    out.view.rounds = rr; out.view.games = games; out.view.table = table;
    out.done = games.filter(m => m.res).length; out.total = games.length;
    const leagueDone = out.done === out.total;
    let finalOrder = table.map(r => ({ id:r.id, rank:r.rank }));
    let placementDone = true;
    if(g.placementGames && order.length >= 2){
      const pg = [];
      for(let i = 0; i + 1 < table.length; i += 2){
        const a = table[i].id, b = table[i + 1].id, key = `PL${i / 2}`;
        const res = leagueDone ? resultOf(matches, key, a, b) : null;
        pg.push({ key, a, b, places:[i + 1, i + 2], res, ready:leagueDone });
      }
      out.view.placement = pg;
      out.total += pg.length;
      out.done += pg.filter(m => m.res).length;
      placementDone = leagueDone && pg.every(m => m.res && m.res.sa !== m.res.sb);
      if(leagueDone){
        finalOrder = [];
        table.forEach((r, i) => finalOrder.push({ id:r.id, rank:i + 1 }));
        pg.forEach(m => {
          if(m.res && m.res.sa !== m.res.sb){
            const w = m.res.sa > m.res.sb ? m.a : m.b, l = w === m.a ? m.b : m.a;
            finalOrder[m.places[0] - 1] = { id:w, rank:m.places[0] };
            finalOrder[m.places[1] - 1] = { id:l, rank:m.places[1] };
          }
        });
      }
    }
    const fin = leagueDone && placementDone;
    finalOrder.forEach(r => {
      place[r.id] = { rank:r.rank, points:tierPoints(r.rank - 1, order.length, g), final:fin, label:"" };
    });
    out.status = fin ? "fertig" : out.done ? "läuft" : "bereit";
  }

  // Zeilen + Personenpunkte
  out.rows = units.map(u => Object.assign({ unitId:u.id, members:u.members }, place[u.id] || { rank:null, points:0, final:false, label:"" }))
    .sort((a, b) => (a.rank || 999) - (b.rank || 999) || b.points - a.points);
  units.forEach(u => {
    const p = place[u.id];
    (u.members || []).forEach(pid => { out.personPoints[pid] = p ? p.points : 0; });
  });
  out.final = out.status === "fertig";
  return out;
}
function countMatches(out, br){
  br.rounds.forEach(r => r.matches.forEach(m => {
    if(m.bye) return;
    out.total++;
    if(m.winner !== undefined && m.winner !== null) out.done++;
  }));
  if(br.third){ out.total++; if(br.third.winner) out.done++; }
}

/* Alle offenen Spiele mit Zufallsresultaten füllen (Testmodus). */
function openMatches(ev){
  const list = [], v = ev.view;
  const add = (m, noDraw) => { if(m && m.a && m.b && !m.res && !m.bye) list.push({ key:m.key, a:m.a, b:m.b, noDraw }); };
  (v.groups || []).forEach(gr => gr.games.forEach(m => add(m, false)));
  (v.games || []).forEach(m => add(m, false));
  (v.placement || []).forEach(m => { if(m.ready) add(m, true); });
  if(v.bracket){
    v.bracket.rounds.forEach(r => r.matches.forEach(m => { if(m.a && m.b && m.winner === undefined) list.push({ key:m.key, a:m.a, b:m.b, noDraw:true }); }));
    const t = v.bracket.third;
    if(t && t.a && t.b && t.winner === undefined) list.push({ key:t.key, a:t.a, b:t.b, noDraw:true });
  }
  return list;
}
function randomResult(g, noDraw){
  if(normalizeGame(g).resultType === "winner"){ return Math.random() < 0.5 ? [1, 0] : [0, 1]; }
  let a = Math.floor(Math.random() * 11), b = Math.floor(Math.random() * 11);
  if(noDraw && a === b) a++;
  return [a, b];
}
function simulate(gIn, dataIn, ctx){
  const g = normalizeGame(gIn);
  const data = JSON.parse(JSON.stringify(dataIn || {}));
  data.matches = data.matches || {}; data.scores = data.scores || {};
  for(let guard = 0; guard < 50; guard++){
    const ev = evaluate(g, data, ctx);
    if(g.mode === "rangliste"){
      ev.view.rows.forEach(r => {
        const arr = (data.scores[r.id] || []).slice();
        const lo = g.pointsScheme === "resultat" ? 0 : 20, span = g.pointsScheme === "resultat" ? Math.max(2, Math.round(g.maxPoints / g.entries)) : 40;
        for(let i = 0; i < g.entries; i++) if(arr[i] == null || arr[i] === "") arr[i] = lo + Math.floor(Math.random() * span);
        data.scores[r.id] = arr;
      });
      return data;
    }
    const open = openMatches(ev);
    if(!open.length) return data;
    open.forEach(m => { const [sa, sb] = randomResult(g, m.noDraw); data.matches[m.key] = { a:m.a, b:m.b, sa, sb }; });
  }
  return data;
}
/* Setzliste so umstellen, dass sich in der 1. K.o.-Runde möglichst
   keine zwei Teams aus derselben Gruppe treffen. */
function avoidSameGroup(seeds, groupOf){
  const n = seeds.length;
  if(n < 4) return seeds;
  const S = nextPow2(n);
  const order = seedOrder(S);
  const s = seeds.slice();
  const opp = i => { // Index des Gegners von Setzplatz i (0-basiert) in Runde 1
    const pos = order.indexOf(i + 1);
    const o = order[pos ^ 1] - 1;
    return o < n ? o : -1;
  };
  for(let i = 0; i < n; i++){
    const o = opp(i);
    if(o < 0 || o < i) continue;
    if(groupOf(s[i]) !== groupOf(s[o])) continue;
    // tausche s[o] mit einem anderen schwächeren Setzplatz ohne Konflikt
    for(let j = n - 1; j > i; j--){
      if(j === o) continue;
      const oj = opp(j);
      const tryS = s.slice(); [tryS[o], tryS[j]] = [tryS[j], tryS[o]];
      const ok = groupOf(tryS[i]) !== groupOf(tryS[o]) && (oj < 0 || groupOf(tryS[j]) !== groupOf(tryS[oj]));
      if(ok){ [s[o], s[j]] = [s[j], s[o]]; break; }
    }
  }
  return s;
}

/* Gesamtrangliste über alle Spiele. */
function overall(games, gameData, ctx){
  const evals = {};
  const totals = {};
  (ctx.participants || []).forEach(p => totals[p] = 0);
  games.forEach(g => {
    const ev = evaluate(g, gameData[g.id], ctx);
    evals[g.id] = ev;
    Object.entries(ev.personPoints).forEach(([p, pts]) => {
      totals[p] = (totals[p] || 0) + pts;
    });
  });
  const rows = Object.entries(totals).map(([pid, total]) => ({ pid, total }))
    .sort((a, b) => b.total - a.total);
  let last = null;
  rows.forEach((r, i) => { r.rank = (last && last.total === r.total) ? last.rank : i + 1; last = r; });
  return { rows, evals };
}

/* Stärke aus der Historie: Ø relativer Rang (1 = immer Sieger, 0 = immer Letzter). */
function strengthFromHistory(historyYears){
  const acc = {};
  (historyYears || []).forEach(y => {
    const n = (y.rows || []).length;
    if(n < 2) return;
    y.rows.forEach(r => (r.pids || []).forEach(pid => {
      if(!r.rank) return;
      (acc[pid] = acc[pid] || []).push((n - r.rank) / (n - 1));
    }));
  });
  const out = {};
  Object.entries(acc).forEach(([p, arr]) => out[p] = arr.reduce((s, v) => s + v, 0) / arr.length);
  return out;
}

/* Kurzbeschrieb eines Spiels für Karten und Listen. */
function summary(gIn){
  const g = normalizeGame(gIn);
  const who = g.unitKind === "count" ? `${g.teamCount} Teams` : g.teamSize <= 1 ? "Einzel" : `${g.teamSize}er-Teams`;
  let how = MODES[g.mode];
  if(g.mode === "gruppen_ko") how = `${g.groups} Gruppen + K.o. (je ${g.qualifiers} weiter)`;
  if(g.mode === "liga") how = g.ligaRounds ? `Jeder gegen jeden, ${g.ligaRounds} Runden` : "Jeder gegen jeden";
  if(g.mode === "rangliste") how = `Rangliste nach ${g.scoreLabel}${g.scoreDir === "asc" ? " (wenig = gut)" : ""}`;
  return `${who} · ${how}`;
}

const api = {
  MODES, DEFAULT_CATALOG, DEFAULT_LINEUP,
  normalizeGame, isSolo, category, shuffle,
  teamCountFor, splitSizes, describeUnits, describeFormat, unitCountFor,
  makeUnits, makeGroups, drawGame, pairHistory, roundRobin, standings,
  seedOrder, bracket, koPlacements, tierPoints, evaluate, overall,
  strengthFromHistory, summary, roundLabel, openMatches, simulate
};
if(typeof module !== "undefined" && module.exports) module.exports = api;
else root.SpieltagEngine = api;
})(this);
