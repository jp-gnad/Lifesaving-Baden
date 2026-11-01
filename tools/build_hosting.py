"""Build the static Firebase Hosting directory from explicitly public website files."""

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = (
    "index.html", "login.html", "app.html", "account-settings.html",
    "link-request.html", "impressum.html", "datenschutz.html", "manifest.webmanifest",
)
PUBLIC_SUFFIXES = {".html", ".js", ".css", ".webmanifest", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"}
BUILD_MARKER = ".lifesaving-hosting-build.json"


def public_files(root):
    root = root.resolve()
    files = [root / name for name in ROOT_FILES]
    for folder in ("assets", "timer"):
        directory = root / folder
        if directory.is_symlink():
            raise ValueError(f"Public directory must not be a symlink: {directory}")
        for source in directory.rglob("*"):
            relative = source.relative_to(root)
            if any(part.startswith(".") or part in {"node_modules", "__pycache__"} for part in relative.parts):
                continue
            if source.is_file() and source.suffix.lower() in PUBLIC_SUFFIXES:
                files.append(source)
    for source in files:
        if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(root):
            raise ValueError(f"Invalid public website file: {source}")
        if any((root / parent).is_symlink() for parent in source.relative_to(root).parents if parent != Path(".")):
            raise ValueError(f"Public file must not use symlink directories: {source}")
    return files


def build(root=ROOT):
    root = root.resolve()
    destination = root / "dist"
    files = public_files(root)
    if destination.is_symlink() or destination.resolve().parent != root:
        raise ValueError(f"Build destination must be a direct child of the workspace: {destination}")
    if destination.exists():
        marker = destination / BUILD_MARKER
        if not marker.is_file() or json.loads(marker.read_text(encoding="utf-8")).get("builder") != "lifesaving-static-hosting":
            raise ValueError(f"Refusing to replace a directory without this builder's marker: {destination}")
        # The absolute target, workspace parent, and generated-directory marker were verified above.
        shutil.rmtree(destination)
    destination.mkdir()
    relative_files = []
    for source in files:
        relative = source.relative_to(root)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        relative_files.append(relative.as_posix())
    (destination / BUILD_MARKER).write_text(json.dumps({
        "builder": "lifesaving-static-hosting", "files": sorted(relative_files),
    }, indent=2), encoding="utf-8")
    return destination, relative_files


if __name__ == "__main__":
    output, files = build()
    print(f"Prepared {len(files)} public website files in {output}")
