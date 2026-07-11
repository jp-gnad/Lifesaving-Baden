# Lifesaving Baden

Statisches Grundgerüst für eine GitHub-Pages-Website mit Startseite,
Firebase-Registrierung/Login und einem geschützten Bereich.

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
|-- assets/
|   |-- css/
|   |   `-- styles.css
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

Der Mitgliederbereich speichert die Datenschutz-Einstellung pro Nutzer in
Firestore unter `users/{uid}`.

Gespeicherte Felder:

- `keepPersonalDataUntilRevoked`: Standardwert in der Website ist `true`.
- `privateProfile`: Standardwert ist `false`.
- `publicProfile`: Gegenwert zu `privateProfile`, praktisch für spätere
  Profilsuche.
- `personLinkStatus`: Status des beantragten Personenabgleichs.
- `personLinkRequest`: Antrag mit Vorname, Nachname, Geburtsdatum,
  DLRG-Gliederung, erstem/letztem Wettkampf, Konto-E-Mail und Firebase UID.

1. In Firebase `Firestore Database` öffnen.
2. `Create database` wählen.
3. `Production mode` nutzen.
4. Eine Region auswählen, idealerweise eine EU-Region, falls verfügbar.
5. Unter `Rules` diese Regeln veröffentlichen:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, create, update, delete: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

Damit kann jeder eingeloggte Nutzer nur sein eigenes Einstellungsdokument
lesen und ändern.

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

## Hinweis zu geschützten Inhalten

Der Mitgliederbereich prüft den Firebase-Login und die E-Mail-Bestätigung.
Da GitHub Pages aber statisch ist, dürfen vertrauliche Dokumente nicht einfach
als Dateien im Repository liegen. Für private Inhalte braucht es eine
geschützte Datenquelle, z. B. Firebase Firestore/Storage mit Security Rules.
