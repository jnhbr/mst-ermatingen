# MST Ermatingen – Vereinsseite

Live: https://jnhbr.github.io/mst-ermatingen/ (GitHub Pages, Branch `main`, Root)

- `index.html` – Startseite mit Kacheln + für den Admin: Mitglieder (Alias, Eintritt, Austritt → «Ehemalige», endgültig löschen),
  Vorstand-Logins (Rollen) und das eingeklappte Änderungsprotokoll
- `gv/` + `js/gv-app.js` – GV: Traktanden (Platzhalter wie {vermoegen}, Vorschläge der Mitglieder), Mitglieder & Jahresbeiträge
  (Rabatt aus dem AWB-Einsatzplan), Finanzen (Kontobewegungen, AWB-Abrechnung), Protokoll des Aktuars, Jahresrückblick;
  druckt Übersicht und Protokoll im Stil der GV-Übersicht 2026 (Calibri, A4). Alte PDFs im Reiter «PDF».
  Kassier: Beitrag per WhatsApp anfordern (einzeln über wa.me mit Handynummer aus `contacts/<memberId>` – nur Vorstand
  lesbar – oder Sammelnachricht), danach Status «Twint angefordert»; Belege (Foto/PDF, Fotos auf 1600 px verkleinert)
  hängen an der Buchung: `finance/<jahr>/belege/<buchung>_<n>` (Base64-Stücke), Metadaten in `bookings/<id>.beleg`.
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
- `js/mst.js` – Firebase-Init (Projekt `minispieltag`) und Login
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
`private/gv-harness.html?rolle=admin|kassier|aktuar|mitglied` (bzw. `&seite=index`) lädt eine lokale Kopie der Daten
(`node private/dump-gv.mjs`) und simuliert das Login – nichts wird gespeichert. `&druck=uebersicht|protokoll` füllt die
Druckansicht (für Chrome headless `--print-to-pdf`).

## Cache
`css/mst.css` und `js/mst.js` werden mit `?v=<Zeitstempel>` eingebunden (GitHub Pages cacht 10 Min.).
Nach jeder Änderung an diesen Dateien die Nummer in allen HTML-Seiten erhöhen, sonst sehen Leute
neue Seiten mit altem Stylesheet.
