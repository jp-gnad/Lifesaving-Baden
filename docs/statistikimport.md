# Wettkampfergebnisse aus Excel importieren

Ein Import verarbeitet **einen ausgewählten Wettkampf**. Excel dient als Eingabe, Firestore als dauerhaftes Archiv.

## Import im Admin-Bereich

1. Mit dem Admin-Konto anmelden und im Mitgliederbereich **Datenbank → Importieren** öffnen.
2. Eine XLSX- oder XLSM-Datei bis 30 MB in das Feld ziehen oder **Datei auswählen** anklicken. Tabellenblatt und Wettkampf auswählen. Auch ausgeblendete Blätter erscheinen in der Auswahl.
3. **Vorschau erstellen** wählen. Die Seite prüft Excel-Zeilen und gleicht die betroffenen Dokumente mit Firestore ab. Die Vorschau zeigt neue, geänderte und unveränderte Ergebnisse sowie die geplanten Schreibvorgänge. Über den Sportlernamen lassen sich die Disziplinen und Änderungen einblenden.
4. **Import bestätigen** und **Jetzt speichern** wählen. Die Seite zeigt den Fortschritt. Bei einer Unterbrechung dieselbe Datei verwenden und eine frische Vorschau erstellen. Bereits gespeicherte Dokumente werden beim Abgleich erkannt.

Die Arbeitsmappe wird im Browser gelesen. Ein Datenbankvergleich lädt die betreffenden Archivdokumente anhand ihrer IDs. Die Browser-Variante benötigt die bestehende Firebase-Anmeldung. Die Firestore-Regeln aus dem Projekt müssen vor der Freigabe dieser Seite veröffentlicht werden. Die Änderungen werden in Blöcken gespeichert. Die Transaktion liest die geänderten Dokumente vor dem Schreiben erneut und gleicht sie mit der Vorschau ab.

## Wettkämpfe und Ergebnisse ansehen

Unter **Datenbank → Übersicht** stehen importierte Wettkämpfe nach Datum, der neueste zuerst. Beim Öffnen eines Wettkampfs lassen sich Altersklassen und darin die Geschlechter aufklappen. Mehrere Phasen oder Wertungsarten erhalten eigene Tabellen. Die Gliederung zum Startrecht erscheint beim Ergebnis. Zeiten werden in Minuten, Sekunden und Hundertsteln angezeigt, Jahrgänge zweistellig. Bei breiten Tabellen lässt sich der Disziplinbereich horizontal scrollen. Gesamtplatz und Name bleiben dabei sichtbar.

Die Übersicht lädt Wettkämpfe in Seiten von 20 und die Ergebnisse des geöffneten Wettkampfs in Seiten von 50. Personen, Gliederungen und Disziplinnamen werden erst beim Öffnen eines Ergebnisblocks geladen und für diesen Wettkampf wiederverwendet.

Unter **Datenbank → Struktur** lässt sich jeweils eine Sammlung auswählen. Die Ansichten für Disziplinen, Wettkämpfe, Athleten und Gliederungen erklären die Feldnamen und zeigen beim Aufklappen die gespeicherten Werte und Dokument-IDs. Bei Gliederungen stehen die Namen der übergeordneten oder nachfolgenden Organisation neben ihrer ID, sobald deren Dokument geladen ist. Die Stammdatenansicht ist schreibgeschützt und lädt jeweils bis zu 30 Einträge pro Seite.

Unter **Struktur → Gliederungen** erscheint ein aufklappbarer Stammbaum. Er zeigt zunächst Bundesverbände und lädt beim Öffnen die direkt untergeordneten Landesverbände, Bezirke oder Ortsgruppen. Ortsgruppen ohne Bezirk erscheinen direkt unter ihrem Landesverband. Die Gliederungsdaten lassen sich am jeweiligen Eintrag öffnen. Kinder einer zugeordneten Alt-ID sind im gemeinsamen Zweig sichtbar.

Unter **Struktur → Gliederungen → Mögliche Dubletten prüfen** lassen sich gleich oder ähnlich benannte Gliederungen derselben Ebene anhand ihrer Verbandspfade und Dokument-IDs vergleichen. Der Bericht lädt die Gliederungen auf Anforderung in Seiten von bis zu 50 Dokumenten. Bei früheren Importen konnten unterschiedliche Eingabekürzel trotz gleichem Anzeigenamen verschiedene IDs erzeugen.

Die Prüfung schlägt für eindeutig zuordenbare Alt-IDs das bereits vorhandene Dokument nach dem aktuellen Importschema vor. Die Eltern müssen auf denselben Verbandspfad führen. Aktivstatus und Nachfolger müssen übereinstimmen. **Alt-IDs zuordnen** speichert nach Bestätigung den Verweis `aliasOf`. Die Struktur listet danach den gemeinsamen Eintrag. Historische Ergebnisverweise bleiben gültig, weil die alten Dokumente bestehen bleiben. Die Liste der offenen Dubletten enthält weiterhin Fälle, für die es keine eindeutige Zuordnung gibt.

## Lokaler Import unter Windows

Die Kommandozeile bleibt für lokale Prüfungen und Wartung verfügbar.

1. Einmalig Python, die Pakete aus `requirements-dev.txt` und die Node-Werkzeuge gemäß [Entwicklung](development.md#voraussetzungen) installieren. Die Arbeitsmappe außerhalb des öffentlichen Repositorys aufbewahren.
2. Im Projektordner die **lokale Prüfung** starten. Im Dateidialog eine XLSX- oder XLSM-Datei wählen. Falls sich kein Fenster öffnen lässt, fragt das Programm nach dem Dateipfad. Im Explorer per Rechtsklick auf die Datei „Als Pfad kopieren“ wählen, den Pfad einfügen und Enter drücken. Bei mehreren Blättern oder Wettkämpfen zeigt das Terminal eine nummerierte Auswahl. Auch ein verborgenes Datenblatt lässt sich auswählen.

   ```powershell
   .venv\Scripts\python.exe tools/import_statistics.py
   ```

3. Die angezeigten Zeilennummern in Excel prüfen. Änderungen können in einer privaten Importkopie erfolgen. Der lokale Lauf braucht weder Zugangsdaten noch Datenbankkontingent. Alternativ in Excel beide Kopfzeilen zusammen mit den Daten kopieren und `--clipboard` verwenden. Für UTF-8-Tabellentext sind auch `.tsv` und `.txt` möglich. Spalten und leere Zellen müssen durch Tabulatoren getrennt bleiben.
4. Für den **Datenbankvergleich** nach der Excel-Auswahl die private JSON-Schlüsseldatei des Firebase-Dienstkontos für `lifesaving-baden` auswählen. Die Datei privat außerhalb des Repositorys aufbewahren. Falls noch kein Schlüssel vorliegt, lässt er sich unter Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren herunterladen. Eine bereits gesetzte Umgebungsvariable `FIREBASE_SERVICE_ACCOUNT_JSON` verwendet das Programm automatisch. Für den Vergleich benötigt das Dienstkonto Leserechte, zum Import zusätzlich Schreibrechte. [Firebase-Anleitung](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments)

   ```powershell
   .venv\Scripts\python.exe tools/import_statistics.py 'C:\Privat\Ergebnisse.xlsx' --event 'BaWü-SEN - 2026' --compare
   ```

5. Die Vorschau listet neue Personen und Organisationen, geänderte Felder mit altem und neuem Wert sowie die Anzahlen neuer, geänderter und unveränderter Dokumente je Collection auf. Besonders auf neue Namen bei Korrekturimporten, die historische Organisation und Disziplinen achten, die im neuen Datensatz leer sind.
6. Zum **Schreiben** denselben Befehl mit `--apply` ausführen. Das Werkzeug erstellt eine frische Vorschau und zeigt Zielprojekt, Wettkampf und Schreibanzahl. Erst die Eingabe **IMPORT** übernimmt sie. Bei null Änderungen endet der Lauf sofort. Ein separater vorheriger `--compare` ist optional und kostet beim Echtbetrieb einen zusätzlichen Lesevorgang je verglichenem Dokument.

   ```powershell
   .venv\Scripts\python.exe tools/import_statistics.py 'C:\Privat\Ergebnisse.xlsx' --event 'BaWü-SEN - 2026' --apply
   ```

Für eine feste Blattauswahl `--sheet 'Blattname'` ergänzen. Zum Üben einen lokalen Firestore-Emulator im Projekt mit `npx --no-install firebase emulators:start --only firestore --project demo-lifesaving-baden` starten und beim Import `--emulator --apply` verwenden. Der Emulator-Modus verwendet ausschließlich einen lokalen Host und dieses Demo-Projekt. Die Terminalvorschau enthält personenbezogene Daten. Excel-Dateien, private Kopien, Schlüssel und mitgeschnittene Terminalausgaben gehören außerhalb von GitHub Pages.

## Wie Excel gelesen wird

Die erste Kopfzeile benennt die 17 Disziplinen, die zweite die Datenspalten. Die alten Excel-Spalten `4-Kampf (ohne HLW)` und `LSC Change` sind optional. Der Importer erkennt jeden Fünferblock über seinen Namen und die Unterspalten `Pl / Time / Points / C / St`. Er behandelt Zeilenumbrüche, geschützte Leerzeichen, zusammengeführte Titelzellen und die Originalabkürzung „25m Rü. ohne Arme“. Umgestellte vollständige Blöcke behalten ihre Disziplin-ID. Unbekannte oder doppelte Spalten bzw. Blöcke stoppen den Import. XLSM-Makros werden nicht ausgeführt. Formeln in importierten Spalten brauchen einen in der Arbeitsmappe gespeicherten Ergebniswert.

| Excel | Archiv und Interpretation |
|---|---|
| Name, Gender, Age | Nachname und Vorname getrennt, Geschlecht (m oder w) und vierstelliger Geburtsjahrgang. Die explizite Nummer „(2)“ bleibt ein eigenes Identitätsmerkmal. |
| AK, OG, BZ, LV, BV, St. Recht | Altersklasse als Text, vier historische Verbands-IDs und Startrecht pro Ergebnis. "Standard" ist ein regulärer Wert. `St. Recht` gibt an, für welche Ebene die Person gestartet ist. Bei `BV` kann im selben Ergebnis weiterhin die Heimat-OG stehen. |
| PLACE, 3-Kampf | Gesamtplatz und Mehrkampfpunkte. `AK` (außer Konkurrenz) oder `ausg.` (ausgeschlossen) in `PLACE` kennzeichnen die Gesamtwertung der Person in diesem Wettkampf. |
| LSC | Der vorhandene LSC wird als Zahl übernommen. |
| HLW | Historische Disziplin `D018`. Der Import speichert 200 oder 500 Punkte als bestanden und 0 Punkte als disqualifiziert. `n.a.` steht für nicht angetreten. Bei einer leeren Zelle entfällt der Disziplineintrag. Enthaltene HLW-Punkte sind bereits Teil der Mehrkampfpunkte aus `3-Kampf`. |
| Pl, Time, Points, C, St | Disziplinplatz, Millisekunden, bereits bereinigte Punkte, Fehlercode, numerische Strafpunkte und Status. `AK` oder `ausg.` in `Pl` gelten für diese Disziplin. „0:59,89“ ergibt 59.890 ms. „disq“ ergibt DQ, „n.a.“ ergibt DNS. Der Import zieht Strafen kein zweites Mal ab. Ein vollständig leerer Block erzeugt keinen Disziplineintrag. |
| Datum, Wettkampf, WK-Name | ISO-Kalendertag, eindeutiger Kurzname, Langname. Excel-Zahl 46340 ergibt im 1900-Datumssystem den 14.11.2026. XLSX/XLSM verwenden das Datumssystem der Mappe. Für eingefügten Text mit 1904-Datumssystem das Datum als ISO- oder deutsches Datum kopieren. |
| Bahn, Rule, Land, Stadt | Beckenlänge in Metern, Regelwerk, Land und Stadt des Wettkampfs. `GER` in der Spalte `Land` wird als `Deutschland` gespeichert. Regelwerks- und Wertungsnamen sind erweiterbare Texte. |
| Lauf, Wertung | `Lauf` enthält die Wettkampfphase. Bei ausschließlich `1` gibt es einen Durchgang ohne separate Finalphase. Ist die höchste Phase `2`, gilt `1` als Vorlauf und `2` als Finale. Bei höchster Phase `3` gilt `2` als Zwischenlauf und `3` als Finale. Eine leere Zelle bleibt als direktes Finale unterstützt. `Wertung` bleibt als Text wie „3Kampf“ erhalten. |

Der Import ermittelt die Phasenanzahl aus der höchsten Phasennummer in den Zeilen des ausgewählten Wettkampfs und speichert sie dort als `phaseCount`. Für das erste Erfassen der Phasenanzahl eines bereits importierten Wettkampfs die vollständigen Wettkampfdaten erneut einlesen. Bei späteren Teilimporten bleibt eine höhere gespeicherte Phasenanzahl erhalten. Die Phasennummer trägt zusammen mit Wettkampf und Person zur Ergebnis-ID bei.

### Identität und Prüffälle

In der Excel-Spalte BV führen `GER`, `DEU`, `DE` und `Deutschland` zur selben ID und zum Anzeigenamen „Deutschland“. Beim nächsten bestätigten Import wird ein bereits gespeicherter Name `GER` unter derselben ID aktualisiert. Sind in der Excel-Zeile die Heimat-OG und ihre Verbandsebenen eingetragen, bleiben diese auch bei einem Start für den LV oder BV nachvollziehbar. Steht eine Ortsgruppe ohne Bezirk direkt unter dem Landesverband, bleibt `BZ` in Excel leer. Der Import speichert dann den LV als übergeordnete Gliederung der OG und lässt die Bezirks-ID im Ergebnis leer. Eine leere OG-Zelle wird als fehlende Zuordnung gespeichert.

In der Excel-Spalte LV führen Kürzel und ausgeschriebene Namen zur selben ID, etwa WÜ und Württemberg oder BA und Baden. Die [Zuordnung der Kürzel](../tools/lib/dlrg-landesverbaende.json) umfasst die 18 Landesverbände. Ein unbekanntes deutsches Kurzkürzel erscheint mit Zeilennummer zur Prüfung. Bereits importierte Kürzel werden beim nächsten bestätigten Import desselben Verbands unter der vorhandenen ID ausgeschrieben. [Landesverbände der DLRG](https://www.dlrg.de/informieren/die-dlrg/kontakt-und-ansprechpartner/landesverbaende/)

Für die Ortsgruppe werden „Bermatingen/Markdorf“ und „Bermatingen-Markdorf“ als „Bermatingen-Markdorf“ gespeichert. Die ID verwendet weiterhin die übergeordnete Gliederung. Beim erneuten Import derselben Wettkampf- und Ergebniszeilen werden deren Verbandsverweise auf die vereinheitlichten IDs aktualisiert. Frühere Gliederungsdokumente können weiterhin in der Strukturansicht erscheinen.

- Für einen zweistelligen Jahrgang verwendet der Import das **Wettkampfjahr** und einen Altersbereich von 0 bis einschließlich 100 Jahren. Bei einem Wettkampf im Jahr 2026 ergibt `Age=16` damit den Jahrgang 2016. `Age=26` kann für 1926 oder 2026 stehen. In diesem Fall den vollständigen Jahrgang in Excel eintragen.
- Exakte Identitätsmerkmale erlauben eine Zuordnung über mehrere Wettkämpfe. Leerraum und Groß-/Kleinschreibung sind für die ID vereinheitlicht. Umlaute, Bindestriche und Nummern bleiben unterscheidbar. Es gibt keine unscharfe Namenszusammenführung. Unterschiedliche Schreibweisen zur gleichen ID, widersprüchliche Wettkampfdaten, fehlende Eltern einer genannten Organisation und doppelte Ergebniszeilen derselben Person und Wettkampfphase werden zur Prüfung gemeldet. Bei einer Ortsgruppe ohne Bezirk ist der Landesverband die erforderliche übergeordnete Gliederung.
- Bei identischem Namen, Jahrgang und Geschlecht können die Quelldaten zwei Menschen nur mit einer zusätzlichen Kennzeichnung unterscheiden. Die etablierte Nummerierung in allen zugehörigen Zeilen beibehalten. Der Importer kann einen quer über Wettkämpfe fehlenden Gleichnamigen-Zusatz nicht aus Zeiten oder Verein beweisen. Stellen zwei historische Schreibweisen dieselbe Person dar, vor dem Import die bestätigte Archivschreibweise in der Importkopie verwenden.
- Der einmal festgelegte Schlüssel dient auch künftigen Importen. Eine Änderung am Kurz­namen, Geburtsjahrgang, Namenszusatz oder an der Phasennummer kann eine andere ID liefern. Die Vorschau meldet dann eine Neuanlage. Bei einer beabsichtigten Identitätskorrektur den Import abbrechen und die betroffenen Verweise gesondert zuordnen. Datenbank-IDs werden durch dieses Werkzeug weder umbenannt noch bereinigt.

### Wiederholung, Korrektur und Abbruch

Jede eingereichte Ergebniszeile beschreibt den **vollständigen Stand dieser Wettkampfphase für die Person**, einschließlich der leeren Disziplinblöcke. Damit kann eine korrigierte Zeile auch eine irrtümlich erfasste Disziplin entfernen. Die Änderung erscheint in der Vorschau. Andere Ergebniszeilen dürfen in der Importdatei fehlen. Der Import liest nur ausdrücklich adressierte Dokumente und enthält keine Löschoperation für Dokumente.

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
| `statsDisciplines` | Fester Katalog `D001` bis `D017` für die Schwimmdisziplinen in der ursprünglichen Reihenfolge sowie `D018` für HLW. `name,category` Text, `sortOrder` Ganzzahl, `distance` Ganzzahl/null. Neue Disziplinen erhalten neue IDs. |
| `statsResults` | `R…` aus Wettkampf-ID, Sportler-ID und Phasennummer bzw. null. `athleteId,competitionId` sowie `ogId,bzId,lvId,bvId` als Verweise. `gender,ageGroup,startRight,classification` Text. `round,place` Ganzzahl/null. `overallPoints,lsc` Zahl/null. `rankingStatus` enthält den Wertungsstatus der Gesamtwertung. `disciplines` enthält die belegten Disziplinen mit ihren jeweiligen Ergebnisfeldern. |

Eine Schwimmdisziplin enthält `place` und `timeMs` als Ganzzahl/null, `points` und `penaltyPoints` als Zahl/null, `faultCode` als Text/null sowie `status` als OK, DQ oder DNS. HLW enthält `points` und `status` als PASS, DQ oder DNS. Bei HLW-Nichtantritt ist `points` null. Das Ergebnis einer Person für eine Wettkampfphase einschließlich ihrer Disziplinen benötigt einen Lesezugriff und kann atomar korrigiert werden. Separate Disziplinergebnisse würden globale Abfragen nach Disziplin vereinfachen, aber bei jedem Import und jeder Wettkampfansicht zusätzliche Dokumentzugriffe erzeugen.

`rankingStatus` speichert `AK` oder `EXCLUDED` auf der Ebene, auf der die Markierung in Excel steht. An der betreffenden Stelle ist `place` null. Zeit, Punkte und ein Status wie `DQ` oder `DNS` können weiterhin am Disziplinergebnis stehen. Bei mehreren Wettkampfphasen steht eine Gesamtmarkierung in der Ergebniszeile, aus deren `PLACE`-Zelle sie stammt. Für spätere Ranglisten ist sie bei der Wertung derselben Person im ganzen Wettkampf zu berücksichtigen. Eine Markierung in `Pl` betrifft nur die Disziplin der jeweiligen Phase.

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

Die Archiv-Collections erlauben bei veröffentlichter Regelversion einzelnen Dokumentzugriff, begrenzte Listenabfragen und die dafür vorgesehenen Schreiboperationen für verifizierte Admins. Löschungen über den Browser bleiben gesperrt. Der lokale Server-SDK authentifiziert sich über IAM. Eine spätere Veröffentlichung soll eigens freigegebene Ausgabefelder enthalten. Firestore-Leserechte gelten für das ganze Dokument. [Firestore-Sicherheitsregeln](https://firebase.google.com/docs/firestore/security/get-started)

## Kostenloser Betrieb und Größenordnung

Stand der Prüfung **27. November 2026**, Cloud Firestore Standard. Das kostenlose Kontingent gilt für genau eine Datenbank pro Projekt. Mitgliederbereich, Timer und Archiv teilen sich das verfügbare Kontingent. Tageskontingente beginnen ungefähr um Mitternacht pazifischer Zeit neu. [Offizielle Kontingente und technische Grenzen](https://firebase.google.com/docs/firestore/quotas)

| Ressource | Spark-Freikontingent |
|---|---:|
| Dokumentlesevorgänge | 50.000 pro Tag |
| Dokument-Schreibvorgänge | 20.000 pro Tag |
| Dokumentlöschungen | 20.000 pro Tag |
| Gespeicherte Daten einschließlich Indizes | 1 GiB |
| Ausgehende Datenübertragung | 10 GiB pro Monat |

**Rechenbeispiel für einen Import.** 500 Ergebniszeilen, 400 eindeutige Sportler, 50 Organisationen, ein Wettkampf und 18 Katalogeinträge ergeben rund **969 adressierte Dokumente**. Ein erstmaliger Import in ein leeres Archiv benötigt ungefähr 969 Reads und 969 Writes. Eine identische Wiederholung benötigt ungefähr 969 Reads und null Writes. Bei einer einzigen geänderten Ergebniszeile derselben Datei fällt ein Write an. Ein einzelner Aufruf mit `--apply` enthält den Vergleich bereits. Netzwerk-Wiederholungen und andere Projektzugriffe sind in diesen Zahlen nicht enthalten.

**Rechenbeispiel für den Betrieb.** Angenommene 40 Reads je öffentlichem Seitenaufruf würden bei 1.250 Aufrufen das gesamte Tageskontingent verbrauchen. Sind 10.000 Reads für Mitgliederbereich und Timer reserviert, bleiben rechnerisch 1.000 solche Aufrufe. Bei angenommenen 4 KiB je Ergebnis einschließlich Indexanteil entspräche 1 GiB rund 262.000 Zeilen, vor Stammdaten und vorhandenem Datenbestand. Die tatsächliche Größe hängt unter anderem von belegten Disziplinen und Indizes ab. Nach einem kleinen Import Speicher und Nutzung in der Firebase-Konsole messen und mit den geplanten Altbeständen hochrechnen. Historische Importe wettkampfweise über mehrere Tage verteilen, wenn die Vorschauen die verbleibende Tagesreserve überschreiten.

Spark kostet innerhalb dieser Kontingente **0 €**. Ein ausgeschöpftes Kontingent kann Zugriffe blockieren. Für den Kostenrahmen den Spark-Tarif beibehalten, kein Cloud-Billing-Konto verknüpfen und Billing-/Owner-Rechte eng vergeben. Blaze ist verbrauchsabhängig mit standortabhängigen Preisen. Budgetwarnungen sind dort keine harte Kostengrenze. [Firebase-Tarife](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Firestore-Preise, Indexzugriffe, Speicher und Listener](https://firebase.google.com/docs/firestore/pricing)

Cloud Functions für serverseitige Berechnungen, Cloud Storage für Datei-Uploads sowie verwaltete Firestore-Backups, Wiederherstellung, PITR, Klonen und TTL-Löschungen benötigen aktivierte Abrechnung. Der lokale Import und vorberechnete öffentliche Dateien auf der vorhandenen GitHub-Pages-Seite kommen ohne diese Dienste aus. Private Quelldateien und bestätigte manuelle Zuordnungen lokal sichern. [Firebase-Tarife](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Storage-Anforderungen](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) · [Firestore-Kontingente](https://firebase.google.com/docs/firestore/quotas)
