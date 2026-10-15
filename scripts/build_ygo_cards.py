"""Build static/ygo/cards.json, the card database the deck builder loads in the browser.

Sources (one request each):
  - YGOPRODeck API: every card, plus TCG/OCG banlists and which formats a card is legal in.
  - Master Duel Meta API: the Master Duel banlist (YGOPRODeck doesn't carry it).

Rerun after a new set or banlist, then commit the JSON:
    python scripts/build_ygo_cards.py
"""
import json
import os
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "static", "ygo", "cards.json")

YGOPRODECK = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes"
MDM = "https://www.masterduelmeta.com/api/v1/cards?banStatus[$exists]=true&limit=3000&fields=name,konamiID,banStatus"

# Column order of each row in "cards"; deck.js reads rows by these positions.
FIELDS = ["id", "name", "frame", "race", "typeline", "attribute", "level", "atk", "def",
          "scale", "links", "archetype", "desc", "ban", "formats", "views", "date"]

FORMAT_BITS = {"TCG": 1, "OCG": 2, "Master Duel": 4}
BAN_CODES = {"Banned": "F", "Forbidden": "F", "Limited": "L", "Semi-Limited": "S",
             "Limited 1": "L", "Limited 2": "S"}
LINK_CODES = {"Top": "T", "Bottom": "B", "Left": "L", "Right": "R", "Top-Left": "TL",
              "Top-Right": "TR", "Bottom-Left": "BL", "Bottom-Right": "BR"}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "stander-website deck builder"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.load(res)


def as_date(value):
    return int(value.replace("-", "")) if value else 0


def build():
    cards = fetch_json(YGOPRODECK)["data"]
    md_list = fetch_json(MDM)
    # MDM's "konamiID" is the card's passcode, i.e. YGOPRODeck's id.
    md_by_id = {int(c["konamiID"]): c["banStatus"] for c in md_list if c.get("banStatus") and c.get("konamiID")}
    md_by_name = {c["name"].lower(): c["banStatus"] for c in md_list if c.get("banStatus")}

    rows, alias, md_found = [], {}, 0
    for c in cards:
        if c["frameType"] in ("skill", "token") or c["name"] == "???":
            continue
        misc = (c.get("misc_info") or [{}])[0]
        formats = sum(bit for name, bit in FORMAT_BITS.items() if name in misc.get("formats", []))
        if not formats:
            continue
        ban_info = c.get("banlist_info") or {}
        md_status = md_by_id.get(c["id"]) or md_by_name.get(c["name"].lower())
        md_found += bool(md_status)
        ban = "".join(BAN_CODES.get(s, "-") for s in (ban_info.get("ban_tcg"), ban_info.get("ban_ocg"), md_status))
        is_monster = c["frameType"] not in ("spell", "trap")
        dates = [d for d in (as_date(misc.get("tcg_date")), as_date(misc.get("ocg_date"))) if d]
        rows.append([
            c["id"],
            c["name"],
            c["frameType"],
            c.get("race", ""),
            "/".join(c.get("typeline") or []) if is_monster else "",
            c.get("attribute", ""),
            c.get("linkval") if c["frameType"] == "link" else c.get("level"),
            -1 if is_monster and misc.get("question_atk") else c.get("atk"),
            -1 if is_monster and misc.get("question_def") else c.get("def"),
            c.get("scale"),
            ",".join(LINK_CODES.get(m, m) for m in c.get("linkmarkers") or []),
            c.get("archetype", ""),
            c["desc"],
            ban,
            formats,
            misc.get("views", 0),
            min(dates) if dates else 0,
        ])
        for img in c.get("card_images") or []:
            if img["id"] != c["id"]:
                alias[img["id"]] = c["id"]

    rows.sort(key=lambda r: r[1].lower())
    out = {
        "generated": date.today().isoformat(),
        "sources": ["db.ygoprodeck.com", "masterduelmeta.com (Master Duel banlist)"],
        "fields": FIELDS,
        "alias": alias,  # alternate-art passcode -> main passcode, for importing .ydk files
        "cards": rows,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} cards, {len(alias)} alternate arts, "
          f"Master Duel banlist {md_found}/{len(md_by_id)} matched -> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT) / 1048576:.1f} MB)")


if __name__ == "__main__":
    build()
