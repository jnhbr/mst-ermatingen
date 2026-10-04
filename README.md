# MST Ermatingen – Vereinsseite

Live: https://jnhbr.github.io/mst-ermatingen/ (GitHub Pages, Branch `main`, Root)

- `index.html` – Startseite mit Kacheln + für den Admin: «Vereinsjahr & Sicherung» (Knopf «Neues Vereinsjahr …», Stand der
  wöchentlichen Sicherung), Mitglieder (Alias, Eintritt, Austritt → «Ehemalige», endgültig löschen),
  Vorstand-Logins (Rollen) und das eingeklappte Änderungsprotokoll
- `ich/` – **Mein MST** (nur mit Login): nächste Termine mit Zu-/Absage, Spieltag (Anmeldung, Teilnahmen, bester Rang,
  bester Partner, Angstgegner), Jahresbeitrag (Betrag/Status/Twint – gleiche Rechnung wie `feeOf` in `js/gv-app.js`),
  Afterworkbar-Einsätze, Padel (nächster Termin, eigener Status) und eigene GV-Vorschläge. Liest nur, schreibt nur Zusagen.
- `js/jahreswechsel.js` – Dialog «Neues Vereinsjahr» (Admin, Startseite): legt für das Vereinsjahr bis zur GV <jahr> an,
  was fehlt – GV + Finanzjahr (Schlussbestand wie «Neue GV anlegen»), Spieltag (Spiele vom Vorjahr), Afterworkbar
  (wie «Neues Jahr anlegen»), Padel-Saison (Termine +364 Tage, Fixe ohne Ausgetretene) – und macht sie aktuell.
  Zieljahr = letzte schon stattgefundene GV + 1 (änderbar). Bestehendes bleibt unangetastet.
- `sw.js` – Service Worker (nur https): hält Seiten, Stile, Skripte, Firebase-Bibliothek und Schriften auf dem Gerät,
  damit die Seite im Funkloch öffnet (Seiten: zuerst Netz, nach 1,2 s die gespeicherte Fassung). Holt alle 6 Stunden im
  Hintergrund alle Bereiche, alte `?v=` fliegen raus. Neue Seite → in `PAGES` eintragen.
- `gv/` + `js/gv-app.js` – GV: Traktanden (Platzhalter wie {vermoegen}, Vorschläge der Mitglieder), Mitglieder (Mutationen,
  Vorstand), Protokoll des Aktuars, Jahresrückblick; druckt Übersicht (inkl. Finanzseiten) und Protokoll im Stil der
  GV-Übersicht 2026 (Calibri, A4). Alte PDFs im Reiter «PDF».
- `finanzen/` – eigene Kachel, gleiche App `js/gv-app.js` mit `<div id="app" data-mode="finanzen">`: Jahresbeiträge
  (Rabatt aus dem AWB-Einsatzplan; bezahlte Zeilen grün), Kontobewegungen mit Belegen, AWB-Abrechnung. Jahr = Vereinsjahr,
  das mit der GV <jahr> endet (neues Vereinsjahr = auf der GV-Seite unter Einstellungen die nächste GV anlegen).
  Kassier: Beitrag per WhatsApp anfordern (einzeln über api.whatsapp.com (nicht wa.me – zerschiesst Emojis) mit Handynummer aus `contacts/<memberId>` – nur Vorstand
  lesbar – oder Sammelnachricht), danach Status «Twint angefordert»; Belege (Foto/PDF, Fotos auf 1600 px verkleinert)
  hängen an der Buchung: `finance/<jahr>/belege/<buchung>_<n>` (Base64-Stücke), Metadaten in `bookings/<id>.beleg`.
- Finanzen sieht während des Vereinsjahrs nur der Vorstand (Kachel nur für Vorstand). An der GV setzt der Kassier oben auf der
  Finanzen-Seite «für alle Mitglieder freigeben» (`finance/<jahr>.shared`), dann sehen alle Mitglieder das Jahr inkl.
  Finanzseiten der GV-Übersicht; vorher zeigt die GV-Seite Mitgliedern statt Beträgen «(an der GV)».
- `css/gv.css` – gemeinsame Bildschirm-Stile von GV und Finanzen (Druckstile bleiben in `gv/index.html`)
- `spieltag/` – Ermatinger Minispieltag, **öffentlich** (Zuschauer ohne Login): Live-Rangliste, Spiele, Historie 2020–…;
  als Admin: Spiele wechseln/einstellen (Einzel, 2er, 3er …, Modus, Punkte), auslosen, Teams anpassen, Resultate eintragen
- `spieltag/organisation/` – nur Admin: Teilnehmende des Jahres, Gäste, neue Vereinsmitglieder (inkl. Login),
  Grundgerüst der Disziplinen, Spieltage anlegen und in die Historie übernehmen
- `js/spieltag-engine.js` – die ganze Spiel-Logik ohne Firebase (Teams, Gruppen, K.o. mit Freilosen, Liga, Punkte);
  läuft auch in Node (Tests: alle Disziplinen mit 2–41 Personen)
- `js/spieltag-app.js` – Logik der Spieltag-Seite (Rangliste/Startliste, Spiele, Zeitplan, «Mein Spieltag», Bierkapitän, TV, Historie)
- `js/spieltag-stats.js` – bester Partner, Angstgegner, Rekorde; `archiveYear()` schreibt beim Abschliessen Rangliste, Teams, Duelle, Rohresultate
- `js/spieltag-data.js` / `js/spieltag-ui.js` – Datenzugriff (mit Testmodus) und Dialog «Spiel einstellen»
- `padel/` – Padelgruppe: Verfügbarkeit, Gäste/Mitglieder, Bierrunden, Statistik & Schlussabrechnung
- `kalender/` + `js/kalender.js` – Vereinskalender, **öffentlich**: Kommend, Monat, Vergangen, Abonnieren (webcal/Google/Outlook).
  Quelle der Wahrheit ist der Google Kalender «MST» – kein Firestore. Die Seite liest/schreibt über die
  Apps-Script-Web-App `apps-script/kalender/` (Einrichtung dort im README, URL in `js/kalender.js` → `API`).
  Eintragen/ändern/löschen nur Vorstand (Firebase-Token wird im Skript geprüft); Serientermine nur in Google.
  Abo-Feed = `<API>?format=ics`. Die Startseite zeigt die nächsten 3 Termine als Karten mit Datum und den
  Knöpfen «Bin dabei / Vielleicht / Kann nicht» direkt darauf (ein Tipp, nochmals tippen = zurückziehen; beim
  Spieltag-Termin steht dort der Anmelde-Knopf, bei Padel der Link zur Verfügbarkeit).
  **Zu-/Absagen**: eingeloggte Mitglieder tippen im Termin «Bin dabei / Vielleicht / Kann nicht» (+ Bemerkung) und sehen,
  wer kommt. Firestore `rsvp/<termin>` = { title, day, <memberId>:{ s, at, n } }, jedes Mitglied ändert nur sein Feld.
  Nicht bei Spieltag (eigene Anmeldung) und Padel (eigene Verfügbarkeit). Login auf der Kalender-Seite freiwillig
  (Mitglieder zum Zusagen, Vorstand zum Eintragen); `kalender/?termin=<schlüssel>` öffnet einen Termin direkt.
- `fotos/` + `js/fotos.js` – Fotos in Ordnern nach Jahr, nur mit Login. Liegen im Google Drive «MST Fotos» (Jans Konto),
  Zugriff über die Apps-Script-Web-App `apps-script/fotos/` (Einrichtung und Rechte im README dort). Alle Mitglieder laden hoch,
  Ordner verwaltet der Vorstand.
- `js/mst.js` – Firebase-Init (Projekt `minispieltag`), Login und die Instagram-Fusszeile (@minispieltag) auf allen Seiten;
  dazu **Offline**: `enablePersistence` (Firestore behält Gelesenes und schickt Änderungen nach), `MST.quick(promise)`
  (wartet höchstens 0,4 s auf den Server – sonst hängt der Knopf bei schwachem Netz; spätere Ablehnung → Hinweis oben),
  `MST.toast()`, Offline-Balken unten und die Registrierung von `sw.js`
- `css/mst.css` – gemeinsames Design (Schwarz/Gelb aus dem Wappen)
- `firestore.rules` – Regeln für das ganze Firebase-Projekt (auch die Spieltag-Seite!),
  deployen mit `firebase deploy --only firestore:rules`

- `apps-script/backup/` – **Sicherung**: Apps Script «MST Backup» legt jeden Sonntag ~03:00 alle Firestore-Daten als ZIP
  in den Drive-Ordner «MST Backup» (26 Stück bleiben) und schreibt `backupStatus/last` (Anzeige auf der Startseite).
  Einrichtung und Wiederherstellen im README dort.

## Offline am Spieltag
Wer die Seite einmal mit Netz offen hatte, kann sie im Funkloch wieder öffnen (Service Worker) und sieht den letzten
Stand (Firestore-Speicher auf dem Gerät). Resultate, Biere usw. lassen sich weiter eintragen; sie erscheinen sofort und
gehen an den Server, sobald wieder Empfang da ist (Balken unten: «Offline …» → «✓ Alles gespeichert»). Lehnt der Server
eine nachgeschickte Änderung ab (z. B. Rechte), erscheint oben ein roter Hinweis. Tipp: am Morgen vom Spieltag alle
Helfer die Spieltag-Seite einmal mit Netz öffnen lassen. Lokal testen: `private/test-harness.html?seite=ich|kalender|index|spieltag&als=m14|admin|gast`
(erfundene Daten, kein Firebase).

## Tempo (seit 4.10.2026)
Nichts wartet auf den Server, was schon auf dem Gerät liegt:
- **Login**: `MST.identify(user)` merkt sich Nutzer + Mitgliederliste in `localStorage` (`mst-user-v1`). Ab dem zweiten
  Besuch startet jede Seite sofort; Sitzung/Rolle werden im Hintergrund geprüft (geändert → Seite lädt neu, Sitzung weg →
  Login). Auch Spieltag- und Kalender-Seite nutzen `identify`. Geschützt sind die Daten durch die Firestore-Regeln.
- **Lesen beim Öffnen**: `MST.fast(ref, onChange)` statt `ref.get()` – liefert sofort den Stand vom letzten Besuch und fragt
  den Server im Hintergrund; bei Abweichung ruft es `onChange` (Padel/Afterworkbar: `boot()`, Mein MST: `block()`).
  Nicht für Lesen-dann-Schreiben (Jahreswechsel, Austritt …) – dort bleibt `ref.get()`.
- **Schreiben**: `MST.quick()` bzw. `KAL.toggleRsvp()` – die Anzeige wechselt über die `onSnapshot`-Zuhörer sofort.
  Kein `await ref.set()` hinter einem Knopf, der dabei gesperrt ist.
- `KAL.load()` teilt sich eine laufende Anfrage (die Apps-Script-Brücke braucht 1–3 s).
- Bleibt «lade …» länger als 9 s stehen, erscheint ein Knopf «Neu laden».
- **Seitenwechsel** (`leaveClean` oben in `js/mst.js`): Firestore räumt seinen Gerätespeicher sonst erst beim Verschwinden
  der Seite auf; auf iPhone/Safari blieb das hängen und die nächste Seite zeigte «lade …» bis zum Neustart der App
  (jede Kachel, auch zurück). Darum beendet ein Klick auf einen internen Link Firestore zuerst sauber und wechselt dann;
  auf WebKit ist das Aufräumen beim Verschwinden abgeschaltet; kommt eine so verlassene Seite aus dem
  Zwischenspeicher zurück, lädt sie neu. Seite neu laden immer mit `MST.reload()`, nicht `location.reload()`.

## Login & Rollen
- Mitglieder: Vereinsnummer + Vorname (erstes Wort, Gross/Klein egal). Firestore `members/<sha256>` → Sitzung `sessions/<uid>`.
- Vorstand: E-Mail/Passwort-Konten aus Firebase Authentication (legt Jan in der Firebase-Konsole an).
  `roles/<e-mail>` = { role:"admin"|"kassier"|"aktuar", memberId }. Konto ohne Eintrag = Admin (Jans Konto).
  Kassier: Finanzen + Beiträge, Aktuar: Protokoll, beide: GV-Traktanden. Passwort ändern über «Passwort vergessen?».
- Schrift: Bebas Neue (Titel) + Barlow (Text); Druck der GV in Calibri (Ersatz Carlito).

## Daten (Firestore)
- `memberDirectory/m<Nr>` – Name, Kurzname
- `padel/<Saison>/days/<Datum>` – Verfügbarkeit der 7 Fixen, `extras` (Gäste/Mitglieder mit «bezahlt an»), `cancelled`
- `padel/<Saison>/beer/<id>` – Bierrunden

Bis 2.10.2026 lief Padel auf Netlify (mst-padel.netlify.app, Repo `MST-Ermatingen-Padel`); die Daten wurden übernommen.

## Spieltag
- «Resultate für alle offen» (Organisation → Spieltage): alle eingeloggten Mitglieder tragen Resultate/Teamnamen ein;
  jede Änderung steht mit vorher/nachher im Protokoll (Organisation → Änderungen).
- Material & Helfer pro Station (Material in den Spiel-Einstellungen, abhaken: Admin + Stationsleitung),
  Programmpunkte im Zeitplan, Siegerehrung für den Beamer unter `spieltag/#siegerehrung`.
- Rollen: Zuschauer (ohne Login) sehen alles ausser Bierkapitän. Mitglieder (Login Nummer + Vorname) melden sich selbst an/ab
  (wenn in der Organisation «Selbst-Anmeldung offen»), sehen «Mein Spieltag», zählen ihre Biere und tragen Resultate
  an Stationen ein, die sie leiten (`games/<id>.leaders`, nur Felder matches/scores – siehe firestore.rules). Admin: alles.
- Vor dem ersten Resultat ist die Rangliste eine Startliste nach Startnummer (Titelverteidiger = 1, sonst `spieltagPersons.nr`).
- Zeitplan: pro Spiel Start, Ort, Felder, Minuten/Partie (Tab «Zeitplan», Admin) → geschätzte Zeit + Feld jeder Partie.
- TV-Ansicht: `spieltag/#tv` (Rangliste, Als Nächstes, Tagesablauf, Bierkapitän falls eingeloggt; QR-Code).
- Selbst-Anmeldungen liegen in `spieltag/<jahr>/signups/<memberId>`; Teilnehmende = Liste + Anmeldungen.
  Anmelden geht auch mit einem Tipp direkt auf der Startseite (Balken «Anmelden für <Jahr>» in der Spieltag-Kachel).
  Das Datum kommt aus dem Google Kalender (Termin «Minispieltag <jahr>», `KAL.spieltagDay()`): alle Seiten zeigen es
  sofort (`MST.withDate()`); öffnet Jan als Admin die Startseite oder die Organisation, wird es auch nach
  `spieltag/<jahr>.date`/`signupUntil` gespeichert (`MST.syncSpieltagDate()`) – erst dann prüfen die Regeln den Schluss.
  Anmeldeschluss `spieltag/<jahr>.signupUntil` ("JJJJ-MM-TT", der Tag zählt noch) = automatisch 14 Tage davor (in der
  Organisation änderbar); die Firestore-Regeln sperren danach. Anmeldung offen = Schalter `signupOpen` (nie gesetzt =
  offen), solange der Spieltag nicht abgeschlossen ist.
  Solange die Anmeldung läuft, zählen Mitglieder NUR mit `signups/<memberId>.status == "ja"` (selbst bestätigt oder von Jan
  in der Organisation angehakt → `by:"admin"`); eine aus dem Vorjahr übernommene Liste meldet niemanden an
  (`ST.effectiveParticipants`). `participants` enthält dann nur noch Gäste.
  Gäste (ohne Login) meldet nur der Admin in der Organisation an, optional mit Handynummer (`contacts/<pid>`, nur Vorstand).
  Bierkapitän: `spieltag/<jahr>/beer/<id>` { pid, l:0.5|0.33, at, by }.
- Testmodus: `spieltag/?test` (als Admin) bzw. `spieltag/?test&als=m5` (als Mitglied Nr. 5) bzw. `spieltag/organisation/?test` – liest die echten Daten, Änderungen bleiben
  im Browserfenster (Knopf «Zufallsresultate» zum Durchspielen). Ideal zum Ausprobieren vor dem Spieltag.
- Punkte: Platz 1 = Maximum, letzte Stufe = 1, gleichmässig dazwischen (ergibt bei 7 Stufen 18/15/12/10/7/4/1
  wie im Spielplan 2026). Pro Spiel umstellbar auf eigene Liste oder «Resultat = Punkte».
- Daten: `spieltagMeta/{settings,catalog}`, `spieltagPersons/<id>` (m<Nr> = Mitglied, g_… = Gast),
  `spieltag/<jahr>` (+ `games/<id>`), `spieltagHistory/<jahr>`. Erstbefüllung: `private/spieltag/seed-spieltag.mjs`
  (Historie aus `~/Desktop/MST/_GESAMTRANGLISTE.xlsx`, Grundgerüst aus `2026/Spielplan_26.xlsx`).
- Die alte Seite minispieltag.web.app (Sammlungen draws/persons/results/schedules) bleibt unberührt.

## Testen ohne Login
`private/gv-harness.html?rolle=admin|kassier|aktuar|mitglied` (bzw. `&seite=index` oder `&seite=finanzen`) lädt eine lokale Kopie der Daten
(`node private/dump-gv.mjs`) und simuliert das Login – nichts wird gespeichert. `&druck=uebersicht|protokoll` füllt die
Druckansicht (für Chrome headless `--print-to-pdf`).

## Cache
`css/mst.css` und `js/mst.js` werden mit `?v=<Zeitstempel>` eingebunden (GitHub Pages cacht 10 Min.).
Nach jeder Änderung an diesen Dateien die Nummer in allen HTML-Seiten erhöhen, sonst sehen Leute
neue Seiten mit altem Stylesheet.
