# Lifesaving Baden

Statisches Grundgeruest fuer eine GitHub-Pages-Website mit Startseite,
Firebase-Registrierung/Login und einem geschuetzten Bereich.

## Kann GitHub Pages echte Logins?

Nur eingeschraenkt. GitHub Pages liefert ausschliesslich statische Dateien
aus: HTML, CSS, JavaScript und Assets. Es gibt dort keine serverseitige
Logik, keine Datenbank und keine sichere Umgebung fuer geheime Zugangsdaten.

Das bedeutet:

- Ein echtes Benutzerkonto-System braucht einen externen Dienst, zum Beispiel
  Firebase Authentication, Supabase Auth, Auth0, Clerk oder ein eigenes Backend.
- Reiner JavaScript-Schutz auf GitHub Pages kann umgangen werden und schuetzt
  keine vertraulichen Inhalte wirklich.
- Die enthaltene Login-/Registrierungsfunktion nutzt Firebase Authentication.
  Der Zugriff auf statische HTML-Dateien selbst ist aber weiterhin oeffentlich.
  Wirklich private Daten sollten aus Firebase/Supabase/Backend geladen und dort
  per Sicherheitsregeln geschuetzt werden.

## Struktur

```text
.
|-- index.html
|-- login.html
|-- app.html
|-- assets/
|   |-- css/
|   |   `-- styles.css
|   `-- js/
|       |-- auth.js
|       `-- firebase-config.js
`-- .nojekyll
```

## Firebase einrichten

Ja, du musst dich als Admin bei Firebase anmelden. Dafuer reicht ein
Google-Konto.

1. `https://console.firebase.google.com/` oeffnen.
2. Neues Firebase-Projekt erstellen.
3. Im Projekt unter `Authentication` -> `Get started` die Anbieter aktivieren:
   - `Email/Password`
   - `Google`
4. Unter `Project settings` -> `General` eine Web-App anlegen.
5. Firebase zeigt eine `firebaseConfig` an. Die Werte in
   `assets/js/firebase-config.js` mit diesen Daten ersetzen.
6. Unter `Authentication` -> `Settings` -> `Authorized domains` die spaetere
   GitHub-Pages-Domain eintragen, z. B. `deinname.github.io`. Bei einer eigenen
   Domain diese ebenfalls eintragen.
7. Fuer E-Mail-Bestaetigung muss bei `Email/Password` die Registrierung per
   E-Mail erlaubt sein. Nach der Registrierung sendet die Seite automatisch eine
   Bestaetigungs-Mail.

Die Firebase-Web-Konfiguration enthaelt keine geheimen Admin-Schluessel. Sie
darf in einer statischen Website stehen. Trotzdem sollten in Firebase nur die
Domains freigegeben werden, auf denen die Website wirklich laufen soll.

## Firestore fuer Nutzereinstellungen

Der Mitgliederbereich speichert die Datenschutz-Einstellung pro Nutzer in
Firestore unter `users/{uid}`.

Gespeicherte Felder:

- `keepPersonalDataUntilRevoked`: Standardwert in der Website ist `true`.
- `privateProfile`: Standardwert ist `false`.
- `publicProfile`: Gegenwert zu `privateProfile`, praktisch fuer spaetere
  Profilsuche.

1. In Firebase `Firestore Database` oeffnen.
2. `Create database` waehlen.
3. `Production mode` nutzen.
4. Eine Region auswaehlen, idealerweise eine EU-Region, falls verfuegbar.
5. Unter `Rules` diese Regeln veroeffentlichen:

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
lesen und aendern.

## Lokal testen

Firebase Auth sollte ueber einen lokalen Server oder GitHub Pages getestet
werden:

```powershell
python -m http.server 8080
```

Danach ist die Seite unter `http://localhost:8080` erreichbar.

## GitHub Pages aktivieren

1. Repository zu GitHub pushen.
2. In GitHub: `Settings` -> `Pages`.
3. Als Source den Branch `main` und den Ordner `/root` auswaehlen.
4. Speichern. GitHub zeigt danach die oeffentliche URL an.

## Hinweis zu geschuetzten Inhalten

Der Mitgliederbereich prueft den Firebase-Login und die E-Mail-Bestaetigung.
Da GitHub Pages aber statisch ist, duerfen vertrauliche Dokumente nicht einfach
als Dateien im Repository liegen. Fuer private Inhalte braucht es eine
geschuetzte Datenquelle, z. B. Firebase Firestore/Storage mit Security Rules.
