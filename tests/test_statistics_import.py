import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace
from contextlib import ExitStack

from openpyxl import Workbook
from openpyxl.utils.datetime import MAC_EPOCH, WINDOWS_EPOCH, to_excel
from datetime import datetime

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
from import_statistics import competition_names, import_environment, prepare, source_rows
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
                None, 46340, event, 25, "National", "GER", "Althenstett", "OG", heat, "3Kampf", "Beispielmeisterschaft"]


def parse(*rows):
    return prepare(iter([*header(), *rows]), WINDOWS_EPOCH, "BaWü-SEN - 2026")


class StatisticsImport(unittest.TestCase):
    def test_browser_and_cli_produce_the_same_firestore_records(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "Baden.xlsx"
            book = Workbook()
            book.epoch = MAC_EPOCH
            sheet = book.active
            a, b = header()
            sheet.append(a)
            sheet.append(b)
            first, second = line(age=16, heat=1), line(age=16, heat=2)
            for row in (first, second):
                row[99] = to_excel(datetime(2026, 11, 14), MAC_EPOCH)
                row[1] = "W"
                row[2] = "13/14"
                row[4:7] = ["Norderstedt", None, "SH"]
            second[6:8] = ["Schleswig-Holstein", "Deutschland"]
            first[13:18] = ["AK", "0:54,86", 0, "R17", "disq"]
            first[98] = "n.a."
            second[8] = "ausg."
            second[98] = 500
            sheet.append(first)
            sheet.append(second)
            other_club = line(name="Beispiel, Eva")
            other_club[4:8] = ["Bermatingen/Markdorf", "Bodenseekreis", "Baden", "DEU"]
            other_club[99] = first[99]
            sheet.append(other_club)
            district_only = line(name="Beispiel, Lena")
            district_only[4:8] = [None, "Mannheim", "BA", "GER"]
            district_only[99] = first[99]
            district_only[105] = "BZ"
            sheet.append(district_only)
            direct_club = line(name="Beispiel, Hana")
            direct_club[4:8] = ["VZS ČČK Tábor", None, None, "CZE"]
            direct_club[28:33] = [None, None, 0, "dnf", "disq"]
            direct_club[99] = first[99]
            sheet.append(direct_club)
            sheet.merge_cells(start_row=1, start_column=14, end_row=1, end_column=18)
            sheet.cell(4, 20).number_format = "m:ss.00"
            sheet.cell(4, 20).value = 54860 / 86400000
            sheet.cell(4, 100).value = datetime(2026, 11, 14, 13, 30)
            book.save(path)
            book.close()
            args = SimpleNamespace(file=path, clipboard=False, sheet=sheet.title)
            with ExitStack() as stack:
                rows, epoch = source_rows(args, stack)
                event = next(iter(competition_names(iter(rows()))))
                expected, starts = prepare(iter(rows()), epoch, event)
            command = """
                const xlsx = require('./assets/vendor/sheetjs/xlsx-0.20.3.full.min.js');
                const core = require('./assets/js/statistics-excel-core.js');
                const lv = require('./tools/lib/dlrg-landesverbaende.json');
                const bytes = require('node:fs').readFileSync(process.argv[1]);
                const book = xlsx.read(bytes, { cellNF: true, sheetStubs: true });
                const sheet = core.inspectSheet(core.readSheet(book.Sheets[book.SheetNames[0]], xlsx));
                core.prepare(sheet, [...sheet.events.keys()][0], book.Workbook.WBProps.date1904, lv)
                  .then(result => process.stdout.write(JSON.stringify(result)));
            """
            result = subprocess.run(["node", "-e", command, str(path)], cwd=TOOLS.parent,
                                    capture_output=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stderr[:2000])
            actual = json.loads(result.stdout)
            self.assertEqual(actual["errors"], [])
            self.assertEqual(actual["starts"], starts)
            self.assertEqual({d["id"]: d["data"] for d in actual["records"]},
                             {d["id"]: d["data"] for d in expected})
            result_row = next(doc["data"] for doc in actual["records"] if doc["collection"] == "statsResults")
            organization = next(doc["data"] for doc in actual["records"] if doc["id"] == result_row["ogId"])
            self.assertIsNone(result_row["bzId"])
            self.assertEqual(organization["parentId"], result_row["lvId"])
            self.assertTrue(any(doc["data"].get("name") == "Bermatingen-Markdorf" for doc in actual["records"]))
            district = next(doc for doc in actual["records"] if doc["data"].get("name") == "Mannheim")
            district_result = next(doc["data"] for doc in actual["records"] if doc["collection"] == "statsResults"
                                   and doc["data"]["bzId"] == district["id"])
            self.assertEqual(district["data"]["type"], "BZ")
            self.assertEqual(district["data"]["parentId"], district_result["lvId"])
            self.assertIsNone(district_result["ogId"])
            self.assertEqual(district_result["startRight"], "BZ")
            direct_org = next(doc for doc in actual["records"] if doc["data"].get("name") == "VZS ČČK Tábor")
            direct_result = next(doc["data"] for doc in actual["records"] if doc["collection"] == "statsResults"
                                 and doc["data"]["ogId"] == direct_org["id"])
            czech_federation = next(doc for doc in actual["records"] if doc["data"].get("name") == "CZE")
            self.assertEqual(direct_org["data"]["parentId"], czech_federation["id"])
            self.assertEqual(direct_result["bvId"], czech_federation["id"])
            self.assertIsNone(direct_result["bzId"])
            self.assertIsNone(direct_result["lvId"])
            self.assertEqual(direct_result["disciplines"]["D004"]["faultCode"], "dnf")
            self.assertEqual(direct_result["disciplines"]["D004"]["status"], "DQ")
            athlete = next(doc["data"] for doc in actual["records"] if doc["collection"] == "statsAthletes")
            self.assertEqual(athlete["birthYear"], 2016)
            sheet.cell(3, 10).value = "=5+7"
            book.save(path)
            book.close()
            invalid = subprocess.run(["node", "-e", command, str(path)], cwd=TOOLS.parent,
                                     capture_output=True, encoding="utf-8", check=True)
            self.assertIn("Formel ohne gespeichertes Ergebnis", json.loads(invalid.stdout)["errors"][0])

    def test_local_group_without_a_federation_requires_an_excel_correction(self):
        row = line()
        row[4:8] = ["VZS ČČK Krnov", None, None, None]
        with self.assertRaisesRegex(ValueError, "Zeile 3: .*BV.*ergänzen"):
            parse(row)

    def test_competition_phase_count_uses_only_the_selected_event(self):
        for heats, count in (((1,), 1), ((1, 2), 2), ((3, 1, 2), 3), ((None,), None)):
            with self.subTest(heats=heats):
                rows = [line(heat=phase) for phase in heats]
                docs, _ = parse(*rows, line(event="Anderer Wettkampf", heat=3))
                competition = next(d["data"] for d in docs if d["collection"] == "statsCompetitions")
                self.assertEqual(competition["phaseCount"], count)
        with self.assertRaisesRegex(ValueError, "Zeile 3: .*Wettkampfphase"):
            parse(line(heat="2/3"))

    def test_start_right_preserves_the_athletes_affiliation(self):
        from lib.statistics_excel import stable_id
        for level in ("OG", "LV", "BV"):
            with self.subTest(level=level):
                row = line()
                row[105] = level
                docs, _ = parse(row)
                organizations = {d["id"]: d["data"] for d in docs if d["collection"] == "statsOrganizations"}
                result = next(d["data"] for d in docs if d["collection"] == "statsResults")
                self.assertEqual(result["startRight"], level)
                self.assertEqual(organizations[result["ogId"]]["name"], row[4])
                self.assertEqual(organizations[result["lvId"]]["name"], "Württemberg")
                self.assertEqual(result["bvId"], stable_id("C", "BV", None, "ger"))
                self.assertEqual(organizations[result["bvId"]]["name"], "Deutschland")

    def test_competition_country_expands_ger_independently_of_federation(self):
        for country, expected in (("GER", "Deutschland"), ("Deutschland", "Deutschland"),
                                  ("Frankreich", "Frankreich"), (None, "")):
            with self.subTest(country=country):
                row = line()
                row[7] = "FRA"
                row[103] = country
                docs, _ = parse(row)
                competition = next(d["data"] for d in docs if d["collection"] == "statsCompetitions")
                self.assertEqual(competition["country"], expected)

    def test_confirmed_aliases_preserve_the_id_of_the_standard_hierarchy(self):
        from lib.statistics_excel import stable_id
        canonical = line()
        canonical[4:8] = ["Bermatingen-Markdorf", "Bodenseekreis", "BA", "GER"]
        expected, _ = parse(canonical)
        alias = canonical.copy()
        alias[4:8] = ["Bermatingen / Markdorf", "Bodenseekreis", "Baden", "Deutschland"]
        actual, _ = parse(alias)
        self.assertEqual(actual, expected)

        result = next(doc["data"] for doc in actual if doc["collection"] == "statsResults")
        bv_id = stable_id("C", "BV", None, "ger")
        lv_id = stable_id("C", "LV", bv_id, "ba")
        bz_id = stable_id("C", "BZ", lv_id, "bodenseekreis")
        self.assertEqual((result["bvId"], result["lvId"], result["bzId"]), (bv_id, lv_id, bz_id))
        self.assertEqual(result["ogId"], stable_id("C", "OG", bz_id, "bermatingen-markdorf"))
        alias[5] = "Bodensee-Konstanz"
        different, _ = parse(alias)
        separate = next(doc for doc in different if doc["collection"] == "statsResults")
        self.assertNotEqual(separate["data"]["ogId"], result["ogId"])
        self.assertEqual(separate["id"], next(doc["id"] for doc in actual if doc["collection"] == "statsResults"))

    def test_lv_names_expand_only_for_german_state_associations(self):
        from lib.statistics_excel import stable_id
        for country, code, name in [("GER", "WÜ", "Württemberg"), ("GER", "BA", "Baden"),
                                    ("GER", "BY", "Bayern"), ("SUI", "BE", "BE")]:
            row = line()
            row[6:8] = [code, country]
            docs, _ = parse(row)
            parent = stable_id("C", "BV", None, country.lower())
            lv = next(d for d in docs if d["id"] == stable_id("C", "LV", parent, code.lower()))
            self.assertEqual(lv["data"]["name"], name)
        row[6:8] = ["XX", "GER"]
        with self.assertRaisesRegex(ValueError, "Zeile 3: .*LV-Kürzel"):
            parse(row)

    def test_gender_accepts_m_and_w_only(self):
        row = line()
        for value in ("M", "w"):
            row[1] = value
            docs, _ = parse(row)
            for doc in docs:
                if doc["collection"] in ("statsAthletes", "statsResults"):
                    self.assertEqual(doc["data"]["gender"], value.lower())
        row[1] = "d"
        with self.assertRaisesRegex(ValueError, "Zeile 3: .*Gender.*m oder w"):
            parse(row)

    def test_key_picker_only_supplies_the_import_process(self):
        fake_key = '{"type":"service_account","project_id":"demo-test","client_email":"test","private_key":"test"}'
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {}, clear=True):
            key = Path(temp) / "demo.json"
            key.write_text(fake_key, encoding="utf-8-sig")
            with patch("import_statistics.system_input", return_value=str(key)) as picker:
                self.assertIsNone(import_environment(True))
                picker.assert_not_called()
                env = import_environment(False)
                self.assertIn("demo-test", env["FIREBASE_SERVICE_ACCOUNT_JSON"])
                self.assertNotIn("FIREBASE_SERVICE_ACCOUNT_JSON", os.environ)
                with patch.dict(os.environ, {"FIREBASE_SERVICE_ACCOUNT_JSON": fake_key}):
                    self.assertIsNone(import_environment(False))
                picker.assert_called_once()
                key.write_text("{}", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Dienstkontos"):
                    import_environment(False)

    def test_file_selection_without_tk_reads_quoted_path(self):
        with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
            path = Path(temp) / "Meine Ergebnisse.xlsx"
            book = Workbook()
            for row in [*header(), line()]:
                book.active.append(row)
            book.save(path)
            book.close()
            with patch.dict(sys.modules, {"tkinter": None}), patch("builtins.input", return_value=f'"{path}"'):
                rows, _ = source_rows(SimpleNamespace(file=None, clipboard=False, sheet=None), stack)
                self.assertEqual(competition_names(iter(rows())), {"BaWü-SEN - 2026": 1})

    def test_original_layout_and_numeric_values(self):
        row = line()
        self.assertEqual(len(row), 109)
        row[13:18] = [1, "0:59,89", "881,25", "T1", "50"]
        row[23:28] = ["disq", "1:02,34", 0, "F12", "disq"]
        row[28:33] = [None, "n.a.", 0, None, None]
        docs, count = parse(row)
        by_type = {d["collection"]: d["data"] for d in docs}
        result = by_type["statsResults"]
        self.assertEqual((count, result["place"]), (4, 5))
        self.assertEqual((result["lsc"], result["overallPoints"]), (461.33, 1874.98))
        self.assertEqual(result["round"], 1)
        self.assertNotIn("roundTotal", result)
        self.assertEqual(result["disciplines"]["D001"], dict(place=1, timeMs=59890, points=881.25,
                         faultCode="T1", penaltyPoints=50, status="OK"))
        self.assertEqual(result["disciplines"]["D003"]["status"], "DQ")
        self.assertEqual(result["disciplines"]["D004"]["status"], "DNS")
        self.assertNotIn("D005", result["disciplines"])
        self.assertEqual(by_type["statsAthletes"]["birthYear"], 1989)
        self.assertEqual(by_type["statsCompetitions"]["date"], "2026-11-14")
        clubs = {d["id"]: d["data"] for d in docs if d["collection"] == "statsOrganizations"}
        self.assertEqual(clubs[result["ogId"]]["parentId"], result["bzId"])

    def test_overall_and_discipline_ranking_status_are_independent(self):
        for overall, discipline_place, expected_overall, expected_discipline in (
                ("AK", 1, "AK", None), (5, "ak", None, "AK"),
                ("ausg.", 1, "EXCLUDED", None), (5, "AUSG.", None, "EXCLUDED")):
            with self.subTest(overall=overall, discipline_place=discipline_place):
                row = line()
                row[8] = overall
                row[13:18] = [discipline_place, "0:59,89", 570, "F12", "disq"]
                docs, _ = parse(row)
                result = next(d["data"] for d in docs if d["collection"] == "statsResults")
                entry = result["disciplines"]["D001"]
                self.assertEqual(result["rankingStatus"], expected_overall)
                self.assertEqual(result["place"], 5 if expected_overall is None else None)
                self.assertEqual(entry.get("rankingStatus"), expected_discipline)
                self.assertEqual(entry["place"], 1 if expected_discipline is None else None)
                self.assertEqual((entry["status"], entry["timeMs"], entry["points"]), ("DQ", 59890, 570))
                self.assertNotIn("rankingStatus", result["disciplines"]["D002"])

    def test_historical_hlw_is_a_discipline_and_preserves_total_points(self):
        for value, points, status in (("200", 200, "PASS"), ("500", 500, "PASS"), ("0", 0, "DQ"),
                                      ("n.a.", None, "DNS"), ("", None, None)):
            with self.subTest(value=value):
                row = line()
                row[98] = value
                docs, count = parse(row)
                result = next(d["data"] for d in docs if d["collection"] == "statsResults")
                self.assertNotIn("hlw", result)
                self.assertEqual(result["overallPoints"], 1874.98)
                expected = None if status is None else {"points": points, "status": status}
                self.assertEqual(result["disciplines"].get("D018"), expected)
                self.assertEqual(count, 1 if status is None else 2)
                catalog = next(d["data"] for d in docs if d["id"] == "D018")
                self.assertEqual(catalog, {"name": "HLW", "category": "HLW", "distance": None, "sortOrder": 18})

    def test_legacy_points_and_lsc_change_columns_are_optional_and_ignored(self):
        top, bottom = header()
        row = line()
        legacy_indices = {bottom.index("4-Kampf (ohne HLW)"), bottom.index("LSC Change")}
        for index in legacy_indices:
            row[index] = "#EXCEL-FEHLER"
        for omit in (False, True):
            with self.subTest(omit=omit):
                rows = [[cell for i, cell in enumerate(r) if i not in legacy_indices]
                        for r in (top, bottom, row)] if omit else [top, bottom, row]
                docs, _ = prepare(iter(rows), WINDOWS_EPOCH, row[100])
                result = next(d["data"] for d in docs if d["collection"] == "statsResults")
                self.assertEqual(result["overallPoints"], 1874.98)
                self.assertEqual(result["lsc"], 461.33)
                self.assertNotIn("fourEventPoints", result)
                self.assertNotIn("legacyLscChange", result)

    def test_multiple_rounds_suffix_stable_ids_and_partial_selection(self):
        rows = [line(heat=None), line(heat=2), line("Muster, Mia (2)"), line(event="Anderer Wettkampf")]
        names = competition_names(iter([*header(), *rows]))
        self.assertEqual(sorted(names.values()), [1, 3])
        docs, _ = parse(*rows)
        again, _ = parse(*reversed(rows))
        self.assertEqual({d["id"] for d in docs}, {d["id"] for d in again})
        results = [d["data"] for d in docs if d["collection"] == "statsResults"]
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0]["athleteId"], results[1]["athleteId"])
        self.assertNotEqual(results[0]["athleteId"], results[2]["athleteId"])
        self.assertEqual(results[1]["round"], 2)
        self.assertIsNone(results[0]["round"])

    def test_block_reordering_and_ambiguities(self):
        a, b = header()
        a[13], a[18] = a[18], a[13]
        docs, _ = prepare(iter([a, b, line()]), WINDOWS_EPOCH, "BaWü-SEN - 2026")
        result = next(d["data"] for d in docs if d["collection"] == "statsResults")
        self.assertEqual(result["disciplines"]["D001"]["timeMs"], 54860)
        with self.assertRaisesRegex(ValueError, "Duplikat"):
            parse(line(), line())
        with self.assertRaisesRegex(ValueError, "mehrdeutig.*1926.*2026"):
            parse(line(age=26))
        with self.assertRaisesRegex(ValueError, "abweichendem Verband"):
            other = line(heat=2)
            other[4] = "Anderer Verein"
            parse(line(), other)
        with self.assertRaisesRegex(ValueError, "zugehörigen LV"):
            other = line()
            other[6] = None
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
