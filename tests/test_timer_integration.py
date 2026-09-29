import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TimerIntegrationTest(unittest.TestCase):
    def test_timer_entrypoint_uses_relative_local_assets(self):
        html = (ROOT / "timer" / "index.html").read_text(encoding="utf-8")
        references = re.findall(r'(?:href|src)="([^"#?]+)', html)
        local_references = [
            reference
            for reference in references
            if not reference.startswith(("http://", "https://"))
        ]
        for reference in local_references:
            target = (ROOT / "timer" / reference).resolve()
            self.assertTrue(target.exists(), f"Missing timer asset: {reference}")

    def test_timer_has_no_cloudflare_api_dependency(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(`/api", app)
        self.assertIn('db.collection("timerEvents")', adapter)

    def test_access_levels_are_present_in_ui_adapter_and_rules(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        for level in ("organizer", "authenticated", "everyone"):
            self.assertIn(level, app)
            self.assertIn(level, adapter)
            self.assertIn(level, rules)

    def test_admin_cannot_be_granted_from_account_ui(self):
        auth = (ROOT / "assets" / "js" / "auth.js").read_text(encoding="utf-8")
        role_select_block = auth[auth.index("function createAdminAccountRoleSelect"):]
        role_select_block = role_select_block[: role_select_block.index("function createAdminAccountRoleDisplay")]
        self.assertNotIn('{ value: "admin"', role_select_block)

    def test_timer_card_is_on_member_home(self):
        app_html = (ROOT / "app.html").read_text(encoding="utf-8")
        self.assertIn('href="timer/"', app_html)
        self.assertIn("Lifesaving Timer", app_html)


if __name__ == "__main__":
    unittest.main()
