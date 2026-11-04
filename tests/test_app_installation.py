import json
import struct
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


ROOT = Path(__file__).resolve().parents[1]


class PageMetadata(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.manifests = []
        self.touch_icons = []
        self.meta = {}
        self.links = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link":
            rel = attrs.get("rel", "").split()
            if "manifest" in rel:
                self.manifests.append(attrs["href"])
            if "apple-touch-icon" in rel:
                self.touch_icons.append(attrs["href"])
        elif tag == "meta":
            key = attrs.get("name") or attrs.get("property")
            if key:
                self.meta[key] = attrs.get("content")
        elif tag == "a" and "href" in attrs:
            self.links.append(attrs)


class AppInstallationTest(unittest.TestCase):
    def test_all_pages_share_one_standalone_manifest_and_apple_metadata(self):
        pages = list(ROOT.glob("*.html")) + list((ROOT / "timer").glob("*.html"))
        for page in pages:
            metadata = PageMetadata(page.read_text(encoding="utf-8"))
            with self.subTest(page=page.relative_to(ROOT)):
                self.assertEqual(len(metadata.manifests), 1)
                reference = urlsplit(metadata.manifests[0])
                self.assertEqual((page.parent / reference.path).resolve(), ROOT / "manifest.webmanifest")
                self.assertEqual(metadata.meta["apple-mobile-web-app-capable"], "yes")
                self.assertEqual(metadata.meta["apple-mobile-web-app-title"], "Lifesaving Baden")
                self.assertEqual(len(metadata.touch_icons), 1)
                icon = urlsplit(metadata.touch_icons[0]).path
                self.assertEqual((page.parent / icon).resolve(), ROOT / "assets/img/lifesaving-baden-app-180.png")
                self.assertEqual(metadata.meta["og:image"], "https://jp-gnad.github.io/Lifesaving-Baden/assets/img/lifesaving-baden-app-512.png")

    def test_project_app_scope_contains_every_page_and_timer_route_on_both_hosting_paths(self):
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        pages = list(ROOT.glob("*.html")) + list((ROOT / "timer").glob("*.html"))
        for base in ("https://example.test/", "https://example.test/Lifesaving-Baden/"):
            manifest_url = urljoin(base, "manifest.webmanifest")
            scope = urljoin(manifest_url, manifest["scope"])
            self.assertEqual(scope, base)
            self.assertEqual(urljoin(manifest_url, manifest["id"]), base)
            self.assertEqual(urljoin(manifest_url, manifest["start_url"]), base)
            for page in pages:
                url = urljoin(base, page.relative_to(ROOT).as_posix())
                self.assertTrue(url.startswith(scope), url)
            self.assertTrue(urljoin(base, "timer/#/event/example").startswith(scope))

    def test_internal_navigation_keeps_the_current_window_and_stays_in_scope(self):
        base = "https://example.test/Lifesaving-Baden/"
        for page in list(ROOT.glob("*.html")) + list((ROOT / "timer").glob("*.html")):
            metadata = PageMetadata(page.read_text(encoding="utf-8"))
            page_url = urljoin(base, page.relative_to(ROOT).as_posix())
            for link in metadata.links:
                target = urljoin(page_url, link["href"])
                if urlsplit(target).netloc != "example.test":
                    continue
                with self.subTest(page=page.relative_to(ROOT), link=link["href"]):
                    self.assertTrue(target.startswith(base), target)
                    self.assertNotEqual(link.get("target"), "_blank")

    def test_app_icons_and_cached_manifest_resolve(self):
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual({icon["sizes"] for icon in manifest["icons"]}, {"192x192", "512x512"})
        for icon in manifest["icons"]:
            size = int(icon["sizes"].split("x")[0])
            path = ROOT / unquote(urlsplit(icon["src"]).path)
            self.assertEqual(path, ROOT / f"assets/img/lifesaving-baden-app-{size}.png")
            self.assertEqual(struct.unpack(">II", path.read_bytes()[16:24]), (size, size))
        touch_icon = ROOT / "assets/img/lifesaving-baden-app-180.png"
        self.assertEqual(struct.unpack(">II", touch_icon.read_bytes()[16:24]), (180, 180))
        worker = (ROOT / "timer" / "sw.js").read_text(encoding="utf-8")
        self.assertIn('"../manifest.webmanifest?v=20261105-baden-icon-v2"', worker)

    def test_old_timer_manifest_keeps_its_original_identity_and_timer_start(self):
        manifest = json.loads((ROOT / "timer" / "manifest.webmanifest").read_text(encoding="utf-8"))
        base = "https://example.test/Lifesaving-Baden/timer/manifest.webmanifest"
        original_start = "https://example.test/Lifesaving-Baden/timer/"
        self.assertEqual(urljoin(base, manifest["id"]), original_start)
        self.assertEqual(urljoin(base, manifest["start_url"]), original_start)
        self.assertEqual(urljoin(base, manifest["scope"]), "https://example.test/Lifesaving-Baden/")


if __name__ == "__main__":
    unittest.main()
