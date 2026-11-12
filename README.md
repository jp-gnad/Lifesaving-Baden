# Lifesaving Baden

Statische GitHub-Pages-Website mit gemeinsamer Anmeldung, Mitgliederbereich,
Konten-/Clubverwaltung, Startberechtigungen, Arbeitszeiten und Lifesaving Timer.
Firebase Authentication und Firestore speichern die geschützten Konten- und
Fachdaten. Der Browser lädt HTML, CSS und JavaScript direkt; es gibt keinen
Produktions-Build und keinen eigenen Node-Server.

Der Timer ist unter `timer/` erreichbar, beispielsweise
[auf GitHub Pages](https://jp-gnad.github.io/Lifesaving-Baden/timer/).
Bestehende HTML-URLs und installierte Timer bleiben erhalten.

## Für Entwicklung und KI-Arbeit

| Dokument | Inhalt |
|---|---|
| [AGENTS.md](AGENTS.md) | Arbeitsregeln, Modulzuständigkeiten, Kontingent- und Sicherheitsgrenzen |
| [Architektur](docs/architecture.md) | Einstiegspunkte, Module, Datenmodell und Datenflüsse |
| [Entwicklung](docs/development.md) | Installation, einheitliche Testbefehle, CI und lokale Vorschauen |
| [Sicherheit und Kompatibilität](docs/security-and-compatibility.md) | Berechtigungen, Migrationen, alte URLs und Offline-Daten |
| [Prüfung und Umbau](docs/refactoring-review.md) | Durchgeführte Änderungen und geprüfte Eigenschaften |
| [Firestore-Leseaudit](docs/firestore-lesevorgaenge-audit.md) | Verbrauchsquellen und bereits umgesetzte Importoptimierung |

Schneller Einstieg nach Installation der [Testwerkzeuge](docs/development.md):

```powershell
npm.cmd test
npm.cmd run test:rules
npm.cmd run serve
```

Die ersten beiden Befehle verwenden keine Produktionsdaten. Normale App-Seiten
im lokalen Browser sind dagegen weiterhin mit dem konfigurierten Firebase-Projekt
verbunden; für reine Oberflächenprüfungen die dokumentierten Test-Fixtures verwenden.

## Struktur

```text
*.html                    Öffentliche Seiten und geschützte App-Einstiege
assets/js/                Gemeinsame Anmeldung, Konten, Clubs und Arbeitszeiten
assets/js/*-core.js       Wiederverwendbare Fachlogik
assets/js/*-store.js      Datenbanktransaktionen und Reservierungen
timer/app.js              Routing, Zeitnahme, Ergebnisse und Synchronisation
timer/core.js             Gemeinsame Timer-Fachlogik
timer/views/              Abgegrenzte Timer-Ansichten
timer/*-store.js           Teilnehmer- und Offline-Persistenz
timer/results-pdf.js      Ergebnisexport
timer/result-feed.js      Begrenzte Live-Ergebnisseiten und vollständige Exportabfragen
timer/firestore-api.js    Firestore-Adapter, Authentifizierung und Caches
firestore.rules           Verbindliche serverseitige Berechtigungen
tools/                    Lokale Prüfungen und kontrollierte Wartungs-CLIs
tests/                    Funktions-, Integrations-, Regel- und Browserprüfungen
docs/                     Architektur, Entwicklung und Prüfberichte
.github/workflows/        Prüfungen ohne Produktionsdaten sowie separater Verzeichnis-Sync
```

Statische Dateien selbst sind öffentlich abrufbar. Wirklich private Daten werden
über Firebase und dessen Sicherheitsregeln geschützt. Die folgende Anleitung
beschreibt die bestehende Einrichtung und Veröffentlichung.

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
Nach erfolgreicher Anmeldung führt die App in die gemeinsame Mitgliederübersicht.
Alte `returnTo`-Parameter überschreiben dieses Ziel nicht. Die bisherige URL
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
`assets/js/auth.js` verwaltet den Mitglieder- und Kontobereich;
`assets/js/admin-accounts.js` enthält die abgegrenzte Kontenverwaltung. Anmeldung,
Kontobereich und Timer nutzen `assets/js/auth-core.js` für dauerhafte Sitzungen, Rollen und
höchstens drei Versuche bei vorübergehenden Verbindungs-/Serverfehlern.

Auf allen Bildschirmgrößen bleibt das Passwort zunächst verborgen und erscheint
erst nach Eingabe der E-Mail und Klick auf „Anmelden“ anstelle des E-Mail-Felds.
Im Passwortschritt ersetzt die gewählte E-Mail den Text im Trennbereich. Der
Zurück-Pfeil neben „Anmelden“ führt zum E-Mail-Schritt zurück. Auf Handys bis 600 px steht
der Google-Button über dem E-Mail-Feld. Bestehende Konten werden angemeldet. Neue
E-Mail-Registrierungen fragen nach dem Passwort zuerst Vorname und Nachname ab.
Erst beim Absenden des Namens wird das unbestätigte Firebase-Konto angelegt und
der Name atomar im eigenen Profil gespeichert. Die Bestätigungsmail wird erst
nach erfolgreichem Speichern verschickt. Bis zum Absenden bleibt das Passwort
ausschließlich im Arbeitsspeicher. Neuladen oder Verlassen verwirft den Entwurf;
die E-Mail ist dadurch noch nicht reserviert und ein anderes Passwort ist möglich.
Bereits angelegte unbestätigte Konten bleiben passwortgeschützt und verwenden
bei Bedarf den Passwort-Reset. Ein fehlgeschlagener Mailversand kann ohne erneute
Namenseingabe wiederholt werden. Weil
Firebase mit aktivem E-Mail-Enumeration-Schutz keine verlässliche E-Mail-Vorabprüfung
liefert, führt ein erfolgreicher Passwort-Login direkt zur Anmeldung. Bei allgemeinen
Zugangsdatenfehlern folgt zunächst die Namenseingabe. Ist die E-Mail bereits vergeben,
wird die Registrierung beim Absenden abgewiesen und das Passwort erneut abgefragt.
Bestehende Konten werden bei falschem Passwort nicht verändert.
Auch am Desktop gibt es ein gemeinsames Formular ohne Umschaltung zwischen Login
und Registrierung. Ab 1200 px liegt derselbe kompakte Anmeldekasten mittig mit
leicht transparentem Hintergrund vor dem durchgehenden Schwimmbadfoto zwischen
Header und Footer. Der Hintergrund reicht bis zum unteren Bildschirmrand; der
Footer folgt darunter und ist durch Scrollen erreichbar. Die Bildfläche bleibt
bei wechselnder Formularhöhe unverändert;
Bild und Kasten scrollen gemeinsam, der Abstand zum Kasten passt sich an. Bei niedrigen Fenstern scrollt nur der
Formularbereich. Die Zwischenansicht von 601 bis 1199 px bleibt separat gestaltbar.
Google-Anmeldungen übernehmen die getrennten Felder `given_name` und `family_name`
aus dem von Firebase gelieferten Anbieterprofil in ein noch leeres Mitgliederprofil.
Bereits gespeicherte Namen bleiben erhalten. Fehlende Namensbestandteile werden
bei der Kontoeinrichtung abgefragt; Geschlecht und Geburtsdatum bleiben manuelle Angaben.
Ein vollständig beim Login erfasster Name (`loginNameCaptured`) überspringt den
Namensschritt in der erweiterten Kontoeinrichtung. Die weiteren optionalen Angaben
und die getrennte Personenverknüpfung bleiben bestehen.

Die Loginseite lädt das Firestore-SDK für das Speichern der Namen bei Registrierung
und Google-Anmeldung sowie die Wiederaufnahme bereits angelegter unbestätigter
Konten. Neue Konten erhalten dabei die Rolle `standard`; eine Transaktion verhindert
das Überschreiben eines bereits vorhandenen Profils aus einem anderen Tab.
Bestehende bestätigte E-Mail-Konten benötigen beim Login weiterhin keinen Profilread.

Die Login-Abläufe lassen sich ohne echte Konten oder Firebase-Zugriffe prüfen:

```powershell
node --test tests/auth_flow.test.cjs
node --test tests/event_overview.test.cjs
python -B -m unittest discover -s tests -p 'test_*.py'
```

Die Berechtigungen lassen sich zusätzlich mit Java 21 und dem lokalen Firestore-Emulator prüfen:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run test:rules
```

Der feste Demo-Projektname und die lokale Host-Prüfung im Test verhindern Zugriffe
auf Produktionsdaten. Ohne gestarteten Emulator wird dieser Test übersprungen.

### Google-Login in der installierten GitHub-Web-App

Das lokale Button-Logo `assets/img/google-g.png` ist das unveränderte Original aus
[Googles offiziellen Branding-Richtlinien](https://developers.google.com/identity/branding-guidelines).


Installierte Apps unter einer `*.github.io`-Domain verwenden mit konfigurierter
`window.googleSignInClientId` Google Identity Services direkt. Das Google-Skript
wird nur in diesem Modus geladen. Googles eigener dunkler Button öffnet die
Kontoauswahl; es gibt kein One Tap und keine automatische Kontoauswahl.
Normale Browser verwenden weiterhin den Firebase-Popup-Ablauf.

`assets/js/google-handoff.js` sichert den Google-Anmeldenachweis kurzzeitig im
Sitzungsspeicher derselben App. Nach der Kontoauswahl wird die identische
Login-URL ohne Tokenparameter neu geladen. Erst die neue Seite übergibt den
Nachweis über `GoogleAuthProvider.credential` und `signInWithCredential` an
Firebase. So übersteht die Anmeldung den unter iOS beobachteten Seitenneustart,
ohne eine weitere Kontoauswahl zu verlangen. Der zunächst leere Firebase-
Sitzungszustand während dieser Fortsetzung wird nicht als Fehler behandelt.
Firebase validiert den Google-Nachweis und stellt die Sitzung für das bestehende
Konto aus; der anschließende Profil- und Rollenablauf bleibt gleich.

Die Übergabe enthält den Google-ID-Token, die öffentliche Client-ID, die
Firebase-Projekt-ID, den Empfangszeitpunkt und einen Versuchszähler. Sie ist
höchstens zwei Minuten nutzbar und erlaubt insgesamt drei Austauschversuche,
auch über mehrere Seitenneustarts. Nach erfolgreicher Firebase-Übernahme,
endgültigem Fehler oder einem Wechsel zur Passwortanmeldung wird sie gelöscht.
Ein Ablauf-Timer und die Prüfung bei jedem Zugriff verwerfen abgelaufene Daten;
wenn iOS eine Seite anhält, kann die Bereinigung erst beim nächsten Ausführen
erfolgen. Andere Projekte/Client-IDs und ungültige Übergaben werden verworfen.
Der Nachweis wird nicht in die URL geschrieben.

Vor jedem Austausch wartet die App auf die sichtbare Seite und einen nächsten
Animationsframe. Nur `auth/network-request-failed` erlaubt kurze Wiederholungen;
andere Anmeldefehler werden sofort verständlich angezeigt. Die verlassene Seite
darf einen noch benötigten Übergabestatus nicht löschen oder weitere
Austauschversuche starten. Bei blockiertem Sitzungsspeicher bleibt die Verarbeitung
im Arbeitsspeicher nutzbar, kann aber einen Seitenneustart nicht überstehen.
Ein abgebrochenes Google-Fenster sperrt die Formulare nicht. Nach einem
Lade-/Anmeldefehler kann der Google-Button erneut verwendet werden.

Die öffentliche Web-Client-ID liegt getrennt von der Firebase-Konfiguration in
`assets/js/firebase-config.js`. Sie ist kein Client-Secret. Einmalig im bestehenden
Google-Cloud-Projekt `lifesaving-baden` unter `Google Auth Platform → Clients`
den passenden OAuth-Web-Client öffnen und unter `Authorized JavaScript origins`
den Eintrag `https://jp-gnad.github.io` ergänzen, falls er fehlt. Kein Repository-
Pfad und kein abschließender Schrägstrich gehören in diesen Eintrag. Die Adresse
gilt für `Lifesaving-Baden` und `Lifesaving-Test`. Die vorhandenen Redirect-URIs
und die Firebase-Einstellungen bleiben erhalten. Auch die Firebase-Freigabe der
GitHub-Domain unter `Authentication → Settings → Authorized domains` bleibt nötig.

Die Loginseite führt keinen Diagnoseverlauf mehr. Der frühere lokale
Diagnoseschlüssel wird beim nächsten Aufruf gezielt entfernt; Konto-, Firebase-
und Übergabedaten bleiben dabei erhalten. Für den funktionalen Rückkehrablauf
bleibt ein kurzlebiger Startzeitpunkt in `sessionStorage` bestehen.

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
Safari-Browser auf GitHub Pages muss weiterhin funktionieren. Die direkte
Anmeldung in der GitHub-Web-App bleibt von dieser Hosting-Änderung getrennt.

Beim Google-Login werden Firebase-Anmeldeereignisse und die Rückkehr in die
App auch während eines offenen Google-Fensters verarbeitet. Ein noch wartendes
oder bereits geschlossenes Fenster blockiert so keine vorhandene Sitzung.
Die Timer-App lädt gemeinsame Auth-Skripte bevorzugt aus dem Netz und greift
bei fehlender Verbindung auf ihren Cache zurück.

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
- `role`: `standard`, `athlete`, `trainer`, `organizer` oder `admin`. Neue Konten erhalten `standard`.
- `isAdmin` / `admin`: optionale Admin-Markierung als Boolean.
- `personLinkStatus`: Status des beantragten Personenabgleichs.
- `personLinkRequest`: Antrag mit Vorname, Nachname, Geburtsdatum,
  DLRG-Gliederung, kurzer Identitätsinfo, Konto-E-Mail und Firebase UID.

1. In Firebase `Firestore Database` öffnen.
2. `Create database` wählen.
3. `Production mode` nutzen.
4. Eine Region auswählen, idealerweise eine EU-Region, falls verfügbar.
5. Unter `Rules` den vollständigen Inhalt von [`firestore.rules`](firestore.rules) einfügen und veröffentlichen. Diese Datei ist die einzige Vorlage für die Regeln, einschließlich der Timer-Berechtigungen.

## Rollen und Admin-Schutz

| Anzeige | Gespeicherter Wert | Rechte |
| --- | --- | --- |
| Standard | `standard` | Grundzugriff und Event-Freigabe für angemeldete Nutzer |
| Sportler | `athlete` | zusätzlich Freigabe „Sportler und höher“ |
| Trainer (grün) | `trainer` | zusätzlich Freigabe „Trainer und höher“ |
| Organisator | `organizer` | zusätzlich Freigabe „Organisatoren“, Eventverwaltung und Teilnehmerimport |
| Admin | `admin` | alle Event-Freigaben, Verwaltung anderer Konten |

Bestehende Konten müssen nicht umgeschrieben werden: `sportler` bedeutet jetzt
Standard; `kader-sportler`, `kadersportler`, `kader` und die alten Kader-Markierungen
bedeuten Sportler. `organisator` bleibt ein Alias für Organisator. Alte Event-Freigaben
mit `kader` entsprechen „Sportler und höher“. Neue Änderungen speichern die Werte
oben. Bei einer Rollenänderung werden alte Kader-Markierungen entfernt.

Admins können andere Nicht-Admin-Konten zu Standard, Sportler, Trainer oder
Organisator machen. Die Rolle bestehender Admin-Konten kann nicht über die Web-App
geändert werden; auch ihre Löschung ist gesperrt. Eigene persönliche Daten,
Anmeldeanbieter, Verknüpfungen und Datenschutzeinstellungen bleiben bearbeitbar.
Die Firestore-Regeln erlauben dabei keine Änderungen an geschützten Rollenfeldern.
Auch andere Admins können Admin-Konten weder umstufen noch löschen.

Adminrollen werden ausschließlich manuell in der Firebase Console unter Firestore
`users/{uid}` gepflegt. Admin-Kontodokumente müssen `role: "admin"`, `admin: true`
oder `isAdmin: true` enthalten, damit andere Konten den Admin-Schutz erkennen.
Vorhandene Auth Custom Claims bleiben wirksam und müssen gegebenenfalls separat
über eine privilegierte Admin-Umgebung geändert werden; die Web-App kann sie nicht
ändern. Der Schutz der eigenen Rollenfelder und vor Löschung gilt auch für nur
über Claims erkannte Admins.

## Kontoverwaltung

In den Kontoeinstellungen kann ein eingeloggter Nutzer auch mit Adminrolle Name und E-Mail-Adresse
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
Admins verknüpfen Konten in der Kontenübersicht über eine Personensuche in
derselben Importliste wie Timer und Startberechtigungen. Die Übersicht zeigt
kompakte Karten mit zwei getrennten Spalten: Kontoname, Jahrgang, Gliederung
und E-Mail links sowie Name, Jahrgang und Gliederung der Datenbankperson rechts.
Die Spaltenüberschriften stehen einmal über der Liste. Ein Klick auf eine Karte
öffnet oder schließt die Bearbeitung. Rollenwahl und die Icons zum Speichern,
Ändern und Aufheben der Zuordnung stehen gemeinsam in einer Zeile. Außerhalb
der Bearbeitung kennzeichnet die Farbe die Rolle. Jahrgänge werden zweistellig
als `(JJ)` angezeigt. Das funktioniert für jede Kontorolle und auch ohne Antrag.

Bei mehreren Anmeldeadressen zeigt die Kontenübersicht bevorzugt die Google-Mail.
Dafür wird `users/{uid}.googleEmail` beim Laden des eigenen Kontos aus dem Google-
Anbieter von Firebase Auth aktualisiert. Die primäre `email` bleibt erhalten.
Für bestehende Konten lässt sich dieser Wert einmalig abgleichen, ohne auf deren
nächste Anmeldung zu warten. Mit `firebase-admin` und dem Servicekonto in
`FIREBASE_SERVICE_ACCOUNT_JSON` zuerst die Vorschau prüfen und dann anwenden:

```sh
node tools/sync_account_google_emails.mjs
node tools/sync_account_google_emails.mjs --apply
```

Die Zuordnung liegt separat unter `users/{uid}.personLink` mit `id`, `name`,
`birthYear`, `gender` und `organization`. Änderungen am Kontonamen oder anderen
Profilangaben ändern diese Personendaten nicht. Admins dürfen Zuordnungen anlegen, wechseln oder aufheben. Jedes Mitglied darf
seine eigene Verknüpfung aufheben oder einen Fehler melden. Das Aufheben gibt
die Personenreservierung atomar frei. Gemeldete Fehler erscheinen im Adminbereich
als rote Nachrichtenmarkierung; das einzelne Erledigt-Icon schließt die Meldung ab. Es lassen
sich ausschließlich vorhandene Personen auswählen.

`personAccountLinks/{candidateId}` reserviert jede Person für genau eine
Firebase-UID. Zuordnung und Reservierung werden atomar geschrieben. Die
Firestore-Regeln prüfen die Quellperson und beide Verweise, sodass auch
gleichzeitige Adminaktionen keine Doppelverknüpfung erzeugen können. Beim
Aufheben, Wechsel und Löschen des Kontos wird die Reservierung freigegeben.

Frühere manuell gesetzte IDs und Statusfelder zählen nicht mehr als
Verknüpfung. Für den Umstieg zuerst die neuen Firestore-Regeln bereitstellen
und die Website aktualisieren. Danach die alten Felder einmalig mit dem
Firebase-Servicekonto bereinigen (neue Zuordnungen und offene Anträge bleiben
erhalten):

```sh
node tools/reset_legacy_person_links.mjs         # Vorschau, keine Änderungen
node tools/reset_legacy_person_links.mjs --apply # Alte Zuordnungen zurücksetzen
```

Das Skript benötigt `firebase-admin` und `FIREBASE_SERVICE_ACCOUNT_JSON` und
akzeptiert ausschließlich das Projekt `lifesaving-baden`. Personen bleiben
nach der Verknüpfung mit ihren gespeicherten Angaben erkennbar, auch wenn sie
bei einem späteren Quellenabgleich aus der Importliste verschwinden.

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

Die Eventübersicht hat die Tabs `Aktuell` und `Vergangene`. Ein Wettkampf wird
ab dem vierten Kalendertag nach seinem Datum unter `Vergangene` angezeigt:
Ein Event vom 1. Januar wechselt am 5. Januar um 00:00 Uhr nach lokaler Zeit.
Events ohne Datum bleiben unter `Aktuell`. Die Einordnung wird beim Öffnen,
beim Tageswechsel und bei der Rückkehr in die App neu berechnet; dafür werden
keine Eventdaten in Firestore verändert. Die kompakten Eventkarten behalten
ihre bisherigen Icongrößen.

Der Timer verwendet keine eigene Cloudflare-Datenbank mehr. Events, Personen
und Ergebnisse liegen in diesen Firestore-Collections:

```text
timerEvents/{eventId}
timerEvents/{eventId}/participants/{participantId}
timerEvents/{eventId}/participantIdentities/{identityKey}
timerEvents/{eventId}/results/{resultId}
timerParticipantDirectory/{candidateId}
```

Die Eventübersicht und direkte Eventlinks sind öffentlich erreichbar. Welche
Funktionen innerhalb eines Events nutzbar sind, legt ein Organisator in den
Event-Einstellungen fest:

- gesperrt (nur Admin),
- Organisatoren,
- Trainer und höher,
- Sportler und höher,
- Standard und höher (angemeldet und bestätigt),
- jeder, auch ohne Anmeldung.

Diese Auswahl gibt es getrennt für Timer, Ergebnisanzeige,
Ergebniskorrekturen, Personenanzeige und Personenbearbeitung. Eventerstellung,
Eventeinstellungen und Eventlöschung bleiben immer Organisatoren und dem Admin
vorbehalten. Ein öffentlicher Timerzugriff schließt die zum Stoppen benötigte
Personenanzeige technisch mit ein.

Der Timer zeigt in der Kopfzeile immer den aktuellen Account beziehungsweise
für Gäste einen Login-Link. Auch in der kompakten Stoppuhransicht bleibt ein
Account-Trigger sichtbar. Event- und Ergebnislisten laden höchstens 50 Dokumente
pro Abfrage. Weitere Events lassen sich nachladen; Ergebnisse haben eine
Seitennavigation und sind innerhalb der angezeigten Seite nach Zeit sortiert.
Nur die sichtbare Ergebnisseite ist live verbunden; im ausgeblendeten Tab
pausiert die Verbindung. Filterwechsel und Speichern erzeugen keine zusätzliche
Vollabfrage. Ein PDF lädt auf ausdrücklichen Klick sämtliche Ergebnisse nach.

Für diese Begrenzung zuerst die neue Website veröffentlichen, anschließend die
aktuellen Firestore-Regeln. Alte Browserstände müssen danach aktualisiert werden.
Zusätzliche Indizes, App Check oder ein Tarifwechsel sind dafür nicht erforderlich.

### Sparsame Teilnehmerimporte

Die Personenansicht lädt den Eventkader einmal und hält ihn nur für die geöffnete
Ansicht im Arbeitsspeicher. Importsuchen laden höchstens zehn Suchtreffer und
lesen den Kader nicht erneut. Identische Suchbegriffe werden für 30 Sekunden
wiederverwendet (höchstens 40 Begriffe). Erfolgreiche Imports, manuelle Ergänzungen,
Bearbeitungen und Löschungen aktualisieren die vorhandene Anzeige direkt.
„Aktualisieren“ lädt Änderungen anderer Geräte ausdrücklich nach. Seitenwechsel
sowie Änderungen an Anmeldung oder Rollen verwerfen die zwischengespeicherten Daten.

Der Dublettenschutz verwendet `participantIdentities` mit einem Schlüssel aus
normalisiertem Namen, zweistelligem Jahrgang und Geschlecht. Teilnehmer und
Zuordnung werden in einer Transaktion geändert. Die Firestore-Regeln erzwingen
die Zuordnung auch für direkte Schreibzugriffe; parallele Imports können deshalb
nicht zwei Teilnehmer derselben Identität erzeugen. Auch Umbenennen und Löschen
geben die alte Zuordnung atomar frei. Bereits bestehende Dubletten werden nicht
gelöscht; ihre Zuordnung bleibt belegt, solange eine davon existiert.

Bestehende Events werden einmalig übernommen, sobald ein Organisator mit
Importberechtigung die Personenansicht öffnet. Dabei wird der bereits geladene
Serverbestand verwendet und pro Identität eine Zuordnung geschrieben. IDs und
Ergebnisverweise bleiben erhalten. Unterbrochene Übernahmen können wiederholt
werden; bis zum Abschluss verhindern die Regeln Teilnehmeränderungen. Trainer
mit Bearbeitungsrechten benötigen deshalb bei einem alten Event zuerst diesen
einmaligen Aufruf durch einen Organisator. Neue Events starten direkt mit
`participantIndexVersion: 1`.

Für die Veröffentlichung müssen **Website und aktuelle Firestore-Regeln zusammen**
bereitgestellt werden. Alte Browser-Versionen ohne Zuordnung können mit den neuen
Regeln keine Teilnehmer schreiben. Die Regeln lassen sich wie unten beschrieben
im vorhandenen kostenlosen Firebase-Projekt veröffentlichen; zusätzliche Dienste
oder ein kostenpflichtiger Tarif sind nicht erforderlich.

Tests für Leseumfang, Anzeige ohne erneutes Laden und Cache:

```powershell
node --test tests/timer_import.test.cjs tests/timer_people_view.test.cjs
```

`tests/firestore_rules.test.cjs` prüft außerdem parallele Imports, direkte
Umgehungsversuche, Umbenennen, Löschen und die Übernahme manueller Altbestände
gegen den lokalen Firestore-Emulator.

Die Oberfläche blendet gesperrte Funktionen aus. Entscheidend sind aber die
Regeln in `firestore.rules`: Sie prüfen jede Firestore-Anfrage unabhängig von
der Oberfläche.

## Clubs und Startberechtigungen

`gliederungen.html` ist die Admin-App zum Erstellen und Löschen von Clubs und zum
Zuordnen ihrer Verantwortlichen. Nur Admins vergeben oder entziehen Verantwortung;
auswählbar sind Trainer-, Organisator- und Adminkonten. `club-verwaltung.html` bietet Personen, Startberechtigungen
und die zunächst reine Mannschaftsliste. Zugeordnete Trainer und Organisatoren
wechseln zwischen ihren Clubs. Admins haben Zugriff auf alle Clubs.

Personen werden aus dem bestehenden Verzeichnis importiert und beginnen inaktiv.
Die Aktivierung gilt getrennt für das aktuelle und das nächste Kalenderjahr und
steuert beide Auswertungen. Neue Folgejahre beginnen ebenfalls inaktiv.
Verantwortliche erscheinen mit ihren globalen Kontorollen im Personenbestand.
Importierte Mitglieder erscheinen ohne Kontorolle und erhalten keine Clubrechte,
auch wenn ihr Konto Trainer oder Organisator ist. Admins behalten unabhängig von
Mitgliedschaft oder Verantwortung Zugriff auf alle Clubs. Ein Rollenwechsel oder
eine Personenverknüpfung vergibt keine neue Clubverantwortung.
Bei unverknüpften Konten stammen Name und Jahrgang aus dem Kontoprofil. Fehlt der
Jahrgang, wird dies in der Auswertung als fehlende Angabe angezeigt.

Die Daten liegen in `clubs/{clubId}`, `clubs/{clubId}/people/{memberId}`,
`clubAccounts/{uid}` und `clubProfiles/{uid}`. Prüfungsdaten liegen direkt auf
der Personenzuordnung im jeweiligen Club. Jeder neue Import beginnt mit leeren
Nachweisen, auch wenn die Person bereits einem anderen Club angehört. Das
Entfernen einer Clubzugehörigkeit löscht deren Nachweise. Ein Wiedereintritt
beginnt erneut ohne Nachweise. Das Löschen eines Clubs entfernt seine gesamten
Zuordnungen einschließlich Nachweisen. Andere Clubs bleiben eigenständig. Die ehemaligen privaten
Einträge unter `users/{uid}/startEligibility` werden nicht übernommen und durch
die Regeln gesperrt. Der alte Seitenlink führt zur Club-Verwaltung.

Clubnamen sind nach Entfernen äußerer Leerzeichen ohne Berücksichtigung der
Groß-/Kleinschreibung eindeutig. Zusätze wie `DLRG` oder `OG` bleiben Bestandteil
des Namens. Der Verzeichnisabgleich erzeugt zusätzlich `clubDirectory`. Bis zum
ersten Abgleich ermittelt die Admin-App die Namen aus dem Personenverzeichnis.

Rollenwechsel und normale Austritte prüfen alle verwalteten Clubs. Die letzte
verantwortliche Person muss dafür vorher ersetzt oder der Club gelöscht werden.
Bei einer Kontolöschung darf dagegen auch die letzte Verantwortung entfallen.
Ein unveränderlicher `accountDeletionStartedAt` markiert zunächst den Beginn der
Löschung und sperrt die bisherigen Rollenrechte. Danach werden ausschließlich die
eigenen Clubverantwortungen transaktional freigegeben; ein unterbrochener Ablauf
kann erneut gestartet werden. Die bestehende DB-Person bleibt mit ihren
Aktivjahren und Nachweisen Mitglied. Das Personenverzeichnis wird nicht gelöscht.
Clubs ohne Verantwortliche tragen `needsResponsible: true`. Admins sehen dafür
einen roten Zähler an der App und je Club eine Meldung. Die Hinweise verschwinden
bei neuer Zuordnung oder Club-Löschung. Ein Club kann weiterhin nicht einfach
ohne Ersatz verlassen werden.
Verantwortliche können selbst austreten, wenn eine weitere verantwortliche Person
bleibt. Die Admin-App kann Verantwortung entziehen, ohne Mitgliedschaft,
Aktivjahre oder Nachweise zu löschen.
Beim Löschen wird ein Club zuerst gesperrt, danach werden die Zuordnungen
entfernt. Ein unterbrochenes Löschen kann in der Admin-App fortgesetzt werden.

Clubs mit expliziter Zuordnung tragen `responsibilityVersion: 2`. Ältere Clubs
sind bis zur Umstellung nur für Admins zugänglich. Beim Öffnen von „Gliederungen“
bleibt die anhand identischer Erstellzeitpunkte eindeutig erkennbare erste
Zuordnung erhalten; alte, durch Import automatisch vergebene Rechte werden
entzogen, die Mitglieder und Nachweise bleiben erhalten. Ist die erste Zuordnung
nicht mehr erkennbar oder nicht mehr zulässig, bestätigt der Admin über die
Verantwortlichensuche eine neue Zuordnung. Der neue Abfrageindex muss gemeinsam
mit den Regeln veröffentlicht werden.

Vor der Nutzung müssen die Website sowie die Regeln und der Club-Abfrageindex
veröffentlicht werden:

```powershell
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project lifesaving-baden
```

`tests/clubs_rules.test.cjs` prüft Clubrechte, parallele Austritte, Rollenwechsel,
getrennte Clubnachweise und das Entfernen von Zuordnungen im lokalen Emulator.

## Zeiterfassung

Die App unter `arbeitszeiten.html` ist über eine grüne Kachel im Mitgliederbereich
für Trainer, Organisatoren und Admins erreichbar. Jeder sieht und bearbeitet nur
seine eigenen Einträge. Auch Admins und Organisatoren erhalten keinen Zugriff auf
fremde Detaildaten. Eine übergreifende Personenübersicht ist noch nicht enthalten.

Ein Eintrag enthält Von-Datum/-Uhrzeit und Bis-Datum/-Uhrzeit, Titel, eine optionale Beschreibung
und eine Kategorie: Trainer, Wettkampf, Organisation, Athletenbetreuung,
Fortbildungen, Social Media / Öffentlichkeitsarbeit oder Sonstiges. Auch zukünftige
Aufgaben sind erlaubt. Es gibt keine Pausen und keinen Freigabeprozess. Jeder kann bis zu drei eigene Gliederungen
hinterlegen und pro Aufgabe eine davon auswählen. Die Aufgabenliste kombiniert
deutliche Tagesüberschriften mit einer gemeinsamen Box pro Tag. Jede Aufgabe ist
eine vollständig anklickbare Zeile: links das Kategorie-Icon in Gliederungsfarbe,
mittig Titel und Beschreibung, rechts die Stunden (z. B. `2,50 Std.`).
Über der Box stehen Datum und Tagessumme. Lange Titel und Beschreibungen werden
platzsparend gekürzt; im Bearbeitungsdialog bleiben sie vollständig verfügbar.
Ein separates Bearbeiten-Icon gibt es nicht. Die Zeilen funktionieren auch per
Tastatur; auf Handys erhält beim Öffnen die Dialogüberschrift den Fokus, damit
die Tastatur erst nach dem Antippen eines Feldes erscheint. Die Löschfunktion
befindet sich als Papierkorb-Icon unten links im Bearbeitungsdialog. Gespeicherte Gliederungsnamen
bleiben bei späteren Änderungen der persönlichen Auswahl in alten Aufgaben erhalten.

Aufgaben können sich über mehrere Tage erstrecken. Bis-Datum und -Uhrzeit müssen
nach Von-Datum und -Uhrzeit liegen. In der Auswertung verteilt sich die Zeit auf die
tatsächlichen Kalendertage, auch an Wochen-, Monats- und Jahresgrenzen. Die
Aufgabenliste ordnet den vollständigen Eintrag weiterhin unter dem Startdatum ein.
Ältere Einträge ohne Bis-Datum
werden beim Bearbeiten mit ihrem bisherigen Enddatum geöffnet. Die Zeitzone ist unabhängig vom Gerät `Europe/Berlin`; die Dauer
berücksichtigt Zeitumstellungen. Doppelte Uhrzeiten beim Herbstwechsel verwenden
das erste Vorkommen; nicht existierende Uhrzeiten beim Frühjahrswechsel werden
abgewiesen. Direkt aneinander anschließende Aufgaben sind erlaubt.

Die Oberfläche trennt Aufgaben und Auswertung. Auf dem Handy zeigt die Auswertung
den Monat mit höchstens fünf Balken (1.–7., 8.–14. usw.) und ohne Filter oder
Zeitraum-Auswahl. Auf dem Desktop stehen Tag, Woche (ab Montag), Monat, Datumswahl,
Kategorie- und Gliederungsfilter zur Verfügung. Die Aufgabenansicht zeigt jeweils
einen Monat. Das Tagesdiagramm zeigt nur die Stunden am ausgewählten Tag. Bei der
Zeitumstellung hat ein Tag 23 bzw. 25 Stunden; die wiederholte Stunde wird im
Herbst gemeinsam dargestellt. Summen, Kategorien und Gliederungen enthalten nur
die Zeitanteile im ausgewählten Zeitraum einschließlich zukünftiger Einträge.
Auch Aufgaben, die vor dem Zeitraum begonnen haben, werden dafür geladen.
Diagramme stapeln die
Stunden wahlweise nach Gliederungen oder Kategorien. Die Umschaltung steht auch
auf dem Handy zur Verfügung. Gliederungen verwenden dieselben Farben wie die
Aufgabenliste; nicht zugeordnete Zeiten sind grau. Kategorien haben jeweils eine
feste Farbe. Die Legende zeigt die gewählte Aufteilung und die zugehörigen Summen.
Auf Handys stehen Kennzahlen, Diagramm und Kategorien in getrennten Bereichen.
Der Button „Aufgabe hinzufügen“ bleibt unten im Inhaltsbereich und läuft beim
Footer nach oben, sodass die Fußnavigation frei bleibt. Datum und Uhrzeit sind
breitenbegrenzt; bei höchstens 360 px stehen sie pro Von-/Bis-Gruppe untereinander.
Die mobile Zeiterfassung unterbindet Pinch- und Doppeltipp-Zoom in Aufgaben und
Auswertung. Scrollen mit einem Finger bleibt möglich; Formulare verwenden auf
Handys mindestens 16 px Schriftgröße gegen automatisches Zoomen beim Fokussieren.

Die Daten liegen unter `users/{uid}/worktimeEntries/{entryId}`, die persönlichen
Gliederungen unter `users/{uid}/worktimeSettings/preferences`. Das Feld `day`
enthält das Startdatum, `endDay` das Enddatum als UTC-Mitternacht zur
Kalenderzuordnung; `startedAt` und
`endedAt` enthalten die tatsächlichen Zeitpunkte. Pro Ansicht werden nur die
Einträge des gewählten Zeitraums geladen.

Speichern, Bearbeiten und Löschen verwenden Firestore-Transaktionen mit einer
geordneten Reservierungsliste unter `users/{uid}/worktimeSchedule/intervals`.
Die Sicherheitsregeln prüfen die benachbarten Intervalle sowie die vollständige
Änderung der Liste. Damit werden auch Überschneidungen an beliebigen mittleren
Tagen eines mehrtägigen Eintrags und konkurrierende Schreibvorgänge verhindert.
Die Liste ist auf 5.000 Einträge begrenzt und enthält nur IDs sowie Start- und
Endzeitpunkte. Titel, Notizen und Gliederungen bleiben in den Einzeldokumenten.

Vor dem Speichern werden die bestehenden Einträge vom Server geprüft. Einträge
aus V1/V2, die noch nicht in der Reservierungsliste stehen, werden einzeln und
transaktional übernommen. Titel, Gliederung, Zeitpunkte und Erstellungsdatum
bleiben erhalten. Bereits bestehende Überschneidungen müssen durch Bearbeiten
oder Löschen der betroffenen Aufgabe aufgelöst werden. Alte Tagesreservierungen
unter `worktimeDays` bleiben unverändert, privat und schreibgeschützt.
Speichern und Löschen benötigen eine Internetverbindung. Die neuen
Sicherheitsregeln müssen vor der Nutzung dieser Version veröffentlicht werden
(siehe unten).

Lokale Prüfungen:

```powershell
node --test tests/worktime.test.cjs tests/auth_flow.test.cjs
```

`tests/firestore_rules.test.cjs` prüft Zugriffsschutz, Datenvalidierung,
Überschneidungen, konkurrierende Schreibvorgänge und Gliederungseinstellungen
gegen den lokalen Firestore-Emulator. Die Browser-Testansicht
`tests/worktime.browser.html` lädt die echte Oberfläche mit eigenen Daten im
Arbeitsspeicher und ohne Firebase-Verbindung. Über den lokalen HTTP-Server lässt
sich damit auch die mobile Darstellung prüfen; die Testdaten werden nicht gespeichert.

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

Die Adminrolle kann weiterhin nicht über die Website vergeben werden. Die
Adminrolle wird ausschließlich direkt in Firebase gepflegt. Ein Admin kann in
der Website andere Konten zu Organisatoren, Trainern, Sportlern oder Standard-Nutzern
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

Der Import berücksichtigt alle Wettkampfjahre der XLSX-Quelle. Die frühere
Beschränkung auf das jüngste Jahr und dessen Vorjahr wurde entfernt. Pro
normalisiertem Namen, Geburtsjahr und Geschlecht wird eine Person mit der
zuletzt erfassten Gliederung übernommen; bestehende Personenreferenzen behalten
ihre ID. Ein leerer oder unbrauchbarer Import wird vor dem Synchronisieren
abgebrochen. Um ältere Personen sofort freizuschalten, nach Veröffentlichung
den Workflow einmal manuell ausführen. Er kann nur Personen übernehmen, die
tatsächlich in der Quelldatei stehen.

Unbegrenzte Lesezugriffe auf die globale Importliste bleiben Organisatoren
vorbehalten. Trainer dürfen begrenzte Suchabfragen mit höchstens zehn Treffern
verwenden. Bereits in ein Event übernommene Personen richten sich nach den
Zugriffsrechten des Events. Unveränderte Verzeichnisdokumente werden beim Sync
nicht erneut geschrieben; der Abgleich liest den bisherigen Bestand weiterhin.
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
