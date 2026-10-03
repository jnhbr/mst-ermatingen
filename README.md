# MST Ermatingen – Vereinsseite

Live: https://jnhbr.github.io/mst-ermatingen/ (GitHub Pages, Branch `main`, Root)

- `index.html` – Startseite mit Kacheln (Padel, Spieltag, Afterworkbar, GV, für den Admin zusätzlich Spieltag-Organisation) + Mitgliederverwaltung für den Admin
- `spieltag/` – Ermatinger Minispieltag, **öffentlich** (Zuschauer ohne Login): Live-Rangliste, Spiele, Historie 2020–…;
  als Admin: Spiele wechseln/einstellen (Einzel, 2er, 3er …, Modus, Punkte), auslosen, Teams anpassen, Resultate eintragen
- `spieltag/organisation/` – nur Admin: Teilnehmende des Jahres, Gäste, neue Vereinsmitglieder (inkl. Login),
  Grundgerüst der Disziplinen, Spieltage anlegen und in die Historie übernehmen
- `js/spieltag-engine.js` – die ganze Spiel-Logik ohne Firebase (Teams, Gruppen, K.o. mit Freilosen, Liga, Punkte);
  läuft auch in Node (Tests: alle Disziplinen mit 2–41 Personen)
- `js/spieltag-data.js` / `js/spieltag-ui.js` – Datenzugriff (mit Testmodus) und Dialog «Spiel einstellen»
- `padel/` – Padelgruppe: Verfügbarkeit, Gäste/Mitglieder, Bierrunden, Statistik & Schlussabrechnung
- `js/mst.js` – Firebase-Init (Projekt `minispieltag`) und Login
- `css/mst.css` – gemeinsames Design (Schwarz/Gelb aus dem Wappen)
- `firestore.rules` – Regeln für das ganze Firebase-Projekt (auch die Spieltag-Seite!),
  deployen mit `firebase deploy --only firestore:rules`

## Login
- Mitglieder: Vereinsnummer + Vorname (erstes Wort, Gross/Klein egal). Firestore `members/<sha256>` → Sitzung `sessions/<uid>`.
- Admin: E-Mail/Passwort-Konto aus Firebase Authentication (dasselbe wie für die Spieltag-Seite).

## Daten (Firestore)
- `memberDirectory/m<Nr>` – Name, Kurzname
- `padel/<Saison>/days/<Datum>` – Verfügbarkeit der 7 Fixen, `extras` (Gäste/Mitglieder mit «bezahlt an»), `cancelled`
- `padel/<Saison>/beer/<id>` – Bierrunden

Bis 2.10.2026 lief Padel auf Netlify (mst-padel.netlify.app, Repo `MST-Ermatingen-Padel`); die Daten wurden übernommen.

## Spieltag
- Testmodus: `spieltag/?test` bzw. `spieltag/organisation/?test` – liest die echten Daten, Änderungen bleiben
  im Browserfenster (Knopf «Zufallsresultate» zum Durchspielen). Ideal zum Ausprobieren vor dem Spieltag.
- Punkte: Platz 1 = Maximum, letzte Stufe = 1, gleichmässig dazwischen (ergibt bei 7 Stufen 18/15/12/10/7/4/1
  wie im Spielplan 2026). Pro Spiel umstellbar auf eigene Liste oder «Resultat = Punkte».
- Daten: `spieltagMeta/{settings,catalog}`, `spieltagPersons/<id>` (m<Nr> = Mitglied, g_… = Gast),
  `spieltag/<jahr>` (+ `games/<id>`), `spieltagHistory/<jahr>`. Erstbefüllung: `private/spieltag/seed-spieltag.mjs`
  (Historie aus `~/Desktop/MST/_GESAMTRANGLISTE.xlsx`, Grundgerüst aus `2026/Spielplan_26.xlsx`).
- Die alte Seite minispieltag.web.app (Sammlungen draws/persons/results/schedules) bleibt unberührt.

## Cache
`css/mst.css` und `js/mst.js` werden mit `?v=<Zeitstempel>` eingebunden (GitHub Pages cacht 10 Min.).
Nach jeder Änderung an diesen Dateien die Nummer in allen HTML-Seiten erhöhen, sonst sehen Leute
neue Seiten mit altem Stylesheet.
