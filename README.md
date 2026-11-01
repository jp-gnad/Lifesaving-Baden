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

Website und Timer verwenden dieselbe dunkle Loginseite unter `login.html`.
Der Parameter `returnTo` führt nach der Anmeldung zum ursprünglichen Bereich
zurück; externe Ziele und Login-Schleifen werden verworfen. Die bisherige URL
`timer/login.html` leitet zur gemeinsamen Anmeldung weiter.
Alle HTML-Seiten verweisen auf das gemeinsame Projektmanifest
`manifest.webmanifest`. Es startet Lifesaving Baden auf der Hauptseite,
definiert den gesamten Projektpfad als App-Bereich und verwendet `standalone`.
Login, Kontobereich und Timer liegen damit im selben App-Bereich. Alle Seiten
enthalten dieselben Apple-Web-App-Metadaten und dasselbe Home-Screen-Icon.
Das bisherige `timer/manifest.webmanifest` bleibt für ältere Installationen
mit seiner bisherigen Timer-Identität und Timer-Startseite erreichbar.

Nach der Veröffentlichung die Hauptseite in Safari öffnen und über
`Teilen → Zum Home-Bildschirm` als Web-App hinzufügen. Unter iOS 26 muss
`Als Web-App öffnen` eingeschaltet sein. Wenn eine ältere Installation weiterhin
eigene Seiten in einem Browserfenster öffnet, die App von der Hauptseite neu
hinzufügen, damit sie die gemeinsame Konfiguration bei der Einrichtung erhält.
Vor dem Entfernen einer alten Timer-Installation alle lokalen Ergebnisse
synchronisieren, da deren Offline-Daten verloren gehen können.

Browserleisten auf externen Seiten wie Google oder Firebase werden von iOS
verwaltet und lassen sich durch dieses Projekt nicht ausblenden. Der gemeinsame
App-Bereich gilt für die eigenen Seiten auf derselben Domain.

`assets/js/login.js` enthält Anmeldung, Registrierung und Passwort-Zurücksetzen.
`assets/js/auth.js` verwaltet den Mitglieder- und Kontobereich. Beide und der
Timer nutzen `assets/js/auth-core.js` für dauerhafte Sitzungen, Rollen und
höchstens drei Versuche bei vorübergehenden Verbindungs-/Serverfehlern.

Die Loginseite benötigt kein Firestore. Das Nutzerdokument unter `users/{uid}`
wird beim ersten Aufruf des Mitgliederbereichs oder Timers angelegt. Neue
Konten erhalten dabei die Rolle `sportler`; eine Transaktion verhindert das
Überschreiben eines bereits vorhandenen Profils aus einem anderen Tab.

Die Login-Abläufe lassen sich ohne echte Konten oder Firebase-Zugriffe prüfen:

```powershell
node --test tests/auth_flow.test.cjs
python -B -m unittest discover -s tests -p 'test_*.py'
```

### Google-Login in der installierten GitHub-Web-App

Auf dem betroffenen iPhone scheitert der Firebase-Popup-Ablauf in der installierten
GitHub-Web-App mit `auth/network-request-failed`, bevor die Seite neu startet.
Safari funktioniert, ebenso die installierte Firebase-Hosting-Variante. Eine Kopie
unter einem anderen Repository-Pfad auf derselben GitHub-Domain hat nicht geholfen.
Die konkret fehlschlagende Anfrage beziehungsweise interne SDK-Verbindung ist
damit noch nicht bestimmt.

Installierte Apps unter einer `*.github.io`-Domain verwenden deshalb mit
konfigurierter `window.googleSignInClientId` Google Identity Services direkt.
Das Google-Skript wird nur in diesem Modus geladen. Googles eigener dunkler Button
öffnet die Kontoauswahl; es gibt kein One Tap und keine automatische Kontoauswahl.
Der ID-Token wird ausschließlich an `GoogleAuthProvider.credential` und
`signInWithCredential` übergeben. Firebase validiert ihn und stellt die Sitzung
für das bestehende Konto aus; der anschließende Profil-/Rollenablauf bleibt gleich.
Der Anwendungscode schreibt den Google-Nachweis weder in URLs noch in den
Diagnoseverlauf. Für den Seitenwechsel wird er kurzzeitig in `sessionStorage`
derselben App gehalten; siehe den folgenden Abschnitt.

Die öffentliche Web-Client-ID liegt getrennt von der Firebase-Konfiguration in
`assets/js/firebase-config.js`. Sie ist kein Client-Secret. Einmalig im bestehenden
Google-Cloud-Projekt `lifesaving-baden` unter `Google Auth Platform → Clients`
den passenden OAuth-Web-Client öffnen und unter `Authorized JavaScript origins`
den Eintrag `https://jp-gnad.github.io` ergänzen, falls er fehlt. Kein Repository-
Pfad und kein abschließender Schrägstrich gehören in diesen Eintrag. Die Adresse
gilt damit für `Lifesaving-Baden` und `Lifesaving-Test`. Die vorhandenen Redirect-URIs
und die Firebase-Einstellungen bleiben erhalten. Auch die Firebase-Freigabe der
GitHub-Domain unter `Authentication → Settings → Authorized domains` bleibt nötig.

Nach dem Push auf GitHub die installierte App neu laden. Die Anmeldehilfe muss
`Loginversion: 20261101-google-handoff-v8` und
`Google-Verfahren: Google direkt → Firebase` zeigen. Die neuen Ereignisse
unterscheiden das Empfangen des Google-Nachweises vom Firebase-Austausch. Die
automatisierten Tests prüfen die Übergabe, Fehlerbehandlung und bestehenden
Anmeldewege; den Erfolg auf dem betroffenen iPhone müssen wir noch prüfen.

Ein abgebrochenes Google-Fenster sperrt die Formulare nicht. Bei einem Ladefehler
kann derselbe Google-Button das Skript erneut laden. Nach einem Fehler beim
Firebase-Austausch erscheint Googles Button wieder; es gibt keinen automatischen
Rückfall auf den auf diesem Gerät fehlschlagenden Firebase-Popup-Ablauf.

Im v6-Geräteprotokoll kommt der Google-Nachweis an; anschließend scheitert erst
`signInWithCredential` mit `auth/network-request-failed`. Der Beginn des
Firebase-Aufrufs steht dabei vor dem Ereignis „App wieder sichtbar“. Das ist ein
Hinweis auf den Zeitpunkt der Rückkehr, noch kein Beweis für die genaue Ursache.
Die aktuelle Version wartet vor jedem Austausch auf eine sichtbare Seite und
einen nächsten Animationsframe. Nur `auth/network-request-failed` erlaubt bis zu
zwei Wiederholungen mit kurzen Pausen; andere Anmeldefehler werden sofort
angezeigt. Eine inzwischen abgeschlossene Anmeldung verhindert eine
verspätete weitere Übergabe.

Der v7-Gerätetest bestätigt einen empfangenen Google-Nachweis und einen
Firebase-Aufruf im Vordergrund. Trotzdem meldet der Browser einen `TypeError`;
anschließend startet die Loginseite automatisch neu, noch bevor der erste
Wiederholungsversuch sichtbar wird. Der Nutzer bestätigt außerdem, dass der
Passwort-Login in derselben installierten GitHub-Web-App funktioniert. Bloßes
Warten auf Sichtbarkeit reicht deshalb nicht aus.

`assets/js/google-handoff.js` sichert für die direkte Google-Anmeldung den
Nachweis unter einem eigenen `sessionStorage`-Schlüssel. Nach dem Google-Callback
wird die identische Login-URL ohne Tokenparameter neu geladen. Erst die neue
Seite übernimmt die Übergabe an Firebase; es ist keine weitere Kontoauswahl
nötig. Der zunächst leere Firebase-Sitzungszustand dieser neuen Seite wird
während der Fortsetzung nicht als fehlgeschlagene Anmeldung ausgegeben.

Die Übergabe enthält den Google-ID-Token, die öffentliche Client-ID, die
Firebase-Projekt-ID, den Empfangszeitpunkt und einen Versuchszähler. Sie ist
höchstens zwei Minuten nutzbar und erlaubt insgesamt drei Austauschversuche,
auch über mehrere Seitenneustarts. Nach erfolgreicher Firebase-Übernahme,
endgültigem Fehler oder einem Wechsel zur Passwortanmeldung wird sie gelöscht.
Ein Ablauf-Timer und die Prüfung bei jedem Zugriff verwerfen abgelaufene Daten;
wenn iOS eine Seite anhält, kann die Bereinigung erst beim nächsten Ausführen
erfolgen. Der Google-ID-Token selbst wird weiterhin von Firebase validiert.
Andere Projekte/Client-IDs und ungültige Übergaben werden verworfen.

Die verlassene Seite darf einen noch benötigten Übergabestatus nicht löschen
oder weitere Austauschversuche starten. Bei blockiertem Sitzungsspeicher bleibt
die bisherige Verarbeitung im Arbeitsspeicher nutzbar, kann aber einen
Seitenneustart weiterhin nicht überstehen. Der Diagnoseverlauf enthält nur
feste Statusmeldungen zur Sicherung und Wiederaufnahme, niemals den Token.

Die Diagnose hält die tatsächliche Sichtbarkeit beim Empfang, das Warten auf
den Vordergrund und fehlgeschlagene beziehungsweise wiederholte Übergaben fest.
Aus dem internen SDK-Fehlertext werden lediglich die fest vorgegebenen Namen
`TypeError`, `AbortError` oder `NetworkError` übernommen, sofern vorhanden.
Der rohe Text kann sensible Angaben enthalten und wird nicht ausgegeben oder
gespeichert. Die genaue betroffene HTTP-Anfrage wird damit nicht erfasst.

### Zusätzliche Firebase-Testwebsite entfernen

Die Website wird ausschließlich über GitHub Pages weiter veröffentlicht. Die
Hosting-Konfiguration zeigt jetzt auf `firebase-hosting/`: Darin liegt nur eine
`404.html`, keine Kopie der Website, kein Loginformular und keine Timer-Datei.
Der bisherige Export der Website nach `dist/` wurde entfernt.

Um die bereits veröffentlichte Kopie auf Firebase durch diesen leeren Stand zu
ersetzen, einmalig im Projektverzeichnis ausführen:

```powershell
npx.cmd firebase-tools deploy --only hosting --project lifesaving-baden
```

Falls die CLI abgemeldet ist, vorher `npx.cmd firebase-tools login` ausführen.
Der Befehl veröffentlicht ausschließlich die 404-Seite auf dem explizit gesetzten
Hosting-Site `lifesaving-baden`. Die bisherige Website-Kopie wird damit aus dem
aktiven Hosting-Stand entfernt. Die Firebase-Domains liefern für die bisherigen
App-Seiten anschließend HTTP 404. Ein GitHub-Push allein ändert die bereits
veröffentlichten Firebase-Dateien nicht.

Die Domain `lifesaving-baden.firebaseapp.com` bleibt als technische Auth-Domain
bestehen. Firebase stellt unter `/__/auth/` eigene Anmelde-Hilfsseiten bereit;
dieser reservierte Bereich wird weder überschrieben noch umgeleitet. Die
Konfiguration enthält deshalb keine allgemeine Weiterleitung oder SPA-Rewrite.
`authDomain`, die Firebase-Anbieter, OAuth-Weiterleitungsadressen, Konten,
Firestore-Daten und Regeln bleiben erhalten. Auch die Freigabe der Firebase-
Domain für Authentication wird nicht entfernt.

Nach der Veröffentlichung `/`, `/login.html` und `/timer/` auf Firebase auf
HTTP 404 sowie `/__/auth/iframe` auf Erreichbarkeit prüfen. Der Google-Login im
Safari-Browser auf GitHub Pages muss weiterhin funktionieren. Die neue direkte
Anmeldung in der GitHub-Web-App wird unabhängig davon weiter geprüft.

Beim Google-Login werden Firebase-Anmeldeereignisse und die Rückkehr in die
App auch während eines offenen Google-Fensters verarbeitet. Ein noch wartendes
oder bereits geschlossenes Fenster blockiert so keine vorhandene Sitzung.
Die Timer-App lädt gemeinsame Auth-Skripte bevorzugt aus dem Netz und greift
bei fehlender Verbindung auf ihren Cache zurück.

Falls die iPhone-Web-App nach der Kontoauswahl auf der Loginseite bleibt,
zeigt sie bei einem erkannten Fehler den Anmeldecode, die geladene Version und
den App-/Browsermodus. Unter dem Google-Button lässt sich außerdem die
`Anmeldehilfe` aufklappen und über `Status kopieren` weitergeben. Sie zeigt auch
bei ausbleibenden Fehlermeldungen die Firebase-Version, die Speicherverfügbarkeit,
ob Firebase eine Sitzung erkennt und die letzten 40 Ablaufereignisse.
Relative Sekundenangaben machen die Dauer zwischen Fehler und Seitenwechsel
sichtbar; sie beziehen sich auf den ersten noch angezeigten Eintrag.
Die Verlaufsspur liegt zusätzlich unter einem eigenen Schlüssel in `localStorage`,
damit ein Seitenneustart den ursprünglichen Google-Klick nicht aus der Diagnose
entfernt. Einzelne Seitenausführungen erhalten zufällige lokale Kennzeichnungen;
diese identifizieren weder ein Konto noch ein Gerät. Navigationsart, ein vorhandener
Fensteröffner und der beim Seitenstart vorgefundene Startmarker helfen, einen
Seitenneustart von einem anderen Fenster-/Speicherkontext zu unterscheiden.
Einträge, die älter als zehn Minuten sind, werden beim nächsten Zugriff verworfen.
Wenn der lokale Speicher blockiert ist, funktioniert die Diagnose weiterhin im
Arbeitsspeicher und blockiert keine Anmeldung.
Die Angaben enthalten keine E-Mail-Adresse, Nutzer-ID, Tokens oder rohen
Fehlermeldungen und werden erst durch den Kopierbutton in die Zwischenablage
übernommen; es erfolgt kein automatischer Versand.
Ein kurzfristiger Eintrag in `sessionStorage` erkennt
auch einen Seitenneustart während der Anmeldung; er enthält nur den Startzeitpunkt,
keine Kontodaten oder Tokens. Diese Angaben helfen, eine fehlende Firebase-Sitzung
von einem Fehler bei der Rückkehr aus dem Google-Fenster zu unterscheiden.

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
