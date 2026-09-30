# Lifesaving Baden

Gemeinsame GitHub-Pages-Website für Lifesaving Baden mit Firebase-Login,
Mitgliederbereich und integriertem Lifesaving Timer. Die Dateien werden
vollständig aus diesem Repository veröffentlicht. Firebase Authentication und
Firestore übernehmen Anmeldung, Rollen und Timer-Daten.

Der Timer ist anschließend unter dem Unterpfad `timer/` erreichbar, zum
Beispiel:

```text
https://jp-gnad.github.io/Lifesaving-Baden/timer/
```

## Kann GitHub Pages echte Logins?

Nur eingeschränkt. GitHub Pages liefert ausschließlich statische Dateien
aus: HTML, CSS, JavaScript und Assets. Es gibt dort keine serverseitige
Logik, keine Datenbank und keine sichere Umgebung für geheime Zugangsdaten.

Das bedeutet:

- Ein echtes Benutzerkonto-System braucht einen externen Dienst, zum Beispiel
  Firebase Authentication, Supabase Auth, Auth0, Clerk oder ein eigenes Backend.
- Reiner JavaScript-Schutz auf GitHub Pages kann umgangen werden und schützt
  keine vertraulichen Inhalte wirklich.
- Die enthaltene Login-/Registrierungsfunktion nutzt Firebase Authentication.
  Der Zugriff auf statische HTML-Dateien selbst ist aber weiterhin öffentlich.
  Wirklich private Daten sollten aus Firebase/Supabase/Backend geladen und dort
  per Sicherheitsregeln geschützt werden.

## Struktur

```text
.
|-- index.html
|-- login.html
|-- app.html
|-- account-settings.html
|-- link-request.html
|-- timer/
|   |-- index.html
|   |-- app.js
|   |-- firestore-api.js
|   |-- styles.css
|   `-- sw.js
|-- firestore.rules
|-- firebase.json
|-- firestore.indexes.json
|-- tools/
|   |-- build_participant_directory.py
|   `-- sync_participant_directory.mjs
|-- assets/
|   |-- img/
|   |   |-- auth-pool.jpg
|   |   |-- elch-gelb.png
|   |   |-- hero-swimmer.jpg
|   |   |-- termine-pool.jpg
|   |   |-- lifesaving-baden-logo.png
|   |   `-- training-rescue.jpg
|   |-- css/
|   |   `-- styles.css
|   |-- fonts/
|   |   |-- LT_50139_italien.woff
|   |   |-- LT_50140_heavy.woff
|   |   `-- LT_50141_regular.woff
|   `-- js/
|       |-- auth.js
|       `-- firebase-config.js
`-- .nojekyll
```

## Firebase einrichten

Ja, du musst dich als Admin bei Firebase anmelden. Dafür reicht ein
Google-Konto.

1. `https://console.firebase.google.com/` öffnen.
2. Neues Firebase-Projekt erstellen.
3. Im Projekt unter `Authentication` -> `Get started` die Anbieter aktivieren:
   - `Email/Password`
   - `Google`
4. Unter `Project settings` -> `General` eine Web-App anlegen.
5. Firebase zeigt eine `firebaseConfig` an. Die Werte in
   `assets/js/firebase-config.js` mit diesen Daten ersetzen.
6. Unter `Authentication` -> `Settings` -> `Authorized domains` die spätere
   GitHub-Pages-Domain eintragen, z. B. `deinname.github.io`. Bei einer eigenen
   Domain diese ebenfalls eintragen.
7. Für E-Mail-Bestätigung muss bei `Email/Password` die Registrierung per
   E-Mail erlaubt sein. Nach der Registrierung sendet die Seite automatisch eine
   Bestätigungs-Mail.

Die Firebase-Web-Konfiguration enthält keine geheimen Admin-Schlüssel. Sie
darf in einer statischen Website stehen. Trotzdem sollten in Firebase nur die
Domains freigegeben werden, auf denen die Website wirklich laufen soll.

## Firestore für Nutzereinstellungen

Der Mitgliederbereich legt direkt nach der Kontoerstellung oder beim ersten
Google-Login ein Nutzerdokument in Firestore unter `users/{uid}` an. Dadurch
tauchen neue Konten sofort in Firestore auf, auch wenn noch keine Einstellung
geändert wurde.

Gespeicherte Felder:

- `uid`: Firebase UID des Kontos.
- `email`: aktuelle Konto-E-Mail.
- `firstName`: Vorname des Kontos.
- `lastName`: Nachname des Kontos.
- `displayName`: aktueller Anzeigename.
- `emailVerified`: Status der E-Mail-Bestätigung.
- `providerIds`: verwendete Login-Anbieter, z. B. `password` oder
  `google.com`.
- `keepPersonalDataUntilRevoked`: Standardwert in der Website ist `true`.
- `privateProfile`: Standardwert ist `false`.
- `publicProfile`: Gegenwert zu `privateProfile`, praktisch für spätere
  Profilsuche.
- `createdAt`, `updatedAt`, `lastSignInAt`: technische Zeitstempel.
- `dlrgBranch`: freiwillige DLRG-Gliederung aus den Kontoeinstellungen.
- `birthDate`: freiwilliges Geburtsdatum aus den Kontoeinstellungen.
- `role`: Rolle des Kontos. Neue Konten erhalten automatisch `sportler`.
  Manuell vergebene Werte sind z. B. `organizer`, `organisator` oder `admin`.
- `isAdmin` / `admin`: optionale Admin-Markierung als Boolean.
- `personLinkStatus`: Status des beantragten Personenabgleichs.
- `personLinkRequest`: Antrag mit Vorname, Nachname, Geburtsdatum,
  DLRG-Gliederung, kurzer Identitätsinfo, Konto-E-Mail und Firebase UID.

1. In Firebase `Firestore Database` öffnen.
2. `Create database` wählen.
3. `Production mode` nutzen.
4. Eine Region auswählen, idealerweise eine EU-Region, falls verfügbar.
5. Unter `Rules` diese Regeln veröffentlichen:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(userId) {
      return request.auth != null && request.auth.uid == userId;
    }

    function elevatedRoleFields() {
      return [
        'isOrganizer',
        'organizer',
        'organizerSince',
        'organizerGrantedBy',
        'isAdmin',
        'admin',
        'adminSince',
        'adminGrantedBy'
      ];
    }

    function isSportlerRole() {
      return request.resource.data.keys().hasAll(['role'])
        && request.resource.data.role == 'sportler';
    }

    function roleIsSafeOnCreate() {
      return !request.resource.data.keys().hasAny(['role']) || isSportlerRole();
    }

    function roleUnchangedOrDefaulted() {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role'])
        || (!resource.data.keys().hasAny(['role']) && isSportlerRole());
    }

    function noElevatedRoleFieldsInNewDoc() {
      return !request.resource.data.keys().hasAny(elevatedRoleFields());
    }

    function elevatedRoleFieldsUnchanged() {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(elevatedRoleFields());
    }

    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      allow create: if isOwner(userId)
        && noElevatedRoleFieldsInNewDoc()
        && roleIsSafeOnCreate();
      allow update: if isOwner(userId)
        && elevatedRoleFieldsUnchanged()
        && roleUnchangedOrDefaulted();
    }
  }
}
```

Damit kann jeder eingeloggte Nutzer nur sein eigenes Einstellungsdokument
lesen und ändern. Nutzer dürfen `role: "sportler"` automatisch anlegen, aber
keine höheren Rollen wie `organizer` oder `admin` selbst setzen oder ändern.

## Rollen: Sportler, Organisator, Admin

Die Website kennt aktuell drei Rollen. Neue Konten sind automatisch `Sportler`,
solange in Firestore kein Rollenfeld gesetzt ist. `Organisator` wird manuell
vergeben. `Admin` ist die höchste Rolle und zählt automatisch auch als
Organisator.

Aktuell erkennt die Website Organisatorrechte über eines dieser Merkmale:

- Firestore-Feld `role: "organizer"` oder `role: "organisator"` im Dokument
  `users/{uid}`
- später optional Firebase Auth Custom Claim `organizer: true` oder
  `isOrganizer: true`

Aktuell erkennt die Website Adminrechte über eines dieser Merkmale:

- Firestore-Feld `role: "admin"` im Dokument `users/{uid}`
- Firestore-Feld `isAdmin: true` oder `admin: true` im Dokument `users/{uid}`
- später optional Firebase Auth Custom Claim `admin: true` oder `isAdmin: true`

So vergibst du aktuell eine Rolle:

1. In Firebase `Authentication` öffnen.
2. Das gewünschte Konto in der Nutzerliste anklicken.
3. Die `User UID` kopieren.
4. In `Firestore Database` zur Collection `users` gehen.
5. Das Dokument mit genau dieser UID öffnen oder erstellen.
6. Für Organisator: Feld `role` als String mit Wert `organizer` hinzufügen.
7. Für Admin: Feld `role` als String mit Wert `admin` hinzufügen.
8. Website neu laden oder neu einloggen.

Für echte spätere Admin-Funktionen sind Firebase Auth Custom Claims sicherer.
Diese können nicht direkt von GitHub Pages gesetzt werden, sondern brauchen
Admin SDK, Cloud Functions oder ein kleines Backend.

## Kontoverwaltung

In den Kontoeinstellungen kann ein eingeloggter Nutzer Name und E-Mail-Adresse
ändern. Die Firebase UID bleibt dabei gleich, das Konto geht also nicht
verloren. Bei einer neuen E-Mail-Adresse sendet Firebase eine
Bestätigungs-Mail an die neue Adresse.

Passwörter können mit altem Passwort und zweimal neuem Passwort geändert
werden. Im Login gibt es zusätzlich `Passwort vergessen?`, das eine
Firebase-Mail zum Zurücksetzen des Passworts auslöst.

Ein Google-Konto kann mit dem bestehenden Firebase-Konto verbunden werden. Ein
bereits verbundenes Google-Konto wird nur dann gewechselt, wenn zusätzlich ein
Passwort-Login vorhanden ist, damit der Zugang zum Konto erhalten bleibt.

## Personenverknüpfung beantragen

Im Mitgliederbereich erscheint eine Karte `Person verknüpfen`. Der Button
`Jetzt verknüpfen` führt auf `link-request.html`. Dort kann ein Nutzer die
Verknüpfung seines Kontos mit einer Person aus der späteren Datenbank
beantragen. Der Antrag wird im eigenen Firestore-Dokument unter
`users/{uid}.personLinkRequest` gespeichert.
Geburtsdatum und DLRG-Gliederung aus dem Antrag werden zusätzlich als
`users/{uid}.birthDate` und `users/{uid}.dlrgBranch` in die Profil- und
Mitgliedsdaten übernommen.

Solange ein Konto noch nicht verknüpft ist, zeigt der Mitgliederbereich eine
dezente Erinnerung `Kontokonfiguration offen` und ein Ausrufezeichen am
Profilkreis. Nach einem Antrag wechselt der Hinweis zu `Antrag in Prüfung`.
Als verknüpft gilt ein Konto, wenn adminseitig eines dieser Felder gesetzt ist:

- `personLinkStatus: "linked"`
- `personLinked: true`
- `linkedPersonId`
- `personId`

Zusätzlich öffnet die Website eine vorbereitete E-Mail an `jpg.gnad@web.de`.
Da GitHub Pages nur statische Dateien ausliefert, kann die Website diese E-Mail
nicht im Hintergrund selbst versenden. Der Nutzer muss den geöffneten
E-Mail-Entwurf absenden.

Die echte Zuordnung zu einer Person sollte später nur adminseitig erfolgen,
nicht über ein Feld, das der Nutzer selbst schreiben darf.

## Lokal testen

Firebase Auth sollte über einen lokalen Server oder GitHub Pages getestet
werden:

```powershell
python -m http.server 8080
```

Danach ist die Seite unter `http://localhost:8080` erreichbar.

## GitHub Pages aktivieren

1. Repository zu GitHub pushen.
2. In GitHub: `Settings` -> `Pages`.
3. Als Source den Branch `main` und den Ordner `/root` auswählen.
4. Speichern. GitHub zeigt danach die öffentliche URL an.

## Integrierter Lifesaving Timer

Der Timer verwendet keine eigene Cloudflare-Datenbank mehr. Events, Personen
und Ergebnisse liegen in diesen Firestore-Collections:

```text
timerEvents/{eventId}
timerEvents/{eventId}/participants/{participantId}
timerEvents/{eventId}/results/{resultId}
timerParticipantDirectory/{candidateId}
```

Die Eventübersicht und direkte Eventlinks sind öffentlich erreichbar. Welche
Funktionen innerhalb eines Events nutzbar sind, legt ein Organisator in den
Event-Einstellungen fest:

- nur Organisatoren,
- alle angemeldeten und bestätigten Nutzer,
- alle, auch ohne Anmeldung.

Diese Auswahl gibt es getrennt für Timer, Ergebnisanzeige,
Ergebniskorrekturen, Personenanzeige und Personenbearbeitung. Eventerstellung,
Eventeinstellungen und Eventlöschung bleiben immer Organisatoren und dem Admin
vorbehalten. Ein öffentlicher Timerzugriff schließt die zum Stoppen benötigte
Personenanzeige technisch mit ein.

Der Timer zeigt in der Kopfzeile immer den aktuellen Account beziehungsweise
für Gäste einen Login-Link. Auch in der kompakten Stoppuhransicht bleibt ein
Account-Trigger sichtbar. Ergebnisansichten verwenden Firestore-Live-Listener;
neue, bearbeitete oder gelöschte Ergebnisse erscheinen dadurch ohne manuelles
Neuladen auf anderen Geräten.

Die Oberfläche blendet gesperrte Funktionen aus. Entscheidend sind aber die
Regeln in `firestore.rules`: Sie prüfen jede Firestore-Anfrage unabhängig von
der Oberfläche.

## Firestore-Regeln veröffentlichen

Nach Änderungen an `firestore.rules` müssen die Regeln einmal in das bereits
verwendete Firebase-Projekt `lifesaving-baden` veröffentlicht werden. Das ist
mit dem kostenlosen Firebase-Tarif möglich:

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project lifesaving-baden
```

Alternativ kann der Inhalt von `firestore.rules` in der Firebase Console unter
`Firestore Database -> Rules` eingefügt und veröffentlicht werden. Solange die
neuen Regeln noch nicht veröffentlicht sind, zeigt der Timer bei Firestore-
Zugriffen erwartungsgemäß eine fehlende Berechtigung an.

## Admin- und Organisatorrollen

Die Adminrolle kann weiterhin nicht über die Website vergeben werden. Das
Admin-Konto wird ausschließlich direkt in Firebase gepflegt. Ein Admin kann in
der Website andere Konten zu Organisatoren, Kader-Sportlern oder Sportlern
machen, aber keinen weiteren Admin anlegen. Normale Konten können ihre eigenen
Rollenfelder weder setzen noch verändern.

Organisatoren dürfen alle Timer-Events verwalten. Die Firestore-Regeln prüfen
die Rolle direkt im geschützten Dokument `users/{uid}`; ein im Browser
veränderter Text, versteckter Button oder URL-Parameter vergibt keine Rechte.

## Automatische Personenliste

Der Workflow `.github/workflows/sync-participant-directory.yml` aktualisiert
die importierbare Timer-Personenliste wöchentlich. Dafür werden zwei GitHub-
Repository-Secrets benötigt:

- `PARTICIPANT_SOURCE_URL`: URL der XLSX-Quelldatei.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: vollständiges JSON eines ausschließlich
  hierfür verwendeten Firebase-Servicekontos.

Die globale Importliste ist nur für Organisatoren lesbar. Bereits in ein Event
übernommene Personen richten sich nach den Zugriffsrechten des Events.
Wenn die beiden Secrets noch fehlen oder der Workflow noch nicht erfolgreich
gelaufen ist, meldet der Import ausdrücklich, dass die geschützte Importliste
noch nicht eingerichtet ist.

## Umstieg vom früheren Timer-Repository

Das alte Cloudflare-D1-Datenmodell wird nicht automatisch nach Firestore
übernommen. Vor dem Löschen des Repositorys `Lifesaving-Timer` müssen eventuell
vorhandene produktive Events und Ergebnisse exportiert und importiert werden.
Das alte Repository sollte deshalb erst entfernt werden, nachdem der neue
Timer veröffentlicht, getestet und eine benötigte Datenübernahme abgeschlossen
ist.

## Hinweis zu geschützten Inhalten

Der Mitgliederbereich prüft den Firebase-Login und die E-Mail-Bestätigung.
Da GitHub Pages aber statisch ist, dürfen vertrauliche Dokumente nicht einfach
als Dateien im Repository liegen. Für private Inhalte braucht es eine
geschützte Datenquelle, z. B. Firebase Firestore/Storage mit Security Rules.
