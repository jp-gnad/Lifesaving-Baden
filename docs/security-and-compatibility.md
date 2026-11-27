# Sicherheit und Kompatibilität

## Autorisierung

Die Web-Admin-Datenbank erlaubt einem verifizierten Admin den gezielten
Dokumentzugriff in den fünf Statistik-Collections. Rollen und begonnene
Kontolöschungen werden von den Firestore-Regeln geprüft. Die Übersicht und die
Strukturansicht verwenden begrenzte Listenabfragen mit höchstens 50 Dokumenten
pro Abfrage. Löschvorgänge im Archiv sind für Browserclients gesperrt.
Ergebnis-Updates bewahren Sportler-, Wettkampf- und Phasenidentität sowie
eventuell vorhandene Altspalten. Die Excel-Datei bleibt beim Browser.

Die Kontovorschau (`lifesaving-baden:account-avatar:v1` im Sitzungsspeicher)
enthält nur UID, Bildadresse, begrenzte Bilddaten, Initialen, den bestätigten
Anzeigenamen und Cache-Metadaten. Vor Wiederherstellung der Anmeldung zeigt sie
das letzte Kontobild und die Begrüßung im Mitgliederbereich. Sie bestätigt keine
Sitzung und enthält weder Rollen noch Tokens oder Formularwerte. Die aktuelle
Firebase-Sitzung bleibt maßgeblich. Kontowechsel und Abmeldung entfernen die
Vorschau, verspätete Antworten des früheren Kontos werden verworfen.

`lifesaving-baden:account-indicators:v1` enthält nur die UID und Anzeigewerte
für Verknüpfung und Hinweise. Die Admin-Summen werden ausschließlich nach
bestätigter Rolle abgefragt. Die Vorschau startet keine Abfragen und gibt
keine Rollen, Formulardaten oder Zugriffsrechte frei.

- Alle statischen HTML-Dateien sind grundsätzlich öffentlich abrufbar. Eine
  Weiterleitung zur Anmeldung schützt die Oberfläche, nicht die Datenbank.
- Firestore-Regeln entscheiden über Datenzugriff. Das Ausblenden von Links,
  gespeicherte Profildaten und Rollenprüfungen im Browser ersetzen diese Regeln nicht.
- `auth-core.js` lädt Rollen aus Konto und Claims. Rollenaliasnamen sind absichtlich
  unterstützt; das normale Konten-UI vergibt keine Adminrolle.
- `member-view-cache.js` speichert ausschließlich eine kontobezogene Vorschau für
  die Mitgliederübersicht, höchstens 30 Minuten lang. Ihre Rolle steuert nur die
  Darstellung von Navigationslinks. Berechtigungsprüfungen, Admin-Abfragen,
  Fachmodule und Formulare verwenden weiterhin die frisch geladenen Daten.
  Ein manipulierter Sitzungscache vergibt keine serverseitigen Rechte.
- Neue E-Mail-Registrierungen legen vor dem Absenden des Namens kein Firebase-Konto
  an. Der Passwortentwurf bleibt nur im Arbeitsspeicher und wird beim Verlassen
  verworfen. Bereits angelegte Konten bleiben auch ohne bestätigte E-Mail
  passwortgeschützt; ein fehlgeschlagener Login erlaubt weder Überschreiben noch
  Löschen oder Zurücksetzen ohne den vorgesehenen E-Mail-Rücksetzlink.
- Die bestehenden Regeln unterscheiden Eigentümer, Sportler, Trainer,
  Organisatoren und Admins sowie die getrennten Eventrechte. Beim Refactoring
  keine dieser Grenzen vereinfachen oder durch ein allgemeines `allow read/write` ersetzen.
- Teilnehmer-/Personenlink-/Club-/Arbeitszeit-Reservierungen müssen gemeinsam mit
  den zugehörigen Datensätzen atomar geändert werden. Parallelzugriffe sind Teil
  des unterstützten Verhaltens und werden mit Emulator-Tests geprüft.

Beim Abgleich eines Clubprofils liefert die verknüpfte Verzeichnis-Person das
Geburtsjahr. Ein optionales Konto-`birthDate` wird nur als ISO-Text ausgewertet;
ältere Nullwerte oder andere Feldtypen dürfen die Admin-Verknüpfung nicht blockieren.
Ohne Verknüpfung ergeben solche Werte wie im Browserprofil kein Geburtsjahr.
Die korrigierten Regeln müssen veröffentlicht werden; eine Datenmigration ist nicht nötig.

Eine letzte Clubverantwortung darf nur bei begonnener Kontolöschung entfallen.
Der unveränderliche Kontomarker `accountDeletionStartedAt` entzieht die bisherigen
Rollenrechte und ist kein austauschbarer Austrittsparameter. Danach erlauben die
Regeln nur die eigene Clubbereinigung und die abschließende Kontolöschung;
gewöhnliche Austritte und Rollenwechsel behalten die Ersatzpflicht. Ein Club ohne
Verantwortliche muss `needsResponsible: true` tragen. Das Kennzeichen kann nicht
unabhängig von der Verantwortlichenliste geändert werden. Die verknüpfte
DB-Person, Aktivjahre und clubbezogene Nachweise bleiben bei der Kontolöschung
erhalten. Der Admin-Zähler verwendet nur die gefilterte Menge offener Clubmeldungen.

Normales Entziehen einer Verantwortung setzt keinen Kontolöschmarker. Ein
vorhandener Marker sperrt auch Admin-Verknüpfungen und erneute Verantwortungszuweisungen,
selbst wenn der Auth-Nutzer noch besteht. Für eine nachweislich falsche Vormerkung
ist eine gezielte Datenkorrektur außerhalb der Browserregeln nötig, ausschließlich
am betroffenen Kontodokument. Den Marker nicht beim Zuweisen automatisch entfernen
und echte Löschabläufe nicht durch eine allgemeine Rücknahmeberechtigung aufheben.
Die konkrete Console-Reparatur steht im [README](../README.md).

## Nicht vertrauenswürdige Eingaben

`adminReviewPending` kennzeichnet neue Kontoprofile. Bei der Anlage darf ein
Eigentümer ausschließlich `true` setzen; für alte Clients bleibt das fehlende Feld
zulässig. Eigentümer dürfen den Marker anschließend weder ändern noch entfernen.
Admins dürfen ausschließlich von `true` auf `false` quittieren, auch bei einem
Admin-Kontoprofil. Verknüpfungsreservierungen bleiben dabei atomar geschützt.
Es gibt keine rückwirkende Kennzeichnung bestehender Konten und keinen separaten
Auth-Trigger: Die Meldung entsteht beim Anlegen des Website-Profils, nicht bei
reinen Firebase-Auth-Konten ohne Profildokument. Geänderte Regeln gemeinsam mit
den neuen Browserdateien veröffentlichen; alte Marker bleiben unverändert gültig.

Namen, Dokument-IDs, externe Links und bereits vorhandene Firestore-Daten sind
beim Rendern als Eingaben zu behandeln. DOM-Text über `textContent` setzen;
Templatewerte einschließlich Attributwerten escapen. Dokument-IDs in URLs
als Pfadsegment codieren und im Adapter kontrolliert decodieren. Externe
Ergebnislinks auf HTTP/HTTPS begrenzen. Keine Zugangsdaten oder Tokens loggen.

Die öffentliche `firebase-config.js` enthält Web-Konfiguration und eine öffentliche
OAuth-Client-ID. Der private Service-Account gehört ausschließlich in die
Umgebungsvariable `FIREBASE_SERVICE_ACCOUNT_JSON` der Wartung/CI. Wartungsskripte
weisen andere Projekt-IDs ab und geben fehlerhafte Credential-JSON nicht aus.

## Bewusst erhaltene Altpfade

| Vertrag | Warum er erhalten bleibt |
|---|---|
| `startberechtigungen.html` | Bestehende Links führen zur Clubverwaltung weiter. |
| `timer/login.html` | Alte Timer-Logins wechseln zur gemeinsamen Anmeldung. |
| `link-request.html`, alte `accountSetupRequired`-Marker | Der alte Link führt zu den Einstellungen; alte Marker erzwingen keine Kontoeinrichtung mehr. |
| `timer/manifest.webmanifest`, alte Timer-Icons | Bereits installierte Timer besitzen diese Identität/URLs. |
| Alte Rollenaliasnamen | Vorhandene Konten/Claims können diese noch verwenden. |
| Personenlink-Bereinigung und explizite Wartungs-CLIs | Alte Kontodaten benötigen kontrollierte Übernahme statt blindem Löschen. |
| `participantIndexVersion` und Reservierungslisten | Bestehende/manuell angelegte Teilnehmer und alte Dubletten müssen ohne Änderung der IDs übernommen werden. |
| Arbeitszeit-Migration und Reservierungen | Alte Einträge müssen vor neuem Speichern auf Überschneidungen geprüft werden. |
| `firebase-hosting/404.html` und Hosting-Konfiguration | Das frühere Firebase-Hosting soll weiter stillgelegt bleiben; die Website wird über GitHub Pages veröffentlicht. |

Nicht verwendete JavaScript-Funktionen dürfen nach Prüfung aller Aufrufer entfernt
werden. Fehlende aktuelle HTML-Verweise allein beweisen bei öffentlichen URLs,
Manifesten, Datenfeldern und Speicherformaten keine Entbehrlichkeit.

## Offline-Daten

Die IndexedDB-Datenbank heißt `lifesaving-timer-offline`, hat Version `1` und
enthält `pendingResults` mit `clientSubmissionId` als Schlüssel. Diese Namen sowie
die Submission-ID im Ergebnis sind dauerhaftes Datenformat. Ein nicht übertragenes
Ergebnis kann ausschließlich in diesem Speicher liegen.

- Beim Umbau keine Datenbank löschen, umbenennen oder pauschal leeren.
- Schreibvorgänge erst nach dem `complete` der IndexedDB-Transaktion bestätigen.
- Bei fehlgeschlagener Übertragung die vorgemerkten Daten für einen erneuten
  Versuch behalten. Auf Serverseite dieselbe Submission-ID wiederverwenden.
- Firestore-Offlinespeicher und Service-Worker-Dateicache separat betrachten.
- Neue Skriptversionen müssen sowohl im HTML als auch im Precache stehen.
- Neue Einträge dürfen zusätzlich `operation` (Pfad/Methode) und `accountId`
  tragen. Ohne `operation` bleibt ein Altbestand ein Ergebnis-POST mit seiner
  ursprünglichen Submission-ID. Neue Einträge werden ausschließlich für ihr
  Ursprungskonto übertragen. `clientMutationId` hält Event-/Personenneuanlagen
  bei erneutem Senden eindeutig; Reservierungen bleiben transaktional.
- Ansichtswechsel dürfen Hintergrundschreibvorgänge nicht abbrechen. Dafür
  prüft der Adapter bei `background: true` die Kontositzung einschließlich Rollen
  getrennt vom Lebenszyklus des Teilnehmercaches. Cachewerte autorisieren keine
  Schreibvorgänge.

## Kontingent und Veröffentlichung

Manuell erstellte Personen haben eine eigene ID im Clubkader und leere Verweise
auf Konto und Personenverzeichnis. Die Regeln erlauben die Erstellung in aktiven
Clubs ausschließlich deren berechtigten Team Managern und Admins. Nach der Anlage
sind Aktivjahre und Nachweise editierbar. Die neuen Regeln zuerst veröffentlichen,
damit die Website diese Einträge speichern kann.

Teilnehmerbeiträge liegen unter `clubs/{clubId}/finance/{year}`. Berechtigte
Team Manager und Admins eines aktiven Clubs dürfen das Jahresdokument lesen.
Pro Schreibvorgang prüfen die Regeln genau eine aktive Person und einen
ganzzahligen Eurocent-Betrag. Die Bearbeitung ist für das laufende und das
folgende Jahr freigegeben. Beim ausdrücklichen Löschen einer Gliederung werden
ihre Finanzdokumente vollständig entfernt.
Für die Finanzansicht müssen die neuen Firestore-Regeln vor der Website-Version
veröffentlicht werden.

Die Club-Eventplanung speichert unter `clubs/{clubId}/events/{eventId}` und nutzt
keine Timer-Events. Zugriff erhalten ausschließlich die bisherigen berechtigten
Clubverantwortlichen und Admins. Bei Wettkämpfen prüfen die Regeln aktive Personen
des Eventjahrs bei der Übernahme und erzwingen die atomare Zuordnung zu höchstens einer
Mannschaft mit 4–5 Personen. Einzelstarts sind davon unabhängig. Eine Person darf
nur mit bestehender Mannschaft aus Einzel entfernt werden; das spätere Entfernen
der Mannschaft stellt den Einzelstart ausdrücklich nicht automatisch wieder her.
Nachträglich inaktive Personen bleiben als Event-Snapshot erhalten. Beim
Entfernen aus dem Clubkader markiert der Store zuerst die Mitgliedschaft. Die
Regeln sperren dadurch weitere Aufnahmen und erlauben das Entfernen aus den ab
diesem Kalendertag geplanten Terminen samt Korrektur der Mannschaftszuordnung.
Die ursprüngliche Erstellungszeit schützt eine neu angelegte Mitgliedschaft
unter derselben ID. Vergangene Termine behalten ihre Snapshots. Wenn die
Übertragung unterbrochen wird, kann der Clubverantwortliche das Entfernen mit
dem ursprünglichen Stichtag erneut versuchen.
Training und Organisation dürfen auch inaktive Kaderpersonen übernehmen. Die
Regeln überprüfen die Identität jeder Person aus dem aktuellen Clubkader und
prüfen bei beiden Terminarten die Start- und Endzeit. Die Terminart ist nach dem
Anlegen fest. Bestehende Termine ohne Eintrag zur Terminart gelten als Wettkämpfe.
Die Trainingsvorauswahl wird einmal in einem temporären Entwurf gegen den
Clubkader geprüft. Eine Transaktion übernimmt die geprüften Personen in alle
Termine und entfernt den Entwurf. Die Firestore-Regeln verlangen diesen
gemeinsamen Schreibvorgang. Die aktualisierten Regeln müssen vor der Website
mit der Trainingsvorauswahl veröffentlicht werden.
Automatische Einladungen sind für Training und Organisation verfügbar. Das
optionale Feld `invitationMode` beschreibt, welche Kaderpersonen in geplante
Termine aufgenommen werden. Ältere Termine ohne Modus verwenden die manuelle
Auswahl. Die Automatik fragt geplante Termine über einen kombinierten Index
für `invitationMode` und `date` ab und nutzt die bestehenden Identitätsregeln
für Teilnehmersnapshots. Vor der neuen Website-Version die Firestore-Regeln
und den Index aus `firestore.indexes.json` veröffentlichen und den Indexaufbau
abschließen lassen.
Serienänderungen verwenden die bestehenden Terminrechte. Die Transaktion
gleicht die ursprünglich geladenen Metadaten aller betroffenen Termine ab und
bewahrt parallele Änderungen an Teilnehmenden oder Mannschaften. Die Regeln
erlauben bei wiederkehrenden Trainings eine Verschiebung in ein anderes
bearbeitbares Kalenderjahr auch mit vorhandener Teilnehmendenliste.

Die sofortige Bedienung nutzt eine eigene kontogebundene lokale Warteschlange.
Ihre Darstellung autorisiert keinen Schreibvorgang. Vor jeder Übertragung und nach
asynchronen Lesezugriffen wird das Ursprungskonto geprüft. Teilnehmergruppen mit
höchstens drei Zu- oder Abgängen werden atomar gegen die aktuellen Kaderdokumente
validiert. Veraltete Identitäten werden abgewiesen. Bei Wettkämpfen gilt das auch
für veraltete Aktivmarkierungen.
Alte Einzelaktionen bleiben zulässig. Direkte Mannschaftsaufnahmen können neue
Eventteilnehmer ohne Einzelstart übernehmen; bestehende Einzelstarts lassen sich
weiterhin nur mit Mannschaftszuordnung deaktivieren. Fehlerhafte oder offline
wartende lokale Aufträge werden nicht automatisch gelöscht.

Die neuen Firestore-Regeln müssen vor der Website-Version mit den neuen
Terminarten veröffentlicht werden, damit Training und Organisation gespeichert
werden können. Bestehende Wettkämpfe bleiben kompatibel.
Es sind keine neuen Dienste, kostenpflichtigen Tarife oder Datenmigrationen nötig.
Die Eventliste verlangt ein Abfragelimit von höchstens 50; normale Änderungen lesen
nur das betroffene Event und gegebenenfalls die ausdrücklich ausgewählte Kaderperson.
Das ausdrückliche Löschen einer Gliederung bereinigt ihre Eventseiten vollständig.

Die optionale Ergebnisquelle `timekeeper` enthält nur die Account-ID und das
Namenskürzel zum Zeitpunkt des Stoppens. Bei Neuanlagen muss die ID zum aktuellen
Account gehören; Gäste verwenden eine leere ID und „Unbekannt“. Bearbeitungen
dürfen den Snapshot weder ersetzen noch entfernen oder bei Altbeständen ergänzen.
Die Anzeige nutzt nur das gespeicherte Kürzel, keine erneuten Accountabfragen.
Alte Ergebnisse und vorgemerkte Übertragungen ohne Quelle bleiben gültig und
werden als „Unbekannt“ angezeigt. Für die Quelle zuerst die kompatiblen Regeln,
danach die Timer-Dateien veröffentlichen.

Benannte benutzerdefinierte Ergebnisse tragen optional `customDisciplineId`,
`customDisciplineName` und `customLapCount`. Alte Ergebnisse ohne diese Felder
bleiben gültig. Die Regeln gleichen Namen und Rundenzahl mit einem Katalogeintrag
im selben Event ab und erlauben dafür ausschließlich Einzelergebnisse. Neue
Katalogeinträge entstehen atomar mit einem zugehörigen Ergebnis; bestehende
Einträge dürfen nicht umbenannt oder auf eine andere Rundenzahl geändert werden.
Kataloglisten sind auf höchstens 50 Einträge pro Abfrage begrenzt. Event-Löschen
durchläuft auch diesen Katalog ausdrücklich in Seiten; einzelne Ergebnislöschungen
bewahren die Namen für spätere Messungen auf.
Für diese Namensfunktion zuerst die kompatiblen Firestore-Regeln veröffentlichen,
danach die Timer-Dateien. Ohne die neuen Regeln werden benannte Ergebnisse und
Katalogabfragen abgewiesen; die bisherige unbenannte Speicherung bleibt erlaubt.

Das Projekt soll kostenlos bleiben. Dieser Umbau benötigt keinen neuen Firebase-
Dienst und ändert weder Tarif noch Abrechnung. Codeoptimierung ist keine
serverseitige Kostenbegrenzung; keine Billing-Verknüpfung im Rahmen von Codearbeit anlegen.

Event- und Ergebnislisten verlangen serverseitig `limit(1..50)`. Die Oberfläche
verwendet Seiten mit bis zu 50 Dokumenten. Diese Grenze gilt pro Abfrage, nicht
pro Nutzer oder Zeitraum: Wiederholte Anfragen und einzelne Dokumentzugriffe
können weiterhin Kontingent verbrauchen. Rollen-/Eventrechte sind unverändert
zusätzlich erforderlich; Teilnehmerlisten haben weiterhin ihre bisherigen Regeln.
App Check ist nicht eingerichtet oder aktiviert worden.

Beim Umstieg auf begrenzte Listen zuerst die neue Website veröffentlichen und anschließend die
verschärften Regeln. Alte Browserstände mit unbegrenzten Listen werden danach
abgewiesen und müssen aktualisiert werden. Neue zusammengesetzte Indizes oder
Datenmigrationen sind nicht erforderlich.

Tests laufen ausschließlich mit Mocks oder einem lokalen Demo-Emulator. Ein
Regeldeploy, ein Personen-Sync oder ein Konto-Cleanup gegen `lifesaving-baden`
ist eine echte Produktionsaktion und kein Ersatz für einen Testlauf.

Die Performance-Anpassungen vom 20. November 2026 benötigen weder neue Firestore-Regeln
noch zusätzliche Indizes, Datenmigrationen per CLI oder Dienste. Tarif und Abrechnung
bleiben unberührt. Gebündelte Profillisten werden ausschließlich mit den schon
bestehenden Adminrechten verwendet. Optimistische Anzeigen und vorbereitete
Arbeitszeitsitzungen umgehen keine aktuelle Transaktions- oder Regelprüfung.

Deployment-Anleitung und bestehende Einrichtungsschritte: [README](../README.md).
