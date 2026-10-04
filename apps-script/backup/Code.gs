/* ============================================================
   MST Ermatingen – wöchentliche Sicherung der Firestore-Daten

   Läuft unter Jans Google-Konto (Inhaber des Firebase-Projekts «minispieltag»)
   jeden Sonntag um ca. 03:00. Liest ALLE Sammlungen über die Firestore-REST-API
   (mit Jans Berechtigung, an den Sicherheitsregeln vorbei – nur lesen) und legt
   eine ZIP-Datei mit einer JSON-Datei in den Drive-Ordner «MST Backup».
   Die letzten 26 Sicherungen (ein halbes Jahr) bleiben, ältere kommen in den
   Drive-Papierkorb.

   Danach schreibt es backupStatus/last = { ok, at, docs, bytes, file, url } –
   das zeigt die Startseite dem Admin («Vereinsjahr & Sicherung»).
   Schlägt die Sicherung fehl, steht dort der Fehler, und Google schickt Jan
   eine Mail (Fehler bei zeitgesteuerten Skripten).

   Format der JSON-Datei: { project, at, format:"firestore-rest-v1", docs:{ "<pfad>": <fields> } }
   – <fields> genau so, wie die REST-API sie liefert (mit Typen), damit
   «wiederherstellen» verlustfrei zurückschreiben kann.

   Einrichtung und Wiederherstellen: siehe README.md in diesem Ordner.
   ============================================================ */

const PROJECT = 'minispieltag';
const ROOT = 'projects/' + PROJECT + '/databases/(default)/documents';
const API = 'https://firestore.googleapis.com/v1/';
const FOLDER_NAME = 'MST Backup';
const KEEP = 26;
const PREFIX = 'mst-backup-';
/* Sammlungen ohne Unter-Sammlungen (spart Abfragen) bzw. gar nicht sichern */
const LEAF = ['log', 'members', 'memberDirectory', 'spieltagPersons', 'contacts', 'rsvp', 'roles', 'config',
  'spieltagMeta', 'spieltagHistory', 'awbMenu', 'backupStatus'];
const SKIP = ['sessions'];   // Login-Sitzungen – laufen ohnehin ab, nach einer Wiederherstellung neu einloggen

/* Einmal im Editor ausführen: Berechtigungen, wöchentlicher Auslöser und eine erste Sicherung. */
function einrichten(){
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sichern').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sichern').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  Logger.log('Wöchentlicher Auslöser gesetzt (Sonntag ca. 03:00).');
  const r = sichern();
  Logger.log('Erste Sicherung: ' + r.docs + ' Dokumente in «' + r.file + '» – Ordner: ' + r.url);
}

/* ---------- Sichern ---------- */
function sichern(){
  try{
    const docs = {};
    let cols = listCollectionIds_(ROOT).filter(c => SKIP.indexOf(c) < 0);
    cols.forEach(c => dumpCollection_(ROOT + '/' + c, LEAF.indexOf(c) >= 0, docs));
    const count = Object.keys(docs).length;
    if(!count) throw new Error('Keine Dokumente gefunden – stimmt die Berechtigung?');
    const stamp = Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd_HHmm');
    const json = JSON.stringify({ project:PROJECT, at:new Date().toISOString(), format:'firestore-rest-v1', docs });
    const name = PREFIX + stamp;
    const zip = Utilities.zip([Utilities.newBlob(json, 'application/json', name + '.json')], name + '.zip');
    const folder = folder_();
    folder.createFile(zip);
    prune_(folder);
    const res = { ok:true, at:Date.now(), docs:count, bytes:json.length, file:name + '.zip', url:folder.getUrl() };
    writeStatus_(res);
    return res;
  }catch(err){
    try{ writeStatus_({ ok:false, at:Date.now(), error:String(err && err.message || err).slice(0, 300) }); }catch(e){}
    throw err;   // damit Google eine Fehler-Mail schickt
  }
}

/* Alle Dokumente einer Sammlung (auch «leere» Eltern-Dokumente, die nur Unter-Sammlungen haben)
   und rekursiv deren Unter-Sammlungen. */
function dumpCollection_(colPath, leaf, out){
  const names = [];
  let token = '';
  do{
    const r = call_('get', colPath + '?pageSize=300&showMissing=true' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (r.documents || []).forEach(d => {
      const path = d.name.split('/documents/')[1];
      if(d.createTime) out[path] = d.fields || {};
      names.push(d.name);
    });
    token = r.nextPageToken || '';
  }while(token);
  if(leaf || !names.length) return;
  // Unter-Sammlungen aller Dokumente – parallel in Paketen, sonst wird es bei vielen Dokumenten zu langsam
  for(let i = 0; i < names.length; i += 40){
    const chunk = names.slice(i, i + 40);
    const lists = callAll_(chunk.map(n => ({ method:'post', path:n + ':listCollectionIds', body:{ pageSize:100 } })));
    lists.forEach((r, k) => (r.collectionIds || []).forEach(c => dumpCollection_(chunk[k] + '/' + c, false, out)));
  }
}
function listCollectionIds_(parent){
  const ids = [];
  let token = '';
  do{
    const r = call_('post', parent + ':listCollectionIds', token ? { pageSize:100, pageToken:token } : { pageSize:100 });
    (r.collectionIds || []).forEach(c => ids.push(c));
    token = r.nextPageToken || '';
  }while(token);
  return ids;
}

/* ---------- Drive ---------- */
function folder_(){
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function prune_(folder){
  const files = [];
  const it = folder.getFiles();
  while(it.hasNext()){ const f = it.next(); if(f.getName().indexOf(PREFIX) === 0) files.push(f); }
  files.sort((a, b) => b.getName() < a.getName() ? -1 : 1);   // Name enthält Datum → neueste zuerst
  files.slice(KEEP).forEach(f => f.setTrashed(true));
}

/* ---------- Status für die Startseite ---------- */
function writeStatus_(o){
  const fields = {};
  Object.keys(o).forEach(k => {
    const v = o[k];
    fields[k] = typeof v === 'boolean' ? { booleanValue:v } : typeof v === 'number' ? { integerValue:String(Math.round(v)) } : { stringValue:String(v) };
  });
  call_('patch', ROOT + '/backupStatus/last', { fields });
}

/* ---------- Wiederherstellen ----------
   Im Editor: die zwei Werte unten anpassen und «wiederherstellen» ausführen.
   DATEI   = Name der ZIP-Datei im Ordner «MST Backup», z. B. 'mst-backup-2026-10-11_0300.zip'
   PRAEFIX = nur diese Pfade zurückschreiben, z. B. 'finance/2026' oder 'awb/2027/shifts' ('' = alles).
   Überschreibt die betroffenen Dokumente vollständig mit dem Stand der Sicherung; andere bleiben unberührt.
   Zuerst mit TROCKEN = true laufen lassen: zeigt nur, was geschrieben würde. */
const DATEI = '';
const PRAEFIX = '';
const TROCKEN = true;
function wiederherstellen(){
  if(!DATEI) throw new Error('Oben bei DATEI den Namen der Sicherung eintragen.');
  const it = folder_().getFilesByName(DATEI);
  if(!it.hasNext()) throw new Error('Datei «' + DATEI + '» nicht im Ordner «' + FOLDER_NAME + '».');
  const blob = Utilities.unzip(it.next().getBlob())[0];
  const data = JSON.parse(blob.getDataAsString());
  const paths = Object.keys(data.docs).filter(p => !PRAEFIX || p === PRAEFIX || p.indexOf(PRAEFIX + '/') === 0).sort();
  Logger.log(paths.length + ' Dokumente aus ' + DATEI + (PRAEFIX ? ' unter «' + PRAEFIX + '»' : '') + (TROCKEN ? ' (TROCKEN – nichts geschrieben)' : ''));
  paths.slice(0, 30).forEach(p => Logger.log('  ' + p));
  if(paths.length > 30) Logger.log('  … und ' + (paths.length - 30) + ' weitere');
  if(TROCKEN) return;
  for(let i = 0; i < paths.length; i += 400){
    const writes = paths.slice(i, i + 400).map(p => ({ update:{ name:ROOT + '/' + p, fields:data.docs[p] } }));
    call_('post', ROOT.replace(/\/documents$/, '/documents:commit'), { writes });
  }
  Logger.log('Fertig: ' + paths.length + ' Dokumente zurückgeschrieben.');
}

/* ---------- REST ---------- */
/* Mit Jans Anmeldung. Abrechnungsprojekt = «minispieltag» (X-Goog-User-Project); falls Google das
   für dieses Konto nicht erlaubt, ohne den Kopf nochmals. */
let useUserProject_ = true;
/* Pfadteile sicher kodieren (Dokument-IDs können @ | + : enthalten), «:methode» am Schluss und ?query bleiben */
function urlFor_(path){
  const q = path.indexOf('?'), query = q >= 0 ? path.slice(q) : '', p = q >= 0 ? path.slice(0, q) : path;
  const m = p.match(/:(listCollectionIds|commit)$/), base = m ? p.slice(0, -m[0].length) : p;
  return API + base.split('/').map(seg => seg === '(default)' ? seg : encodeURIComponent(seg)).join('/') + (m ? m[0] : '') + query;
}
function request_(method, path, body){
  const headers = { Authorization:'Bearer ' + ScriptApp.getOAuthToken() };
  if(useUserProject_) headers['X-Goog-User-Project'] = PROJECT;
  const r = { url:urlFor_(path), method, headers, muteHttpExceptions:true };
  if(body){ r.contentType = 'application/json'; r.payload = JSON.stringify(body); }
  return r;
}
function parse_(res, path){
  const code = res.getResponseCode(), text = res.getContentText();
  if(code >= 200 && code < 300) return text ? JSON.parse(text) : {};
  const e = new Error('Firestore ' + code + ' bei ' + path.split('?')[0] + ': ' + text.slice(0, 300));
  e.code = code; e.text = text;
  throw e;
}
function call_(method, path, body){
  try{ const q = request_(method, path, body); return parse_(UrlFetchApp.fetch(q.url, q), path); }
  catch(e){
    if(useUserProject_ && e.code === 403 && /USER_PROJECT|serviceusage/i.test(e.text || '')){ useUserProject_ = false; return call_(method, path, body); }
    throw e;
  }
}
function callAll_(reqs){
  const res = UrlFetchApp.fetchAll(reqs.map(q => request_(q.method, q.path, q.body)));
  return res.map((r, i) => {
    try{ return parse_(r, reqs[i].path); }
    catch(e){
      if(useUserProject_ && e.code === 403 && /USER_PROJECT|serviceusage/i.test(e.text || '')){ useUserProject_ = false; return call_(reqs[i].method, reqs[i].path, reqs[i].body); }
      throw e;
    }
  });
}
