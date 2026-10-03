/* ============================================================
   MST Spieltag – Dialog «Spiel einstellen»
   Wird auf der Spieltag-Seite (Spiele des Jahres) und in der
   Organisation (Grundgerüst der Disziplinen) verwendet.
   ============================================================ */
const GameDialog = (() => {
  const E = SpieltagEngine;
  const SIZE_BUTTONS = [1, 2, 3, 4, 5, 6, 8];
  // Änderungen an diesen Feldern machen eine bestehende Auslosung ungültig
  const STRUCTURAL = ["unitKind", "teamSize", "teamCount", "mode", "groups", "qualifiers", "ligaRounds", "entries"];

  function structuralChange(a, b){
    const x = E.normalizeGame(a), y = E.normalizeGame(b);
    return STRUCTURAL.some(k => x[k] !== y[k]);
  }

  /* opts: { title, catalog, participants (Anzahl), allowCatalogPick, onSave(g), onDelete() } */
  function open(game, opts){
    opts = opts || {};
    let g = E.normalizeGame(JSON.parse(JSON.stringify(game || {})));
    let dlg = document.getElementById("gameDlg");
    if(!dlg){ dlg = document.createElement("dialog"); dlg.id = "gameDlg"; dlg.className = "game-dlg"; document.body.appendChild(dlg); }

    const render = () => {
      const n = opts.participants || 0;
      const units = E.unitCountFor(n, g);
      const catOptions = (opts.catalog || []).map(c => `<option value="${esc(c.id)}">${esc(c.icon || "")} ${esc(c.name)}</option>`).join("");
      const sizeKind = g.unitKind === "count" ? "count" : "size";
      dlg.innerHTML = `
        <form method="dialog" id="gameForm">
          <h3>${esc(opts.title || "Spiel einstellen")}</h3>
          ${opts.allowCatalogPick && catOptions ? `
          <label>Disziplin wechseln (übernimmt das Grundgerüst)
            <select name="pick"><option value="">– bleibt –</option>${catOptions}</select>
          </label>` : ""}
          <div class="form-row two">
            <label>Name<input name="name" value="${esc(g.name || "")}" required></label>
            <label>Symbol<input name="icon" value="${esc(g.icon || "")}" maxlength="4" class="icon-input"></label>
          </div>

          <div class="fs-title">Wer spielt?</div>
          <div class="seg seg-wrap" id="sizeSeg">
            ${SIZE_BUTTONS.map(s => `<button type="button" class="btn-small ${sizeKind === "size" && g.teamSize === s ? "on" : ""}" data-size="${s}">${s === 1 ? "Einzel" : s + "er"}</button>`).join("")}
            <button type="button" class="btn-small ${sizeKind === "count" ? "on" : ""}" data-count="1">feste Anzahl Teams</button>
          </div>
          <div class="form-row two">
            ${sizeKind === "count"
              ? `<label>Anzahl Teams<input name="teamCount" type="number" min="2" max="40" value="${g.teamCount}"></label>`
              : `<label>Teamgrösse<input name="teamSize" type="number" min="1" max="20" value="${g.teamSize}"></label>`}
            <label>Auslosung
              <select name="draw">
                <option value="zufall" ${g.draw === "zufall" ? "selected" : ""}>Zufällig (möglichst neue Partner)</option>
                <option value="stark" ${g.draw === "stark" ? "selected" : ""}>Ausgeglichen nach Historie</option>
              </select>
            </label>
          </div>

          <div class="fs-title">Spielmodus</div>
          <div class="seg seg-wrap" id="modeSeg">
            ${Object.entries(E.MODES).map(([k, v]) => `<button type="button" class="btn-small ${g.mode === k ? "on" : ""}" data-mode="${k}">${v}</button>`).join("")}
          </div>
          ${modeFields(g)}

          <div class="fs-title">Punkte</div>
          <div class="form-row two">
            <label>Punkte für Platz 1<input name="maxPoints" type="number" min="1" max="100" value="${g.maxPoints}"></label>
            <label>Verteilung
              <select name="pointsScheme">
                <option value="linear" ${g.pointsScheme === "linear" ? "selected" : ""}>gleichmässig bis 1 Punkt</option>
                <option value="liste" ${g.pointsScheme === "liste" ? "selected" : ""}>eigene Liste</option>
                ${g.mode === "rangliste" ? `<option value="resultat" ${g.pointsScheme === "resultat" ? "selected" : ""}>Resultat = Punkte</option>` : ""}
              </select>
            </label>
          </div>
          ${g.pointsScheme === "liste" ? `<label>Punkte pro Platz/Stufe (Komma)<input name="customPoints" value="${esc(g.customPoints || "")}" placeholder="18, 15, 12, 10, 7, 4, 1"></label>` : ""}

          <label>Material (eine Zeile pro Posten)<textarea name="material" rows="3" style="width:100%">${esc(g.material || "")}</textarea></label>
          <div class="preview">
            <div><b>${n}</b> Teilnehmende → ${esc(E.describeUnits(n, g))}</div>
            ${units >= 2 ? `<div>${esc(E.describeFormat(units, g))}</div>` : ""}
            <div class="pts">Punkte: ${esc(ST.pointsPreview(g, n) || "–")}</div>
          </div>
          <p class="form-msg" id="gameMsg">${opts.warn ? esc(opts.warn) : ""}</p>
          <div class="dlg-actions">
            ${opts.onDelete ? '<button type="button" class="btn-danger" id="gDel">Entfernen</button>' : "<span></span>"}
            <div class="right">
              <button type="button" class="btn-ghost" id="gCancel">Abbrechen</button>
              <button type="submit" class="btn-primary">Speichern</button>
            </div>
          </div>
        </form>`;

      const f = dlg.querySelector("form");
      const readForm = () => {
        const v = name => f.elements[name] ? f.elements[name].value : undefined;
        const num = name => f.elements[name] ? parseInt(f.elements[name].value, 10) : undefined;
        g.name = v("name").trim(); g.icon = v("icon").trim();
        if(f.elements.teamSize) g.teamSize = Math.max(1, num("teamSize") || 1);
        if(f.elements.teamCount) g.teamCount = Math.max(2, num("teamCount") || 2);
        g.draw = v("draw");
        ["groups", "qualifiers", "ligaRounds", "entries"].forEach(k => { if(f.elements[k]) g[k] = num(k) || 0; });
        ["scoreLabel", "scoreDir", "resultType"].forEach(k => { if(f.elements[k]) g[k] = v(k); });
        ["thirdPlace", "placementGames"].forEach(k => { if(f.elements[k]) g[k] = f.elements[k].checked; });
        g.maxPoints = num("maxPoints") || 1;
        g.pointsScheme = v("pointsScheme");
        if(f.elements.customPoints) g.customPoints = v("customPoints");
        if(f.elements.material) g.material = v("material");
        g = E.normalizeGame(g);
      };
      // jede Änderung aktualisiert Vorschau (ausser Textfelder während dem Tippen)
      f.addEventListener("change", (e) => {
        if(e.target.name === "pick"){
          const c = (opts.catalog || []).find(x => x.id === e.target.value);
          if(c){ g = E.normalizeGame(Object.assign({}, JSON.parse(JSON.stringify(c)), { id:g.id, catId:c.id })); }
          render(); return;
        }
        readForm(); render();
      });
      dlg.querySelectorAll("[data-size]").forEach(b => b.onclick = () => { readForm(); g.unitKind = "size"; g.teamSize = parseInt(b.dataset.size, 10); render(); });
      dlg.querySelector("[data-count]").onclick = () => { readForm(); if(g.unitKind !== "count"){ g.unitKind = "count"; g.teamCount = Math.max(2, E.unitCountFor(opts.participants || 0, g) || 4); } render(); };
      dlg.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
        readForm(); g.mode = b.dataset.mode;
        if(g.mode !== "rangliste" && g.pointsScheme === "resultat") g.pointsScheme = "linear";
        render();
      });
      dlg.querySelector("#gCancel").onclick = () => dlg.close();
      if(opts.onDelete) dlg.querySelector("#gDel").onclick = async () => {
        if(!confirm(`«${g.name}» wirklich entfernen?`)) return;
        await opts.onDelete(); dlg.close();
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        readForm();
        if(!g.name){ dlg.querySelector("#gameMsg").textContent = "Name fehlt."; return; }
        f.querySelector("[type=submit]").disabled = true;
        try{
          const ok = await opts.onSave(g);
          if(ok !== false) dlg.close();
          else f.querySelector("[type=submit]").disabled = false;
        }catch(err){
          console.error(err);
          dlg.querySelector("#gameMsg").textContent = "Speichern fehlgeschlagen.";
          f.querySelector("[type=submit]").disabled = false;
        }
      };
    };
    render();
    if(!dlg.open) dlg.showModal();
  }

  function modeFields(g){
    if(g.mode === "rangliste") return `
      <div class="form-row three">
        <label>Resultat in<input name="scoreLabel" value="${esc(g.scoreLabel)}"></label>
        <label>Besser ist
          <select name="scoreDir">
            <option value="asc" ${g.scoreDir === "asc" ? "selected" : ""}>weniger (z. B. Schläge)</option>
            <option value="desc" ${g.scoreDir === "desc" ? "selected" : ""}>mehr (z. B. Punkte)</option>
          </select>
        </label>
        <label>Durchgänge<input name="entries" type="number" min="1" max="10" value="${g.entries}"></label>
      </div>`;
    const resultSel = `
        <label>Resultat eintragen als
          <select name="resultType">
            <option value="score" ${g.resultType === "score" ? "selected" : ""}>Spielstand (z. B. 21:15)</option>
            <option value="winner" ${g.resultType === "winner" ? "selected" : ""}>nur Sieger antippen</option>
          </select>
        </label>`;
    if(g.mode === "ko") return `
      <div class="form-row two">${resultSel}
        <label class="check-label"><input type="checkbox" name="thirdPlace" ${g.thirdPlace ? "checked" : ""}> Spiel um Platz 3</label>
      </div>`;
    if(g.mode === "gruppen_ko") return `
      <div class="form-row three">
        <label>Anzahl Gruppen<input name="groups" type="number" min="1" max="12" value="${g.groups}"></label>
        <label>Weiter pro Gruppe<input name="qualifiers" type="number" min="1" max="8" value="${g.qualifiers}"></label>
        <label class="check-label"><input type="checkbox" name="thirdPlace" ${g.thirdPlace ? "checked" : ""}> Spiel um Platz 3</label>
      </div>
      <div class="form-row two">${resultSel}</div>`;
    if(g.mode === "liga") return `
      <div class="form-row three">
        <label>Runden (0 = alle)<input name="ligaRounds" type="number" min="0" max="30" value="${g.ligaRounds}"></label>
        <label class="check-label"><input type="checkbox" name="placementGames" ${g.placementGames ? "checked" : ""}> Platzierungsspiele (1–2, 3–4 …)</label>
        ${resultSel}
      </div>`;
    return "";
  }

  return { open, structuralChange };
})();
