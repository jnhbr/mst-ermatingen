# MST Ermatingen – Vereinsseite

Live: https://jnhbr.github.io/mst-ermatingen/ (GitHub Pages, Branch `main`, Root)

- `index.html` – Startseite mit Kacheln + für den Admin: Mitglieder (Alias, Eintritt, Austritt → «Ehemalige», endgültig löschen),
  Vorstand-Logins (Rollen) und das eingeklappte Änderungsprotokoll
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
  Abo-Feed = `<API>?format=ics`. Die Startseite zeigt die nächsten 3 Termine.
- `fotos/` + `js/fotos.js` – Fotos in Ordnern nach Jahr, nur mit Login. Liegen im Google Drive «MST Fotos» (Jans Konto),
  Zugriff über die Apps-Script-Web-App `apps-script/fotos/` (Einrichtung und Rechte im README dort). Alle Mitglieder laden hoch,
  Ordner verwaltet der Vorstand.
- `js/mst.js` – Firebase-Init (Projekt `minispieltag`), Login und die Instagram-Fusszeile (@minispieltag) auf allen Seiten
- `css/mst.css` – gemeinsames Design (Schwarz/Gelb aus dem Wappen)
- `firestore.rules` – Regeln für das ganze Firebase-Projekt (auch die Spieltag-Seite!),
  deployen mit `firebase deploy --only firestore:rules`

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
  Das Datum kommt aus dem Google Kalender (Termin «Minispieltag <jahr>», `KAL.spieltagDay()`): sobald Jan als Admin die
  Startseite oder die Organisation öffnet, wird es nach `spieltag/<jahr>.date` übernommen (`MST.syncSpieltagDate()`).
  Anmeldeschluss `spieltag/<jahr>.signupUntil` ("JJJJ-MM-TT", der Tag zählt noch) = automatisch 14 Tage davor (in der
  Organisation änderbar); die Firestore-Regeln sperren danach. Anmeldung offen = Schalter `signupOpen`, nie gesetzt =
  offen, sobald ein Anmeldeschluss gespeichert ist.
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
