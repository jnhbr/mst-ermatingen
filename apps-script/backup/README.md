# Sicherung (Google Apps Script «MST Backup»)

Sichert jeden Sonntag um ca. 03:00 **alle** Firestore-Daten des Projekts `minispieltag` (Mitglieder, Finanzen inkl. Belege,
GV, Spieltage und Historie, Padel, Afterworkbar, Zusagen, Änderungsprotokoll …) als ZIP in den Google-Drive-Ordner
**«MST Backup»** (Jans Konto). Die letzten 26 Sicherungen bleiben, ältere kommen in den Drive-Papierkorb.
Nicht gesichert: `sessions` (Login-Sitzungen). Kalender und Fotos liegen ohnehin in Google (Kalender «MST», Drive «MST Fotos»).

Kein Firebase-Blaze-Plan, keine Kosten. Das Skript liest mit Jans Google-Anmeldung (Inhaber des Firebase-Projekts)
direkt über die Firestore-REST-API.

Die Startseite zeigt dem Admin unter **«Vereinsjahr & Sicherung»** den Stand (`backupStatus/last`); ist die letzte
Sicherung älter als 8 Tage oder fehlgeschlagen, steht dort eine Warnung. Bei einem Fehler schickt Google zusätzlich eine Mail.

## Stand (04.10.2026)
Per clasp angelegt unter jnhbr97@gmail.com: Projekt «MST Backup» (Script-ID in `.clasp.json`), Code hochgeladen.
Am 04.10.2026 hat Jan im Editor **einrichten** ausgeführt (Berechtigungen, wöchentlicher Auslöser, erste Sicherung).
Editor: https://script.google.com/d/1x29UEAXTMC34wHS80Y_r3RDqk68djdnG3qCBezqjrEnRVw_s7LywJuFJ/edit

## Einrichten (einmalig)
Per clasp (in diesem Ordner):
```
npx @google/clasp create --type standalone --title "MST Backup"
npx @google/clasp push --force
```
Dann **nur Jan, im Browser**: `npx @google/clasp open` (oder script.google.com → «MST Backup») →
oben Funktion **einrichten** wählen → **Ausführen** → Berechtigungen erlauben («Erweitert → Zu MST Backup wechseln»).
Das setzt den wöchentlichen Auslöser und macht gleich die erste Sicherung; im Protokoll steht der Link zum Ordner.

Ohne clasp: script.google.com → Neues Projekt «MST Backup», `Code.gs` hineinkopieren, in den Projekteinstellungen
«appsscript.json im Editor anzeigen» anhaken und den Inhalt aus diesem Ordner übernehmen, dann wie oben **einrichten**.

Code später ändern: `npx @google/clasp push --force` (keine Bereitstellung nötig – es ist keine Web-App).

## Wiederherstellen
Im Editor oben in `Code.gs` bei **DATEI** den Namen der Sicherung eintragen (z. B. `mst-backup-2026-10-11_0300.zip`),
bei **PRAEFIX** den Bereich (z. B. `finance/2026`, `awb/2027/shifts`, leer = alles) und zuerst mit `TROCKEN = true`
die Funktion **wiederherstellen** ausführen: das Protokoll zeigt, welche Dokumente zurückgeschrieben würden.
Stimmt es, `TROCKEN = false` setzen und nochmals ausführen. Betroffene Dokumente werden vollständig mit dem Stand der
Sicherung überschrieben, alle anderen bleiben unberührt. Danach DATEI/PRAEFIX/TROCKEN wieder zurücksetzen.

Die ZIP-Datei enthält eine JSON-Datei `{ project, at, format:"firestore-rest-v1", docs:{ "<pfad>": <fields> } }`
(Felder genau im Format der Firestore-REST-API, also mit Typen) – zur Not auch von Hand lesbar.

## Falls es nicht klappt
- «Firestore 403 … has not been used in project …»: das Skript versucht es zuerst mit dem Abrechnungsprojekt
  `minispieltag` und sonst ohne. Hilft beides nicht: im Editor Projekteinstellungen → Google Cloud-Projekt →
  Projektnummer von `minispieltag` eintragen (Firebase-Konsole → Projekteinstellungen → Projektnummer).
- Auslöser prüfen: im Editor links «Trigger» (Wecker-Symbol) – dort muss `sichern`, wöchentlich, stehen.
