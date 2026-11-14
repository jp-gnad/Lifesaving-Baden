# Architektur und Einstiegspunkte

Lifesaving Baden ist eine statische Website mit gemeinsamem Mitgliederbereich
und Timer. HTML lädt die JavaScript-Dateien direkt mit `defer`. Der Browser spricht
Firebase Authentication und Firestore an; `firestore.rules` setzt die tatsächlichen
Berechtigungen durch. Es gibt keinen Node-Server und keinen Produktions-Build.

## Welche Datei gehört zu welcher Funktion?

| Einstieg | Aufgabe | Zuständige Module |
|---|---|---|
| `index.html` | Öffentliche Startseite und Weiterleitung bestehender Sitzungen | `auth-core.js`, `auth.js`, `nav.js`, `header.js` |
| `login.html` | Anmeldung, Registrierung, Verifikation und Passwort-Reset | `auth-core.js`, `login.js`, `google-handoff.js`, `login-background.js` |
| `app.html` | Mitgliederübersicht und rollengesteuerte App-Links | `auth.js`, `admin-accounts.js`, `clubs-notifications.js` |
| `account-settings.html` | Profil, Anmeldeanbieter, Passwort und Personenverknüpfung | `auth.js`, `person-link-store.js` |
| `link-request.html` | Kompatibilitätsweiterleitung zu den Verknüpfungen in den Einstellungen | Inline-Weiterleitung |
| `admin-accounts.html` | Konten, Rollen, Anträge und Personen zuordnen | `admin-accounts.js`, `auth.js`, `person-link-store.js` |
| `club-verwaltung.html` | Clubkader, Aktivstatus und Nachweise | `clubs.js`, `clubs-core.js`, `clubs-store.js`, `start-eligibility*.js` |
| `gliederungen.html` | Clubs und Verantwortliche verwalten | dieselben Clubmodule, Admin-Einstieg |
| `arbeitszeiten.html` | Aufgaben, Arbeitszeiten und Statistik | `worktime.js`, `worktime-core.js`, `worktime-store.js` |
| `mein-training.html` | Vorbereiteter geschützter Trainingsbereich | `auth.js`, `training.css`; bisher kein eigener Datenspeicher |
| `timer/index.html` | Events, Zeitnahme, Teilnehmer und Ergebnisse | Timer-Module in der folgenden Tabelle |
| Weitere Root-HTML-Seiten | Öffentliche Inhalte, Rechner, Rechtstexte | seiteneigenes HTML/JavaScript, gemeinsame Navigation/CSS |

Die in der Tabelle abgekürzten gemeinsamen JS-Dateien liegen in `assets/js/`.
Das Rootmanifest gehört zur gesamten App. `timer/sw.js` speichert die Timer-App-Hülle;
Firestore hat einen separaten SDK-Cache. Diese beiden Speicher haben unterschiedliche Aufgaben.

Die gemeinsame Anmeldung lädt auch das Firestore-SDK, um neue E-Mail-Profile vor
dem Versand der Bestätigungsmail mit Vor- und Nachnamen zu speichern.
`auth-core.js` stellt dafür `saveAccountName` mit einer Transaktion auf dem eigenen
Kontodokument bereit. Google-Anbieterprofile liefern getrennte Namensbestandteile;
diese befüllen ausschließlich noch leere Profile. `loginNameCaptured` kennzeichnet
vollständige Login-Namen. Eine verpflichtende erweiterte Ersteinrichtung gibt es
nicht mehr. Neue Konten erhalten `accountSetupRequired: false`; vorhandene Marker
werden weder im Mitgliederbereich noch im Timer als Zugangssperre ausgewertet.
Nach dem bestätigten Login öffnet sich direkt der Mitgliederbereich.
Vor dem Absenden des Namens bleibt eine neue Registrierung ein Entwurf im
Arbeitsspeicher; erst danach wird das Firebase-Konto erstellt. Neuladen oder
Verlassen verwirft den Entwurf einschließlich Passwort, ohne eine E-Mail zu
reservieren. Allgemeine Passwort-Loginfehler unterscheiden neue Adressen nicht
von falschen Passwörtern; die Kontoneuanlage kann daher erst beim Absenden des
Namens eine bereits vergebene Adresse zurückweisen. Bereits angelegte unbestätigte
Konten ohne vollständigen Namen nehmen die Namenseingabe nach erfolgreicher
Authentifizierung wieder auf. Ihr Passwortschutz bleibt erhalten. Bestehende
bestätigte E-Mail-Konten benötigen für den Login keinen Firestore-Lesezugriff.

Verknüpfungen werden freiwillig unter `account-settings.html#verknuepfungen`
angefragt. Pflichtangaben werden ausschließlich im gespeicherten Profil gepflegt:
Vorname, Nachname, Geschlecht, Geburtsdatum und DLRG-Gliederung. Der Anfragebutton
in `auth.js` ist bis zur Vollständigkeit deaktiviert. Ein optionaler Hinweistext
kann dort eingegeben und mit der Anfrage aktualisiert werden. `person-link-store.js`
prüft innerhalb einer Transaktion die aktuellen Profildaten und eine inzwischen
bestehende Zuordnung. Es schreibt nur die Anfrage, keine Personenreservierung oder
Rollenänderung. Die tatsächliche Zuordnung bleibt ein separater Adminvorgang.

## Timer-Module

| Datei | Verantwortung und Schnittstelle |
|---|---|
| `timer/core.js` | `TimerCore`: Disziplinen, Zugriffslabels, Datums-/Zeitformatierung, Zeitparser, Lap-Gruppen, HTML-Escaping. Keine DOM-/Firestore-Zugriffe. |
| `timer/app.js` | DOM-Einstieg, Hash-Routing, Uhr, Ergebnisansichten, Synchronisation vorgemerkter Ergebnisse. Verbindet die übrigen Module. |
| `timer/control-input.js` | `TimerControlInput.bindRelease(button, activate)`: Aktivierung der Stoppuhrknöpfe beim Loslassen, auch nach langem Halten; verhindert doppelte Klicks und erhält Tastaturbedienung. Keine Initialisierung beim Laden. |
| `timer/time-input.js` | `TimerTimeInput`: Live-Eingabemaske für bis zu sechs Ziffern, Cursor-/Löschverhalten und gemeinsames Einlesen der Zeitfelder in beiden Ergebnis-Editoren. `create({ parseTime })` erhält den bestehenden Zeitparser; die gespeicherten Werte bleiben Hundertstelsekunden. |
| `timer/participant-picker.js` | `TimerParticipantPicker.create({ escapeHtml }).renderGroups(...)`: gemeinsame dezente Altersklassen-Gruppierung für Ergebnisprüfung, Ergebnisbearbeitung und Importauswahl. Erhält bereits gefilterte Personen und eine Renderfunktion; lädt keine Daten. |
| `timer/participant-updates.js` | `TimerParticipantUpdates.create({ getAccountId })`: lokale Personenänderungen nach dauerhafter Vormerkung und Serverbestätigung zusammenführen. Überlebt Ansichtswechsel, gleicht verspätete Listen ab und leert sich bei Konto-/Rollenwechsel; keine Datenbankzugriffe. |
| `timer/custom-discipline-picker.js` | `TimerCustomDisciplinePicker.create(...).mount(...)`: optionaler Name und Auswahl früherer Namen für Benutzerdefiniert; begrenzte, nach Rundenzahl gefilterte Event-Abfragen im Hintergrund, lokale vorgemerkte Namen und Schutz vor verspäteten Antworten. |
| `timer/event-cache.js` | `TimerEventCache.create(...)`: höchstens 50 Event-Metadatensätze für sofortige Navigation zwischen Event, Einstellungen und Timer. Nach 30 Sekunden im Hintergrund erneuern; bei Konto-/Rollenwechsel leeren. Keine Teilnehmerdaten. |
| `timer/save-queue.js` | `TimerSaveQueue.create(...)`: lokale Schreibwarteschlange mit sequenzieller Hintergrundübertragung, Wiederholung und Kontobindung. Die Oberfläche wartet auf den lokalen Transaktionsabschluss, nicht auf Firebase. |
| `timer/views/people.js` | `TimerPeopleView.create(dependencies).render(...)`: Teilnehmerliste, Suche und Bearbeitungsdialoge. |
| `timer/firestore-api.js` | `timerFirestoreApi`: `request`, Auth-Kontext, Ergebnislistener und Cache-Lebenszyklus. Kennt die Firestore-Struktur. |
| `timer/result-feed.js` | `TimerResultFeed.create(...)`: Listener-Lebenszyklus, Seitennavigation und Sichtbarkeit; `readAll(...)` ausschließlich für ausdrückliche vollständige Exporte. Abhängigkeiten werden übergeben. |
| `timer/participant-store.js` | `TimerParticipantStore`: Identitätsschlüssel, Migration und atomare Teilnehmeränderungen. |
| `timer/offline-store.js` | `TimerOfflineStore`: pending Ergebnisse in IndexedDB lesen/schreiben/löschen. Bestätigt Schreibvorgänge erst nach Transaktionsabschluss. |
| `timer/results-pdf.js` | `TimerResultsPdf.create(...)`: PDF-Ausgabe und optionales Eventbild. |
| `timer/sw.js` | App-Hülle und Offline-Dateiversionen, ohne Firestore-Datenzugriffe. |

Die Disziplin-Definitionen werden von Oberfläche und Firestore-Adapter gemeinsam
verwendet. Fachlogik muss deshalb nicht in beiden Dateien parallel gepflegt werden.
Die serverseitigen Sicherheitsregeln bleiben davon unabhängig.

`disciplinesForEvent`/`disciplineForEvent` lösen bahnlängenabhängige Disziplinen
auf: `obstacle100` hat auf 25 m vier und auf 50 m zwei Runden. Die zusätzliche
Disziplin steht unter dem geschlossenen Bereich „Weitere Disziplinen“.
`disciplineForResult` rekonstruiert die ursprüngliche Einteilung aus gespeicherten
Lap-Gruppen; spätere Änderungen der Event-Bahnlänge verändern alte Ergebnisse
oder deren Bearbeitung nicht. Neue Ergebnisse werden gegen die aktuelle Bahnlänge
geprüft, bestehende gegen ihre gespeicherte Rundeneinteilung – auch in den Regeln.

Der Timer lädt die Personenliste erst nach Aufbau der bedienbaren Stoppuhr im
Hintergrund. Die Ergebnisprüfung ergänzt nachgeladene Personen, ohne laufende
Zeitkorrekturen oder Zuordnungen zu überschreiben. Die Event-Startseite benötigt
keinen Teilnehmer-Read. Vorgemerkte Änderungen werden auf heruntergeladene
Event-/Teilnehmeransichten angewendet, bis die Übertragung bestätigt ist.
Ein sitzungsgebundenes Änderungsjournal übernimmt neu angelegte oder importierte
Personen direkt in die Timer-Auswahl. Es bewahrt bestätigte Änderungen auch nach
Entfernen aus der Warteschlange, damit verspätete Listen sie nicht verschwinden
lassen. Neuere Bearbeitungen und Löschungen haben Vorrang vor älteren Antworten.
Die Stoppuhr startet mit diesen lokalen Personen; wartende Einträge aus IndexedDB
und der normale Personenabruf ergänzen die Auswahl unabhängig im Hintergrund.

Die Schreibwarteschlange bewahrt alte Ergebnisdatensätze und zusätzliche
Schreibbefehle im bestehenden IndexedDB-Store auf. Neue Befehle sind an die
Konto-ID gebunden; Event-/Personenneuanlagen verwenden bei Wiederholungen dieselbe
`clientMutationId`. Hintergrundschreibvorgänge überleben Ansichtswechsel,
prüfen Konto-/Rollenwechsel aber weiterhin vor Mutationen. Die atomaren
Teilnehmer-/Identitätstransaktionen und die Firestore-Regeln bleiben maßgeblich.

Benutzerdefinierte Disziplinennamen stehen im Event unter `customDisciplines`.
Name und Anzahl der ursprünglich gemessenen Runden bestimmen die Identität;
verbundene Runden behalten ihre ursprüngliche Lap-Abdeckung. Ein neuer Name und
das zugehörige Einzelergebnis werden atomar geschrieben. Die Auswahl liest nur
passende Namen in Seiten von höchstens 50 Dokumenten; normale Saves scannen keine
Ergebnisse. Ergebnislisten/PDFs zeigen den Namen und bieten einen Namensfilter.

Beim Stoppen hält die Stoppuhr die Quelle als `timekeeper: { uid, initials }`
fest. Das Kürzel kommt aus dem bereits geladenen Accountnamen, ohne zusätzliche
Profilabfrage. Die Offline-Warteschlange bewahrt diesen Snapshot; spätere
Ergebniskorrekturen ändern ihn nicht. Ergebnislisten und PDFs zeigen eine kleine
Zeile „Zeitnahme: Kürzel“, im PDF innerhalb der bestehenden Namenszelle.
Gäste und Altbestände ohne Quelle erscheinen als „Unbekannt“.

Normales Speichern und erfolgreiche Hintergrundübertragungen zeigen keine
automatischen Erfolgsmeldungen. Der Status unten erscheint nur bei noch nicht
übertragenen Offline-Änderungen oder Übertragungsfehlern. Fehler und ausdrücklich
angeforderte Rückmeldungen bleiben sichtbar.

## Daten und verantwortliche Schreibpfade

| Firestore-Pfad | Zweck | Schreibpfad |
|---|---|---|
| `users/{uid}` | Profil, Rolle, Einstellungen, Linkanträge | Auth-/Kontenlogik; Rollen nur berechtigte Administration |
| `personAccountLinks/{personId}` | Eindeutige Zuordnung Person zu Konto | `person-link-store.js` |
| `timerParticipantDirectory/{id}` | Geschützte importierbare Personenliste | Wartungs-Sync mit Admin SDK |
| `clubDirectory/{id}` | Namen für die Gliederungsverwaltung | derselbe Wartungs-Sync |
| `timerEvents/{eventId}` | Eventdaten und getrennte Zugriffsrechte | Timer-Adapter |
| `timerEvents/{eventId}/participants/{id}` | Eventteilnehmer | `participant-store.js` |
| `timerEvents/{eventId}/participantIdentities/{key}` | Dublettenschutz, auch bei Parallelzugriffen | dieselbe Transaktion wie der Teilnehmer |
| `timerEvents/{eventId}/results/{id}` | Einzelergebnis mit Personensnapshot | Timer-Adapter; idempotente Offline-Übertragung |
| `timerEvents/{eventId}/customDisciplines/{id}` | Wiederverwendbarer Disziplinenname mit fester Rundenzahl, ausschließlich für Benutzerdefiniert | Timer-Adapter: atomar mit einem Ergebnis; Katalogeinträge sind unveränderlich. |
| `clubs/{id}` und `clubs/{id}/people/{id}` | Verantwortliche, Kader, Aktivjahre und Nachweise | `clubs-store.js` |
| `clubProfiles/{uid}`, `clubAccounts/{uid}` | Profile und Clubzuordnungen | Club-/Personenlink-Transaktionen |
| `users/{uid}/worktimeEntries/{id}` | Arbeitsaufgaben und Intervalle | `worktime-store.js` |
| `users/{uid}/worktimeSchedule/intervals` | Atomare Prüfung auf Überschneidungen | dieselbe Arbeitszeittransaktion |
| `users/{uid}/worktimeSettings/preferences` | Gliederungsauswahl | Arbeitszeitoberfläche |

Snapshots in Ergebnissen bleiben auch dann nutzbar, wenn sich die ursprüngliche
Person später ändert. Bestehende Teilnehmer-IDs werden bei der Indexmigration
beibehalten, damit Ergebnisverweise gültig bleiben.

`clubs-notifications.js` stellt eine Factory für den Admin-Zähler bereit.
Sie hört ausschließlich auf Clubs mit `needsResponsible == true`, pausiert bei
verborgener Seite und verwirft Rückmeldungen alter Sitzungen oder Listener.
`clubs-store.js` aktualisiert dieses Kennzeichen atomar mit den Verantwortlichen
und ihrem Kontoindex. Die Gliederungsansicht verwendet ihren bestehenden
Clublistener für die Meldung am jeweiligen Club.

## Datenfluss beim Teilnehmerimport

1. Personenansicht lädt den Kader einmal über den Adapter.
2. Bei alten Events übernimmt ein berechtigter Organisator den vorhandenen Kader
   einmalig in den Identitätsindex; währenddessen blockieren Regeln Teilnehmeränderungen.
3. Suche lädt höchstens zehn Verzeichnistreffer. „Bereits importiert“ wird lokal
   angezeigt; identische Suchbegriffe sind kurz wiederverwendbar.
4. Der Import prüft und schreibt Teilnehmer und Identitätszuordnung atomar.
5. Die Anzeige übernimmt die zurückgegebene Person. Eine vollständige Liste wird
   erst bei ausdrücklichem Aktualisieren oder neuem Ansichtsaufruf wieder geladen.

## Begrenzte Event- und Ergebnisabfragen

Eventlisten und Ergebnisse werden nach Dokument-ID mit `limit(50)` und
`startAfter(id)` abgefragt. Diese Reihenfolge schließt Altbestände ohne Datumsfeld
ein; Änderungen an Zeiten verschieben die Seitengrenzen nicht. Die Firestore-Regeln
verlangen für beide Listen ein Limit von höchstens 50, auch bei Admins. Einzelne
Dokumentzugriffe und die bestehenden Rollenrechte bleiben getrennt geregelt.

Die Eventübersicht lädt weitere Seiten ausdrücklich nach und sortiert/filtert die
geladenen Events lokal nach Datum. In Ergebnisansichten ist genau eine Seite live;
die Anzeige sortiert deren Ergebnisse nach Zeit und kennzeichnet den Seitenumfang.
Ein Disziplin-/Geschlechtswechsel innerhalb derselben Ergebnisansicht verwendet
diese Daten weiter. Metadatenänderungen starten den Ergebnislistener nicht neu.
Ausgeblendete Tabs pausieren beide Listener, das Verlassen beendet sie endgültig.

Die Ergebnisansicht lädt zunächst keine Teilnehmer. Erst das Bearbeiten benötigt
die vorhandene Teilnehmerliste. Speichern und Löschen nutzen die Rückmeldung des
Live-Listeners. PDF-Exporte laden auf ausdrücklichen Klick alle Ergebnisse in
begrenzten Seiten, filtern/sortieren anschließend die vollständige gewählte Gruppe
und erzeugen bei Ladefehlern kein unvollständiges PDF. Auch das Löschen eines Events
durchläuft alle Ergebnisseiten. Seitenabfragen sind keine gemeinsame Momentaufnahme
über mehrere Anfragen; gleichzeitige Neuanlagen können einen erneuten Export erfordern.

## Wartungs- und Testcode

`tools/lib/` enthält die reine Planung von Sync-Änderungen und die Prüfung des
erlaubten Firebase-Projekts. Nur die Wartungs-CLIs importieren das Admin SDK.
Der wöchentliche Workflow synchronisiert beide Verzeichnisse und schreibt bereits
identische Dokumente nicht erneut. Vollständige Bestandsreads bleiben dabei bestehen.

Tests stehen in `tests/`; visuelle Browser-Fixtures arbeiten mit eigenen lokalen
Daten. Abhängigkeiten, Befehle und Prüfmatrix: [development.md](development.md).
Kompatibilitäts- und Sicherheitsverträge: [security-and-compatibility.md](security-and-compatibility.md).
