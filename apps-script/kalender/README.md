# Kalender-Brücke (Google Apps Script)

Verbindet die Seite `/kalender/` mit dem Google Kalender «MST». Läuft unter Jans Google-Konto,
das den Kalender besitzt. Kein Firebase-Blaze-Plan, keine Kosten.

## Einrichten (einmalig, ca. 5 Minuten)
1. https://script.google.com → **Neues Projekt**, Name «MST Kalender».
2. Inhalt von `Code.gs` in die Datei `Code.gs` kopieren (alles ersetzen).
3. Zahnrad **Projekteinstellungen** → «Manifestdatei „appsscript.json" im Editor anzeigen» anhaken,
   dann `appsscript.json` mit dem Inhalt aus diesem Ordner ersetzen (setzt die Zeitzone Europe/Zurich).
4. Oben die Funktion **einrichten** auswählen → **Ausführen** → Berechtigungen erlauben
   («Erweitert → Zu MST Kalender wechseln», weil das Skript von dir selbst stammt). Im Protokoll muss
   «Kalender: MST» und «Zeitzone … ✓» stehen.
5. **Bereitstellen → Neue Bereitstellung** → Typ «Web-App», Ausführen als **Ich**,
   Zugriff **Jeder** → Bereitstellen. Die URL (endet auf `/exec`) in `js/kalender.js` bei `API:` eintragen.

## Stand (04.10.2026)
Eingerichtet per clasp unter jnhbr97@gmail.com: Projekt «MST Kalender» (Script-ID in `.clasp.json`),
Bereitstellung `AKfycbx0X4sktOkDG8HpoWK5UOU3zOMSomAb547kcJH_byOpAK9uRqO2XJb_cNKe5phzl679` = URL in `js/kalender.js`.

Code ändern per Terminal (in diesem Ordner, URL bleibt gleich):
`npx @google/clasp push --force && npx @google/clasp update-deployment AKfycbx0X4sktOkDG8HpoWK5UOU3zOMSomAb547kcJH_byOpAK9uRqO2XJb_cNKe5phzl679`
(vorher einmal `npx @google/clasp login`, falls abgemeldet). Neue Berechtigungen → im Editor einmal `einrichten` ausführen.

## Später Code ändern (im Browser)
Code ersetzen → **Bereitstellen → Bereitstellungen verwalten** → Stift → Version «Neue Version» →
Bereitstellen. So bleibt die URL gleich (eine *neue* Bereitstellung gäbe eine neue URL).

## Wer darf was
- Lesen und Abo (`?format=ics`): alle, ohne Login.
- Schreiben: nur Vorstand-Logins (E-Mail/Passwort in Firebase). Das Skript prüft das Firebase-Token
  bei Google (`accounts:lookup`). Optional weiter einschränken: Projekteinstellungen →
  Skripteigenschaften → `ERLAUBT` = `mail1@…, mail2@…`.
- Serientermine werden angezeigt, aber nur im Google Kalender bearbeitet.

## Lokal testen
`node private/kalender/mock-server.mjs <export.ics>` → `http://localhost:8787/kalender/?api=http://localhost:8787/api&als=vorstand`
(führt diesen Code mit nachgebautem CalendarApp aus).
