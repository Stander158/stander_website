"""/ygo: Yu-Gi-Oh! deck builder. The card database is a static JSON file (scripts/build_ygo_cards.py);
card images are fetched from YGOPRODeck once and then served from Vercel's CDN cache."""
import os
import zlib

import requests
from flask import Blueprint, Response, abort, render_template

from .storage import ROOT

bp = Blueprint("ygo", __name__, url_prefix="/ygo")

CARDS_FILE = os.path.join(ROOT, "static", "ygo", "cards.json")
IMAGE_SOURCES = {
    "small": "https://images.ygoprodeck.com/images/cards_small/{}.jpg",
    "big": "https://images.ygoprodeck.com/images/cards/{}.jpg",
}
# YGOPRODeck asks sites not to hotlink their images. Cache for a year on the CDN
# (s-maxage) and in the browser so each image is downloaded from them only once.
IMAGE_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable"


def _data_version():
    """Changes whenever cards.json is rebuilt, so browsers fetch the new file."""
    try:
        with open(CARDS_FILE, "rb") as f:
            return format(zlib.crc32(f.read()), "x")
    except OSError:
        return "0"


DATA_VERSION = _data_version()


@bp.route("/deck")
def deck():
    return render_template("ygo/deck.html", data_version=DATA_VERSION)


@bp.route("/img/<size>/<int:card_id>.jpg")
def card_image(size, card_id):
    if size not in IMAGE_SOURCES or not 0 < card_id < 10**10:
        abort(404)
    try:
        res = requests.get(IMAGE_SOURCES[size].format(card_id), timeout=10)
    except requests.RequestException:
        abort(502)
    if res.status_code != 200 or not res.content.startswith(b"\xff\xd8"):
        abort(404)
    return Response(res.content, mimetype="image/jpeg", headers={"Cache-Control": IMAGE_CACHE})
