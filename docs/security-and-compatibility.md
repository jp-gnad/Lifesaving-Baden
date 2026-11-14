# Sicherheit und Kompatibilität

## Autorisierung

- Alle statischen HTML-Dateien sind grundsätzlich öffentlich abrufbar. Eine
  Weiterleitung zur Anmeldung schützt die Oberfläche, nicht die Datenbank.
- Firestore-Regeln entscheiden über Datenzugriff. Das Ausblenden von Links,
  gespeicherte Profildaten und Rollenprüfungen im Browser ersetzen diese Regeln nicht.
- `auth-core.js` lädt Rollen aus Konto und Claims. Rollenaliasnamen sind absichtlich
  unterstützt; das normale Konten-UI vergibt keine Adminrolle.
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

Eine letzte Clubverantwortung darf nur bei begonnener Kontolöschung entfallen.
Der unveränderliche Kontomarker `accountDeletionStartedAt` entzieht die bisherigen
Rollenrechte und ist kein austauschbarer Austrittsparameter. Danach erlauben die
Regeln nur die eigene Clubbereinigung und die abschließende Kontolöschung;
gewöhnliche Austritte und Rollenwechsel behalten die Ersatzpflicht. Ein Club ohne
Verantwortliche muss `needsResponsible: true` tragen. Das Kennzeichen kann nicht
unabhängig von der Verantwortlichenliste geändert werden. Die verknüpfte
DB-Person, Aktivjahre und clubbezogene Nachweise bleiben bei der Kontolöschung
erhalten. Der Admin-Zähler verwendet nur die gefilterte Menge offener Clubmeldungen.

## Nicht vertrauenswürdige Eingaben

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

Das Projekt soll kostenlos bleiben. Dieser Umbau benötigt keinen neuen Firebase-
Dienst und ändert weder Tarif noch Abrechnung. Codeoptimierung ist keine
serverseitige Kostenbegrenzung; keine Billing-Verknüpfung im Rahmen von Codearbeit anlegen.

Event- und Ergebnislisten verlangen serverseitig `limit(1..50)`. Die Oberfläche
verwendet Seiten mit bis zu 50 Dokumenten. Diese Grenze gilt pro Abfrage, nicht
pro Nutzer oder Zeitraum: Wiederholte Anfragen und einzelne Dokumentzugriffe
können weiterhin Kontingent verbrauchen. Rollen-/Eventrechte sind unverändert
zusätzlich erforderlich; Teilnehmerlisten haben weiterhin ihre bisherigen Regeln.
App Check ist nicht eingerichtet oder aktiviert worden.

Für diesen Umstieg zuerst die neue Website veröffentlichen und anschließend die
verschärften Regeln. Alte Browserstände mit unbegrenzten Listen werden danach
abgewiesen und müssen aktualisiert werden. Neue zusammengesetzte Indizes oder
Datenmigrationen sind nicht erforderlich.

Tests laufen ausschließlich mit Mocks oder einem lokalen Demo-Emulator. Ein
Regeldeploy, ein Personen-Sync oder ein Konto-Cleanup gegen `lifesaving-baden`
ist eine echte Produktionsaktion und kein Ersatz für einen Testlauf.

Deployment-Anleitung und bestehende Einrichtungsschritte: [README](../README.md).
