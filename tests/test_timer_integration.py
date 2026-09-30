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
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        role_select_block = auth[auth.index("function createAdminAccountRoleSelect"):]
        role_select_block = role_select_block[: role_select_block.index("function createAdminAccountRoleDisplay")]
        self.assertNotIn('{ value: "admin"', role_select_block)
        self.assertIn("request.auth.uid != uid", rules)

    def test_timer_card_is_on_member_home(self):
        app_html = (ROOT / "app.html").read_text(encoding="utf-8")
        self.assertIn('href="timer/"', app_html)
        self.assertIn("Lifesaving Timer", app_html)

    def test_known_club_cap_is_mapped(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        self.assertIn('"Cap-Deportivo Sirenas de Catarroja.svg"', app)
        self.assertIn('"Deportivo Sirenas de Catarroja"', app)

    def test_timer_has_account_trigger_and_realtime_results(self):
        html = (ROOT / "timer" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        self.assertIn('id="timer-account-control"', html)
        self.assertIn('id="timer-account-dialog"', html)
        self.assertIn("watchResults", app)
        self.assertIn("query.onSnapshot", adapter)

    def test_timer_results_do_not_write_nested_firestore_arrays(self):
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        self.assertIn("lapGroups.map((laps) => ({ laps: [...laps] }))", adapter)
        self.assertIn("Array.isArray(group?.laps) ? group.laps : []", adapter)

    def test_signed_in_landing_and_timer_links_return_to_member_app(self):
        landing = (ROOT / "index.html").read_text(encoding="utf-8")
        auth = (ROOT / "assets" / "js" / "auth.js").read_text(encoding="utf-8")
        timer_html = (ROOT / "timer" / "index.html").read_text(encoding="utf-8")
        timer_app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        self.assertIn('data-page="landing"', landing)
        self.assertIn('page === "landing"', auth)
        self.assertIn('id="timer-portal-link"', timer_html)
        self.assertIn('currentTimerAuth.authenticated ? "../app.html" : "../index.html"', timer_app)

    def test_participant_directory_is_organizer_only(self):
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        self.assertIn("canImportParticipants: participantMode === \"edit\" && authContext.isOrganizer", adapter)
        directory_rule = rules[rules.index("match /timerParticipantDirectory/{candidateId}"):]
        self.assertIn("allow read: if isOrganizer();", directory_rule)
        self.assertIn("allow write: if false;", directory_rule)


if __name__ == "__main__":
    unittest.main()
