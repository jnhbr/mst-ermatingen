# MST Ermatingen – Vereinsseite

Live: https://jnhbr.github.io/mst-ermatingen/ (GitHub Pages, Branch `main`, Root)

- `index.html` – Startseite mit Kacheln (Padel, Spieltag, Afterworkbar, GV) + Mitgliederverwaltung für den Admin
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
