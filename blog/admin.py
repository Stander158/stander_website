"""/admin: passkey sign-in and the in-browser editor. Every change is a commit."""
import os
import re
import secrets
from datetime import date

import frontmatter
from flask import Blueprint, abort, jsonify, redirect, render_template, request, session, url_for

from . import auth
from .storage import ROOT, ConflictError, StorageError, get_storage

bp = Blueprint("admin", __name__, url_prefix="/admin")

KINDS = {"posts": "post", "projects": "project", "art": "art"}
FIELDS = ["title", "date", "summary", "tags", "draft", "link", "repo", "image"]
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
IMAGE_TYPES = {
    ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".png": b"\x89PNG",
    ".gif": b"GIF8", ".webp": b"RIFF",
}
MAX_UPLOAD = 4 * 1024 * 1024


def _error(message, status=400):
    return jsonify(error=message), status


def _content_path(kind, slug):
    return f"content/{kind}/{slug}.md"


def _valid(kind, slug=None):
    if kind not in KINDS or (slug is not None and not SLUG_RE.match(slug)):
        abort(404)


@bp.before_request
def check_configured():
    if os.environ.get("VERCEL") and not (os.environ.get("SECRET_KEY") and os.environ.get("GITHUB_TOKEN")):
        return "Admin is not configured.", 503
    # Passkeys are bound to one domain; send other deployment URLs there.
    host = request.host.split(":")[0]
    if host != auth.rp_id() and auth.rp_id() != "localhost":
        return redirect(f"{auth.expected_origin()}{request.path}")


@bp.errorhandler(StorageError)
def storage_failed(exc):
    status = 409 if isinstance(exc, ConflictError) else 502
    return _error(str(exc), status)


# --- sign in ---------------------------------------------------------------

@bp.route("/login")
def login():
    if auth.is_logged_in():
        return redirect(url_for("admin.dashboard"))
    _, _, domain_keys = auth.load_passkeys(get_storage())
    return render_template("admin/login.html", has_passkey=bool(domain_keys))


@bp.route("/setup")
def setup():
    _, _, domain_keys = auth.load_passkeys(get_storage())
    if domain_keys and not auth.is_logged_in():
        return redirect(url_for("admin.login"))
    return render_template("admin/setup.html", first=not domain_keys)


@bp.post("/api/register/options")
@auth.same_origin_only
def register_options():
    data = request.get_json(silent=True) or {}
    options, err = auth.registration_options(get_storage(), data.get("code", ""), data.get("name", ""))
    if err:
        return _error(err, 403)
    return options, 200, {"Content-Type": "application/json"}


@bp.post("/api/register/verify")
@auth.same_origin_only
def register_verify():
    err = auth.finish_registration(get_storage(), request.get_json(silent=True) or {})
    return _error(err, 403) if err else jsonify(ok=True)


@bp.post("/api/login/options")
@auth.same_origin_only
def login_options():
    options, err = auth.authentication_options(get_storage())
    if err:
        return _error(err, 403)
    return options, 200, {"Content-Type": "application/json"}


@bp.post("/api/login/verify")
@auth.same_origin_only
def login_verify():
    err = auth.finish_authentication(get_storage(), request.get_json(silent=True) or {})
    return _error(err, 403) if err else jsonify(ok=True)


@bp.post("/logout")
@auth.same_origin_only
def logout():
    session.clear()
    return redirect(url_for("home"))


# --- dashboard and editor --------------------------------------------------

def _local_title(kind, slug):
    """Title from the deployed copy, if this deployment has it yet."""
    try:
        return frontmatter.load(os.path.join(ROOT, _content_path(kind, slug))).get("title")
    except (OSError, ValueError):
        return None


@bp.route("/")
@auth.login_required
def dashboard():
    files = get_storage().list_files("content/")
    sections = {}
    for kind in KINDS:
        slugs = sorted(
            (p[len(f"content/{kind}/"):-3] for p in files
             if p.startswith(f"content/{kind}/") and p.endswith(".md")),
            reverse=True,
        )
        sections[kind] = [{"slug": s, "title": _local_title(kind, s)} for s in slugs]
    return render_template("admin/dashboard.html", sections=sections)


@bp.route("/new/<kind>")
@auth.login_required
def new(kind):
    _valid(kind)
    entry = {"kind": kind, "slug": "", "sha": None, "title": "", "date": date.today().isoformat(),
             "summary": "", "tags": [], "draft": False, "link": "", "repo": "", "image": "", "body": ""}
    return render_template("admin/editor.html", entry=entry, is_new=True)


@bp.route("/edit/<kind>/<slug>")
@auth.login_required
def edit(kind, slug):
    _valid(kind, slug)
    content, sha = get_storage().get(_content_path(kind, slug))
    if content is None:
        abort(404)
    post = frontmatter.loads(content.decode("utf-8"))
    entry = {"kind": kind, "slug": slug, "sha": sha, "body": post.content}
    for field in FIELDS:
        value = post.get(field)
        entry[field] = value.isoformat() if isinstance(value, date) else value
    entry["tags"] = entry["tags"] or []
    return render_template("admin/editor.html", entry=entry, is_new=False)


def _build_markdown(data):
    meta = {"title": data["title"].strip()}
    meta["date"] = date.fromisoformat(data.get("date") or date.today().isoformat())
    if data.get("summary", "").strip():
        meta["summary"] = data["summary"].strip()
    tags = [t.strip() for t in data.get("tags", []) if t.strip()]
    if tags:
        meta["tags"] = tags
    if data.get("draft"):
        meta["draft"] = True
    for field in ("link", "repo", "image"):
        if data.get(field, "").strip():
            meta[field] = data[field].strip()
    post = frontmatter.Post(data.get("body", "").rstrip() + "\n", **meta)
    return frontmatter.dumps(post, sort_keys=False).encode("utf-8") + b"\n"


@bp.post("/api/save")
@auth.same_origin_only
@auth.login_required
def save():
    data = request.get_json(silent=True) or {}
    kind, slug = data.get("kind"), data.get("slug", "")
    if kind not in KINDS:
        return _error("Unknown section.")
    if not SLUG_RE.match(slug):
        return _error("Slug may only contain lowercase letters, numbers and single dashes.")
    if not data.get("title", "").strip():
        return _error("Title is required.")
    if not isinstance(data.get("tags", []), list):
        return _error("Tags must be a list.")
    try:
        content = _build_markdown(data)
    except ValueError:
        return _error("Date must look like 2026-09-29.")

    sha = data.get("sha") or None
    verb = "Update" if sha else "Add"
    try:
        new_sha = get_storage().put(
            _content_path(kind, slug), content, f"{verb} {KINDS[kind]}: {data['title'].strip()}", sha)
    except ConflictError:
        if sha:
            return _error("This file was changed somewhere else. Reload to get the latest version.", 409)
        return _error(f"Something with the slug '{slug}' already exists.", 409)
    return jsonify(ok=True, sha=new_sha, url=url_for(
        {"posts": "post", "projects": "project", "art": "artwork"}[kind], slug=slug))


@bp.post("/api/delete")
@auth.same_origin_only
@auth.login_required
def delete():
    data = request.get_json(silent=True) or {}
    kind, slug, sha = data.get("kind"), data.get("slug", ""), data.get("sha")
    if kind not in KINDS or not SLUG_RE.match(slug) or not sha:
        return _error("Bad request.")
    try:
        get_storage().delete(_content_path(kind, slug), f"Delete {KINDS[kind]}: {slug}", sha)
    except ConflictError:
        return _error("This file was changed somewhere else. Reload and try again.", 409)
    return jsonify(ok=True)


@bp.post("/api/upload")
@auth.same_origin_only
@auth.login_required
def upload():
    file = request.files.get("file")
    target = request.form.get("target", "uploads")
    if file is None or target not in ("uploads", "art"):
        return _error("Bad request.")
    stem, ext = os.path.splitext(file.filename or "image")
    ext = ext.lower()
    content = file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        return _error("Image is larger than 4 MB.")
    if ext not in IMAGE_TYPES or not content.startswith(IMAGE_TYPES[ext]):
        return _error("Only JPG, PNG, GIF and WebP images are allowed.")

    stem = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")[:40] or "image"
    name = f"{stem}-{secrets.token_hex(3)}{ext}"
    folder = "static/art" if target == "art" else f"static/uploads/{date.today().year}"
    get_storage().put(f"{folder}/{name}", content, f"Upload image: {name}")
    return jsonify(ok=True, filename=name, url=url_for("static", filename=f"{folder[len('static/'):]}/{name}"))
