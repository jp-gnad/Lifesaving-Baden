# Codeprüfung und Strukturumbau vom 12. November 2026

Ausgangsstand: `bc10587` (`Besseres Read! und Smal Changes in css`).
Ziel war eine verständlichere, effizientere Struktur bei erhaltenen Funktionen
und unveränderten serverseitigen Berechtigungen.

## Umgesetzt

| Bereich | Änderung | Absicherung |
|---|---|---|
| Kontenverwaltung | Rund 880 Zeilen aus `auth.js` in eine eigene Factory mit ausdrücklich übergebenen Abhängigkeiten verschoben | Bestehende Auth-/Konto-/Rollen-/Antragsprüfungen, lokale Browser-Fixtures |
| Timer-Fachlogik | Disziplinen und Zeit-/Datumsfunktionen in `timer/core.js`; Oberfläche und Adapter teilen dieselben unveränderlichen Definitionen | Zeitparser, alte Lap-Gruppen, Disziplinen, Eventumschaltung |
| Personenansicht | Eigenes View-Modul mit Route-/Cleanup-Schnittstelle | Imports, lokale Anzeige, Cache, veraltete Antworten und HTML-Eingaben |
| Ergebnisexport | PDF-Ausgabe vom Routing getrennt | Mehrseitige Ausgabe, Text-Escaping und korrekte PDF-Objektoffsets |
| Offline-Ergebnisse | IndexedDB-Zugriffe in eigener Datei; Erfolg erst nach Transaktionsabschluss | Speichername/-version, Schlüssel, erfolgreicher Commit und später Abort |
| Wiederholte Berechnungen | Statische Clubkappen-Aliase einmalig normalisieren; identische Zeitformatierung gemeinsam verwenden | Vorhandene Ansichten und Domänentests |
| Verzeichnis-Sync | Gemeinsame Planung/Batch-Hilfe, vollständige Eingabeprüfung, nur geänderte Dokumente schreiben | Unveränderte Bestände, Änderungen, Löschungen, ungültige/mehrdeutige Quellen |
| Wartungsschutz | Erwartetes Firebase-Projekt zentral prüfen; fehlerhafte Credential-JSON nicht ausgeben | Falsches Projekt, fehlende und fehlerhafte Credentials |
| HTML-Sicherheit | Dynamische Teilnehmer-/Ergebnis-IDs und Bahnlängen sicher in Attribute einsetzen; IDs in Navigations-/API-Pfaden codieren | Angriffstexte, Sonderzeichen und zurückgewiesene codierte Pfadtrenner |
| Offline-Dateien | Tatsächliche Skriptversionen mit dem Precache abgleichen und veralteten Personenlink-Cacheeintrag korrigieren | Automatische genaue URL-Prüfung |
| Projektwerkzeuge | Paket-/Lockdatei, Python-Anforderungen, einheitliche Prüfskripte und separater CI-Workflow | `npm test`, `npm run test:rules` |
| Entwicklungsabhängigkeiten | Aktuelle CLI-/Admin-Werkzeuge und gezielte Sicherheits-Pins für indirekte Pakete; Browser-SDK bleibt unverändert | `npm audit`: 0 bekannte Meldungen zum Prüfzeitpunkt; erneute Emulatorprüfung |
| KI-Orientierung | `AGENTS.md`, Architektur-, Entwicklungs- und Sicherheitsdokumente, aktualisierter README-Einstieg | Klare Modul-/Datenzuständigkeit und Testzuordnung |

## Entfernt und bewusst erhalten

Nach Prüfung der Referenzen wurden die unbenutzten Funktionen
`getInitialsFromName` und `disciplineOptions` entfernt. Die doppelte Implementierung
der kumulierten Zeitformatierung wurde durch die vorhandene gemeinsame Formatierung
ersetzt. Das übrige Verschieben in Module ist keine Entfernung von Funktionen.

Alte Rollenaliasnamen, Personenlink-/Arbeitszeitmigrationen, Teilnehmerübernahme,
Redirect-Seiten und bisherige Manifest-/Offline-Identitäten bleiben erhalten.
Sie unterstützen vorhandene Konten, Daten, Links oder Installationen. Die
öffentlichen Seiten und der vorbereitete Trainingsbereich bleiben erreichbar.

Die Dateien `firestore.rules`, `firestore.indexes.json`, `firebase.json` und die
Firebase-Web-Konfiguration wurden bei diesem Strukturumbau nicht verändert.
Es gab keinen produktiven Daten-Sync, kein Konto-Cleanup, keinen Deploy und keine
Änderung am Firebase-Tarif.

## Prüfungen

- Strukturprüfung über alle produktiven JS-Dateien, Root-/Timer-HTML-Seiten,
  Inline-Skripte und lokale Asset-/Manifest-Verweise; dazu Skript-Reihenfolge
  und Übereinstimmung von HTML und Timer-Precache.
- Node-Funktionstests einschließlich bestehender Anmeldung, Kontenverwaltung,
  Clubs-/Startberechtigungslogik, Arbeitszeiten, Timer-Import und neuer Modultests.
- Gesamte Python-Suite einschließlich Verzeichnisaufbereitung und Installation.
- Beide Sicherheitsregel-Suites mit echten Transaktionen im lokalen Demo-Emulator;
  keine übersprungenen Regeltests als Erfolgsnachweis.

Die GitHub-Prüfworkflow-Datei ist vorbereitet; ihre Ausführung auf GitHub erfolgt
erst nach Veröffentlichung der Änderungen. Lokale DOM-Tests prüfen das Verhalten;
die vorhandenen Browser-Fixtures bleiben für die visuelle Prüfung verfügbar.

Ergebnis der lokalen Funktions-/Integrationsprüfung: **159 Node-Tests und 33
Python-Tests bestanden**. Die Regelprüfung umfasst **50 bestandene Tests** ohne
übersprungene Fälle. Die Strukturprüfung umfasst **33 produktive/werkzeugbezogene
JS-Dateien und 19 HTML-Seiten**. Der Paket-Audit meldete nach den Sicherheitsupdates
**0 bekannte Schwachstellen**; das ist eine Paketdatenbankprüfung zum Prüfzeitpunkt,
keine Garantie über jede denkbare Schwachstelle der Anwendung.

## Weitere Wartung

`auth.js` und `timer/app.js` enthalten weiterhin umfangreiche Profile-/Antrags-
beziehungsweise Stoppuhr-/Ergebnisoberflächen. Künftige Änderungen dort anhand
der dokumentierten Zuständigkeiten vornehmen und weitere zusammenhängende Views
bei Bedarf ausgliedern. Die maßgeblichen Transaktions- und Regelgrenzen gehören
in die Store-/Regelmodule und sollen nicht in neue Oberflächen kopiert werden.

Der Verzeichnis-Sync spart unveränderte Schreibvorgänge; seine Bestandsabfragen
bleiben bestehen. Weitere Leseoptimierungen der Arbeitszeit- oder Statistikpfade
benötigen eigene Prüfungen ihrer Migrations-/Überlappungsgarantien. Die kürzlich
umgesetzte Teilnehmer-Read-Optimierung bleibt durch die vorhandenen Tests abgesichert.
