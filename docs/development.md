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
| Login, Konto, Profil, Administration | `auth_flow.test.cjs`, `person_link_requests.test.cjs`, Python-Timerintegration; bei Daten-/Berechtigungsänderungen zusätzlich Regeln |
| Kontobild, sofortige Vorschau und Hintergrundabgleich | `account_avatar.test.cjs`, `auth_flow.test.cjs`, Timeransichtstests; `member_bootstrap.browser.html` mit verzögertem Profilabruf |
| Verknüpfungskreis und Benachrichtigungszähler | `account_indicators.test.cjs`, `auth_flow.test.cjs`, `clubs_notifications.test.cjs`; `member_bootstrap.browser.html` mit verzögertem Profilabruf |
| Neumeldungen zu Konten, Quittierung und deduplizierte Zähler | `account_notifications.test.cjs`, `auth_flow.test.cjs`, `npm run test:rules`; `admin_accounts.browser.html?new=1` |
| Startbild, Bereitschaft und Übergabe an den Mitgliederbereich | `app_launch.test.cjs`, `auth_flow.test.cjs`, `member_bootstrap.browser.html?launch=1&delay=5000`; Fehlerfall zusätzlich `&fail=1` |
| Schnelle Rückkehr zur Mitgliederübersicht und Vorschau ohne Berechtigungswirkung | `member_view_cache.test.cjs`, `auth_flow.test.cjs`, Emulator-Suites |
| Timer-Domäne, PDF, Offline-Speicher | `timer_modules.test.cjs`, `event_overview.test.cjs` |
| Bahnlängenabhängige 100 m Hindernis und weitere Disziplinen | `timer_modules.test.cjs`, `timer_controls.test.cjs`, `timer_import.test.cjs`, `timer_result_view.test.cjs`, `npm run test:rules` |
| Eigene Disziplinennamen je Event und Rundenzahl | `timer_custom_disciplines.test.cjs`, `timer_import.test.cjs`, `timer_controls.test.cjs`, `timer_result_view.test.cjs`, `npm run test:rules` |
| Zeitnahme-Kürzel, unveränderliche Quelle und PDF-Anzeige | `timer_modules.test.cjs`, `timer_controls.test.cjs`, `timer_import.test.cjs`, `timer_result_view.test.cjs`, `npm run test:rules` |
| Stoppuhrbedienung, Runden zurücknehmen und Disziplinwechsel im Lauf oder nach dem Stoppen | `timer_controls.test.cjs` (simulierte Uhr, ohne Firebase) |
| Live-Formatierung von Zeiteingaben, Löschen/Cursor und Ergebnisbearbeitung | `timer_time_input.test.cjs`, `timer_result_view.test.cjs` |
| Altersklassen in der Personenauswahl | `timer_participant_picker.test.cjs`, `timer_controls.test.cjs`, `timer_result_view.test.cjs`, `timer_people_view.test.cjs` |
| Sofortige Navigation, Hintergrundspeicherung, Wiederholungen und Kontowechsel | `timer_save_queue.test.cjs`, `timer_controls.test.cjs`, `timer_import.test.cjs`; zusätzlich Emulator-Suites bei Adapter-/Store-Änderungen |
| Ergebnis-Seiten, Live-Verbindungen und vollständiger Export | `timer_result_feed.test.cjs`, `timer_result_view.test.cjs`, `timer_import.test.cjs`; bei Query-/Regeländerungen zusätzlich Regeln |
| Teilnehmerimport und Cache | `timer_import.test.cjs`, `timer_people_view.test.cjs`, Firestore-Regeltests |
| Sofortige Personenauswahl nach Neuanlage/Import und verspätete Listen | `timer_participant_updates.test.cjs`, `timer_controls.test.cjs`, `timer_save_queue.test.cjs`, `timer_people_view.test.cjs` |
| Clubs und Startberechtigungen | `start_eligibility.test.cjs`, `clubs_rules.test.cjs`, `clubs_notifications.test.cjs`, Auth-Tests |
| Club-Events, sofortige Hintergrundspeicherung, Einzelstarts und Mannschaftszuordnungen | `club_events.test.cjs`, `club_events_queue.test.cjs`, `club_teams.test.cjs`, `clubs_rules.test.cjs`; zusätzlich `npm run test:rules` |
| Arbeitszeiten | `worktime.test.cjs`, `firestore_rules.test.cjs` |
| Wartungs-CLIs und Quelldaten | `maintenance_tools.test.cjs`, `test_participant_directory.py` |
| HTML, Assets, Modul-/Dateiversionen | `npm run check`, Python-Integration; passende lokale Browser-Fixture für Layout |
| Cursor, Suchcache, Profillistener, optimistische Kaderänderungen, Arbeitszeit-Vorbereitung und verzögertes Laden | `performance_modules.test.cjs`, Auth-/Timeransichtstests; bei Datenzugriffen zusätzlich `npm run test:rules` |

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

- `tests/member_bootstrap.browser.html`: echter Start aller Mitgliederseiten mit
  simulierter Firebase-Anmeldung. Lädt die tatsächliche seitenspezifische Liste
  lokaler Skripte und führt `auth.js` unverändert aus; externe SDKs und Zugriffe
  sind ersetzt. Prüft insbesondere Rollenfarben, Profilwerte und den Start von
  Gliederungen, Clubverwaltung und Arbeitszeiten ohne das Admin-Modul.
- `tests/admin_accounts.browser.html`: Kontenverwaltung, verschiedene Bildschirmbreiten.
  `?many=1` ergänzt 123 Konten für Nachladen und die ausdrückliche vollständige Suche.
- `tests/account_links.browser.html`: eigene Personenverknüpfung.
- `tests/account_checklist.browser.html`: Profilfortschritt, Kontozähler und Hinweise im Einstellungsmenü mit lokalen Profilständen bei Desktop, 390 und 320 px; kurze/lange Namen und konstante Headerhöhe bei abgeschlossener Einrichtung.
- `tests/worktime.browser.html`: Arbeitszeiten.
- `tests/club_teams.browser.html`: Club-Events, Erstellung und Mannschaftsbearbeitung mit lokalen Daten; Desktop, 390 und 320 px. Der bestehende Fixture-Pfad bleibt erhalten.
  `?multi=1` öffnet die Personenansicht mit drei Clubs und prüft die Clubauswahl
  im Desktopmenü und über den Clubtitel auf dem Handy.
  `&rosterDelay=2000` verzögert den ersten Kadersnapshot jedes Clubs. Mit
  `&rosterFail=fixture-south` lässt sich zusätzlich ein fehlgeschlagener Wechsel prüfen.
  Mit `?delay=15000` verzögert die Fixture jeden simulierten Servervorgang um 15 Sekunden.
  `&persist=1` bewahrt zusätzlich die simulierten Server-Events für einen Neuladetest
  im Sitzungsspeicher auf. Damit lassen sich sofortige Anzeige und Wiederaufnahme prüfen.
  `?many=1` ergänzt einen größeren Kader und Mannschaften beider Geschlechter in einer AK
  für die Prüfung von Spalten, mobilen Ansichten und Dialog-Scrollleisten.
  `?admin=1&many=1` prüft 73 Gliederungen einschließlich Seitennavigation und
  nachgeladener Verantwortlichenauswahl. `?fail=1&delay=5000` lässt die erste
  simulierte Änderung fehlschlagen, um die Rücknahme optimistischer Änderungen zu prüfen.
- `tests/mobile_nav.browser.html`: mobile Navigation.
- `tests/login.browser.html`: Registrierung und wiederaufgenommene Namenseingabe,
  mit simuliertem Speichern und Mailversand auf Desktop sowie bei 390/320 px.

Diese Fixtures verwenden eigene Daten. Funktionstests mit vereinfachtem DOM
prüfen Verhalten, ersetzen aber keine Layoutkontrolle im Browser.

Die Profilfortschritt-Fixture besitzt einen Schalter „Ladezustand“. Die Skeletons
maskieren die tatsächlichen Karten-/Formularelemente, damit deren Maße erhalten bleiben.
Die statischen Menü-Piktogramme der Kontoeinstellungen bleiben dabei sichtbar.
`member_bootstrap.browser.html?page=account-settings.html&width=390&delay=10000&cached=1`
prüft mit den tatsächlichen Einstiegsskripten sofortige Menüzähler aus dem Sitzungscache
und deren spätere Aktualisierung. Ohne `cached=1` bleiben unbekannte Zähler zunächst leer.
`member_bootstrap.browser.html?preview=1&width=390&delay=10000&role=standard`
prüft die sofortige Rückkehr mit einer vorherigen Admin-Ansicht und deren Korrektur
nach dem Hintergrundabgleich. `&fresh=1` ohne `preview=1` prüft einen Cache-Miss;
`&launch=1` prüft, dass das Startlogo trotz Vorschau auf frische Daten wartet.
Bei neuen Bildern unterhalb des anfänglich sichtbaren Bereichs an `loading="lazy"`
denken; sofort sichtbare Start-/Loginbilder früh laden.

Fotografien liegen zusätzlich als WebP mit maximal 1800 beziehungsweise 900 Pixeln
Kantenlänge und Qualität 83 vor; das Seitenverhältnis bleibt erhalten. Sichtbare
Logo-/Google-Bilder verwenden kleine verlustfreie WebP-Dateien. Alte Bild-URLs sowie
PNG-Manifest-/Installationsicons bleiben kompatibel. Es gibt keinen Produktions-Build.

## CI und Produktionswartung

`admin_accounts.browser.html?new=1&delay=3000` prüft das automatische Lesen beim
Öffnen einer Person mit verzögerter Speicherung. Der Editor muss geöffnet bleiben;
zusätzlich `&fail=1` prüft die Rücknahme des Gelesen-Status bei einem Fehler.

`member_bootstrap.browser.html?registrations=1&width=390` simuliert zwei neue Konten,
eines davon mit Verknüpfungsantrag. Der App-Zähler zeigt „2“, nicht „3“.

`.github/workflows/checks.yml` führt bei Push/PR Struktur-, Funktions-, Python-
und Emulatorprüfungen ohne Produktions-Credentials aus. Der vorhandene Workflow
`sync-participant-directory.yml` ist davon getrennt: Er verarbeitet die private
Quelldatei und verändert mit den dafür vorgesehenen Secrets echte Verzeichnisdaten.

Die Wartungs-CLIs `sync_account_google_emails.mjs` und
`reset_legacy_person_links.mjs` zeigen ohne `--apply` nur eine Vorschau an;
auch eine Vorschau liest echte Daten und verbraucht Kontingent. Nicht automatisch
als Teil eines Tests ausführen. Die Schreiboption ausdrücklich nur für die
beabsichtigte Produktionswartung verwenden.
