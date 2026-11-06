"""Offline term discovery and 14-day review over the site's observed evidence."""

import argparse
from collections import Counter
import json
import re
import sqlite3
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit


KINDS = {"model", "product", "tool", "repository", "concept", "other"}
GENERIC = {"ai", "api", "llm", "llms", "mcp", "agent", "agents", "model", "tool", "tools",
           "github", "release", "version", "open source", "new model", "模型", "工具", "人工智能", "智能体"}
# Only extract a launch subject in predictable title formats when no model judgment is available.
LATIN_NAME = r"[A-Z][A-Za-z0-9.+_-]*(?: [A-Z0-9][A-Za-z0-9.+_-]*){0,2}"
ANNOUNCEMENT = re.compile(rf"^(?i:introducing|announcing|show hn:)\s+[\"“]?({LATIN_NAME})(?=$|[\s,，:：—–!?\"”])")
QUOTED_LAUNCH = re.compile(r"(?:推出|发布|开源|上线)(?:了)?\s*[「《“]([^」》”]{2,64})[」》”]")
SCHEMA = """
CREATE TABLE IF NOT EXISTS terms (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL,
    opportunity TEXT, cited_urls TEXT NOT NULL, first_day TEXT NOT NULL, last_day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
    term_key TEXT NOT NULL, url TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
    source TEXT NOT NULL, published_at TEXT NOT NULL, revision TEXT, observed_day TEXT NOT NULL,
    PRIMARY KEY (term_key, url), UNIQUE (term_key, id)
);
CREATE INDEX IF NOT EXISTS evidence_id ON evidence(id);
CREATE TABLE IF NOT EXISTS scans (day TEXT PRIMARY KEY, has_input INTEGER NOT NULL);
"""


def key_for(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def contains_name(text, key):
    # ASCII word boundaries still allow a name adjoining a Chinese verb in the original title.
    return re.search(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", text) is not None


def timestamp(raw):
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("timestamps require an explicit time zone")
    return value.astimezone(timezone.utc)


def items_by_id(items, now):
    result = {}
    urls = set()
    for item in items:
        if not all(isinstance(item.get(k), str) and item[k].strip() for k in ("id", "title", "source", "url", "publishedAt")):
            raise ValueError("each item needs an id, title, source, url and publishedAt")
        url = urlsplit(item["url"])
        if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password:
            raise ValueError("each evidence link must be a public HTTP(S) URL without credentials")
        if timestamp(item["publishedAt"]) > now or item["url"] in urls:
            continue
        urls.add(item["url"])
        summary = item.get("summary") or ""
        result[item["id"]] = {**item, "text": key_for(item["title"] + "\n" + summary)}
    return result


def launch_candidates(items):
    for item in items.values():
        title = item["title"].strip()
        match = ANNOUNCEMENT.search(title) or QUOTED_LAUNCH.search(title)
        if match:
            name = match.group(1).rstrip(".-_")
            yield {"term": name, "kind": "other", "summary": title[:300], "opportunity": None,
                   "evidenceIds": [item["id"]]}


def saved_evidence(conn, now):
    rows = conn.execute("""SELECT DISTINCT e.id, e.revision FROM evidence e
        JOIN terms t ON t.key=e.term_key WHERE e.revision IS NOT NULL AND t.last_day >= date(?, '-30 days')""",
                        (now.date().isoformat(),))
    return [{"id": id_, "revision": revision} for id_, revision in rows]


def apply_corrections(conn, items, invalidated):
    # A corrected citation invalidates any generated text that used it. A fresh grounded proposal
    # may replace the judgment below; an abstention keeps the old text out of the report.
    for id_ in items.keys() | {id_ for id_, _ in invalidated}:
        item = items.get(id_)
        rows = conn.execute("""SELECT e.term_key, e.url, e.revision, t.cited_urls FROM evidence e
            JOIN terms t ON t.key=e.term_key WHERE e.id=?""", (id_,)).fetchall()
        for row in rows:
            changed = item and item.get("revision") and item["revision"] != row["revision"]
            if not changed and (id_, row["revision"]) not in invalidated:
                continue
            key = row["term_key"]
            if row["url"] in json.loads(row["cited_urls"]):
                conn.execute("""UPDATE terms SET kind='other', summary='', opportunity=NULL, cited_urls='[]'
                                WHERE key=?""", (key,))
            if item and contains_name(item["text"], key) and not conflicting_url(conn, key, item):
                conn.execute("""UPDATE evidence SET title=?, source=?, url=?, published_at=?, revision=?
                                WHERE term_key=? AND id=?""",
                             (item["title"], item["source"], item["url"], item["publishedAt"], item["revision"], key, item["id"]))
            else:
                conn.execute("DELETE FROM evidence WHERE term_key=? AND id=?", (key, id_))
                bounds = conn.execute("SELECT MIN(observed_day), MAX(observed_day) FROM evidence WHERE term_key=?",
                                      (key,)).fetchone()
                if bounds[0]:
                    conn.execute("UPDATE terms SET first_day=?, last_day=? WHERE key=?", (*bounds, key))
                else:
                    conn.execute("DELETE FROM terms WHERE key=?", (key,))


def conflicting_url(conn, key, item):
    # An earlier scan may have retained this URL under a different publication and revision.
    return conn.execute("SELECT 1 FROM evidence WHERE term_key=? AND url=? AND id<>?",
                        (key, item["url"], item["id"])).fetchone()


def remember_candidates(conn, candidates, items, today):
    active = set()
    for candidate in candidates:
        name = candidate["term"].strip()
        key = key_for(name)
        if not (2 <= len(key) <= 80) or key in GENERIC or not any(c.isalpha() for c in key):
            continue
        if candidate["kind"] not in KINDS:
            continue
        ids = list(dict.fromkeys(candidate["evidenceIds"]))
        if not 1 <= len(ids) <= 10 or not all(
            i in items and contains_name(items[i]["text"], key) and not conflicting_url(conn, key, items[i]) for i in ids
        ):
            continue
        urls = [items[i]["url"] for i in ids]
        # Pin all cited links so a reader can always audit the generated description.
        conn.execute("""INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, summary=excluded.summary,
                          opportunity=excluded.opportunity, cited_urls=excluded.cited_urls
                        WHERE terms.cited_urls='[]' OR (terms.kind='other' AND excluded.kind!='other')""",
                     (key, name, candidate["kind"], candidate["summary"][:500],
                      (candidate.get("opportunity") or "")[:500] or None, json.dumps(urls), today, today))
        active.add(key)
    return active


def record_mentions(conn, items, today, discovered):
    # Also count later articles about a known term, even when they are not launch announcements.
    # Keep the original first sighting permanently; readers see recently active terms.
    active = {row[0] for row in conn.execute("SELECT key FROM terms WHERE last_day >= date(?, '-30 days')", (today,))}
    for key in active | discovered:
        for item in items.values():
            if not contains_name(item["text"], key):
                continue
            inserted = conn.execute("""INSERT OR IGNORE INTO evidence
                    (term_key,url,id,title,source,published_at,revision,observed_day) VALUES (?,?,?,?,?,?,?,?)""",
                    (key, item["url"], item["id"], item["title"], item["source"], item["publishedAt"], item.get("revision"), today))
            if inserted.rowcount:
                conn.execute("UPDATE terms SET last_day=? WHERE key=?", (today, key))


def public_term(conn, term, today, covered_days):
    first = date.fromisoformat(term["first_day"])
    due = first + timedelta(days=14)
    rows = conn.execute("SELECT * FROM evidence WHERE term_key=? ORDER BY observed_day DESC, id", (term["key"],)).fetchall()
    status = "pending"
    if today >= due:
        # A delayed backfill of an older article cannot validate a launch. Review the original window,
        # even if the process restarts weeks after its due date.
        followup = next((row for row in rows if first < date.fromisoformat(row["observed_day"]) <= due
                         and first < timestamp(row["published_at"]).date() <= due), None)
        if followup:
            status = "follow_up"
        else:
            covered = conn.execute("SELECT count(*) FROM scans WHERE day>? AND day<=? AND has_input=1",
                                   (first.isoformat(), due.isoformat())).fetchone()[0]
            status = "no_follow_up" if covered == 14 else "insufficient_data"
    # Only facts backed by these returned links affect the displayed evidence counts/score.
    # Pin a follow-up citation too, even if the term stays busy long after day 14.
    pinned = set(json.loads(term["cited_urls"]))
    if status == "follow_up":
        pinned.add(followup["url"])
    rows.sort(key=lambda r: r["url"] not in pinned)
    rows = rows[:20]
    sources = len({r["source"] for r in rows})
    counts = Counter(row["observed_day"] for row in rows)
    trend = []
    for days_ago in range(13, -1, -1):
        day = (today - timedelta(days=days_ago)).isoformat()
        count = counts[day] if day >= term["first_day"] and day in covered_days else None
        trend.append({"day": day, "count": count})
    age = (today - date.fromisoformat(term["last_day"])).days
    # Evidence priority, not search interest: 45 for source diversity, 30 for reports, 25 for recency.
    score = min(45, sources * 15) + min(30, len(rows) * 6) + max(0, 25 - age * 3)
    evidence = [{"id": r["id"], "title": r["title"], "source": r["source"], "url": r["url"],
                 "publishedAt": r["published_at"], **({"revision": r["revision"]} if r["revision"] else {})} for r in rows]
    return {"key": term["key"], "term": term["name"], "kind": term["kind"], "summary": term["summary"],
            "opportunity": term["opportunity"], "firstSeen": term["first_day"], "lastSeen": term["last_day"],
            "sourceCount": sources, "evidenceCount": len(evidence), "evidence": evidence,
            "review": {"dueOn": due.isoformat(), "status": status}, "score": score, "trend": trend}


def run(conn, batch):
    if batch.get("version") != 1:
        raise ValueError("expected term radar input version 1")
    now = timestamp(batch["observedAt"])
    today = now.date().isoformat()
    invalidated = {(e["id"], e["revision"]) for e in batch.get("invalidated", [])}
    items = items_by_id((item for item in batch["items"] if (item["id"], item.get("revision")) not in invalidated), now)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    with conn:
        latest = conn.execute("SELECT MAX(day) FROM scans").fetchone()[0]
        if latest and today < latest:
            raise ValueError("refusing an out-of-order observation day")
        conn.execute("INSERT INTO scans VALUES (?,?) ON CONFLICT(day) DO UPDATE SET has_input=MAX(has_input,excluded.has_input)",
                     (today, bool(items)))
        apply_corrections(conn, items, invalidated)
        if "candidates" in batch:
            examined = set(batch.get("judgedIds", items))
            remaining = {i: item for i, item in items.items() if i not in examined}
            candidates = [*batch["candidates"], *launch_candidates(remaining)]
        else:
            candidates = launch_candidates(items)
        discovered = remember_candidates(conn, candidates, items, today)
        record_mentions(conn, items, today, discovered)
        covered_days = {row[0] for row in conn.execute(
            "SELECT day FROM scans WHERE has_input=1 AND day >= date(?, '-13 days')", (today,))}
        terms = [public_term(conn, term, now.date(), covered_days) for term in conn.execute(
            "SELECT * FROM terms WHERE cited_urls!='[]' AND last_day >= date(?, '-30 days')", (today,))]
    terms.sort(key=lambda t: (-t["score"], -date.fromisoformat(t["lastSeen"]).toordinal(), t["key"]))
    return {"version": 1, "observedAt": batch["observedAt"], "terms": terms[:50]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, type=Path, help="persistent SQLite history file")
    parser.add_argument("--list-evidence", metavar="OBSERVED_AT", type=timestamp,
                        help="list active stored publication revisions for a visibility check")
    args = parser.parse_args()
    args.state.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.state) as db:
        if args.list_evidence is not None:
            db.executescript(SCHEMA)
            result = saved_evidence(db, args.list_evidence)
        else:
            result = run(db, json.load(sys.stdin))
        json.dump(result, sys.stdout, ensure_ascii=False)
        print()
