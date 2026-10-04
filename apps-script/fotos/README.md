# Fotos-Brücke (Google Apps Script)

Verbindet die Seite `/fotos/` mit dem Google-Drive-Ordner «MST Fotos» (Jans Konto jnhbr97@gmail.com).
Kein Firebase-Blaze-Plan, keine Kosten (Platz = Jans Google-Speicher, 15 GB gratis).

Ablage: `MST Fotos / <Jahr> / <Ordner> / foto.jpg`. Fotos werden beim Hochladen auf 2400 px verkleinert (JPEG)
und «für alle mit dem Link» freigegeben, damit die Seite sie anzeigen kann (`drive.google.com/thumbnail?id=…`).
Wer hochgeladen hat, steht in der Beschreibung der Datei (`{by, byName, at}`).

## Stand (04.10.2026)
Per clasp angelegt: Projekt «MST Fotos» (Script-ID in `.clasp.json`),
Bereitstellung `AKfycbw5bzksNeFsJdpe0WforruArC6JZyAw7ifvJMTXBLIKBOXMNAWpeGfZWBZqC59V5rE2` = URL in `js/fotos.js` → `API`.

**Einmal nötig (nur Jan, im Browser):** https://script.google.com/d/1fx-UY81oXsQ39lr_HlWaGaY8GTJAmNzsm2cE94h6X2YifturlyoWOZ5B/edit
öffnen → oben Funktion **einrichten** wählen → **Ausführen** → Berechtigungen erlauben («Erweitert → Zu MST Fotos
wechseln»). Im Protokoll steht danach der Link zum Ordner «MST Fotos». Erst dann funktioniert die Web-App.

Code ändern per Terminal (in diesem Ordner, URL bleibt gleich):
`npx @google/clasp push --force && npx @google/clasp update-deployment AKfycbw5bzksNeFsJdpe0WforruArC6JZyAw7ifvJMTXBLIKBOXMNAWpeGfZWBZqC59V5rE2`
Neue Berechtigungen → im Editor nochmals `einrichten` ausführen.

## Wer darf was
- Ansehen und hochladen: alle eingeloggten Mitglieder (anonymer Firebase-Login + gültige Sitzung `sessions/<uid>`,
  das Skript liest sie mit dem Token des Mitglieds – die Firestore-Regeln erlauben das nur für die eigene Sitzung).
- Ordner anlegen, umbenennen, löschen: Vorstand (E-Mail/Passwort-Login).
- Foto löschen: Vorstand oder wer es hochgeladen hat. Gelöschtes liegt 30 Tage im Drive-Papierkorb.
- In Drive selbst kann Jan Ordner/Fotos auch direkt verwalten (Ordnernamen unter dem Jahr = Ordner auf der Seite;
  Liste wird 10 Minuten zwischengespeichert).

## Lokal testen
`node private/fotos/mock-server.mjs` → `http://localhost:8788/fotos/?api=http://localhost:8788/api&als=vorstand`
(oder `&als=mitglied`; führt diesen Code mit nachgebautem DriveApp im Speicher aus).
