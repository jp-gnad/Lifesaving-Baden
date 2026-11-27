"""The two-row competition export. No database access in this module."""
import hashlib
import json
import math
import re
import unicodedata
from datetime import date, datetime, time, timedelta

from openpyxl.utils.datetime import from_excel


DISCIPLINES = (
    "100m Lifesaver", "50m Retten", "200m Super Lifesaver", "100m Kombi",
    "100m Retten/Flossen", "200m Hindernis", "100m Hindernis", "100m MLS",
    "50m Retten/Flossen", "50m Flosse", "50m Hindernis", "50m k. Schwimmen",
    "50m Freistil", "25m Freistil", "25m Brust", "25m Rücken ohne Arme", "25m Puppe",
)
FIELDS = ("Name", "Gender", "AK", "Age", "OG", "BZ", "LV", "BV", "PLACE", "3-Kampf",
          "4-Kampf (ohne HLW)", "LSC", "LSC Change", "HLW", "Datum", "Wettkampf", "Bahn",
          "Rule", "Land", "Stadt", "St. Recht", "Lauf", "Wertung", "WK-Name")
BLOCK = ["pl", "time", "points", "c", "st"]


def clean(value):
    if value is None:
        return ""
    return " ".join(unicodedata.normalize("NFC", str(value)).split())


def heading(value):
    return re.sub(r"[\s.()/-]", "", clean(value).lower())


def stable_id(prefix, *parts):
    key = json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return prefix + hashlib.sha256(key).hexdigest()[:32]


def columns(top, bottom):
    labels = {heading(name): name for name in FIELDS}
    disciplines = {heading(name): f"D{i:03d}" for i, name in enumerate(DISCIPLINES, 1)}
    disciplines[heading("25m Rü. ohne Arme")] = "D016"
    bottom = [heading(value) for value in bottom]
    fields, blocks = {}, {}
    i = 0
    while i < len(bottom):
        if bottom[i:i+5] == BLOCK:
            names = {disciplines.get(heading(v)) for v in top[i:i+5] if clean(v)}
            if len(names) != 1 or None in names:
                raise ValueError(f"Disziplinüberschrift über Spalten {i+1}–{i+5} prüfen.")
            key = names.pop()
            if key in blocks:
                raise ValueError(f"Doppelter Disziplinblock {key}.")
            blocks[key] = i
            i += 5
            continue
        if bottom[i]:
            field = labels.get(bottom[i])
            if field is None or field in fields:
                raise ValueError(f"Unbekannte oder doppelte Überschrift in Spalte {i+1}.")
            fields[field] = i
        i += 1
    missing = set(FIELDS) - fields.keys()
    if missing or len(blocks) != len(DISCIPLINES):
        raise ValueError(f"Kopfzeilen prüfen: fehlende Felder {sorted(missing)}, {len(blocks)}/17 Disziplinblöcke.")
    return fields, blocks


def number(value):
    s = clean(value)
    if not s:
        return None
    if "," in s:
        if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+", s):
            raise ValueError(f"Ungültige Dezimalzahl {s!r}.")
        s = s.replace(".", "").replace(",", ".")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", s) or not math.isfinite(float(s)):
        raise ValueError(f"Ungültige Zahl {s!r}.")
    return int(s) if "." not in s else float(s)


def integer(value):
    n = number(value)
    if n is None or n != int(n):
        raise ValueError(f"Ganze Zahl erwartet: {value!r}.")
    return int(n)


def event_date(value, epoch):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = clean(value)
    if re.fullmatch(r"\d+(?:[.,]0+)?", s):
        converted = from_excel(integer(s), epoch)
        if isinstance(converted, datetime):
            return converted.date()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Ungültiges Wettkampfdatum {s!r}.")


def birth_year(value, year):
    n = integer(value)
    if 0 <= n <= 99:
        candidates = [y for y in range(year-110, year+1) if y % 100 == n]
        if len(candidates) == 1:
            return candidates[0]
        raise ValueError(f"Jahrgang {n:02d} mehrdeutig ({candidates}); Age vierstellig angeben.")
    if 1000 <= n <= year:
        return n
    raise ValueError(f"Ungültiger Jahrgang {n}.")


def elapsed_ms(value):
    if isinstance(value, time):
        value = timedelta(hours=value.hour, minutes=value.minute, seconds=value.second,
                          microseconds=value.microsecond)
    if isinstance(value, timedelta):
        ms = round(value.total_seconds() * 1000)
        if ms < 0:
            raise ValueError("Negative Zeit.")
        return ms
    match = re.fullmatch(r"(?:(\d+):)?(\d{1,2})(?:[,.](\d{1,3}))?", clean(value))
    if not match or (match[1] and int(match[2]) >= 60):
        raise ValueError(f"Ungültige Zeit {value!r}; erwartet z. B. 0:59,89.")
    return (int(match[1] or 0)*60 + int(match[2]))*1000 + int((match[3] or "").ljust(3, "0"))


def discipline(values):
    markers = {"na": "DNS", "disq": "DQ"}
    marked = {markers[heading(v)] for v in values if heading(v) in markers}
    if len(marked) > 1:
        raise ValueError("Widersprüchliche Statusmarker disq und n.a.")
    status = next(iter(marked), "OK")
    place, duration, points, _, penalty = [
        v if clean(v) and heading(v) not in markers else None for v in values
    ]
    result = dict(place=integer(place) if place is not None else None,
                  timeMs=elapsed_ms(duration) if duration is not None else None,
                  points=number(points), faultCode=clean(values[3]) or None,
                  penaltyPoints=number(penalty), status=status)
    if status == "DNS" and result["points"] not in (None, 0):
        raise ValueError("Nichtantritt mit Punkten ungleich 0.")
    return result


def round_fields(value):
    s = clean(value)
    if not s:
        return None, None
    m = re.fullmatch(r"([1-3])(?:/([1-3]))?", s)
    if not m or (m[2] and m[1] > m[2]):
        raise ValueError(f"Unbekannter Lauf {s!r}.")
    return int(m[1]), int(m[2]) if m[2] else None


def documents(values, fields, blocks, epoch):
    row = {key: values[i] for key, i in fields.items()}
    day = event_date(row["Datum"], epoch)
    year = birth_year(row["Age"], day.year)
    name = clean(row["Name"])
    parts = [s.strip() for s in name.split(",")]
    gender = clean(row["Gender"]).lower()
    if len(parts) != 2 or not all(parts) or gender not in ("m", "w", "d"):
        raise ValueError("Name (Nachname, Vorname) und Gender prüfen.")
    last, first = parts
    suffix = re.fullmatch(r"(.+?)\s+\(([1-9]\d*)\)", first)
    discriminator = int(suffix[2]) if suffix else None
    first = suffix[1] if suffix else first
    athlete_id = stable_id("A", last.lower(), first.lower(), year, gender, discriminator)
    athlete = dict(lastName=last, firstName=first, birthYear=year, gender=gender,
                   discriminator=discriminator)
    event = clean(row["Wettkampf"])
    event_id = stable_id("W", event.lower())
    pool = re.fullmatch(r"(\d+)\s*m?", clean(row["Bahn"]), re.I)
    if not event or (clean(row["Bahn"]) and (not pool or int(pool[1]) < 1)):
        raise ValueError("Wettkampfbezeichnung oder Bahnlänge prüfen.")
    competition = dict(name=event, fullName=clean(row["WK-Name"]), date=day.isoformat(),
                       poolLength=int(pool[1]) if pool else None, rule=clean(row["Rule"]),
                       country=clean(row["Land"]), city=clean(row["Stadt"]))
    docs = [("statsCompetitions", event_id, competition), ("statsAthletes", athlete_id, athlete)]
    parent = None
    affiliations = {}
    previous_kind = None
    for kind in ("BV", "LV", "BZ", "OG"):
        org = clean(row[kind])
        org_id = None
        if org:
            if previous_kind and not affiliations[previous_kind.lower()+"Id"]:
                raise ValueError(f"{kind} {org!r}: zugehörigen {previous_kind} zur eindeutigen Zuordnung ergänzen.")
            org_id = stable_id("C", kind, parent, org.lower())
            docs.append(("statsOrganizations", org_id, dict(type=kind, name=org, parentId=parent)))
            parent = org_id
        affiliations[kind.lower()+"Id"] = org_id
        previous_kind = kind
    heats, total = round_fields(row["Lauf"])
    entries = {}
    for key, i in blocks.items():
        cells = values[i:i+5]
        if any(clean(v) for v in cells):
            try:
                entries[key] = discipline(cells)
            except ValueError as exc:
                raise ValueError(f"{key}: {exc}") from exc
    result_id = stable_id("R", event_id, athlete_id, heats)
    result = dict(athleteId=athlete_id, competitionId=event_id, **affiliations, gender=gender,
                  ageGroup=clean(row["AK"]), startRight=clean(row["St. Recht"]),
                  round=heats, roundTotal=total, classification=clean(row["Wertung"]),
                  place=integer(row["PLACE"]) if clean(row["PLACE"]) else None,
                  overallPoints=number(row["3-Kampf"]), fourEventPoints=number(row["4-Kampf (ohne HLW)"]),
                  lsc=number(row["LSC"]), legacyLscChange=number(row["LSC Change"]),
                  hlw=row["HLW"] if clean(row["HLW"]) else None, disciplines=entries)
    docs.append(("statsResults", result_id, result))
    return docs
