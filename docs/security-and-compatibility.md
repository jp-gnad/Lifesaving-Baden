# Sicherheit und Kompatibilität

## Autorisierung

- Alle statischen HTML-Dateien sind grundsätzlich öffentlich abrufbar. Eine
  Weiterleitung zur Anmeldung schützt die Oberfläche, nicht die Datenbank.
- Firestore-Regeln entscheiden über Datenzugriff. Das Ausblenden von Links,
  gespeicherte Profildaten und Rollenprüfungen im Browser ersetzen diese Regeln nicht.
- `auth-core.js` lädt Rollen aus Konto und Claims. Rollenaliasnamen sind absichtlich
  unterstützt; das normale Konten-UI vergibt keine Adminrolle.
- Die bestehenden Regeln unterscheiden Eigentümer, Sportler, Trainer,
  Organisatoren und Admins sowie die getrennten Eventrechte. Beim Refactoring
  keine dieser Grenzen vereinfachen oder durch ein allgemeines `allow read/write` ersetzen.
- Teilnehmer-/Personenlink-/Club-/Arbeitszeit-Reservierungen müssen gemeinsam mit
  den zugehörigen Datensätzen atomar geändert werden. Parallelzugriffe sind Teil
  des unterstützten Verhaltens und werden mit Emulator-Tests geprüft.

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

## Kontingent und Veröffentlichung

Das Projekt soll kostenlos bleiben. Dieser Umbau benötigt keinen neuen Firebase-
Dienst und ändert weder Tarif noch Abrechnung. Codeoptimierung ist keine
serverseitige Kostenbegrenzung; keine Billing-Verknüpfung im Rahmen von Codearbeit anlegen.

Tests laufen ausschließlich mit Mocks oder einem lokalen Demo-Emulator. Ein
Regeldeploy, ein Personen-Sync oder ein Konto-Cleanup gegen `lifesaving-baden`
ist eine echte Produktionsaktion und kein Ersatz für einen Testlauf.

Deployment-Anleitung und bestehende Einrichtungsschritte: [README](../README.md).
