import os
from urllib.parse import parse_qs, unquote
from datetime import date, datetime
from email.utils import format_datetime

import frontmatter
import markdown
from flask import Flask, Response, abort, render_template, request, url_for

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT_DIR = os.path.join(ROOT, "content")

SITE = {
    "title": "Stander",
    "description": "Notes, writing, and projects.",
    "author": "Stander",
    "url": "https://standerwebsite.vercel.app",
}

app = Flask(
    __name__,
    template_folder=os.path.join(ROOT, "templates"),
    static_folder=os.path.join(ROOT, "static"),
)

class OriginalPathMiddleware:
    """Vercel rewrites every request to /api/index; restore the path the visitor asked for."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        if path.startswith("/api/index"):
            query = parse_qs(environ.get("QUERY_STRING", ""))
            matches = parse_qs(environ.get("HTTP_X_NOW_ROUTE_MATCHES", ""))
            original = (query.get("__path") or matches.get("1") or [""])[0]
            environ["PATH_INFO"] = "/" + unquote(original).lstrip("/")
        return self.wsgi_app(environ, start_response)


app.wsgi_app = OriginalPathMiddleware(app.wsgi_app)

MD_EXTENSIONS = ["fenced_code", "codehilite", "tables", "toc", "footnotes", "sane_lists"]
MD_CONFIG = {"codehilite": {"guess_lang": False, "css_class": "highlight"}}


def _to_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    return None


def load_entries(kind):
    """Load all markdown entries from content/<kind>/, newest first, drafts hidden."""
    folder = os.path.join(CONTENT_DIR, kind)
    entries = []
    if not os.path.isdir(folder):
        return entries
    for name in os.listdir(folder):
        if not name.endswith(".md"):
            continue
        post = frontmatter.load(os.path.join(folder, name))
        if post.get("draft"):
            continue
        entries.append({
            "slug": name[:-3],
            "title": post.get("title", name[:-3]),
            "date": _to_date(post.get("date")),
            "summary": post.get("summary", ""),
            "tags": post.get("tags") or [],
            "link": post.get("link"),
            "repo": post.get("repo"),
            "image": post.get("image"),
            "body": post.content,
        })
    entries.sort(key=lambda e: e["date"] or date.min, reverse=True)
    return entries


def get_entry(kind, slug):
    for entry in load_entries(kind):
        if entry["slug"] == slug:
            return entry
    abort(404)


def render_md(text):
    return markdown.markdown(text, extensions=MD_EXTENSIONS, extension_configs=MD_CONFIG)


@app.context_processor
def inject_site():
    return {"site": SITE, "year": date.today().year, "detail_endpoint": DETAIL_ENDPOINTS}


# Maps a content kind to the endpoint that renders a single entry of it.
DETAIL_ENDPOINTS = {"posts": "post", "projects": "project", "art": "artwork"}


@app.template_filter("image_url")
def image_url(image):
    """Art images live in static/art/ unless given as a full URL."""
    if not image or image.startswith(("http://", "https://")):
        return image
    return url_for("static", filename=f"art/{image}")


@app.route("/")
def home():
    return render_template(
        "index.html",
        posts=load_entries("posts")[:5],
        projects=load_entries("projects")[:3],
        art=load_entries("art")[:3],
    )


@app.route("/posts")
def posts():
    return render_template("list.html", heading="Posts", kind="posts", entries=load_entries("posts"))


@app.route("/posts/<slug>")
def post(slug):
    entry = get_entry("posts", slug)
    return render_template("entry.html", entry=entry, kind="posts", html=render_md(entry["body"]))


@app.route("/projects")
def projects():
    return render_template("list.html", heading="Projects", kind="projects", entries=load_entries("projects"))


@app.route("/projects/<slug>")
def project(slug):
    entry = get_entry("projects", slug)
    return render_template("entry.html", entry=entry, kind="projects", html=render_md(entry["body"]))


@app.route("/art")
def art():
    return render_template("art.html", entries=load_entries("art"))


@app.route("/art/<slug>")
def artwork(slug):
    entry = get_entry("art", slug)
    return render_template("entry.html", entry=entry, kind="art", html=render_md(entry["body"]))


@app.route("/tags/<tag>")
def tag(tag):
    matches = [e for e in load_entries("posts") if tag in e["tags"]]
    return render_template("list.html", heading=f"#{tag}", kind="posts", entries=matches)


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/feed.xml")
def feed():
    xml = render_template(
        "feed.xml",
        posts=load_entries("posts")[:20],
        rfc822=lambda d: format_datetime(datetime(d.year, d.month, d.day)) if d else "",
    )
    return Response(xml, mimetype="application/rss+xml")


@app.errorhandler(404)
def not_found(e):
    return render_template("404.html"), 404


if __name__ == "__main__":
    app.run(debug=True)
