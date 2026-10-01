import re
import struct
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
        for level in ("everyone", "authenticated", "kader", "organizer", "locked"):
            self.assertIn(level, app)
            self.assertIn(level, adapter)
            self.assertIn(level, rules)
        self.assertIn("Gesperrt (nur Admin)", app)
        self.assertIn("Angemeldete Personen", app)
        self.assertIn("Kadersportler", app)
        self.assertIn("Organisatoren", app)
        self.assertIn("if (authContext.isAdmin) return true", adapter)
        self.assertIn('if (level === "authenticated") return authContext.authenticated', adapter)
        self.assertIn('if (level === "kader") return authContext.isKaderAthlete || authContext.isOrganizer', adapter)
        self.assertIn('return level === "organizer" && authContext.isOrganizer', adapter)
        event_access_rule = rules[rules.index("function eventAllows"):rules.index("function ownerKeepsProtectedFieldsSafe")]
        self.assertIn("return isAdmin()", event_access_rule)
        self.assertNotIn("return isOrganizer()", event_access_rule)

    def test_admin_cannot_be_granted_from_account_ui(self):
        auth = (ROOT / "assets" / "js" / "auth.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        role_select_block = auth[auth.index("function createAdminAccountRoleSelect"):]
        role_select_block = role_select_block[: role_select_block.index("function createAdminAccountRoleDisplay")]
        self.assertNotIn('{ value: "admin"', role_select_block)
        self.assertIn("request.auth.uid != uid", rules)

    def test_timer_card_is_on_member_home(self):
        app_html = (ROOT / "app.html").read_text(encoding="utf-8")
        styles = (ROOT / "assets" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('class="member-app" href="timer/#/"', app_html)
        self.assertIn("Lifesaving Timer", app_html)
        self.assertIn('class="member-app-label">Timer</span>', app_html)
        self.assertNotIn('id="member-apps-title"', app_html)
        self.assertIn("app-icon-1024.png", app_html)
        self.assertIn(".member-app-icon", styles)
        member_hover = styles[styles.index(".member-app:hover .member-app-icon"):]
        member_hover = member_hover[:member_hover.index(".member-app:focus-visible")]
        self.assertNotIn("transform", member_hover)
        self.assertNotIn("color", member_hover)
        self.assertNotIn("timer-app-card", app_html)

    def test_public_home_links_to_timer_event_overview(self):
        landing = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="timer" aria-labelledby="timer-title"', landing)
        self.assertIn('class="public-timer-launcher" href="timer/#/"', landing)
        self.assertIn("Eventübersicht öffnen", landing)
        self.assertIn("app-icon-1024.png", landing)
        self.assertIn("min-height: 68px", (ROOT / "assets" / "css" / "styles.css").read_text(encoding="utf-8"))
        self.assertNotIn('id="training"', landing)

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
        self.assertIn('collection("results").onSnapshot', adapter)

    def test_stopwatch_view_has_no_account_trigger(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        timer_renderer = app[app.index("async function renderTimer(id)"):app.index("async function renderViewer")]

        self.assertNotIn("compactAccountTrigger", app)
        self.assertNotIn("data-timer-account-open", timer_renderer)
        self.assertNotIn("timer-account-compact", timer_renderer)

    def test_stopwatch_skips_a_single_mode_category(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        timer_renderer = app[app.index("async function renderTimer(id)"):app.index("async function renderViewer")]

        self.assertIn("function availableModeGroups()", timer_renderer)
        self.assertIn("if (availableGroups.length === 1) renderModeGroup(availableGroups[0].id, { allowBack: false })", timer_renderer)
        self.assertIn('if (!group) return;', timer_renderer)
        self.assertNotIn('if (!group || group.id === "normal") return;', timer_renderer)

    def test_timer_access_replaces_the_old_enabled_status(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        settings_renderer = app[app.index("async function renderEventSettings"):app.index("async function renderPeople")]
        result_rules = rules[rules.index("match /results/{resultId}"):rules.index("match /timerParticipantDirectory")]

        self.assertNotIn('name="timerEnabled"', settings_renderer)
        self.assertNotIn("eventTimerEnabled", app)
        self.assertIn("canUseTimer: canUseAccess(timerAccess)", adapter)
        self.assertNotIn("timer_enabled:", adapter)
        self.assertNotIn("eventData(eventId).timerEnabled == true", result_rules)

    def test_timer_reuses_lifesaving_baden_footer(self):
        html = (ROOT / "timer" / "index.html").read_text(encoding="utf-8")
        styles = (ROOT / "timer" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('class="timer-site-footer"', html)
        self.assertIn('src="../assets/img/elch-gelb.png"', html)
        self.assertIn('href="../impressum.html"', html)
        self.assertIn('href="../datenschutz.html"', html)
        self.assertIn("body.home-page .timer-site-footer, body.event-page .timer-site-footer", styles)
        self.assertIn("body.timer-page .timer-site-footer", styles)
        self.assertIn(".timer-footer-brand:hover, .timer-footer-brand:focus-visible { background: transparent;", styles)
        self.assertIn(".timer-footer-links a:hover, .timer-footer-links a:focus-visible { background: transparent;", styles)

    def test_event_overview_navigation_uses_header_brand(self):
        html = (ROOT / "timer" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        event_renderer = app[app.index("async function renderEvent(id)"):app.index("async function renderEventSettings")]

        self.assertIn('class="brand" href="#/"', html)
        self.assertNotIn('class="back" href="#/"', event_renderer)

    def test_event_settings_have_a_dedicated_event_submenu(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        settings_renderer = app[app.index("async function renderEventSettings"):app.index("async function renderPeople")]

        self.assertIn('new Set(["event", "timer", "results", "access"])', settings_renderer)
        self.assertIn('{ id: "event", icon: "calendar", name: "Event"', settings_renderer)
        self.assertIn('activeSection === "event" ? eventMarkup', settings_renderer)
        self.assertIn('if (activeSection === "event") Object.assign(payload', settings_renderer)
        self.assertIn('class="event-settings-actions settings-overview-actions"', settings_renderer)
        self.assertIn('href="#/event/${id}" data-history-back>Abbrechen</a>', settings_renderer)

    def test_public_results_share_link_is_results_only(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        styles = (ROOT / "timer" / "styles.css").read_text(encoding="utf-8")

        self.assertIn('shareUrl.hash = `#/results/${id}`', app)
        self.assertIn('event.results_access === "everyone" ? `<button', app)
        self.assertNotIn('body: JSON.stringify({ resultsAccess: "everyone" })', app)
        self.assertNotIn('Ergebnisse dieses Events werden dafür auf „Jeder“ gestellt', app)
        self.assertIn('current.page === "results"', app)
        self.assertIn('{ resultsOnly: true }', app)
        self.assertIn('!resultsOnly && eventCan(event, "can_edit_results")', app)
        self.assertIn('body.shared-results-page > .site-header', styles)
        self.assertIn('body.eventDate === undefined ? current.eventDate : body.eventDate', adapter)

    def test_saved_official_results_url_is_linked_in_viewer(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        self.assertIn("const officialResultsUrl = safeExternalUrl(event.result_url)", app)
        self.assertIn("Offizielle Ergebnisse</a>", app)
        self.assertIn('target="_blank" rel="noopener noreferrer"', app)

    def test_admin_permission_checks_match_client_and_rules(self):
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        self.assertIn('adminData().keys().hasAny(["isAdmin"])', rules)
        self.assertIn('request.auth.token.role in ["admin", "Admin", "ADMIN"]', rules)
        self.assertIn("await auth.currentUser.getIdToken(true)", adapter)

    def test_timer_brand_icons_have_expected_sizes_and_cache_busting(self):
        html = (ROOT / "timer" / "index.html").read_text(encoding="utf-8")
        manifest = (ROOT / "timer" / "manifest.webmanifest").read_text(encoding="utf-8")
        service_worker = (ROOT / "timer" / "sw.js").read_text(encoding="utf-8")
        expected_sizes = (64, 180, 192, 512, 1024)

        for size in expected_sizes:
            icon = ROOT / "timer" / f"app-icon-{size}.png"
            data = icon.read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            width, height = struct.unpack(">II", data[16:24])
            self.assertEqual((width, height), (size, size))

        self.assertIn("baden-brand-v1", html)
        self.assertIn("baden-brand-v1", manifest)
        self.assertIn("baden-brand-v1", service_worker)

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
        self.assertNotIn('id="timer-portal-link"', timer_html)
        self.assertIn('id="timer-footer-portal-link"', timer_html)
        self.assertIn('timerFooterPortalLink.setAttribute("href", currentTimerAuth.authenticated ? "../app.html" : "../index.html")', timer_app)

    def test_mobile_google_login_is_persistent_and_redirect_race_safe(self):
        auth = (ROOT / "assets" / "js" / "auth.js").read_text(encoding="utf-8")
        login = (ROOT / "login.html").read_text(encoding="utf-8")
        app = (ROOT / "app.html").read_text(encoding="utf-8")
        timer_login = (ROOT / "timer" / "login.html").read_text(encoding="utf-8")
        timer_app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        timer_worker = (ROOT / "timer" / "sw.js").read_text(encoding="utf-8")

        self.assertIn("window.firebase.auth.Auth.Persistence.LOCAL", auth)
        self.assertIn("const localPersistenceReady = ensureLocalAuthPersistence(auth)", auth)
        self.assertIn("let verifiedLoginPromise = null", auth)
        self.assertIn("loginRedirectStarted = true;\n        redirectToApp();", auth)
        self.assertIn('document.body.dataset.authSuccessUrl || "app.html"', auth)
        self.assertIn('googleButton?.addEventListener("click"', auth)
        self.assertIn("firebasejs/12.19.0/firebase-auth-compat.js", login)
        self.assertIn("firebasejs/12.19.0/firebase-auth-compat.js", app)
        self.assertIn("auth.js?v=20261001-ios-pwa-google-v3", login)
        self.assertIn("auth.js?v=20261001-ios-pwa-google-v3", app)
        self.assertIn("loadFreshUserContext(activeUser)", auth)
        self.assertIn('userDoc.get({ source: "server" })', auth)
        self.assertIn('data-auth-success-url="./#/"', timer_login)
        self.assertIn("data-google-login", timer_login)
        self.assertNotIn('type="email"', timer_login)
        self.assertNotIn('type="password"', timer_login)
        self.assertIn('new URL("./login.html", window.location.href)', timer_app)
        self.assertIn('"./login.html"', timer_worker)

    def test_timer_waits_for_persistent_auth_and_fresh_role_data(self):
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        self.assertIn("Auth.Persistence.LOCAL", adapter)
        self.assertIn("loadTimerUserIdentity(user)", adapter)
        self.assertIn('get({ source: "server" })', adapter)
        self.assertIn("user.getIdTokenResult(attempt === 1)", adapter)

    def test_participant_directory_is_organizer_only(self):
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        self.assertIn("canImportParticipants: authContext.isOrganizer && canUseAccess(participantEditAccess)", adapter)
        directory_rule = rules[rules.index("match /timerParticipantDirectory/{candidateId}"):]
        self.assertIn("allow read: if isOrganizer();", directory_rule)
        self.assertIn("allow write: if false;", directory_rule)

    def test_legacy_event_statuses_no_longer_control_timer_features(self):
        app = (ROOT / "timer" / "app.js").read_text(encoding="utf-8")
        adapter = (ROOT / "timer" / "firestore-api.js").read_text(encoding="utf-8")
        rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
        self.assertNotIn('name="resultsMode"', app)
        self.assertNotIn('name="participantMode"', app)
        self.assertNotIn("eventResultsMode", app)
        self.assertNotIn("eventParticipantMode", app)
        self.assertNotIn('results_mode:', adapter)
        self.assertNotIn('participant_mode:', adapter)
        self.assertNotIn('data.resultsMode in ["live", "pause", "stop"]', rules)
        self.assertNotIn('data.participantMode in ["edit", "view", "hidden"]', rules)


if __name__ == "__main__":
    unittest.main()
