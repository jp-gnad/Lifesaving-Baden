"""Preview and import one competition from the 109-column Excel database."""
import argparse
import csv
import io
import json
import subprocess
import sys
import tempfile
from collections import Counter
from contextlib import ExitStack
from pathlib import Path
from zipfile import BadZipFile

import openpyxl
from openpyxl.utils.datetime import WINDOWS_EPOCH

from lib.statistics_excel import DISCIPLINES, clean, columns, documents, heading


def choose(names, label, requested=None):
    if requested is not None:
        if requested not in names:
            raise ValueError(f"{label} {requested!r} fehlt. Verfügbar: {', '.join(names)}")
        return requested
    if len(names) == 1:
        return names[0]
    if not names:
        raise ValueError(f"Kein Eintrag für {label}.")
    for i, name in enumerate(names, 1):
        print(f"{i:4}  {name}")
    value = input(f"{label} auswählen (Nummer): ").strip()
    if not value.isdigit() or not 1 <= int(value) <= len(names):
        raise ValueError("Ungültige Auswahl.")
    return names[int(value)-1]


def system_input(clipboard):
    from tkinter import Tk, TclError, filedialog
    try:
        root = Tk()
        root.withdraw()
        try:
            if clipboard:
                return root.clipboard_get()
            return filedialog.askopenfilename(title="Wettkampfdaten auswählen",
                                              filetypes=[("Excel / Tabellentext", "*.xlsx *.xlsm *.tsv *.txt")])
        finally:
            root.destroy()
    except TclError as exc:
        raise ValueError("Dateidialog/Zwischenablage nicht verfügbar. Einen Dateipfad angeben.") from exc


def source_rows(args, stack):
    if args.clipboard:
        copied = system_input(True)
        return lambda: csv.reader(io.StringIO(copied), delimiter="\t"), WINDOWS_EPOCH
    filename = args.file or system_input(False)
    if not filename:
        raise ValueError("Keine Datei ausgewählt.")
    path = Path(filename)
    if path.suffix.lower() in (".txt", ".tsv"):
        def tab_rows():
            with path.open(encoding="utf-8-sig", newline="") as file:
                yield from csv.reader(file, delimiter="\t")
        return tab_rows, WINDOWS_EPOCH
    if path.suffix.lower() not in (".xlsx", ".xlsm"):
        raise ValueError("Bitte als XLSX, XLSM oder tabgetrennten UTF-8-Text speichern.")
    values = openpyxl.load_workbook(path, read_only=True, data_only=True)
    stack.callback(values.close)
    sheet = choose(values.sheetnames, "Tabellenblatt", args.sheet)
    formulas = openpyxl.load_workbook(path, read_only=True, data_only=False)
    stack.callback(formulas.close)

    def excel_rows():
        for cached, original in zip(values[sheet].rows, formulas[sheet].rows, strict=True):
            yield [("#EXCEL-FEHLER" if cell.data_type == "e" or
                    (cell.value is None and src.data_type == "f") else cell.value)
                   for cell, src in zip(cached, original, strict=True)]

    return excel_rows, values.epoch


def table(rows):
    previous = []
    for n, row in enumerate(rows, 1):
        if any(heading(v) == "name" for v in row) and any(heading(v) == "gender" for v in row):
            fields, blocks = columns(previous, row)
            return fields, blocks, enumerate(rows, n+1)
        previous = row
    raise ValueError("Die zwei Kopfzeilen mit Disziplinnamen und Spaltennamen fehlen.")


def competition_names(rows):
    fields, _, data = table(rows)
    index = fields["Wettkampf"]
    names = Counter()
    spelling = {}
    for n, row in data:
        if not any(clean(v) for v in row):
            continue
        name = clean(row[index]) if len(row) > index else ""
        if not name or name.startswith("#"):
            raise ValueError(f"Zeile {n}: Wettkampf fehlt oder enthält einen Excel-Fehler.")
        previous = spelling.setdefault(name.lower(), name)
        if previous != name:
            raise ValueError(f"Zeile {n}: Wettkampfbezeichnungen {previous!r} und {name!r} abgleichen.")
        names[name] += 1
    return names


def prepare(rows, epoch, event):
    fields, blocks, data = table(rows)
    used = set(fields.values()).union(*(range(i, i+5) for i in blocks.values()))
    width = max(used) + 1
    records = {}
    first_row = {}
    errors = []
    athlete_clubs = {}
    starts = 0
    for n, row in data:
        row = list(row)
        row.extend([None] * max(0, width-len(row)))
        if clean(row[fields["Wettkampf"]]) != event:
            continue
        try:
            if any(clean(v) for i, v in enumerate(row) if i not in used):
                raise ValueError("Daten in Spalte ohne Überschrift.")
            if any(clean(v).startswith("#") for v in row):
                raise ValueError("Excel-Fehler oder Formel ohne gespeichertes Ergebnis. In Excel neu berechnen.")
            for collection, doc_id, values in documents(row, fields, blocks, epoch):
                key = collection, doc_id
                if key in records:
                    if collection == "statsResults":
                        raise ValueError(f"Mögliches Duplikat zur Zeile {first_row[key]} (Person und Lauf).")
                    if records[key] != values:
                        raise ValueError(f"Widersprüchliche Stammdaten zu Zeile {first_row[key]} ({collection}).")
                else:
                    records[key] = values
                    first_row[key] = n
                if collection == "statsResults":
                    clubs = tuple(values[k] for k in ("ogId", "bzId", "lvId", "bvId"))
                    previous_clubs, previous_n = athlete_clubs.setdefault(values["athleteId"], (clubs, n))
                    if previous_clubs != clubs:
                        raise ValueError(f"Person mit abweichendem Verband in Zeile {previous_n}. Identität prüfen.")
                    starts += len(values["disciplines"])
        except (ValueError, OverflowError) as exc:
            errors.append(f"Zeile {n}: {exc}")
    if not records and not errors:
        errors.append("Ausgewählter Wettkampf enthält keine Daten.")
    if errors:
        raise ValueError(f"{len(errors)} Zeile(n) prüfen:\n" + "\n".join(errors))
    for i, name in enumerate(DISCIPLINES, 1):
        records["statsDisciplines", f"D{i:03d}"] = dict(name=name, category="Pool",
                                                       distance=int(name.split("m")[0]), sortOrder=i)
    payload = [{"collection": c, "id": k, "data": v, "row": first_row.get((c, k))}
               for (c, k), v in records.items()]
    return payload, starts


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    source = cli.add_mutually_exclusive_group()
    source.add_argument("file", nargs="?", help="XLSX/XLSM oder tabgetrennter UTF-8-Text")
    source.add_argument("--clipboard", action="store_true", help="Excel-Zellen mit beiden Kopfzeilen")
    cli.add_argument("--sheet", help="Blattname (auch ausgeblendete Blätter)")
    cli.add_argument("--event", help="Exakter Kurzname aus Wettkampf")
    mode = cli.add_mutually_exclusive_group()
    mode.add_argument("--compare", action="store_true", help="Datenbankvergleich ohne Schreiben")
    mode.add_argument("--apply", action="store_true", help="Vergleichen und interaktiv bestätigen")
    cli.add_argument("--emulator", action="store_true", help="Lokale Demo-Datenbank für Vergleich/Import")
    args = cli.parse_args()
    with ExitStack() as stack:
        rows, epoch = source_rows(args, stack)
        names = competition_names(iter(rows()))
        event = choose(sorted(names), "Wettkampf", args.event)
        payload, starts = prepare(iter(rows()), epoch, event)
    counts = Counter(doc["collection"] for doc in payload)
    print(f"{event} | {counts['statsAthletes']} Sportler | {counts['statsResults']} Ergebniszeilen | "
          f"{starts} Disziplinstarts | {counts['statsOrganizations']} Organisationen")
    athletes = {doc["id"]: doc["data"] for doc in payload if doc["collection"] == "statsAthletes"}
    samples = (doc for doc in payload if doc["collection"] == "statsResults")
    print("Stichprobe der eingelesenen Zeilen (bis zu drei):")
    for _, doc in zip(range(3), samples):
        result = doc["data"]
        athlete = athletes[result["athleteId"]]
        suffix = f" ({athlete['discriminator']})" if athlete["discriminator"] else ""
        print(f"  Zeile {doc['row']} · {athlete['lastName']}, {athlete['firstName']}{suffix} "
              f"· Jg. {athlete['birthYear']} · AK {result['ageGroup']} · Lauf {result['round'] or 'direktes Finale'}")
        for key, entry in result["disciplines"].items():
            duration = f"{entry['timeMs']} ms" if entry["timeMs"] is not None else "ohne Zeit"
            points = f"{entry['points']} P." if entry["points"] is not None else "ohne Punkte"
            print(f"    {DISCIPLINES[int(key[1:])-1]} · {duration} · {points} · {entry['status']}")
    print(f"Lokale Prüfung erfolgreich. Abgleich: ca. {len(payload)} Dokumentlesevorgänge, "
          f"höchstens {len(payload)} Schreibvorgänge.", flush=True)
    if not (args.compare or args.apply):
        return 0
    # Only the selected, validated event crosses the local process boundary.
    with tempfile.TemporaryDirectory(prefix="lifesaving-stats-") as temp:
        path = Path(temp) / "event.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        cmd = ["node", str(Path(__file__).with_name("import_statistics.mjs")), str(path)]
        if args.emulator:
            cmd.append("--emulator")
        if args.apply:
            cmd.append("--apply")
        return subprocess.run(cmd, check=False).returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, BadZipFile, EOFError, KeyboardInterrupt) as error:
        sys.exit(f"Import beendet. {error}")
