import sqlite3
import unittest
from datetime import date, timedelta

from run import run


START = date(2026, 10, 1)


def stamp(day):
    return (START + timedelta(days=day)).isoformat() + "T12:00:00Z"


def item(id_, title, day=0, source="lab", **extra):
    return {"id": id_, "title": title, "source": source, "url": "https://news.example/" + id_,
            "publishedAt": stamp(day), **extra}


def candidate(term, *ids):
    return {"term": term, "kind": "tool", "summary": "发布了新工具。", "opportunity": "可验证导出需求。",
            "evidenceIds": list(ids)}


class RadarTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)

    def scan(self, day, items, **extra):
        return run(self.db, {"version": 1, "observedAt": stamp(day), "items": items, **extra})["terms"]

    def test_rules_allow_zh_and_en_launches_and_dedupe_across_scans(self):
        release = item("a", "Introducing SkyForge: run locally", revision="hash1")
        source = item("b", "上线「小织机」：中文示例")
        copied = item("mirror", "Introducing SkyForge: run locally", source="mirror", url=release["url"])
        first = self.scan(0, [release, copied, source])
        self.assertEqual(first, self.scan(0, [release, copied, source]))
        sky = next(t for t in first if t["term"] == "SkyForge")
        self.assertEqual([e["id"] for e in sky["evidence"]], ["a"])
        self.assertEqual(sky["evidence"][0]["revision"], "hash1")
        self.assertEqual((sky["sourceCount"], sky["evidenceCount"]), (1, 1))
        self.assertIn("小织机", [t["term"] for t in first])

    def test_model_candidates_require_named_citations_and_skip_empty_judgment(self):
        items = [item("1", "Introducing SkyForge")]
        rows = self.scan(0, items, candidates=[
            candidate("fake", "1"), candidate("sky", "1"), candidate("SkyForge", "unknown"),
            candidate("SkyForge", "1", "unknown"), candidate("AI", "1"),
        ])
        self.assertEqual(rows, [])
        ranked, = self.scan(0, items, candidates=[candidate("SkyForge", "1")])
        self.assertEqual((ranked["kind"], ranked["opportunity"]), ("tool", "可验证导出需求。"))

    def test_mirrored_url_cannot_attach_a_judgment_to_the_wrong_publication(self):
        a = item("a", "Introducing SkyForge", revision="a1")
        b = {**a, "id": "b", "revision": "b1", "summary": "Price is 100 dollars"}
        price = {**candidate("SkyForge", "b"), "summary": b["summary"]}
        self.assertEqual(self.scan(0, [a, b], candidates=[price]), [])
        self.scan(1, [a])
        row, = self.scan(2, [b], candidates=[price])
        self.assertEqual((row["summary"], row["evidence"][0]["id"]), (a["title"], "a"))
        row, = self.scan(3, [b], candidates=[price], invalidated=[{"id": "a", "revision": "a1"}])
        self.assertEqual((row["summary"], row["evidence"][0]["id"]), (b["summary"], "b"))
        # An invalidation checked before a concurrent correction can only remove the old revision.
        corrected = {**b, "revision": "b2", "summary": "Price is 90 dollars"}
        updated = {**price, "summary": corrected["summary"]}
        self.scan(4, [corrected], candidates=[updated])
        kept, = self.scan(4, [], invalidated=[{"id": "b", "revision": "b1"}])
        self.assertEqual(kept["summary"], corrected["summary"])

    def test_later_mentions_and_followup_persist_across_empty_runs(self):
        self.scan(0, [item("first", "Introducing SkyForge")])
        article = item("second", "SkyForge now exports data", 2, "media")
        newer, = self.scan(2, [article])
        self.assertEqual((newer["sourceCount"], newer["evidenceCount"]), (2, 2))
        self.assertEqual(newer["lastSeen"], "2026-10-03")
        reviewed, = self.scan(18, [article])
        self.assertEqual(reviewed["review"], {"dueOn": "2026-10-15", "status": "follow_up"})
        self.assertEqual(reviewed["lastSeen"], newer["lastSeen"])

    def test_trend_counts_observations_with_gaps_and_same_article_replays(self):
        self.scan(0, [item("first", "Introducing SkyForge")])
        second = item("second", "SkyForge advanced", 2)
        self.scan(2, [second, second])
        row, = self.scan(3, [second])
        self.assertEqual(len(row["trend"]), 14)
        self.assertEqual([p["count"] for p in row["trend"][-4:]], [1, None, 1, 0])
        self.assertTrue(all(p["count"] is None for p in row["trend"][:-4]))

    def test_revision_with_same_id_requires_fresh_grounded_judgment(self):
        original = item("a", "Introducing SkyForge model", revision="old")
        self.scan(0, [original], candidates=[candidate("SkyForge", "a")])
        correction = {**original, "title": "SkyForge is an editor", "revision": "new"}
        self.assertEqual(self.scan(1, [correction], candidates=[]), [])
        fresh = {**candidate("SkyForge", "a"), "kind": "product", "summary": "公开资料称它为编辑器。", "opportunity": None}
        row, = self.scan(2, [correction], candidates=[fresh])
        self.assertEqual((row["kind"], row["summary"], row["opportunity"]), ("product", fresh["summary"], None))
        self.assertEqual((row["evidence"][0]["revision"], row["firstSeen"]), ("new", "2026-10-01"))
        self.assertEqual(self.scan(3, [{**correction, "title": "Unrelated correction", "revision": "v3"}]), [])

    def test_model_budget_allows_rules_only_for_unexamined_items(self):
        items = [item("no", "Introducing SkyForge"), item("other", "Introducing ClearWeave")]
        new, = self.scan(0, items, candidates=[], judgedIds=["no"])
        self.assertEqual(new["term"], "ClearWeave")
        self.assertEqual(new["kind"], "other")

    def test_review_gaps_and_delayed_backfill(self):
        self.scan(0, [item("first", "Introducing SkyForge")])
        self.scan(8, [item("old", "SkyForge was announced", 0)])
        reviewed, = self.scan(15, [item("late", "SkyForge after the review window", 15)])
        self.assertEqual(reviewed["review"]["status"], "insufficient_data")

    def test_fourteen_covered_days_without_new_evidence(self):
        self.scan(0, [item("first", "Introducing SkyForge")])
        for day in range(1, 15):
            self.scan(day, [item(str(day), "Unrelated financial news", day)])
        reviewed, = self.scan(15, [])
        self.assertEqual(reviewed["review"]["status"], "no_follow_up")

    def test_bounded_evidence_pins_cited_summary_and_followup(self):
        self.scan(0, [item("origin", "SkyForge press release")], candidates=[candidate("SkyForge", "origin")])
        self.scan(2, [item("review", "試用 SkyForge 完成", 2)])
        later = [item(str(i), "SkyForge update", 16, "news") for i in range(32)]
        row, = self.scan(16, later)
        self.assertEqual(row["evidenceCount"], 20)
        self.assertTrue({"origin", "review"} <= {e["id"] for e in row["evidence"]})
        self.assertEqual(row["sourceCount"], 2)

    def test_rediscovered_after_inactivity_keeps_original_first_seen(self):
        self.scan(0, [item("a", "Introducing SkyForge")])
        self.assertEqual(self.scan(40, []), [])
        row, = self.scan(41, [item("b", "Announcing SkyForge", 41)])
        self.assertEqual((row["firstSeen"], row["lastSeen"]), ("2026-10-01", "2026-11-11"))

    def test_transaction_rolls_back_and_rejects_old_days(self):
        self.scan(1, [])
        with self.assertRaisesRegex(ValueError, "out-of-order"):
            self.scan(0, [])
        with self.assertRaises(KeyError):
            self.scan(2, [item("a", "SkyForge")], candidates=[candidate("SkyForge", "a"), {}])
        self.assertEqual(self.scan(2, []), [])

    def test_future_dated_sources_are_not_observations(self):
        self.assertEqual(self.scan(0, [item("a", "Introducing SkyForge", 1)]), [])


if __name__ == "__main__":
    unittest.main()
