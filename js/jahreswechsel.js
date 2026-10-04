/* ============================================================
   MST Ermatingen – Neues Vereinsjahr (nur Admin, Startseite)

   Ein Dialog statt vier Orte: legt für das Vereinsjahr, das mit der GV <jahr>
   endet, in einem Schritt an, was noch fehlt:
     - GV <jahr> (Traktanden + Essen-Varianten der letzten GV) und das Finanzjahr
       finance/<jahr> mit dem Schlussbestand des Vorjahrs (gleiche Rechnung wie
       «Neue GV anlegen» in js/gv-app.js)
     - Spieltag <jahr> (Spiele vom letzten Spieltag, ohne Teilnehmende) → aktuell
     - Afterworkbar <jahr> (Einsatzplan ohne Namen, Checkliste/Material ohne Häkchen,
       Karte) → aktuell (gleich wie «Neues Jahr anlegen» auf der Afterworkbar-Seite)
     - Padel-Saison <jahr-1>-<jahr> (Termine ein Jahr später, gleiche Preise und Fixe
       ohne Ausgetretene, Ausfälle leer) → aktuell
   Was es schon gibt, bleibt unangetastet. Die einzelnen Seiten können das
   weiterhin auch selbst.
   ============================================================ */
const JW = {
  dlg: null,
  T: null,          // Zieljahr = Jahr der GV, mit der das neue Vereinsjahr endet
  s: null,          // geladener Stand

  async open(){
    if(!this.dlg){
      this.dlg = document.createElement("dialog");
      this.dlg.className = "jw-dlg";
      document.body.appendChild(this.dlg);
      this.dlg.addEventListener("click", e => { if(e.target === this.dlg && !this.busy) this.dlg.close(); });
    }
    this.dlg.innerHTML = '<h3>Neues Vereinsjahr</h3><p class="dlg-sub">lade den Stand …</p>';
    if(!this.dlg.open) this.dlg.showModal();
    try{
      await this.load();
      this.draw();
    }catch(e){
      console.error(e);
      this.dlg.innerHTML = `<h3>Neues Vereinsjahr</h3><p class="dlg-sub">Konnte den Stand nicht laden: ${esc(e.message || e)}</p>
        <div class="dlg-actions"><div class="right"><button class="btn-primary" type="button" onclick="this.closest('dialog').close()">Schliessen</button></div></div>`;
    }
  },

  /* ---------- Stand ---------- */
  async load(){
    const ids = async col => (await db.collection(col).get()).docs.map(d => d.id);
    const [gvSnap, spIds, awbIds, padelIds, spSet, awbConf, padelConf] = await Promise.all([
      db.collection("gv").get(), ids("spieltag"), ids("awb"), ids("padel"),
      db.collection("spieltagMeta").doc("settings").get(), db.collection("config").doc("awb").get(), db.collection("config").doc("padel").get()
    ]);
    const gvs = gvSnap.docs.filter(d => /^\d{4}$/.test(d.id)).map(d => ({ y:d.id, d:d.data() })).sort((a, b) => a.y.localeCompare(b.y));
    const today = new Date().toISOString().slice(0, 10);
    const past = gvs.filter(g => g.d.date && g.d.date <= today);
    if(!this.T) this.T = past.length ? String(+past[past.length - 1].y + 1) : String(gvs.length ? +gvs[gvs.length - 1].y : new Date().getFullYear());
    this.s = {
      gvs, spIds:spIds.filter(y => /^\d{4}$/.test(y)).sort(), awbIds:awbIds.filter(y => /^\d{4}$/.test(y)).sort(),
      padelIds:padelIds.filter(y => /^\d{4}-\d{2}$/.test(y)).sort(),
      spCurrent:spSet.exists ? spSet.data().currentYear : null,
      awbCurrent:awbConf.exists ? awbConf.data().currentYear : null,
      padelCurrent:padelConf.exists ? padelConf.data().currentSeason : null
    };
  },
  seasonId(T){ return `${+T - 1}-${String(+T % 100).padStart(2, "0")}`; },
  seasonLabel(id){ return "Saison " + id.replace(/^20(\d\d)-(\d\d)$/, "$1/$2"); },
  /* jüngstes Jahr vor T als Vorlage */
  before(list, T){ return list.filter(y => y < T).slice(-1)[0] || null; },
  steps(){
    const s = this.s, T = this.T, sid = this.seasonId(T);
    const gvSrc = this.before(s.gvs.map(g => g.y), T);
    const spSrc = this.before(s.spIds, T), awbSrc = this.before(s.awbIds, T), padSrc = this.before(s.padelIds, sid);
    return [
      { key:"gv", icon:"📋", title:`GV ${T} + Finanzjahr ${+T - 1}/${String(T).slice(2)}`, exists:s.gvs.some(g => g.y === T), src:gvSrc,
        what:gvSrc ? `Traktanden und Essen-Varianten von der GV ${gvSrc}; Finanzen starten mit dem Schlussbestand ${gvSrc}.` : "Keine frühere GV als Vorlage." },
      { key:"spieltag", icon:"🏆", title:`Spieltag ${T} (${+T - 2019}. Minispieltag)`, exists:s.spIds.includes(T), src:spSrc,
        current:s.spCurrent === T, what:spSrc ? `Spiele vom Spieltag ${spSrc}, noch ohne Teilnehmende; Datum kommt aus dem Kalender (Termin «Minispieltag ${T}»).` : "Keine Vorlage." },
      { key:"awb", icon:"🍺", title:`Afterworkbar ${T}`, exists:s.awbIds.includes(T), src:awbSrc, current:s.awbCurrent === T,
        what:awbSrc ? `Einsatzplan ohne Namen, Checkliste und Material ohne Häkchen und die Karte von ${awbSrc}.` : "Keine Vorlage." },
      { key:"padel", icon:"🎾", title:this.seasonLabel(sid), exists:s.padelIds.includes(sid), src:padSrc, current:s.padelCurrent === sid, id:sid,
        what:padSrc ? `Termine ein Jahr nach ${this.seasonLabel(padSrc)}, gleiche Preise und Fixe (ohne Ausgetretene), Ausfälle leer.` : "Keine Vorlage." }
    ];
  },

  /* ---------- Dialog ---------- */
  draw(){
    const steps = this.steps();
    const todo = steps.filter(x => !x.exists && x.src);
    this.dlg.innerHTML = `
      <h3>Neues Vereinsjahr</h3>
      <p class="dlg-sub">Legt alles an, was für das Vereinsjahr bis zur GV ${esc(this.T)} noch fehlt. Bestehendes bleibt, wie es ist.</p>
      <form id="jwForm">
        <label class="jw-year">Vereinsjahr endet mit der GV<input name="T" inputmode="numeric" pattern="\\d{4}" value="${esc(this.T)}" required></label>
        <div class="jw-steps">${steps.map(x => `
          <label class="jw-step ${x.exists ? "done" : ""}">
            <input type="checkbox" name="step" value="${x.key}" ${!x.exists && x.src ? "checked" : ""} ${x.exists || !x.src ? "disabled" : ""}>
            <span class="jw-ic">${x.icon}</span>
            <span><b>${esc(x.title)}</b>
              <span class="jw-what">${x.exists ? `✓ gibt es schon${x.current === false ? " – aber nicht als aktuell markiert (auf der jeweiligen Seite änderbar)" : ""}` : esc(x.what)}</span></span>
          </label>`).join("")}</div>
        <p class="dlg-msg" id="jwMsg"></p>
        <div class="dlg-actions">
          <div class="right">
            <button class="btn-ghost" type="button" id="jwClose">Schliessen</button>
            <button class="btn-primary" type="submit" ${todo.length ? "" : "disabled"}>${todo.length ? `${todo.length} Bereich${todo.length === 1 ? "" : "e"} anlegen` : "Alles schon da"}</button>
          </div>
        </div>
      </form>`;
    const f = this.dlg.querySelector("#jwForm");
    this.dlg.querySelector("#jwClose").onclick = () => this.dlg.close();
    f.T.onchange = async () => {
      if(!/^\d{4}$/.test(f.T.value)) return;
      this.T = f.T.value;
      this.draw();
    };
    f.onsubmit = e => { e.preventDefault(); this.run([...f.querySelectorAll('[name=step]:checked')].map(c => c.value)); };
  },

  async run(keys){
    if(!keys.length) return;
    const steps = this.steps().filter(x => keys.includes(x.key));
    if(!confirm(`Für das Vereinsjahr bis zur GV ${this.T} anlegen:\n\n${steps.map(x => "• " + x.title).join("\n")}\n\nNeue Jahre werden zum aktuellen Jahr auf den Seiten.`)) return;
    const msg = this.dlg.querySelector("#jwMsg");
    this.busy = true;
    this.dlg.querySelectorAll("button, input").forEach(b => b.disabled = true);
    const done = [], failed = [];
    for(const x of steps){
      msg.style.color = "var(--muted)";
      msg.textContent = `lege an: ${x.title} …`;
      try{
        await this[x.key](x);
        done.push(x.title);
        MST.log("verein", `Neues Vereinsjahr: ${x.title} angelegt (Vorlage ${x.src})`);
      }catch(e){ console.error(x.key, e); failed.push(`${x.title} (${e.message || e})`); }
    }
    this.busy = false;
    await this.load();
    this.draw();
    const m = this.dlg.querySelector("#jwMsg");
    m.style.color = failed.length ? "var(--red)" : "var(--green)";
    m.textContent = (done.length ? "✓ Angelegt: " + done.join(", ") + ". " : "") + (failed.length ? "Nicht geklappt: " + failed.join(", ") : "");
  },

  /* ---------- die einzelnen Bereiche ---------- */
  async gv(x){
    const T = this.T, S = x.src;
    const src = (await db.collection("gv").doc(S).get()).data() || {};
    const tk = (src.traktanden || []).map(t => Object.assign({}, t, { id:Math.random().toString(36).slice(2, 9) }));
    const fin = (await db.collection("finance").doc(S).get()).data() || null;
    const batch = db.batch();
    batch.set(db.collection("gv").doc(T), { edition:(src.edition || (+S - 2023)) + 1, date:null, place:src.place || "", traktanden:tk, essen:src.essen || [], rueckblick:"" });
    if(fin && !(await db.collection("finance").doc(T).get()).exists){
      // Schlussbestand wie js/gv-app.js → finance(): Anfangsbestand + Einnahmen − Ausgaben, Kasse, Gewinn AWB
      const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/[’'\s]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
      const bookings = (await db.collection("finance").doc(S).collection("bookings").get()).docs.map(d => d.data());
      const closing = num(fin.opening) + bookings.reduce((s, b) => s + num(b.in) - num(b.out), 0);
      const awb = fin.awb || {};
      const profit = (awb.income || []).reduce((s, v) => s + num(v.betrag), 0) - (awb.costs || []).reduce((s, v) => s + num(v.betrag), 0);
      batch.set(db.collection("finance").doc(T), {
        vjStart:src.date || `${S}-10-01`, vjEnd:`${T}-09-30`, opening:Math.round(closing * 100) / 100, openingCash:num(fin.cash), cash:num(fin.cash),
        awb:{ costs:[], income:[], profits:Object.assign({}, awb.profits || {}, { [S]:Math.round(profit * 100) / 100 }) }
      });
    }
    await batch.commit();
  },

  async spieltag(x){
    const T = this.T;
    const src = (await db.collection("spieltag").doc(x.src).get()).data() || {};
    const batch = db.batch();
    batch.set(db.collection("spieltag").doc(T), { year:+T, edition:+T - 2019, date:null, place:src.place || "", participants:[], games:src.games || [], closed:false });
    if(!this.s.spCurrent || T > this.s.spCurrent) batch.set(db.collection("spieltagMeta").doc("settings"), { currentYear:T }, { merge:true });
    await batch.commit();
  },

  async awb(x){
    const T = this.T, S = x.src, src = db.collection("awb").doc(S), dst = db.collection("awb").doc(T);
    const [info, menu, shifts, tasks, material] = await Promise.all([
      src.get(), db.collection("awbMenu").doc(S).get(), src.collection("shifts").get(), src.collection("tasks").get(), src.collection("material").get()
    ]);
    const i = info.data() || {};
    const batch = db.batch();
    batch.set(dst, { date:"", place:i.place || "", note:`Vorlage aus ${S}`, memberPrices:i.memberPrices || {} });
    batch.set(db.collection("awbMenu").doc(T), { title:`Afterworkbar ${T}`, items:(menu.data() || {}).items || [] });
    shifts.forEach(d => batch.set(dst.collection("shifts").doc(d.id), Object.assign({}, d.data(), { assignee:null, assigneeName:null, at:null })));
    tasks.forEach(d => batch.set(dst.collection("tasks").doc(d.id), Object.assign({}, d.data(), { done:false, doneBy:null, doneByName:null, doneAt:null })));
    material.forEach(d => batch.set(dst.collection("material").doc(d.id), Object.assign({}, d.data(), { done:false, doneBy:null, doneByName:null, doneAt:null })));
    if(!this.s.awbCurrent || T > this.s.awbCurrent) batch.set(db.collection("config").doc("awb"), { currentYear:T }, { merge:true });
    await batch.commit();
  },

  async padel(x){
    const cfg = (await db.collection("padel").doc(x.src).get()).data() || {};
    // so viele Jahre verschieben wie zwischen den Saisons liegen; 364 Tage = gleicher Wochentag (Donnerstag)
    const years = +x.id.slice(0, 4) - +x.src.slice(0, 4);
    const shift = iso => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 364 * years); return d.toISOString().slice(0, 10); };
    const fixed = (cfg.fixed || []).filter(f => !(MST.directory[f.id] || {}).left);
    const batch = db.batch();
    batch.set(db.collection("padel").doc(x.id), Object.assign({}, cfg, { start:shift(cfg.start), end:shift(cfg.end), venueCancelled:{}, note:"", fixed }));
    if(!this.s.padelCurrent || x.id > this.s.padelCurrent) batch.set(db.collection("config").doc("padel"), { currentSeason:x.id }, { merge:true });
    await batch.commit();
  }
};
