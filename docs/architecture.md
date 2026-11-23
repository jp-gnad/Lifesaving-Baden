# Architektur und Einstiegspunkte

Lifesaving Baden ist eine statische Website mit gemeinsamem Mitgliederbereich
und Timer. HTML lädt die JavaScript-Dateien direkt mit `defer`. Der Browser spricht
Firebase Authentication und Firestore an; `firestore.rules` setzt die tatsächlichen
Berechtigungen durch. Es gibt keinen Node-Server und keinen Produktions-Build.

## Welche Datei gehört zu welcher Funktion?

| Einstieg | Aufgabe | Zuständige Module |
|---|---|---|
| `index.html` | Öffentliche Startseite und Weiterleitung bestehender Sitzungen | `auth-core.js`, `landing.js`, `nav.js`, `header.js` |
| `login.html` | Anmeldung, Registrierung, Verifikation und Passwort-Reset | `auth-core.js`, `login.js`, `google-handoff.js`, `login-background.js` |
| `app.html` | Mitgliederübersicht und rollengesteuerte App-Links | `auth.js`, `admin-notifications.js`, `clubs-notifications.js`, `dashboard-header.js`, `member-tabs.js` |
| `account-settings.html` | Profil, Anmeldeanbieter, Passwort und Personenverknüpfung | `auth.js`, `person-link-store.js` |
| `link-request.html` | Kompatibilitätsweiterleitung zu den Verknüpfungen in den Einstellungen | Inline-Weiterleitung |
| `admin-accounts.html` | Konten, Rollen, Anträge und Personen zuordnen | `admin-accounts.js`, `auth.js`, `person-link-store.js` |
| `club-verwaltung.html` | Clubkader, Aktivstatus, Nachweise und eigene Eventplanung | `clubs.js`, `clubs-core.js`, `clubs-store.js`, `start-eligibility*.js`, `club-events*.js`, `club-teams-core.js` |
| `gliederungen.html` | Clubs und Verantwortliche verwalten | dieselben Clubmodule, Admin-Einstieg |
| `arbeitszeiten.html` | Aufgaben, Arbeitszeiten und Statistik | `worktime.js`, `worktime-core.js`, `worktime-store.js` |
| `mein-training.html` | Vorbereiteter geschützter Trainingsbereich | `auth.js`, `training.css`; bisher kein eigener Datenspeicher |
| `timer/index.html` | Events, Zeitnahme, Teilnehmer und Ergebnisse | Timer-Module in der folgenden Tabelle |
| Weitere Root-HTML-Seiten | Öffentliche Inhalte, Rechner, Rechtstexte | seiteneigenes HTML/JavaScript, gemeinsame Navigation/CSS |

Die in der Tabelle abgekürzten gemeinsamen JS-Dateien liegen in `assets/js/`.
`account-avatar-cache.js` hält ausschließlich das Bild und die Initialen des
zuletzt aktiven Kontos im Sitzungsspeicher. `account-avatar.js` zeigt diese
Vorschau auf allen Mitgliederseiten und im Timer bereits vor den Firebase-SDKs.
Der Bildinhalt wird als begrenzte Data-URL gespeichert; ohne CORS-Unterstützung
des Bildhosts bleibt dessen normale HTTP-Bildcache-Nutzung als Ersatzweg.
Die Kontositzung gleicht UID und Bildadresse anschließend unabhängig ab.
Unveränderte Bilder benötigen 24 Stunden keinen erneuten Abruf; danach erfolgt
die Erneuerung im Hintergrund. Ein geändertes Bild ersetzt die Vorschau erst
nach vollständigem Laden und Decodieren. Fehler behalten das bisherige Bild,
Entfernen, Kontowechsel und Abmelden verwerfen es. Der Timer erhält seine
Avatar-DOM-Elemente bei unverändertem Konto auch über Ansichtswechsel hinweg.
`account-indicators.js` hält den Verknüpfungsstatus, die roten Profilhinweise und
die Summen der beiden Admin-Kacheln als reine kontogebundene Anzeige im
Sitzungsspeicher. Die Darstellung erscheint vor Firebase. Erfolgreiche Abfragen
ersetzen geänderte Werte. Fehler und ältere Offline-Snapshots behalten die
letzte Anzeige. Kontowechsel und Abmeldung verwerfen sie, ein bestätigter
Rollenwechsel entfernt die Admin-Summen. Profil- und Zählerabfragen behalten
ihre bisherigen Berechtigungsprüfungen und Filter.
`app-launch.js` und `app-launch.css` halten beim kalten Start der installierten App
das Startbild über dem tatsächlichen Layout. `landing.js` übergibt es bei einer
bestätigten Sitzung mit dem einmaligen URL-Marker `appLaunch=1` an `app.html`;
die Zielseite entfernt den Marker sofort. Manifest-ID und Start-URL bleiben erhalten.
`auth.js` meldet erst nach Profil, autoritativer Rolle und UI-Initialisierung die
Bereitschaft. Danach wartet das Startbild auf Dokument, Schriften, sichtbare lokale
Bilder und zwei Darstellungsframes. Es entstehen keine zusätzlichen Datenbankabfragen.
Die Mindestanzeige von 650 ms gibt die Oberfläche niemals vorzeitig frei; nach
fünf Sekunden erscheint ein Hinweis mit Wiederholungsmöglichkeit. Auch früh
gemeldete Fehler erscheinen frühestens nach diesen fünf Sekunden; ein vorher
erfolgreicher Start verwirft den ausstehenden Hinweis.
Fehler behalten das Startbild und denselben Wiederholungsweg. Normale Seitennavigation
und Neuladen ohne Marker verwenden weiterhin den bisherigen Seitenstart.
Für Rückkehrer stellt `member-view-cache.js` einen getrennten, höchstens 30 Minuten
alten Sitzungsschnappschuss bereit: Name, Profilfortschritt und effektive Rolle aus
dem letzten erfolgreichen Profil-/Claims-Abgleich. Erst nach Erkennen desselben
bestätigten Firebase-Kontos zeigt `auth.js` diese Übersicht ohne wartende Skeletons.
Der unveränderte frische Abgleich läuft im Hintergrund und korrigiert die Anzeige.
Die Vorschau startet keine Admin-Listener oder Fachmodule und befüllt weder
Formulare noch den geschäftlich genutzten Profilcache. Änderungen am Profil
aktualisieren die Vorschau, verlängern aber nicht die Gültigkeit der geprüften Rolle.
Abmeldung löscht den Cache; Kontowechsel entfernen die bisherige Darstellung,
gesperrte/ungültige Sitzungen melden sich ab. Nach Wiederherstellung aus dem
Browser-Verlauf (`pageshow.persisted`) erfolgt ebenfalls ein Hintergrundabgleich.
Der kalte App-Start mit Logo wartet weiterhin auf die frischen Daten.
`dashboard-header.js` passt die Namensschrift im Dashboard und Kontofenster an die
verfügbare Breite an und reagiert auf Profiltext, Fenstergröße und geladene Schriften.
Sein `setName` zeigt Sitzungsvorschauen sofort und blendet neu geladene Namen in
220 ms ein, ohne identische Hintergrundantworten erneut zu animieren. Die Rollenfarbe
der Mitgliederübersicht blendet in 750 ms seitlich ein; Farbwechsel interpolieren
denselben Verlauf. Reduzierte Bewegung deaktiviert beide Effekte.
Der Mitgliederheader behält seine feste responsive Höhe auch ohne offene Aufgaben.
`member-tabs.js` schaltet lokal zwischen Home, Profil und Club unterhalb des
Mitgliederheaders um. Home enthält die bisherigen rollengesteuerten App-Links;
Profil und Club sind zunächst leer. Die Tab-Leiste unterstützt Pfeiltasten sowie
Pos1/Ende und startet beim Seitenladen auf Home. Sie lädt keine weiteren Daten.
Das Rootmanifest gehört zur gesamten App. `timer/sw.js` speichert die Timer-App-Hülle;
Firestore hat einen separaten SDK-Cache. Diese beiden Speicher haben unterschiedliche Aufgaben.

Die öffentliche Startseite lädt keine Kontenverwaltungsoberfläche. `admin-accounts.js`
gehört ausschließlich zu `admin-accounts.html`; `admin-notifications.js` enthält die
kleinen Zählabfragen für die Mitgliederübersicht. Rasch aufeinanderfolgende
Sichtbarkeitsereignisse verwenden einen erfolgreichen Zählerstand 15 Sekunden weiter.
Eigene HTTP-Aggregationsabfragen brechen nach zehn Sekunden ab.
`account-notifications-core.js` definiert dieselbe Zählung für App-Symbol und
Personenboxen. `auth-core.js` legt neue Kontoprofile mit `adminReviewPending: true`
an, auch beim Erfassen des Namens vor der E-Mail-Bestätigung. Bereits vorhandene
Profile erhalten keine nachträgliche Neumeldung. Neues Konto und offener
Verknüpfungsantrag bilden gemeinsam eine Meldung; ein Verknüpfungsfehler zählt
separat. Die erste der weiterhin zwei Zählabfragen verwendet dafür eine OR-Abfrage
über Neumarker und beide bisherigen Antragsformate, ohne Kontodokumente zu laden.
Das Öffnen der Personenbox markiert die Neumeldung sofort als gelesen und speichert
dies im Hintergrund. Editor, Fokus und Entwürfe bleiben erhalten; bei Fehlern wird
die Neumeldung wiederhergestellt. Offene Anträge und Fehlermeldungen bleiben sichtbar.
Bearbeitung eines Verknüpfungsantrags erledigt den Neumarker ebenfalls in derselben Transaktion.

Die gemeinsame Darstellung von Kontotyp und Rollenfarben gehört zu `auth.js` und
funktioniert ohne das Admin-Modul. `admin-accounts.js` erhält dieselben Darstellungs-
funktionen als explizite Factory-Callbacks. Fehler einer Administrationsoberfläche
setzen eine bereits geladene Rolle nicht auf Standard zurück.

`collection-pages.js` hält konten-/ansichtsgebundene Cursor, laufende Abfragen und
kurzlebige Suchergebnisse. Die Kontenliste startet mit 50 Dokumenten und lädt weitere
Seiten ausdrücklich nach. Die Suche filtert geladene Konten; „Alle Konten durchsuchen“
durchläuft bei Bedarf die übrigen Seiten. Änderungen lesen nur das betroffene Konto
neu. Unveränderte Karten und geöffnete Editoren bleiben erhalten. Personenreservierungen
werden für die höchstens zehn Suchtreffer gemeinsam gelesen; die Schreibtransaktion
prüft die Zuordnung weiterhin unabhängig von der Anzeige.

Die Gliederungsübersicht verwendet einen Listener für die aktuelle Seite mit höchstens
50 Dokumenten. Konten für die Verantwortlichenauswahl werden erst beim Öffnen eines
Bearbeitungsdialogs in begrenzten Seiten geladen, das Gliederungsverzeichnis nur beim
Erstellen. Der frühere automatische Ersatzscan des gesamten Personenverzeichnisses
entfällt; neue Gliederungsnamen lassen sich weiterhin manuell eingeben. Altbestände
werden beim Anzeigen ihrer Seite mit dem bestehenden Store migriert.

`club-profile-feed.js` gruppiert Profillistener für Admins in Gruppen von höchstens
zehn IDs. Trainer behalten die bestehenden Einzelzugriffe; ihre Listenberechtigung
wird nicht erweitert. Identische Profildaten erzeugen keine neue Darstellung,
gleichzeitig eintreffende Änderungen werden zusammengefasst. Clubkader und
Gliederungskarten verwenden unveränderte DOM-Elemente weiter.

Unter „Personen“ wechseln Übersicht und Startberechtigungen per Dropdown.
Die Jahresauswahl steuert die Altersgruppen und den angezeigten Aktivstatus.
In der Übersicht bleiben auch inaktive Personen erreichbar. Ihre Aktivjahre
werden im Personenmenü gesetzt. Die Startberechtigungen filtern wie bisher nach
aktiven Personen im gewählten Jahr und öffnen den Nachweiseditor.
„Person erstellen“ speichert Name, Jahrgang und Geschlecht ausschließlich im
jeweiligen Clubkader. Die eigene Dokument-ID bleibt auch in Club-Events die
Identität dieser Person. Manuelle Einträge starten mit leeren Aktivjahren und
Nachweisen und verwenden danach die bestehenden Kaderfunktionen.
`club-roster-state.js` projiziert ausstehende Imports, Entfernungen, Aktivjahre und
Nachweise auf den Clubkader. Erst passende Serversnapshots lösen bestätigte Projektionen
ab; Fehler nehmen die jeweilige Projektion zurück. Ausstehende Personen sind als solche
gekennzeichnet und werden nicht parallel erneut bearbeitet oder vor ihrer Bestätigung
in eine neue Eventauswahl übernommen. Der Zustand endet beim
Club-/Kontowechsel und ist keine zusätzliche dauerhafte Offline-Warteschlange.
Profilfelder in den Einstellungen zeigen ebenfalls sofort den Entwurf und sperren
weitere Änderungen bis zur Bestätigung; fehlgeschlagene Feldänderungen werden zurückgenommen.
Die statischen SVG-Piktogramme des Einstellungsmenüs bleiben auch während des
Profilabrufs sichtbar. Sobald das aktuelle Konto feststeht, zeigen die Menüzähler
gegebenenfalls dessen noch gültigen Sitzungscache an; die frische Profilantwort
ersetzt diese Anzeige. Rollen und Formularwerte verwenden weiterhin den geprüften
Initialisierungsablauf. Kontowechsel oder Abmeldung entfernen vorherige Zähler.
Menü und Zurück-Navigation bleiben währenddessen bedienbar; `inert` sperrt nur
die Inhaltskarten der Einstellungen bis zum Abschluss des Ladens.

Arbeitszeiten gleichen Altbestände beim ersten erfolgreichen Speichern je Kontositzung
ab. Weitere Saves verwenden die transaktionale Reservierung ohne erneute Vollabfrage.
Fehler verwerfen die Vorbereitung, Kontowechsel leeren sie. Jede Änderung liest weiterhin
die aktuelle Reservierung in einer Transaktion; die Statistik behält vollständige Summen.

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
| `timer/lazy-assets.js` | Gemeinsamer, wiederholbarer Skriptabruf für Personenansicht und PDF-Modul mit Zeitlimit. Beide Dateien bleiben für Offline-Nutzung im Precache. |
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

Der Stoppmodus kann nach der Rückkehr aus der Ergebnisprüfung geändert werden.
Die gewählte Disziplin muss alle bereits gestoppten Runden abdecken. Im laufenden
Timer muss zusätzlich die aktuelle Runde Platz haben. Leere Felder längerer
Disziplinen bleiben Teil der Ergebnisprüfung und zählen dort als leere Runden.

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

### Club-Events

Club-Events sind eine eigenständige Planung ohne Verbindung zu `timerEvents`.
`club-events-core.js` berechnet Änderungen und bewahrt Einzelstarts unabhängig von
Mannschaftszuordnungen. `club-teams-core.js` liefert die gemeinsame AK-/Geschlechtslogik.
`club-events-store.js` schreibt einzelne Änderungen oder die Anlage einer Trainingsserie in einer Transaktion.
`club-events.js` verbindet Terminübersicht, Erstellungsdialog und Eventansicht als Factory.
`club-events-queue.js` speichert Änderungen kontogebunden lokal, projiziert sie sofort
auf die Ansicht und überträgt sie unabhängig von Club-/Ansichtswechseln im Hintergrund.
`clubs.js` übergibt den aktuellen Club, Sitzungsprüfung und Kader explizit.

Ein Termin unter `clubs/{clubId}/events/{eventId}` hält Name, Kalendertag, Jahr und
Teilnehmersnapshots. Bestehende Dokumente gelten als Wettkämpfe mit Mannschaften
und einem Zuordnungsindex. Trainings- und Organisationstermine halten zusätzlich
Start- und Endzeit am selben Kalendertag. Eine Trainingsserie erzeugt beim Anlegen
bis zu 52 einzeln bearbeitbare Termine im Wochen- oder Zweiwochenrhythmus. Die
Warteschlange speichert alle Vorkommen in einem Auftrag mit festen IDs. Die Regeln erlauben
pro Änderung nur eine Teilnehmer-, Einzelstart-, Metadaten- oder Mannschaftsaktion;
Teilnehmerauswahlen dürfen bis zu drei geprüfte Zu- oder Abgänge gemeinsam ändern.
Der Index reserviert eine Person innerhalb dieses Events für höchstens eine
Mannschaft mit 4–5 Personen. Mannschaftswechsel und Löschungen ändern Einzelstarts
nicht; Personen ohne Einzelstart und Mannschaft stehen unter „Ohne Start“.
AK und Geschlecht entstehen aus den Eventteilnehmern und dem Eventjahr.
Die Anzeige gruppiert Mannschaften, Einzelstarts und Auswahllisten nach AK,
darin weiblich vor männlich und danach alphabetisch. Kleine Farbpunkte und
farbige Mannschaftsränder kennzeichnen das Geschlecht ohne zusätzliche Überschriften.
Weibliche und männliche Mannschaften derselben AK stehen auf Desktop nebeneinander,
mobil untereinander. Die Karten enthalten nur Personen. Die Darstellung verändert
keine gespeicherte Mannschaftsnummer.

Für Wettkämpfe benötigen neue Teilnehmer den Aktivstatus des Eventjahrs. Bereits übernommene
Personen bleiben bei späterer Deaktivierung oder Clubentfernung als Snapshot
erhalten; die Oberfläche kennzeichnet sie dezent als inaktiv. Fehlendes Geschlecht
alter Kaderdatensätze wird nur für ausdrücklich ausgewählte Personen aus der
maßgeblichen Quelle ergänzt. Aktivjahre, Nachweise und Erstellungszeit bleiben erhalten.

Ein Wettkampf wird nach Name und Datum ohne Teilnehmer erstellt. Erst in der Eventansicht
werden Einzelschwimmer oder Mannschaften aus dem im Eventjahr aktiven Clubkader
hinzugefügt. Direkt für eine Mannschaft übernommene Personen erhalten keinen
automatischen Einzelstart; schon vorhandene Einzelstarts bleiben erhalten.
Die Einzelauswahl übernimmt Personen sofort und blendet sie aus der Auswahl aus.
Das Personenmenü eines Einzelstarts bietet „Entfernen“: Mit Mannschaft bleibt die
Zuordnung erhalten, ohne Mannschaft wird die Person aus dem Event entfernt.
Bei Training und Organisation lassen sich in der Terminansicht alle Aktiven des
Terminjahrs, der gesamte Clubkader oder einzelne Personen hinzufügen. Bereits
eingetragene Personen bleiben erhalten.

Speichern bestätigt zuerst den Abschluss eines synchronen lokalen Schreibvorgangs.
Die Warteschlange nutzt je Auftrag einen eigenen Schlüssel unter
`lifesaving-club-event-queue-v1/{uid}/`; sie enthält feste Event-IDs und kleine,
serialisierbare Kadersnapshots. Fehler beim lokalen Schreiben schließen den Dialog
nicht. Nach Neuladen werden ausstehende Aufträge ausschließlich für ihr Ursprungskonto
fortgesetzt. Web Locks koordinieren Hintergrundarbeiter mehrerer Tabs; nachgewiesene
Bestätigungen bleiben als Sitzungsjournal sichtbar, bis ältere Listenerantworten
aufgeholt haben. Fehlgeschlagene Änderungen bleiben für Wiederholung oder ausdrückliches
Verwerfen erhalten und blockieren keine anderen Events. Der Timer-Speicher bleibt getrennt.

Der Store übernimmt gecachte Kaderidentitäten ohne erneuten Personenabruf in Gruppen
von höchstens drei Personen. Die Firestore-Regeln prüfen in jeder Gruppe den aktuellen
Kader und die ursprüngliche Erstellungszeit unabhängig von diesen Cachewerten.
Bei Wettkämpfen prüfen sie zusätzlich den Aktivstatus. Für Wettkämpfe benötigen
alte Datensätze ohne Geschlecht eine zusätzliche Quellenaktualisierung.
Direkte Mannschaftsaufnahme, Einzelstartwechsel und spätere Bearbeitungen werden
geordnet übertragen; bereits gespeicherte Personen und Startflags bleiben bei
Wiederholung erhalten. Ein kleiner Status kennzeichnet ausstehende Übertragungen.
Ein gefülltes Event kann innerhalb seines Jahres umdatiert werden; ein Jahreswechsel
erfordert ein leeres Event, damit keine ungeprüfte Auswahl aus dem anderen Jahr entsteht.

Die Eventübersicht startet mit „Geplante“ (heute und später); „Vergangene“ enthält
frühere Termine unabhängig vom Jahr. Die Abfragen filtern und sortieren nach Datum,
geplante aufsteigend und vergangene absteigend, mit höchstens 50 Events je Seite.
Weitere Seiten werden ausdrücklich geladen. Ein Tageswechsel erneuert den Datumsfilter.
Innerhalb eines Events ist kein Switch sichtbar; Personen und Startberechtigungen
behalten ihre Jahresauswahl. Beim Öffnen eines Events ersetzt dessen
Dokumentlistener den Listenlistener. Ausgeblendete Seiten pausieren den Listener;
Club-, Konto- und Rollenwechsel schließen Editoren und verwerfen alte Antworten.
Hintergrundaufträge prüfen die Kontositzung getrennt vom Ansichtslebenszyklus;
ein Kontowechsel verhindert weitere Schreibvorgänge des bisherigen Arbeiters.
Bei konkurrierenden Änderungen wird nur nach nachgewiesener Revisionsänderung
begrenzt neu versucht. Das erneute Planen prüft alle Reservierungen erneut.
Die älteren `teamSeasons`-Datensätze bleiben unabhängig erhalten; ohne Eventdatum
werden daraus keine Events konstruiert. Die ungenutzte alte Mannschaftsoberfläche
(`club-teams.js`), ihr Store und die reine Jahresmannschaftslogik wurden entfernt.
`club-teams-core.js` enthält nur noch die gemeinsam verwendete AK-/Geschlechtsberechnung.

### Firestore-Pfade

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
| `clubs/{id}/events/{eventId}` | Club-Eventplanung mit Einzelstarts, Mannschaften und atomaren Zuordnungen | `club-events-store.js`; vollständige Bereinigung beim ausdrücklichen Club-Löschen |
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

Die Personenansicht wird erst auf ihrer Route initialisiert, das PDF-Modul erst bei
einem Exportklick. PDF-Ergebnisse und das optionale Bild laden anschließend parallel.
Alle Bildversuche teilen ein Zeitbudget von acht Sekunden; ohne Bild bleibt der
vollständige Export möglich. Erfolgreiche kleine PDF-Bilder werden begrenzt wiederverwendet.

## Wartungs- und Testcode

`tools/lib/` enthält die reine Planung von Sync-Änderungen und die Prüfung des
erlaubten Firebase-Projekts. Nur die Wartungs-CLIs importieren das Admin SDK.
Der wöchentliche Workflow synchronisiert beide Verzeichnisse und schreibt bereits
identische Dokumente nicht erneut. Vollständige Bestandsreads bleiben dabei bestehen.

Tests stehen in `tests/`; visuelle Browser-Fixtures arbeiten mit eigenen lokalen
Daten. Abhängigkeiten, Befehle und Prüfmatrix: [development.md](development.md).
Kompatibilitäts- und Sicherheitsverträge: [security-and-compatibility.md](security-and-compatibility.md).
