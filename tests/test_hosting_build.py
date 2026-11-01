import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hosting_builder", ROOT / "tools" / "build_hosting.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class HostingBuildTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".hosting-test-", dir=ROOT)
        self.root = Path(self.temp.name)
        self.assertEqual(self.root.resolve().parent, ROOT)
        self.addCleanup(self.temp.cleanup)
        for name in builder.ROOT_FILES:
            (self.root / name).write_text("public page", encoding="utf-8")
        (self.root / "assets" / "js").mkdir(parents=True)
        (self.root / "timer").mkdir()
        (self.root / "assets" / "js" / "login.js").write_text("public script", encoding="utf-8")
        (self.root / "timer" / "index.html").write_text("public timer", encoding="utf-8")

    def test_only_explicitly_public_files_are_exported(self):
        (self.root / ".env").write_text("private", encoding="utf-8")
        (self.root / "firebase.json").write_text("private config", encoding="utf-8")
        (self.root / "assets" / "private.json").write_text("private", encoding="utf-8")
        (self.root / "assets" / ".private.js").write_text("private", encoding="utf-8")
        (self.root / "tools").mkdir()
        (self.root / "tools" / "private.js").write_text("private", encoding="utf-8")
        destination, files = builder.build(self.root)
        self.assertEqual(set(files), set(builder.ROOT_FILES) | {"assets/js/login.js", "timer/index.html"})
        self.assertEqual((destination / "assets/js/login.js").read_text(), "public script")
        self.assertFalse((destination / ".env").exists())
        self.assertFalse((destination / "firebase.json").exists())
        self.assertFalse((destination / "assets/private.json").exists())

    def test_rebuilding_removes_stale_generated_files(self):
        destination, _ = builder.build(self.root)
        (self.root / "assets/js/login.js").unlink()
        builder.build(self.root)
        self.assertFalse((destination / "assets/js/login.js").exists())

    def test_an_existing_unowned_directory_is_not_overwritten(self):
        (self.root / "dist").mkdir()
        original = self.root / "dist" / "keep.txt"
        original.write_text("keep", encoding="utf-8")
        with self.assertRaises(ValueError):
            builder.build(self.root)
        self.assertEqual(original.read_text(), "keep")

    def test_hosting_deployment_builds_a_dedicated_directory_and_does_not_deploy_rules(self):
        config = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))
        self.assertEqual(config["hosting"]["public"], "dist")
        self.assertEqual(config["hosting"]["predeploy"], ["python tools/build_hosting.py"])
        self.assertEqual(config["firestore"]["rules"], "firestore.rules")
        self.assertNotIn("rewrites", config["hosting"])


if __name__ == "__main__":
    unittest.main()
