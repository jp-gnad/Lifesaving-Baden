"""Import older competitors without changing identities or latest organizations."""
import importlib.util
from io import BytesIO
import unittest
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("directory", ROOT / "tools/build_participant_directory.py")
directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)


class ParticipantDirectoryTests(unittest.TestCase):
    def build(self, rows):
        workbook = openpyxl.Workbook()
        sheet = workbook.create_sheet("Results")
        sheet.sheet_state = "veryHidden"
        for name, event, birth, organization, date in rows:
            sheet.append(["w", name, None, None, None, None, None, None, None, date, event, birth, organization])
        buffer = BytesIO()
        workbook.save(buffer)
        workbook.close()
        buffer.seek(0)
        return directory.build(buffer)

    def test_includes_all_source_years_and_keeps_latest_organization(self):
        records = self.build([
            ("Archiv, Anna", "Wettkampf 2008", 90, "Altverein", 1),
            ("Aktuell, Bea", "Wettkampf 2026", 5, "Baden", 3),
            ("Archiv, Anna", "Wettkampf 2014", 90, "Neuer Verein", 2),
        ])
        self.assertEqual(len(records), 2)
        anna = next(item for item in records if item["name"] == "Anna Archiv")
        self.assertEqual(anna["birthYear"], 1990)
        self.assertEqual(anna["organization"], "Neuer Verein")
        older = self.build([("Archiv, Anna", "Wettkampf 2008", 90, "Altverein", 1)])
        self.assertEqual(anna["id"], older[0]["id"])

    def test_empty_import_fails_instead_of_wiping_directory(self):
        with self.assertRaisesRegex(RuntimeError, "No valid people"):
            self.build([("Fehlt, Jahr", "Kein Datum", 90, "Baden", 1)])


if __name__ == "__main__":
    unittest.main()
