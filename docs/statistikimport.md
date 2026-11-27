# Wettkampfergebnisse aus Excel importieren

Ein Aufruf verarbeitet **einen ausgewählten Wettkampf**. Excel dient als Eingabe, Firestore als dauerhaftes Archiv. Das Werkzeug läuft auf dem Verwaltungsrechner. Es benötigt weder einen neuen Server noch weitere Pakete über die vorhandenen Entwicklungsabhängigkeiten hinaus.

## Erster Import unter Windows

1. Einmalig Python, die Pakete aus `requirements-dev.txt` und die Node-Werkzeuge gemäß [Entwicklung](development.md#voraussetzungen) installieren. Die Arbeitsmappe außerhalb des öffentlichen Repositorys aufbewahren.
2. Im Projektordner die **lokale Prüfung** starten. Im Dateidialog eine XLSX- oder XLSM-Datei wählen. Bei mehreren Blättern oder Wettkämpfen zeigt das Terminal eine nummerierte Auswahl. Auch ein verborgenes Datenblatt lässt sich auswählen.

   ```powershell
   .venv\Scripts\python.exe tools/import_statistics.py
   ```

3. Die angezeigten Zeilennummern in Excel prüfen. Änderungen können in einer privaten Importkopie erfolgen. Der lokale Lauf braucht weder Zugangsdaten noch Datenbankkontingent. Alternativ in Excel beide Kopfzeilen zusammen mit den Daten kopieren und `--clipboard` verwenden. Für UTF-8-Tabellentext sind auch `.tsv` und `.txt` möglich. Spalten und leere Zellen müssen durch Tabulatoren getrennt bleiben.
4. Für den **Datenbankvergleich** dieselbe Service-Account-Umgebungsvariable wie bei den vorhandenen Wartungswerkzeugen verwenden. Der Schlüssel bleibt in einer privaten Datei außerhalb des Projekts. Das Konto benötigt Firestore-Datenzugriff per IAM. Für einen reinen Vergleich genügt Lesezugriff. Der Projektwächter akzeptiert für den Echtbetrieb ausschließlich `lifesaving-baden`.

   ```powershell
   $env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content -Raw -Encoding UTF8 'C:\Privat\firebase-service-account.json'
   .venv\Scripts\python.exe tools/import_statistics.py 'C:\Privat\Ergebnisse.xlsx' --event 'BaWü-SEN - 2026' --compare
   ```

5. Die Vorschau listet neue Personen und Organisationen, geänderte Felder mit altem und neuem Wert sowie die Anzahlen neuer, geänderter und unveränderter Dokumente je Collection auf. Besonders auf neue Namen bei Korrekturimporten, die historische Organisation und Disziplinen achten, die im neuen Datensatz leer sind.
6. Zum **Schreiben** denselben Befehl mit `--apply` ausführen. Das Werkzeug erstellt eine frische Vorschau und zeigt Zielprojekt, Wettkampf und Schreibanzahl. Erst die Eingabe **IMPORT** übernimmt sie. Bei null Änderungen endet der Lauf sofort. Ein separater vorheriger `--compare` ist optional und kostet beim Echtbetrieb einen zusätzlichen Lesevorgang je verglichenem Dokument.

   ```powershell
   .venv\Scripts\python.exe tools/import_statistics.py 'C:\Privat\Ergebnisse.xlsx' --event 'BaWü-SEN - 2026' --apply
   Remove-Item Env:FIREBASE_SERVICE_ACCOUNT_JSON
   ```

Für eine feste Blattauswahl `--sheet 'Blattname'` ergänzen. Zum Üben einen lokalen Firestore-Emulator im Projekt mit `npx --no-install firebase emulators:start --only firestore --project demo-lifesaving-baden` starten und beim Import `--emulator --apply` verwenden. Der Emulator-Modus verwendet ausschließlich einen lokalen Host und dieses Demo-Projekt. Die Terminalvorschau enthält personenbezogene Daten. Excel-Dateien, private Kopien, Schlüssel und mitgeschnittene Terminalausgaben gehören außerhalb von GitHub Pages.

## Wie Excel gelesen wird

Die erste Kopfzeile benennt die 17 Disziplinen, die zweite die 109 Spalten. Der Importer erkennt jeden Fünferblock über seinen Namen und die Unterspalten `Pl / Time / Points / C / St`. Er behandelt Zeilenumbrüche, geschützte Leerzeichen, zusammengeführte Titelzellen und die Originalabkürzung „25m Rü. ohne Arme“. Umgestellte vollständige Blöcke behalten ihre Disziplin-ID. Unbekannte oder doppelte Spalten bzw. Blöcke stoppen den Import. XLSM-Makros werden nicht ausgeführt. Formeln brauchen einen in der Arbeitsmappe gespeicherten Ergebniswert.

| Excel | Archiv und Interpretation |
|---|---|
| Name, Gender, Age | Nachname und Vorname getrennt, Geschlecht und vierstelliger Geburtsjahrgang. Die explizite Nummer „(2)“ bleibt ein eigenes Identitätsmerkmal. |
| AK, OG, BZ, LV, BV, St. Recht | Altersklasse als Text, vier historische Verbands-IDs und Startrecht pro Ergebnis. „Standard“ ist ein regulärer Wert. |
| PLACE, 3-Kampf, 4-Kampf (ohne HLW) | Gesamtplatz, allgemeine Mehrkampfpunkte und eigene Vierkampfwertung. Fehlende Werte bleiben leer, numerische Null bleibt Null. |
| LSC, LSC Change, HLW | Der vorhandene LSC und der alte Änderungswert bleiben erhalten. Das zusätzliche HLW-Feld aus Spalte 99 bleibt in seinem ursprünglichen skalaren Zelltyp erhalten. |
| Pl, Time, Points, C, St | Disziplinplatz, Millisekunden, bereits bereinigte Punkte, Fehlercode, numerische Strafpunkte und Status. „0:59,89“ ergibt 59.890 ms. „disq“ ergibt DQ, „n.a.“ ergibt DNS. Der Import zieht Strafen kein zweites Mal ab. Ein vollständig leerer Block erzeugt keinen Disziplineintrag. |
| Datum, Wettkampf, WK-Name | ISO-Kalendertag, eindeutiger Kurzname, Langname. Excel-Zahl 46340 ergibt im 1900-Datumssystem den 14.11.2026. XLSX/XLSM verwenden das Datumssystem der Mappe. Für eingefügten Text mit 1904-Datumssystem das Datum als ISO- oder deutsches Datum kopieren. |
| Bahn, Rule, Land, Stadt | Beckenlänge in Metern, Regelwerk, Land und Stadt des Wettkampfs. Regelwerks- und Wertungsnamen sind erweiterbare Texte. |
| Lauf, Wertung | Laufnummer und optional ausdrücklich vorhandener Nenner, dazu die Originalwertung wie „3Kampf“. Ein leerer Lauf bleibt ein direktes Finale. Ein einzelnes „1“ enthält keine Information über die Anzahl der Läufe. |

### Identität und Prüffälle

- Für einen zweistelligen Jahrgang verwendet der Import das **Wettkampfjahr**. Als ausdrücklich gewählte Plausibilitätsannahme gelten 0 bis 110 Jahre. Gibt es zwei mögliche Jahrhunderte, nennt die Meldung beide Jahrgänge. Beispiel 2026 mit `Age=20` ergibt 1920 oder 2020. Nach Prüfung den vollständigen Jahrgang in die Importkopie eintragen. AK und LSC Change sind keine zuverlässigen Geburtsjahresquellen.
- Exakte Identitätsmerkmale erlauben eine Zuordnung über mehrere Wettkämpfe. Leerraum und Groß-/Kleinschreibung sind für die ID vereinheitlicht. Umlaute, Bindestriche und Nummern bleiben unterscheidbar. Es gibt keine unscharfe Namenszusammenführung. Unterschiedliche Schreibweisen zur gleichen ID, widersprüchliche Wettkampfdaten, fehlende Eltern einer genannten Organisation und doppelte Personen-/Laufschlüssel werden zur Prüfung gemeldet. Fehlende Verbandsangaben können leer bleiben, wenn auch die untergeordneten Ebenen fehlen.
- Bei identischem Namen, Jahrgang und Geschlecht können die Quelldaten zwei Menschen nur mit einer zusätzlichen Kennzeichnung unterscheiden. Die etablierte Nummerierung in allen zugehörigen Zeilen beibehalten. Der Importer kann einen quer über Wettkämpfe fehlenden Gleichnamigen-Zusatz nicht aus Zeiten oder Verein beweisen. Stellen zwei historische Schreibweisen dieselbe Person dar, vor dem Import die bestätigte Archivschreibweise in der Importkopie verwenden.
- Der einmal festgelegte Schlüssel dient auch künftigen Importen. Eine Änderung am Kurz­namen, Geburtsjahrgang, Namenszusatz oder an der Laufnummer kann eine andere ID liefern. Die Vorschau meldet dann eine Neuanlage. Bei einer beabsichtigten Identitätskorrektur den Lauf abbrechen und die betroffenen Verweise gesondert zuordnen. Datenbank-IDs werden durch dieses Werkzeug weder umbenannt noch bereinigt.

### Wiederholung, Korrektur und Abbruch

Jede eingereichte Ergebniszeile beschreibt den **vollständigen Stand dieses Laufs**, einschließlich der leeren Disziplinblöcke. Damit kann eine korrigierte Zeile auch eine irrtümlich erfasste Disziplin entfernen. Die Änderung erscheint in der Vorschau. Andere Ergebniszeilen dürfen in der Importdatei fehlen. Der Import liest nur ausdrücklich adressierte Dokumente und enthält keine Löschoperation für Dokumente.

Neue Dokumente werden mit einer Nichtexistenzbedingung geschrieben, Änderungen mit der Version aus der Vorschau. Wurde ein betroffenes Dokument zwischenzeitlich verändert, schlägt der betreffende atomare Block fehl. Stamm- und Katalogdaten stehen vor den Ergebnissen in der Schreibreihenfolge. Jeder Block enthält höchstens 200 Änderungen. Bei mehr als 200 Änderungen kann ein Teil bereits gespeichert sein.

Nach Bestätigung nennt die Ausgabe die lokale JSONL-Protokolldatei unter `~/.lifesaving-baden/importprotokolle/`. Sie enthält Laufzeit, Ziel, Wettkampf-ID, Fingerabdruck der Eingabedokumente, Sollanzahl, bestätigte Blockfortschritte und Abschluss oder Abbruch. Nach Stromausfall kann die letzte Protokollzeile fehlen. Dieselbe Eingabe erneut mit `--apply` öffnen. Der frische Datenbankvergleich erkennt bereits bestätigte Schreibvorgänge. Das funktioniert auch, wenn nur die Rückmeldung eines erfolgreichen Blocks verloren ging.

## Architekturentscheidung

Im aktuellen Repository sind `wettkaempfe.html` und `rekorde.html` Seiten mit leerem Inhaltsbereich. Der Punkterechner ist eine eigene Browserfunktion. Die Kontoeinstellungen zeigen das Mitgliederprofil. Wettkampfstatistiken, Sportler-Leistungskurven und historische Ranglisten sind hier noch nicht implementiert. Der historische Excel-/VBA-Quellcode der alten Website liegt diesem Repository nicht bei.

Die vorhandene Personen-/Clubsuche nutzt eigene Verzeichnisse. `tools/build_participant_directory.py` erzeugt aus einer privaten Arbeitsmappe die jeweils jüngste Suchidentität. Die Synchronisation darf aus der Suchliste entfallene Einträge bereinigen. Das Archiv benötigt dauerhafte historische Verweise. `clubs` verwaltet bereits Verantwortliche, Kader und Termine. `timerEvents/{id}/results` speichert Messungen mit Zwischenzeiten, Eventrechten und Offline-IDs. Authentifizierung, Kontolinks und Firestore-Regeln dieser Bereiche haben eigene Aufgaben. Die neuen Daten erhalten deshalb eigene Collection-Namen in derselben Standarddatenbank.

| Variante | Abwägung |
|---|---|
| Lokaler Import mit vorhandenen Werkzeugen | Gewählt. Python/openpyxl liest Excel, ein kleiner Node-Prozess verwendet den bereits installierten Admin SDK und den Projektwächter. Eine Bedienoberfläche im Terminal, keine neue Bibliothek. |
| Rein Python oder rein Node | Technisch möglich. Rein Python braucht einen zusätzlichen Firestore-Client, rein Node einen zusätzlichen XLSX-Parser. |
| Import im Web-Admin | Würde Parser, Schreibberechtigungen, Sitzungs- und Wiederanlaufbehandlung im Browser benötigen. Für einen Administrator ist der lokale Import einfacher. |
| SQL/SQLite als Hauptdatenbank | SQL eignet sich für beliebige Joins und Ad-hoc-Analysen. Eine gemeinsam beschreibbare Online-Datenbank bräuchte einen weiteren Betriebsweg. SQLite ist später als lokales Analysewerkzeug möglich. |
| Nur statische JSON-Dateien | Günstig für fertige Ranglisten. Als einziges Archiv erschweren sie geschützte Rohdaten, gezielte Korrekturen und konkurrierende Schreibvorgänge. |

### Schema und Indizes

| Collection | ID und Felder |
|---|---|
| `statsAthletes` | `A…` aus Nachname, Vorname, Jahrgang, Geschlecht, Nummer. `firstName,lastName,gender` Text, `birthYear` Ganzzahl, `discriminator` Ganzzahl/null. |
| `statsOrganizations` | `C…` aus Typ, Eltern-ID und Name. `type,name` Text, `parentId,successorId` ID/null, `active` Boolean. Ein Import initialisiert den Nachfolger bei Neuanlage mit null und bewahrt gepflegte Nachfolger bei Wiederholung. |
| `statsCompetitions` | `W…` aus dem eindeutigen Kurz­namen. `name,fullName,rule,country,city` Text, `date` als sortierbarer ISO-Text, `poolLength` Ganzzahl/null. |
| `statsDisciplines` | Fester Katalog `D001` bis `D017` in der angegebenen Originalreihenfolge. `name,category` Text, `distance,sortOrder` Ganzzahl. Neue Disziplinen erhalten neue IDs. |
| `statsResults` | `R…` aus Wettkampf-ID, Sportler-ID und Laufnummer bzw. null. `athleteId,competitionId` sowie `ogId,bzId,lvId,bvId` als Verweise. `gender,ageGroup,startRight,classification` Text. `round,roundTotal,place` Ganzzahl/null. `overallPoints,fourEventPoints,lsc,legacyLscChange` Zahl/null. `hlw` Originalwert/null. `disciplines` ist eine Map mit den sechs unten beschriebenen Werten je belegter Disziplin. |

Eine Disziplin enthält `place` und `timeMs` als Ganzzahl/null, `points` und `penaltyPoints` als Zahl/null, `faultCode` als Text/null sowie `status` als OK, DQ oder DNS. Mit höchstens 17 Einträgen bleibt die Map überschaubar. Ein Lauf einschließlich seiner Disziplinen benötigt einen Lesezugriff und kann atomar korrigiert werden. Separate Disziplinergebnisse würden globale Abfragen nach Disziplin vereinfachen, aber bei jedem Import und jeder Wettkampfansicht zusätzliche Dokumentzugriffe erzeugen.

Die abgeleiteten IDs verwenden einen Typpräfix und die ersten 128 Bit eines SHA-256-Hashes über die strukturierten Schlüsselwerte. Dadurch sind weder Zählerdokumente noch eine Suche durch alle Personen nötig. Die historische Verbandshierarchie, Wettkampf-AK und Geschlecht stehen bewusst auch am Ergebnis. Für eine heutige gemeinsame Vereinswertung folgt die Auswertung den gepflegten `successorId`-Verweisen auf denselben Nachfolger. Historische OGs behalten ihre IDs. Eine Fusion wird fachlich bestätigt, nicht anhand ähnlich klingender Ortsnamen geraten. Bei der späteren Auswertung Nachfolgerketten auf Zyklen prüfen.

Der Import liest ausschließlich per Dokument-ID. **Zusammengesetzte Indizes braucht er nicht.** Die Konfiguration in `firestore.indexes.json` nimmt die Disziplin-Map von automatischen Einzelindizes aus. Das spart Indexspeicher. Die Ausnahme kann bei einem geplanten Index-Deployment übernommen werden. Der Import funktioniert bereits mit den Standardindizes. Die Einzelindizes auf `competitionId` oder `athleteId` genügen später zum gezielten Laden der Ergebniszeilen. Für eine tatsächlich gebaute Mehrfeldabfrage gezielt einen Index ergänzen, beispielsweise `competitionId ASC, place ASC` für die sortierte Platzliste einer homogenen Wertung. Gemischte AKs, Geschlechter und Läufe vor der fachlichen Rangbildung trennen.

### Lesestrategie und öffentliche Ansichten

| Spätere Ansicht | Günstiger Zugriff |
|---|---|
| Wettkampf | Metadaten einmal pro Ansicht laden, Ergebnisse nach Wettkampf-ID mit Cursor und Limit paginieren. Namen und Organisationen für die sichtbare Seite nach eindeutigen IDs laden und wiederverwenden. |
| Sportlerprofil und persönliche Bestzeiten | Nur die Ergebnisse dieser Sportler-ID auswerten. Ein kleines Profil mit persönlichen Bestzeiten und datierten Verlaufswerten kann nach einer Korrektur für genau diesen Sportler neu berechnet werden. |
| Jahres-, AK-, Vereins- und ewige Bestenlisten | Freigegebene Ranglisten nach Disziplin, Jahr, Regel und Bahn lokal vorberechnen und in kleinen, versionierten Seiten über GitHub Pages ausliefern. Ein Manifest benennt die aktuelle Version. Wiederholte Aufrufe derselben Datei verursachen keine Firestore-Lesezugriffe. |
| Medaillen, DQ-Quote, LSC und Verbandsstatistik | Zuerst je Wettkampf gruppieren, anschließend betroffene Jahre/Organisationen aktualisieren. Für eine Korrektur die alte und die neue Gruppenzugehörigkeit einbeziehen. DQ und DNS getrennt zählen. Bestzeiten nur aus gültigen Zeiten bilden, Medaillen nur aus der fachlich richtigen Final-/Wertungsgruppe. |

Die vorberechneten Ansichten sind ein Ausbaupfad. Für den ersten öffentlichen Bildschirm empfiehlt sich eine freigegebene Wettkampfseite als kleine Datei. Für wiederkehrende globale Abfragen über 100.000 Datensätze sollte die Website niemals bei jedem Besucher das Archiv durchlaufen. Freie Kombinationen vieler Filter und interaktive Ad-hoc-Joins wären ein Grund, die Analyse später lokal oder in SQL auszuführen. Das Archiv kann dabei in Firestore bleiben.

**Öffentliche Daten.** Aggregierte Ranglisten ohne Personenbezug brauchen weder Namen noch Geburtsjahrgänge. Eine fachlich freigegebene persönliche Rangliste benötigt üblicherweise Anzeigename, Disziplin, Leistung, Wettkampf, Jahr sowie je nach Ansicht AK und Verein. Ein voller Geburtsjahrgang ist für die interne Identitätsprüfung hilfreich. Kontodaten, E-Mails, Geburtstage, interne Unterscheidungsmerkmale und Verknüpfungen werden für eine öffentliche Bestenliste nicht benötigt. Für Minderjährige und namentliche Einzelprofile den vorgesehenen Veröffentlichungskreis vor dem Export festlegen. Statische Dateien auf GitHub Pages sind öffentlich abrufbar; für eine ausschließlich angemeldete Zielgruppe ist ein getrenntes, per Firestore-Regeln geschütztes Lesemodell erforderlich.

Die Archiv-Collections sind durch die derzeitigen Regeln für alle Browserclients gesperrt, auch für angemeldete Web-Admins. Der lokale Server-SDK authentifiziert sich über IAM. Eine spätere Veröffentlichung soll eigens freigegebene Ausgabefelder enthalten. Firestore-Leserechte gelten für das ganze Dokument. [Firestore-Sicherheitsregeln](https://firebase.google.com/docs/firestore/security/get-started)

## Kostenloser Betrieb und Größenordnung

Stand der Prüfung **27. November 2026**, Cloud Firestore Standard. Das kostenlose Kontingent gilt für genau eine Datenbank pro Projekt. Mitgliederbereich, Timer und Archiv teilen sich das verfügbare Kontingent. Tageskontingente beginnen ungefähr um Mitternacht pazifischer Zeit neu. [Offizielle Kontingente und technische Grenzen](https://firebase.google.com/docs/firestore/quotas)

| Ressource | Spark-Freikontingent |
|---|---:|
| Dokumentlesevorgänge | 50.000 pro Tag |
| Dokument-Schreibvorgänge | 20.000 pro Tag |
| Dokumentlöschungen | 20.000 pro Tag |
| Gespeicherte Daten einschließlich Indizes | 1 GiB |
| Ausgehende Datenübertragung | 10 GiB pro Monat |

**Rechenbeispiel für einen Import.** 500 Ergebniszeilen, 400 eindeutige Sportler, 50 Organisationen, ein Wettkampf und 17 Katalogeinträge ergeben rund **968 adressierte Dokumente**. Ein erstmaliger Import in ein leeres Archiv benötigt ungefähr 968 Reads und 968 Writes. Eine identische Wiederholung benötigt ungefähr 968 Reads und null Writes. Bei einer einzigen geänderten Ergebniszeile derselben Datei fällt ein Write an. Ein einzelner Aufruf mit `--apply` enthält den Vergleich bereits. Netzwerk-Wiederholungen und andere Projektzugriffe sind in diesen Zahlen nicht enthalten.

**Rechenbeispiel für den Betrieb.** Angenommene 40 Reads je öffentlichem Seitenaufruf würden bei 1.250 Aufrufen das gesamte Tageskontingent verbrauchen. Sind 10.000 Reads für Mitgliederbereich und Timer reserviert, bleiben rechnerisch 1.000 solche Aufrufe. Bei angenommenen 4 KiB je Ergebnis einschließlich Indexanteil entspräche 1 GiB rund 262.000 Zeilen, vor Stammdaten und vorhandenem Datenbestand. Die tatsächliche Größe hängt unter anderem von belegten Disziplinen und Indizes ab. Nach einem kleinen Import Speicher und Nutzung in der Firebase-Konsole messen und mit den geplanten Altbeständen hochrechnen. Historische Importe wettkampfweise über mehrere Tage verteilen, wenn die Vorschauen die verbleibende Tagesreserve überschreiten.

Spark kostet innerhalb dieser Kontingente **0 €**. Ein ausgeschöpftes Kontingent kann Zugriffe blockieren. Für den Kostenrahmen den Spark-Tarif beibehalten, kein Cloud-Billing-Konto verknüpfen und Billing-/Owner-Rechte eng vergeben. Blaze ist verbrauchsabhängig mit standortabhängigen Preisen. Budgetwarnungen sind dort keine harte Kostengrenze. [Firebase-Tarife](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Firestore-Preise, Indexzugriffe, Speicher und Listener](https://firebase.google.com/docs/firestore/pricing)

Cloud Functions für serverseitige Berechnungen, Cloud Storage für Datei-Uploads sowie verwaltete Firestore-Backups, Wiederherstellung, PITR, Klonen und TTL-Löschungen benötigen aktivierte Abrechnung. Der lokale Import und vorberechnete öffentliche Dateien auf der vorhandenen GitHub-Pages-Seite kommen ohne diese Dienste aus. Private Quelldateien und bestätigte manuelle Zuordnungen lokal sichern. [Firebase-Tarife](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Storage-Anforderungen](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) · [Firestore-Kontingente](https://firebase.google.com/docs/firestore/quotas)
