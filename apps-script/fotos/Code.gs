/* ============================================================
   MST Ermatingen – Brücke zwischen der Vereinsseite (/fotos/) und
   dem Google-Drive-Ordner «MST Fotos».

   Läuft als Google-Apps-Script-Web-App unter Jans Google-Konto
   («Ausführen als: Ich», «Zugriff: Jeder»). Die Fotos liegen in Jans
   Drive: MST Fotos / <Jahr> / <Ordner> / Foto.jpg

   Alle Anfragen sind POST (text/plain, JSON) mit idToken = Firebase-Login der Seite:
     {action:"list"}                              → Jahre mit Ordnern (alle Mitglieder)
     {action:"album", id}                         → Fotos eines Ordners (alle Mitglieder)
     {action:"upload", album, name, mime, data}   → Foto hochladen, data = Base64 (alle Mitglieder)
     {action:"delete", id}                        → Foto löschen (Vorstand oder wer es hochgeladen hat)
     {action:"createAlbum", year, name}           → neuer Ordner (nur Vorstand)
     {action:"renameAlbum", id, name}             → Ordner umbenennen (nur Vorstand)
     {action:"deleteAlbum", id}                   → Ordner in den Papierkorb (nur Vorstand)
   Gelöschtes landet im Drive-Papierkorb (30 Tage wiederherstellbar).

   Mitglieder = anonymer Firebase-Login mit gültiger Sitzung sessions/<uid> (wie auf der Seite),
   Vorstand = E-Mail/Passwort-Login. Die Fotos selbst sind «für alle mit dem Link» freigegeben,
   damit die Seite sie anzeigen kann – die Links kennt nur, wer eingeloggt die Liste abruft.

   Einrichtung: siehe README.md in diesem Ordner.
   ============================================================ */

const FIREBASE_API_KEY = 'AIzaSyD30pD_w95TnC4XWuFZ07US6Eg-14fQALo'; // Projekt «minispieltag» (öffentlicher Web-Schlüssel)
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/minispieltag/databases/(default)/documents/';
const ROOT_NAME = 'MST Fotos';
const LIST_CACHE = 'list-v1';
const MAX_BYTES = 15 * 1024 * 1024;

/* ---------- Web-App ---------- */
function doGet(){
  return json_({ ok:true, info:'MST Fotos – nur über die Vereinsseite (POST mit Login)' });
}

function doPost(e){
  try{
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = verifyUser_(req.idToken);
    const a = req.action;
    if(a === 'list') return json_({ ok:true, years:listYears_() });
    if(a === 'album') return json_({ ok:true, album:albumJson_(album_(req.id)), photos:photos_(album_(req.id)) });
    if(a === 'upload') return json_({ ok:true, photo:upload_(req, user) });
    if(a === 'delete'){ deletePhoto_(req.id, user); return json_({ ok:true }); }
    if(!user.vorstand) throw new Error('Ordner verwaltet nur der Vorstand');
    if(a === 'createAlbum') return json_({ ok:true, album:createAlbum_(req.year, req.name) });
    if(a === 'renameAlbum'){ const f = album_(req.id); f.setName(cleanName_(req.name)); dropCache_(); return json_({ ok:true, album:albumJson_(f) }); }
    if(a === 'deleteAlbum'){ album_(req.id).setTrashed(true); dropCache_(); return json_({ ok:true }); }
    throw new Error('Unbekannte Aktion');
  }catch(err){
    return json_({ ok:false, error:String(err && err.message || err) });
  }
}

/* Einmal im Editor ausführen: legt «MST Fotos» an und fragt die Berechtigungen ab. */
function einrichten(){
  const root = root_();
  Logger.log('Ordner: ' + root.getName() + ' → ' + root.getUrl());
  Logger.log('Firebase erreichbar: ' + (UrlFetchApp.fetch(FIRESTORE + 'spieltagMeta/settings', { muteHttpExceptions:true }).getResponseCode() === 200 ? '✓' : '✗'));
}

/* ---------- Login prüfen ---------- */
function verifyUser_(idToken){
  if(!idToken) throw new Error('Nicht angemeldet');
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method:'post', contentType:'application/json', payload:JSON.stringify({ idToken }), muteHttpExceptions:true
  });
  if(res.getResponseCode() !== 200) throw new Error('Login abgelaufen – bitte neu einloggen');
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if(!u || u.disabled) throw new Error('Nicht angemeldet');
  if((u.providerUserInfo || []).some(p => p.providerId === 'password') && u.email){
    return { key:u.email.toLowerCase(), vorstand:true };
  }
  // Mitglied: Sitzung sessions/<uid> lesen – die Firestore-Regeln erlauben das nur mit dem eigenen Login
  const s = UrlFetchApp.fetch(FIRESTORE + 'sessions/' + encodeURIComponent(u.localId), {
    headers:{ Authorization:'Bearer ' + idToken }, muteHttpExceptions:true
  });
  if(s.getResponseCode() !== 200) throw new Error('Nicht als Mitglied angemeldet');
  const f = JSON.parse(s.getContentText()).fields || {};
  const memberId = f.memberId && f.memberId.stringValue;
  if(!memberId) throw new Error('Nicht als Mitglied angemeldet');
  return { key:memberId, vorstand:false };
}

/* ---------- Ordner ---------- */
function root_(){
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_ID');
  if(id){ try{ const f = DriveApp.getFolderById(id); if(!f.isTrashed()) return f; }catch(e){} }
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_NAME);
  props.setProperty('ROOT_ID', f.getId());
  return f;
}
function cleanName_(s){
  const n = String(s || '').replace(/[\/\\]/g, '-').trim().slice(0, 80);
  if(!n) throw new Error('Name fehlt');
  return n;
}
function yearFolder_(year, create){
  const y = String(parseInt(year, 10));
  if(!/^\d{4}$/.test(y)) throw new Error('Jahr fehlt');
  const it = root_().getFoldersByName(y);
  return it.hasNext() ? it.next() : create ? root_().createFolder(y) : null;
}
/* Ordner nur, wenn er wirklich in MST Fotos / <Jahr> / liegt */
function album_(id){
  let f;
  try{ f = DriveApp.getFolderById(String(id || '')); }catch(e){ throw new Error('Ordner nicht gefunden'); }
  const yp = f.getParents();
  const year = yp.hasNext() ? yp.next() : null;
  const rp = year ? year.getParents() : null;
  if(f.isTrashed() || !year || !/^\d{4}$/.test(year.getName()) || !rp.hasNext() || rp.next().getId() !== root_().getId()){
    throw new Error('Ordner nicht gefunden');
  }
  return f;
}
function albumJson_(f){
  const files = f.getFiles(); let count = 0, cover = null;
  while(files.hasNext()){ const x = files.next(); if(!/^image\//.test(x.getMimeType())) continue; count++; if(!cover) cover = x.getId(); }
  const yp = f.getParents();
  return { id:f.getId(), name:f.getName(), year:yp.hasNext() ? yp.next().getName() : '', count, cover, created:f.getDateCreated().toISOString() };
}
function listYears_(){
  const cache = CacheService.getScriptCache();
  const hit = cache.get(LIST_CACHE);
  if(hit) return JSON.parse(hit);
  const out = [];
  const ys = root_().getFolders();
  while(ys.hasNext()){
    const y = ys.next();
    if(!/^\d{4}$/.test(y.getName())) continue;
    const albums = [];
    const as = y.getFolders();
    while(as.hasNext()) albums.push(albumJson_(as.next()));
    albums.sort((a, b) => b.created.localeCompare(a.created));
    out.push({ year:y.getName(), albums });
  }
  out.sort((a, b) => b.year.localeCompare(a.year));
  cache.put(LIST_CACHE, JSON.stringify(out), 600);
  return out;
}
function dropCache_(){ CacheService.getScriptCache().remove(LIST_CACHE); }
function createAlbum_(year, name){
  const y = yearFolder_(year, true), n = cleanName_(name);
  if(y.getFoldersByName(n).hasNext()) throw new Error('Diesen Ordner gibt es in ' + y.getName() + ' schon');
  const f = y.createFolder(n);
  dropCache_();
  return albumJson_(f);
}

/* ---------- Fotos ---------- */
function meta_(file){
  try{ return JSON.parse(file.getDescription() || '{}'); }catch(e){ return {}; }
}
function photoJson_(file){
  const m = meta_(file);
  return { id:file.getId(), name:file.getName(), mime:file.getMimeType(), by:m.by || '', byName:m.byName || '',
    at:m.at || file.getDateCreated().toISOString(), size:file.getSize() };
}
function photos_(f){
  const out = [], it = f.getFiles();
  while(it.hasNext()){ const x = it.next(); if(/^image\//.test(x.getMimeType())) out.push(photoJson_(x)); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
function upload_(req, user){
  const f = album_(req.album);
  const mime = String(req.mime || 'image/jpeg');
  if(!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mime)) throw new Error('Nur Fotos (JPG, PNG, HEIC)');
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if(!bytes.length) throw new Error('Leere Datei');
  if(bytes.length > MAX_BYTES) throw new Error('Foto zu gross');
  const name = cleanName_(req.name || 'foto.jpg');
  const file = f.createFile(Utilities.newBlob(bytes, mime, name));
  file.setDescription(JSON.stringify({ by:user.key, byName:String(req.byName || '').slice(0, 60), at:new Date().toISOString() }));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  dropCache_();
  return photoJson_(file);
}
function deletePhoto_(id, user){
  let file;
  try{ file = DriveApp.getFileById(String(id || '')); }catch(e){ throw new Error('Foto nicht gefunden'); }
  const p = file.getParents();
  album_(p.hasNext() ? p.next().getId() : '');   // liegt es überhaupt in MST Fotos?
  if(!user.vorstand && meta_(file).by !== user.key) throw new Error('Löschen darf nur, wer das Foto hochgeladen hat, oder der Vorstand');
  file.setTrashed(true);
  dropCache_();
}

/* ---------- Hilfen ---------- */
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
