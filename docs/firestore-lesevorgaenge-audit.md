# Firestore-Lesevorgänge: Prüfung vom 12. November 2026

Geprüfter Projektstand: `afeb1ff5fd89eb2fe47be61f30d0cce9aa433ece`.
Für die Einordnung von gestern wurde zusätzlich der letzte Stand vom
11. November (`fdcc969`) und der tatsächlich ausgeführte GitHub-Sync geprüft.
Bei dieser ursprünglichen Prüfung wurden Anwendung, Regeln und Firebase-Konfiguration
nicht geändert. Die anschließend beauftragte Umsetzung der vier Vorschläge für den
Timer-Import ist im folgenden Abschnitt dokumentiert; die weiteren Audit-Funde
beschreiben den ursprünglichen Stand.

## Anschließend umgesetzt: vier Änderungen am Timer-Import

- Teilnehmer werden je geöffneter Ansicht einmal geladen und im Arbeitsspeicher
  gehalten. „Aktualisieren“ lädt Änderungen anderer Geräte nach; Seitenwechsel
  und Änderungen an Anmeldung/Rollen verwerfen den Cache.
- Importsuchen lesen keine Teilnehmerliste mehr. Bis zu zehn Suchtreffer werden
  geliefert; identische Suchbegriffe sind 30 Sekunden wiederverwendbar.
- Transaktionen und Firestore-Regeln sichern eine eindeutige Zuordnung aus Name,
  Jahrgang und Geschlecht. Die bereits geladene Liste dient zur lokalen Anzeige
  „Bereits importiert“. Sie ist nicht die maßgebliche Prüfung beim Schreiben.
- Imports, manuelles Anlegen, Bearbeiten und Löschen aktualisieren die Anzeige
  direkt, ohne vollständige Event-/Teilnehmerabfrage nach dem Speichern.

Altbestände erhalten die Zuordnungen automatisch beim ersten Öffnen der
Personenansicht durch einen berechtigten Organisator. Die einmalige Übernahme
verursacht zusätzliche Schreibvorgänge; bestehende IDs, Ergebnisse und vorhandene
Dubletten bleiben erhalten. Neue Events benötigen diese Übernahme nicht.

Ein Test mit 200 bestehenden Teilnehmern bestätigt: Zehn Suchabfragen, ein
weiterer wiederholter Suchbegriff, Import, Dublettenversuch, Bearbeitung und
Löschen verursachen zusammen nur **eine** vollständige Teilnehmerabfrage. Das
anschließende ausdrückliche Aktualisieren erzeugt erwartungsgemäß eine zweite.
Einzelzugriffe auf Event, Suchtreffer, Teilnehmer und Zuordnung sowie Regelzugriffe
bleiben bestehen. Dies ist ein gezählter Testlauf, keine Produktionsmessung.

Die Website und die geänderten Firestore-Regeln müssen veröffentlicht werden,
damit diese Umsetzung produktiv wirksam wird. Der Firebase-Tarif wurde nicht geändert.

## Aussagekraft und Kostenabsicherung

### Weiterer Umsetzungsstand: begrenzte Listen und Ergebnislistener

Event- und Ergebnisabfragen liefern jetzt höchstens 50 Dokumente pro Seite;
die Regeln erzwingen das Limit auch außerhalb der Oberfläche. Ergebnisansichten
verwenden nur einen Live-Listener für die angezeigte Seite, ohne vorgeschaltete
vollständige Ergebnisabfrage. Filter und Event-Metadaten verwenden die Verbindung
weiter, ausgeblendete Tabs pausieren sie. Speichern/Löschen erzeugt keine zweite
Ergebnisabfrage. Teilnehmer werden dort erst beim Bearbeiten geladen.

Ein vollständiger PDF-Export sowie das Löschen eines Events durchlaufen weiterhin
alle Ergebnisse, jeweils in begrenzten Abfragen. Tests mit 123 Ergebnissen prüfen
das vollständige Nachladen; Emulator-Tests prüfen Limit und Rollenrechte. Die
späteren ursprünglichen Fundstellen sind damit für diese beiden Timer-Lesewege
historisch. Details: [Architektur](architecture.md#begrenzte-event--und-ergebnisabfragen).
Spark wurde inzwischen vom Nutzer bestätigt. App Check bleibt zurückgestellt;
die Begrenzung ist kein Rate-Limit und verhindert keine wiederholten Angriffsabfragen.

### Einordnung der ursprünglichen Prüfung

- 37 % des üblichen kostenlosen Firestore-Lesekontingents entsprechen ungefähr
  18.500 Dokumentlesevorgängen. Die 50.000 Reads gelten **pro Tag**; sie sind
  kein monatlicher Vorrat. Der Reset erfolgt ungefähr um Mitternacht Pacific Time.
- Eine Abfrage zählt nicht pauschal als ein Read: 200 gelieferte Dokumente
  bedeuten grundsätzlich 200 Dokumentreads, zuzüglich gegebenenfalls weiterer
  abrechnungsrelevanter Zugriffe. Auch leere Abfragen haben einen Mindestverbrauch.
- Der tatsächliche Tarif und die Verteilung der gestrigen 18.500 Reads wurden
  nicht aus der Firebase-Konsole ausgelesen. Das Repository beweist weder Spark
  noch Blaze. Die unten genannten Browser-Verbrauchswerte sind Rechenbeispiele,
  keine gemessenen Nutzungszahlen.
- Für das Ziel „niemals zahlen“ muss das Projekt im kostenlosen **Spark-Tarif**
  bleiben. Das Verknüpfen eines Cloud-Billing-Kontos führt zu Blaze. Bei Blaze
  begrenzen Budgetwarnungen die Kosten nicht. Optimierter Anwendungscode allein
  garantiert keine Kostenobergrenze.
- Für diese Prüfung wurden keine produktiven Firestore-Dokumente abgefragt und
  keine Synchronisationen gestartet. Gelesen wurden Quellcode und GitHub-Laufprotokolle.

Quellen: [Firestore-Abrechnung](https://firebase.google.com/docs/firestore/pricing),
[Firebase-Tarife und Budgetwarnungen](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## 1. Timer-Import: stärkster vermeidbarer Multiplikator

Fundstellen:

- `timer/firestore-api.js:636`: Jede Importsuche lädt bis zu zehn Suchtreffer
  **und die gesamte Teilnehmerliste des Events** (`listParticipants`, Zeile 646).
- `timer/app.js:1287`: Die Suche startet nach 220 ms Eingabepause. Langsames
  Tippen kann mehrere Abfragen für einen Namen auslösen.
- `timer/firestore-api.js:681`: Auch der eigentliche Import lädt alle bisherigen
  Teilnehmer, um Dubletten zu erkennen.
- `timer/app.js:1305`: Nach jedem Import lädt `renderPeople` die Teilnehmer erneut.
- `timer/firestore-api.js:576`: Der allgemeine Event-Endpunkt lädt die vollständige
  Teilnehmerliste, sofern die Rolle Zugriff hat. Auch Eventübersicht,
  Einstellungen, Timer und Ergebnisansichten nutzen diesen Endpunkt.

Beispiel: Bei 200 vorhandenen Teilnehmern können zehn ausgeführte Suchabfragen
allein ungefähr 2.000 Teilnehmerreads auslösen, zusätzlich zu den Suchtreffern,
Event- und Regelzugriffen.

Werden 100 Personen einzeln in ein zunächst leeres Event importiert, ergeben
die vollständigen Listen vor und nach den Imports rechnerisch bereits ungefähr
10.000 gelesene Teilnehmerdokumente (`0+1+...+99` plus `1+2+...+100`). Die
Importsuche kommt noch hinzu. Das Beispiel setzt erfolgreiche Serverabfragen
ohne Einsparungen durch Wiederverwendung voraus.

Empfehlung: Event-Metadaten und Teilnehmer getrennt laden; die bereits geladene
Teilnehmerliste innerhalb einer Ansicht wiederverwenden und nach Änderungen
gezielt aktualisieren. Eine eindeutige Importzuordnung muss auch gleichzeitige
Imports sicher verhindern; das Entfernen der Dublettenprüfung wäre keine Lösung.

## 2. Timer-Ergebnisse: vollständige Listen bei Ansichtswechseln

- `timer/app.js:2749`: Zuerst werden alle Ergebnisse einmalig geladen.
- `timer/app.js:2751`: Anschließend wird zusätzlich der Live-Listener gestartet.
- `timer/firestore-api.js:446`: Der Listener umfasst alle Ergebnisse des Events.
- `timer/app.js:2369`: Die Auswahl von Disziplin/Geschlecht ändert die Route.
  `renderRoute` beendet den Listener und baut die Ergebnisansicht erneut auf,
  einschließlich des vollständigen initialen Ladeablaufs.
- `timer/firestore-api.js:433`: Bei jedem gelieferten Event-Snapshot wird der
  Ergebnislistener beendet und neu angelegt, auch bei unveränderten Leserechten.
- `timer/app.js:2587` und `2601`: Nach Bearbeiten/Löschen wird trotz aktivem
  Listener die gesamte Ergebnisliste erneut abgefragt.

Die tatsächlichen zusätzlichen Reads bei aufeinanderfolgenden Gets/Listenern
hängen auch von SDK-Cache und Verbindung ab. Die mehrfachen Ladewege sind
trotzdem vermeidbar. Bei vielen Ergebnissen und Zuschauern multipliziert sich
der Aufwand pro Gerät und Seitenbesuch.

Empfehlung: Einen Ergebnislistener pro geöffnetem Event verwenden, darüber auch
die initialen Daten beziehen und Filter ohne erneuten Datenaufbau anwenden.
Event-Metadaten aktualisieren, ohne den Ergebnislistener unnötig neu zu starten.
Live-Updates müssen nicht grundsätzlich abgeschaltet werden: Ein laufender
Listener liest bei Änderungen normalerweise die betroffenen Dokumente und
nicht jedes Mal die gesamte Sammlung.

## 3. Arbeitszeiten: vollständige Historie bei jedem Speichern

- `assets/js/worktime-store.js:46`: Jedes Anlegen oder Bearbeiten eines Eintrags
  liest sämtliche `worktimeEntries` des Kontos sowie das Reservierungsdokument.
  Das gilt nicht für den reinen Löschpfad.
- Das passiert auch dann, wenn die Altbestände bereits im Reservierungsindex
  `worktimeSchedule/intervals` registriert sind. Fehlende Einträge führen zu
  zusätzlichen Migrationstransaktionen.
- `assets/js/worktime.js:259`: Die Statistikabfrage hat nur eine untere Grenze
  für `endedAt`. Bei Betrachtung eines alten Monats werden auch alle später
  endenden Einträge geladen und erst lokal auf den Zeitraum zugeschnitten.

Beispiel: 500 bestehende Einträge und 20 Bearbeitungen bedeuten allein für die
Vollabfragen ungefähr 10.000 Reads; Transaktionen und Regeln kommen hinzu.

Empfehlung: Die Registrierung alter Einträge als abgeschlossene Migration
behandeln und im normalen Schreibpfad den transaktionssicheren Reservierungsindex
verwenden. Das muss mit dem Schutz vor Überschneidungen und den Regeln zusammen
geändert werden. Statistikabfragen separat auf große historische Bestände prüfen.

## 4. Verwaltung und neue Club-Ansichten

- `assets/js/auth.js:1866`: Die Kontenverwaltung liest alle `users` serverseitig,
  ohne Seitengröße. Mehrere Verknüpfungs-/Antragsaktionen laden danach erneut
  die vollständige Kontenliste. Die Texteingabe in der Kontensuche filtert dagegen
  lokal und erzeugt dort keine zusätzliche Nutzer-Vollabfrage.
- `assets/js/clubs.js:410`: Die Gliederungsverwaltung liest bei jedem Start alle
  Konten, alle Clubprofile und das Gliederungsverzeichnis. Danach werden alle
  Clubs gelesen; anschließend starten nochmals Listener für Clubprofile und Clubs.
- `assets/js/clubs.js:429`: Ist `clubDirectory` leer, wird als Ersatz das komplette
  `timerParticipantDirectory` geladen. Beim zuletzt bestätigten Sync waren das
  979 Personen. Der Ersatzweg wird bei einem erneuten Seitenbesuch wieder ausgeführt,
  solange das Gliederungsverzeichnis leer bleibt.
- `assets/js/clubs.js:163` und `194`: Die Club-Verwaltung hört auf den vollständigen
  Clubkader und zusätzlich auf ein Profil pro verknüpftem Konto.

Die Club-Funktionen kamen laut Git-Historie erst am **12. November** hinzu und
erklären daher nicht den Verbrauch vom 11. November. Sie sind ein zusätzlicher
Verbrauchsfaktor für die weitere Nutzung. Der aktuelle Sync befüllt `clubDirectory`;
der gestern gelaufene ältere Sync tat dies noch nicht.

Empfehlung: Verwaltungslisten begrenzen bzw. bei Bedarf laden; einzelne Änderungen
gezielt übernehmen; Migrationen und Verzeichnisaufbau vom normalen Seitenstart
trennen. Die Club-Verwaltung lädt bereits nur den ausgewählten Kader und räumt
Profil-Listener beim Clubwechsel auf.

## 5. Wöchentlicher Personenabgleich: gestern nachgewiesen

Der [GitHub-Lauf vom 11. November](https://github.com/jp-gnad/Lifesaving-Baden/actions/runs/43009341694)
war erfolgreich. Das Protokoll meldet gegen 12:08 Uhr deutscher Zeit:
`Wrote 979 unique records.` und `Synchronized 979 participant directory records.`
Der vorherige [Lauf vom 4. November](https://github.com/jp-gnad/Lifesaving-Baden/actions/runs/41818383945)
meldete 977 Datensätze.

`tools/sync_participant_directory.mjs:17` liest zuerst den vollständigen vorhandenen
Personenbestand und schreibt anschließend alle importierten Personen neu,
auch bei unveränderten Daten. Wenn der Bestand seit dem vorherigen Lauf nicht
anderweitig geändert wurde, waren das gestern ungefähr **977 Reads**, also
**1,95 %** des täglichen 50.000er-Kontingents. Die 979 geschriebenen Personen
belasten separat das Schreibkontingent. Der aktuelle Code liest/schreibt zusätzlich
`clubDirectory`.

Damit ist der Sync ein belegbarer regelmäßiger Verbraucher, aber keine ausreichende
Erklärung für 37 % Reads. Empfehlung: Unveränderte Quelldaten vor Datenbankzugriffen
erkennen und unveränderte Dokumente nicht neu schreiben. Nur weniger Dokumente
zu schreiben beseitigt die vorherige vollständige Leseabfrage noch nicht.

## Weitere Einordnung

- Sicherheitsregeln lesen Rollen, Eventrechte und Clubzuordnungen über
  `get`, `exists` und `getAfter`. Diese können zusätzliche Reads verursachen,
  auch bei abgelehnten Anfragen. Derselbe abhängige Dokumentpfad wird innerhalb
  einer Anfrage nicht für jede Erwähnung erneut berechnet. Es wäre falsch,
  pauschal einen zusätzlichen Rollenread pro zurückgegebenem Dokument anzusetzen.
- `assets/js/auth-core.js:101` lädt das eigene Rollenprofil bei Seiteninitialisierung
  bewusst vom Server. Das ist ein kleiner Einzelzugriff, kein guter erster
  Ansatzpunkt für eine Ersparnis von vielen Tausend Reads. Rollen dürfen nicht
  durch unzuverlässiges Langzeit-Caching veralten.
- Der Admin-Badge verwendet bereits zwei Zählabfragen statt kompletter Nutzerlisten.
  Sichtbarwerden der Seite löst sie erneut aus; eine kurze Wiederverwendung ist
  möglich, die größeren Vollabfragen haben aber Vorrang.
- Die 30-Sekunden-Uhr der Club-/früheren Startberechtigungsansicht prüft lokal den
  Tageswechsel. Die Sekundenanzeige der Ergebnisansicht aktualisiert lokal den
  Button. Beides ist kein Firestore-Polling. Das 60-Sekunden-Ergebnispolling ist
  nur ein Ersatzpfad, wenn die Listener-API fehlt.
- Ein Service-Worker-Cache für HTML/JavaScript spart nicht automatisch
  Firestore-Dokumentreads. Die Timer-App aktiviert einen separaten Firestore-
  Offlinespeicher; normale Online-Gets bleiben dadurch nicht generell kostenlos.
- Die Regeltests verwenden Emulatoren und Demo-Projektkennungen; ihre lokalen
  Datenzugriffe verbrauchen das Produktionskontingent nicht.

## Reihenfolge für die Optimierung

1. Teilnehmer-Vollabfragen bei Timer-Suche, Einzelimporten und Navigation beseitigen.
2. Ergebnisdaten pro Event einmal beziehen und Listener beim Filtern erhalten.
3. Vollständige Arbeitszeithistorie aus dem normalen Speichervorgang entfernen,
   einschließlich einer sicheren Migrationsstrategie und passender Regeltests.
4. Verwaltungslisten und Club-Initialisierung begrenzen; Verzeichnis-Ersatzscan vermeiden.
5. Sync bei unveränderter Quelle überspringen und nur Änderungen schreiben.

Welche dieser Stellen gestern den größten Anteil hatte, lässt sich ohne die
Firestore-Nutzungsdaten und den tatsächlichen Bedienablauf nicht rückwirkend
belegen. Insbesondere darf der neue Club-Code nicht dem gestrigen Verbrauch
zugerechnet werden.
