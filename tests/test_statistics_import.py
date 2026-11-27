import csv
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import ExitStack

from openpyxl import Workbook
from openpyxl.utils.datetime import MAC_EPOCH, WINDOWS_EPOCH, to_excel
from datetime import datetime

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
from import_statistics import competition_names, prepare, source_rows
from lib.statistics_excel import DISCIPLINES, FIELDS


def header():
    return ([None]*13 + [cell for d in DISCIPLINES for cell in
                         [d.replace("Rücken", "Rü.").replace("/", "/\n"), None, None, None, None]]
            + [None]*11,
            list(FIELDS[:13]) + [s + "\xa0"*i for i in range(17) for s in ("Pl", "Time", "Points", "C", "St")]
            + list(FIELDS[13:]))


def line(name="Muster, Mia", age=89, event="BaWü-SEN - 2026", heat=1):
    return [name, "w", 35, age, "Beispiel", "Bezirk", "WÜ", "GER", 5, "1.874,98", None,
            "461,33", 37] + [None]*5 + [5, "0:54,86", 570, None, None] + [None]*75 + [
                0, 46340, event, 25, "National", "GER", "Althenstett", "OG", heat, "3Kampf", "Beispielmeisterschaft"]


def parse(*rows):
    return prepare(iter([*header(), *rows]), WINDOWS_EPOCH, "BaWü-SEN - 2026")


class StatisticsImport(unittest.TestCase):
    def test_original_layout_and_numeric_values(self):
        row = line()
        self.assertEqual(len(row), 109)
        row[13:18] = [1, "0:59,89", "881,25", "T1", "50"]
        row[23:28] = ["disq", "1:02,34", 0, "F12", "disq"]
        row[28:33] = [None, "n.a.", 0, None, None]
        docs, count = parse(row)
        by_type = {d["collection"]: d["data"] for d in docs}
        result = by_type["statsResults"]
        self.assertEqual((count, result["place"], result["fourEventPoints"], result["hlw"]), (4, 5, None, 0))
        self.assertEqual((result["lsc"], result["overallPoints"], result["legacyLscChange"]), (461.33, 1874.98, 37))
        self.assertEqual((result["round"], result["roundTotal"]), (1, None))
        self.assertEqual(result["disciplines"]["D001"], dict(place=1, timeMs=59890, points=881.25,
                         faultCode="T1", penaltyPoints=50, status="OK"))
        self.assertEqual(result["disciplines"]["D003"]["status"], "DQ")
        self.assertEqual(result["disciplines"]["D004"]["status"], "DNS")
        self.assertNotIn("D005", result["disciplines"])
        self.assertEqual(by_type["statsAthletes"]["birthYear"], 1989)
        self.assertEqual(by_type["statsCompetitions"]["date"], "2026-11-14")
        clubs = {d["id"]: d["data"] for d in docs if d["collection"] == "statsOrganizations"}
        self.assertEqual(clubs[result["ogId"]]["parentId"], result["bzId"])

    def test_multiple_rounds_suffix_stable_ids_and_partial_selection(self):
        rows = [line(heat=None), line(heat="2/3"), line("Muster, Mia (2)"), line(event="Anderer Wettkampf")]
        names = competition_names(iter([*header(), *rows]))
        self.assertEqual(sorted(names.values()), [1, 3])
        docs, _ = parse(*rows)
        again, _ = parse(*reversed(rows))
        self.assertEqual({d["id"] for d in docs}, {d["id"] for d in again})
        results = [d["data"] for d in docs if d["collection"] == "statsResults"]
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0]["athleteId"], results[1]["athleteId"])
        self.assertNotEqual(results[0]["athleteId"], results[2]["athleteId"])
        self.assertEqual((results[1]["round"], results[1]["roundTotal"]), (2, 3))
        self.assertIsNone(results[0]["round"])

    def test_block_reordering_and_ambiguities(self):
        a, b = header()
        a[13], a[18] = a[18], a[13]
        docs, _ = prepare(iter([a, b, line()]), WINDOWS_EPOCH, "BaWü-SEN - 2026")
        result = next(d["data"] for d in docs if d["collection"] == "statsResults")
        self.assertEqual(result["disciplines"]["D001"]["timeMs"], 54860)
        with self.assertRaisesRegex(ValueError, "Duplikat"):
            parse(line(), line())
        with self.assertRaisesRegex(ValueError, "mehrdeutig"):
            parse(line(age=20))
        with self.assertRaisesRegex(ValueError, "abweichendem Verband"):
            other = line(heat=2)
            other[4] = "Anderer Verein"
            parse(line(), other)
        with self.assertRaisesRegex(ValueError, "zugehörigen BZ"):
            other = line()
            other[5] = None
            parse(other)
        with self.assertRaisesRegex(ValueError, "Widersprüchliche Stammdaten"):
            other = line(heat=2)
            other[-1] = "Anderer Langname"
            parse(line(), other)
        self.assertTrue(parse(line(age=1920))[0])
        self.assertTrue(parse(line(age=1))[0])
        a[13] = "Unbekannt"
        with self.assertRaisesRegex(ValueError, "Disziplinüberschrift"):
            prepare(iter([a, b, line()]), WINDOWS_EPOCH, "BaWü-SEN - 2026")

    def test_actual_excel_and_pasted_tsv(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "quelle.xlsx"
            wb = Workbook()
            wb.epoch = MAC_EPOCH
            ws = wb.active
            a, b = header()
            row = line()
            row[99] = to_excel(datetime(2026, 11, 14), MAC_EPOCH)
            for r in [a, b, row]:
                ws.append(r)
            ws.merge_cells(start_row=1, start_column=14, end_row=1, end_column=18)
            wb.save(path)
            args = SimpleNamespace(file=path, clipboard=False, sheet=ws.title)
            with ExitStack() as stack:
                rows, epoch = source_rows(args, stack)
                docs, _ = prepare(iter(rows()), epoch, row[100])
                self.assertEqual(next(d["data"]["date"] for d in docs if d["collection"] == "statsCompetitions"),
                                 "2026-11-14")
            ws.cell(3, 10, "=1+2")
            wb.save(path)
            wb.close()
            with ExitStack() as stack:
                rows, epoch = source_rows(args, stack)
                with self.assertRaisesRegex(ValueError, "Formel"):
                    prepare(iter(rows()), epoch, row[100])
            tsv = Path(temp) / "quelle.tsv"
            with tsv.open("w", encoding="utf-8", newline="") as f:
                csv.writer(f, delimiter="\t").writerows([a, b, line()])
            cli = subprocess.run([sys.executable, str(TOOLS / "import_statistics.py"), str(tsv)],
                                 capture_output=True)
            self.assertEqual(cli.returncode, 0, cli.stderr)
            self.assertIn(b"1 Ergebniszeilen", cli.stdout)
            guard_env = {**os.environ, "FIRESTORE_EMULATOR_HOST": "invalid.example:8080"}
            denied = subprocess.run([sys.executable, str(TOOLS / "import_statistics.py"), str(tsv),
                                     "--apply", "--emulator"], env=guard_env, capture_output=True)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn(b"Emulator muss lokal laufen", denied.stderr)
