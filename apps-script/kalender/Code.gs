/* ============================================================
   MST Ermatingen – Brücke zwischen der Vereinsseite und dem
   Google Kalender «MST».

   Läuft als Google-Apps-Script-Web-App unter Jans Google-Konto
   («Ausführen als: Ich», «Zugriff: Jeder»). Der Google Kalender ist
   die einzige Quelle der Wahrheit – die Seite liest und schreibt direkt
   dort, es gibt keine Kopie in Firestore, also auch keine Konflikte.

   GET  …/exec              → JSON mit allen Terminen (3 Jahre zurück, 3 vor)
   GET  …/exec?fresh=1      → dasselbe ohne Zwischenspeicher
   GET  …/exec?format=ics   → Abo-Feed (webcal) für iPhone, Mac, Outlook, Google
   POST …/exec  {action:"save"|"delete", idToken, event}
        idToken = Firebase-Login der Seite; nur Vorstand (E-Mail-Login) darf schreiben.

   Einrichtung: siehe README.md in diesem Ordner.
   ============================================================ */

const CALENDAR_ID = 'd7b947de0a2c00ace1180d776ba69042c77e00e6ba1034e786d77a9294bed5c7@group.calendar.google.com';
const FIREBASE_API_KEY = 'AIzaSyD30pD_w95TnC4XWuFZ07US6Eg-14fQALo'; // Projekt «minispieltag» (öffentlicher Web-Schlüssel)
const TZ = 'Europe/Zurich';
const FEED_NAME = 'MST Ermatingen';
const SITE_URL = 'https://jnhbr.github.io/mst-ermatingen/kalender/';
const CACHE_KEY = 'events-v1';
const CACHE_SECONDS = 300;
const YEARS_BACK = 3, YEARS_AHEAD = 3;

/* ---------- Web-App ---------- */
function doGet(e){
  const p = (e && e.parameter) || {};
  try{
    if(p.format === 'ics'){
      return ContentService.createTextOutput(buildIcs_(listEvents_(false)))
        .setMimeType(ContentService.MimeType.ICAL);
    }
    return json_({ ok:true, events:listEvents_(p.fresh === '1'), at:new Date().toISOString() });
  }catch(err){
    return json_({ ok:false, error:String(err && err.message || err) });
  }
}

function doPost(e){
  try{
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = verifyUser_(req.idToken);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let event = null;
    try{
      if(req.action === 'save') event = saveEvent_(req.event || {}, req.byName || user.email);
      else if(req.action === 'delete') deleteEvent_(req.event || {});
      else throw new Error('Unbekannte Aktion');
    }finally{
      lock.releaseLock();
    }
    CacheService.getScriptCache().remove(CACHE_KEY);
    return json_({ ok:true, event, events:listEvents_(true) });
  }catch(err){
    return json_({ ok:false, error:String(err && err.message || err) });
  }
}

/* Einmal im Editor ausführen: fragt die Berechtigungen ab und prüft die Einstellungen. */
function einrichten(){
  const cal = calendar_();
  Logger.log('Kalender: ' + cal.getName());
  Logger.log('Zeitzone des Skripts: ' + Session.getScriptTimeZone() + (Session.getScriptTimeZone() === TZ ? ' ✓' : ' ✗ – bitte appsscript.json übernehmen'));
  Logger.log('Termine gefunden: ' + listEvents_(true).length);
  UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis', { muteHttpExceptions:true });
  Logger.log('Alles bereit. Jetzt «Bereitstellen → Neue Bereitstellung → Web-App».');
}

/* ---------- Lesen ---------- */
function calendar_(){
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if(!cal) throw new Error('Kalender «MST» nicht gefunden – gehört er dem Konto, unter dem das Skript läuft?');
  return cal;
}

function listEvents_(fresh){
  const cache = CacheService.getScriptCache();
  if(!fresh){
    const hit = cache.get(CACHE_KEY);
    if(hit) return JSON.parse(hit);
  }
  const now = new Date();
  const from = new Date(now.getFullYear() - YEARS_BACK, 0, 1);
  const to = new Date(now.getFullYear() + YEARS_AHEAD + 1, 0, 1);
  const list = calendar_().getEvents(from, to).map(eventJson_)
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  try{ cache.put(CACHE_KEY, JSON.stringify(list), CACHE_SECONDS); }catch(err){ /* zu gross für den Cache – egal */ }
  return list;
}

function eventJson_(ev){
  const allDay = ev.isAllDayEvent();
  const recurring = ev.isRecurringEvent();
  let start, end;
  if(allDay){
    start = fmt_(ev.getAllDayStartDate(), 'yyyy-MM-dd');
    // Google liefert das Ende exklusiv (Mitternacht des Folgetags) → letzter Tag
    end = fmt_(new Date(ev.getAllDayEndDate().getTime() - 12 * 3600 * 1000), 'yyyy-MM-dd');
  } else {
    start = fmt_(ev.getStartTime(), "yyyy-MM-dd'T'HH:mm:ssXXX");
    end = fmt_(ev.getEndTime(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return {
    id:ev.getId(),
    key:ev.getId() + (recurring ? '|' + start : ''),
    title:ev.getTitle() || '(ohne Titel)',
    allDay, start, end,
    location:ev.getLocation() || '',
    description:ev.getDescription() || '',
    recurring,
    fromSite:ev.getTag('mst') === '1',
    by:ev.getTag('by') || '',
    updated:ev.getLastUpdated() ? ev.getLastUpdated().toISOString() : ''
  };
}

/* ---------- Schreiben ---------- */
function verifyUser_(idToken){
  if(!idToken) throw new Error('Nicht angemeldet');
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method:'post', contentType:'application/json',
    payload:JSON.stringify({ idToken }), muteHttpExceptions:true
  });
  if(res.getResponseCode() !== 200) throw new Error('Login abgelaufen – bitte neu einloggen');
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  const isPassword = u && (u.providerUserInfo || []).some(p => p.providerId === 'password');
  if(!u || u.disabled || !u.email || !isPassword) throw new Error('Nur der Vorstand darf Termine eintragen');
  // Optional: Skripteigenschaft ERLAUBT = "a@x.ch, b@y.ch" schränkt weiter ein
  const allowed = String(PropertiesService.getScriptProperties().getProperty('ERLAUBT') || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if(allowed.length && allowed.indexOf(u.email.toLowerCase()) < 0) throw new Error('Dieses Konto darf keine Termine eintragen');
  return { email:u.email.toLowerCase() };
}

function saveEvent_(e, byName){
  const title = String(e.title || '').trim();
  if(!title) throw new Error('Titel fehlt');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.startDate || '')) throw new Error('Datum fehlt');
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') && e.endDate >= e.startDate ? e.endDate : e.startDate;
  const opts = { location:String(e.location || '').trim(), description:String(e.description || '').trim() };
  let start, end;
  if(e.allDay){
    start = parse_(e.startDate, 'yyyy-MM-dd');
    end = parse_(endDate, 'yyyy-MM-dd');
    end = new Date(end.getTime() + 36 * 3600 * 1000);         // exklusiv: Folgetag …
    end = parse_(fmt_(end, 'yyyy-MM-dd'), 'yyyy-MM-dd');      // … um Mitternacht (auch bei Zeitumstellung)
  } else {
    if(!/^\d{2}:\d{2}$/.test(e.startTime || '')) throw new Error('Startzeit fehlt');
    start = parse_(e.startDate + 'T' + e.startTime, "yyyy-MM-dd'T'HH:mm");
    end = /^\d{2}:\d{2}$/.test(e.endTime || '')
      ? parse_(endDate + 'T' + e.endTime, "yyyy-MM-dd'T'HH:mm")
      : new Date(start.getTime() + 2 * 3600 * 1000);
    if(end <= start) throw new Error('Ende liegt vor dem Beginn');
  }

  const cal = calendar_();
  let ev;
  if(e.id){
    ev = cal.getEventById(e.id);
    if(!ev) throw new Error('Termin nicht mehr gefunden – wurde er in Google gelöscht?');
    if(ev.isRecurringEvent()) throw new Error('Serientermine bitte direkt im Google Kalender ändern');
    ev.setTitle(title);
    ev.setLocation(opts.location);
    ev.setDescription(opts.description);
    if(e.allDay) ev.setAllDayDates(start, end); else ev.setTime(start, end);
  } else {
    ev = e.allDay ? cal.createAllDayEvent(title, start, end, opts) : cal.createEvent(title, start, end, opts);
    ev.setTag('mst', '1');
  }
  ev.setTag('by', String(byName || '').slice(0, 80));
  return eventJson_(ev);
}

function deleteEvent_(e){
  const ev = e.id && calendar_().getEventById(e.id);
  if(!ev) return; // schon weg
  if(ev.isRecurringEvent()) throw new Error('Serientermine bitte direkt im Google Kalender löschen');
  ev.deleteEvent();
}

/* ---------- Abo-Feed (iCalendar, RFC 5545) ---------- */
function buildIcs_(events){
  const stamp = fmt_(new Date(), "yyyyMMdd'T'HHmmss'Z'", 'UTC');
  const utc = iso => fmt_(new Date(iso), "yyyyMMdd'T'HHmmss'Z'", 'UTC');
  const day = d => d.replace(/-/g, '');
  const nextDay = d => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10).replace(/-/g, ''); };
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MST Ermatingen//Vereinskalender//DE',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText_(FEED_NAME), 'X-WR-TIMEZONE:' + TZ,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'
  ];
  events.forEach(ev => {
    lines.push('BEGIN:VEVENT');
    // Serien sind schon aufgelöst → jede Wiederholung braucht eine eigene UID
    lines.push('UID:' + (ev.recurring ? day(ev.start.slice(0, 10)) + '-' + ev.id : ev.id));
    lines.push('DTSTAMP:' + stamp);
    if(ev.allDay){
      lines.push('DTSTART;VALUE=DATE:' + day(ev.start));
      lines.push('DTEND;VALUE=DATE:' + nextDay(ev.end));
      lines.push('TRANSP:TRANSPARENT');
    } else {
      lines.push('DTSTART:' + utc(ev.start));
      lines.push('DTEND:' + utc(ev.end));
    }
    lines.push('SUMMARY:' + icsText_(ev.title));
    if(ev.location) lines.push('LOCATION:' + icsText_(ev.location));
    if(ev.description) lines.push('DESCRIPTION:' + icsText_(ev.description));
    if(ev.updated) lines.push('LAST-MODIFIED:' + utc(ev.updated));
    lines.push('URL:' + SITE_URL);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine_).join('\r\n') + '\r\n';
}

function icsText_(s){
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/* Zeilen nach 75 Bytes umbrechen (UTF-8, ohne Zeichen zu zerschneiden). */
function foldLine_(line){
  const out = [];
  let cur = '', bytes = 0;
  for(const ch of line){
    const b = unescape(encodeURIComponent(ch)).length;
    if(bytes + b > (out.length ? 74 : 75)){ out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/* ---------- Hilfen ---------- */
function fmt_(d, pattern, tz){ return Utilities.formatDate(d, tz || TZ, pattern); }
function parse_(s, pattern){ return Utilities.parseDate(s, TZ, pattern); }
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
