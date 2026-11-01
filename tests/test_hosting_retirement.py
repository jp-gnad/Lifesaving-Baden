import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class HostingRetirementTest(unittest.TestCase):
    def test_deployment_contains_only_a_not_found_page_and_no_website_copy(self):
        config = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))
        hosting = config["hosting"]
        public = (ROOT / hosting["public"]).resolve()
        self.assertTrue(public.is_relative_to(ROOT))
        self.assertNotEqual(public, ROOT)
        files = {file.relative_to(public).as_posix() for file in public.rglob("*") if file.is_file()}
        self.assertEqual(files, {"404.html"})
        self.assertNotIn("predeploy", hosting)
        self.assertNotIn("rewrites", hosting)
        self.assertNotIn("redirects", hosting)

    def test_target_is_the_existing_site_and_firestore_configuration_is_preserved(self):
        config = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))
        project = json.loads((ROOT / ".firebaserc").read_text(encoding="utf-8"))["projects"]["default"]
        self.assertEqual(config["hosting"]["site"], project)
        self.assertEqual(config["firestore"], {"rules": "firestore.rules", "indexes": "firestore.indexes.json"})
        for name in config["firestore"].values():
            self.assertTrue((ROOT / name).is_file())


if __name__ == "__main__":
    unittest.main()
