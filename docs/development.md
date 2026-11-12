# Entwicklung und Prüfung

## Voraussetzungen

- Node.js ab Version 22; produktive Browserdateien benötigen keinen Node-Build.
- Python ab 3.10; CI verwendet 3.12. `openpyxl` wird nur für den XLSX-Import und
  dessen Tests gebraucht, nicht vom Browser.
- Java 21 für den lokalen Firestore-Emulator. Bei mehreren Java-Installationen
  muss `JAVA_HOME` auf Java 21 zeigen und dessen `bin` im `PATH` stehen.

Installation unter PowerShell:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:PATH = "$PWD\.venv\Scripts;$env:PATH"
```

Die Lockdatei hält die Node-Testwerkzeuge fest; `requirements-dev.txt` hält die
Python-Pakete fest. Beim Aktualisieren beide CI-Workflows berücksichtigen. Es gibt
keinen Produktions-Installationsschritt; `node_modules` und `.venv` werden nicht veröffentlicht.

Die `overrides` in `package.json` halten Sicherheitskorrekturen für indirekte
Entwicklungsabhängigkeiten fest (`grpc-js`, FTP-/Glob-/UUID-Hilfen und die
Telemetrie unter Pub/Sub). Sie betreffen keine CDN-Datei der Website. Bei einem
Paketupdate diese Pins, `npm audit` und die Emulatorprüfung gemeinsam prüfen;
nicht durch einen ungeprüften `npm audit fix --force` ersetzen. Die SDK-14-
Wartungswerkzeuge benötigen Node 22; verwendet werden die modularen Imports,
nicht die entfernten Legacy-Namespaces. Siehe [offizielle SDK-14-Änderungen](https://github.com/firebase/firebase-admin-node/releases/tag/v14.0.0).

## Befehle

| Befehl | Prüft/öffnet |
|---|---|
| `npm run check` | JS-Syntax, Inline-Skripte, lokale HTML-/CSS-/Manifest-Dateien, Skript-Reihenfolge und genaue Precache-URLs |
| `npm run test:unit` | Alle Node-Funktionstests außer den separat ausgeführten Emulator-Suites |
| `npm run test:python` | Python-Integration und Verzeichnisaufbereitung |
| `npm test` | Alle drei vorherigen Prüfungen, ohne Produktionsdatenzugriffe |
| `npm run test:rules` | Firestore- und Club-Regeln in einem lokalen Demo-Emulator |
| `npm run serve` | Lokaler HTTP-Server unter `http://127.0.0.1:8000/` |

In PowerShell gegebenenfalls `npm.cmd` statt `npm` verwenden. Den lokalen Server
nicht zum automatischen Durchklicken echter Konten verwenden: Normale App-Seiten
nutzen ohne Mock weiterhin das konfigurierte Firebase-Projekt.

## Welche Tests bei welcher Änderung?

| Bereich | Relevante Tests |
|---|---|
| Login, Konto, Profil, Administration | `auth_flow.test.cjs`, Python-Timerintegration; bei Daten-/Berechtigungsänderungen zusätzlich Regeln |
| Timer-Domäne, PDF, Offline-Speicher | `timer_modules.test.cjs`, `event_overview.test.cjs` |
| Ergebnis-Seiten, Live-Verbindungen und vollständiger Export | `timer_result_feed.test.cjs`, `timer_result_view.test.cjs`, `timer_import.test.cjs`; bei Query-/Regeländerungen zusätzlich Regeln |
| Teilnehmerimport und Cache | `timer_import.test.cjs`, `timer_people_view.test.cjs`, Firestore-Regeltests |
| Clubs und Startberechtigungen | `start_eligibility.test.cjs`, `clubs_rules.test.cjs`, `clubs_notifications.test.cjs`, Auth-Tests |
| Arbeitszeiten | `worktime.test.cjs`, `firestore_rules.test.cjs` |
| Wartungs-CLIs und Quelldaten | `maintenance_tools.test.cjs`, `test_participant_directory.py` |
| HTML, Assets, Modul-/Dateiversionen | `npm run check`, Python-Integration; passende lokale Browser-Fixture für Layout |

`node --test tests/firestore_rules.test.cjs` allein überspringt die Regeln ohne
`FIRESTORE_EMULATOR_HOST`. Für eine belastbare Prüfung `npm run test:rules` verwenden.
Der Testcode weist nicht lokale Emulator-Adressen ab. Demo-Projekte heißen
`demo-lifesaving-baden` beziehungsweise `demo-lifesaving-clubs`.

Auf Systemen, deren Java-Locale beim Emulator Probleme verursacht, können folgende
Java-Optionen helfen:

```powershell
$env:JAVA_TOOL_OPTIONS = "-Duser.language=en -Duser.country=US"
npm.cmd run test:rules
```

## Oberfläche mit Testdaten

Nach Start des lokalen HTTP-Servers:

- `tests/admin_accounts.browser.html`: Kontenverwaltung, verschiedene Bildschirmbreiten.
- `tests/account_links.browser.html`: eigene Personenverknüpfung.
- `tests/worktime.browser.html`: Arbeitszeiten.
- `tests/mobile_nav.browser.html`: mobile Navigation.

Diese Fixtures verwenden eigene Daten. Funktionstests mit vereinfachtem DOM
prüfen Verhalten, ersetzen aber keine Layoutkontrolle im Browser.

## CI und Produktionswartung

`.github/workflows/checks.yml` führt bei Push/PR Struktur-, Funktions-, Python-
und Emulatorprüfungen ohne Produktions-Credentials aus. Der vorhandene Workflow
`sync-participant-directory.yml` ist davon getrennt: Er verarbeitet die private
Quelldatei und verändert mit den dafür vorgesehenen Secrets echte Verzeichnisdaten.

Die Wartungs-CLIs `sync_account_google_emails.mjs` und
`reset_legacy_person_links.mjs` zeigen ohne `--apply` nur eine Vorschau an;
auch eine Vorschau liest echte Daten und verbraucht Kontingent. Nicht automatisch
als Teil eines Tests ausführen. Die Schreiboption ausdrücklich nur für die
beabsichtigte Produktionswartung verwenden.
