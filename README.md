# stander_website

Personal blog built with Flask, deployed on Vercel at https://standerwebsite.vercel.app.
Every push to `main` deploys to production.

## Writing content

Add a Markdown file to `content/posts/`, `content/projects/`, or `content/art/`.
The filename becomes the URL slug.

```markdown
---
title: My post
date: 2026-09-29
summary: One-line description shown in lists.
tags: [python, notes]
draft: true              # optional: hide from the site
link: https://...        # projects only, optional: live demo
repo: https://github.com/...  # projects only, optional: source
---

Body in Markdown.
```

Art entries also take `image: my-piece.jpg`. Put the image file in `static/art/`
(or use a full `https://` URL).

## Layout

- `api/index.py` — Flask app (all routes; Vercel rewrites every request here)
- `templates/` — Jinja templates
- `static/style.css` — styles
- `content/` — posts and projects

## Running locally

```bash
pip install -r requirements.txt
python api/index.py
```

Open http://127.0.0.1:5000.

## Deck builder

`/ygo/deck` is a Yu-Gi-Oh! deck builder (TCG, OCG, Master Duel) that runs in the
browser: `blog/ygo.py`, `templates/ygo/deck.html`, `static/ygo/`. The card database is
`static/ygo/cards.json`; rebuild it after a new set or banlist and commit the result:

```bash
python scripts/build_ygo_cards.py
```

Card images are proxied from YGOPRODeck through `/ygo/img/` and cached by Vercel's CDN
for a year, so each image is fetched from them only once.

## Admin editor

`/admin` is an in-browser editor, locked to the owner's passkey. Saving,
deleting, or uploading an image commits to the repository through the GitHub
API; Vercel then redeploys (about a minute).

Environment variables (Vercel → Settings → Environment Variables):

| Name | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Fine-grained token with Contents read/write on this repo only |
| `SECRET_KEY` | Random string that signs the login cookie |
| `SETUP_CODE` | Allows registering the first passkey; ignored once one exists |

Commits go to the branch being deployed (`VERCEL_GIT_COMMIT_REF`), so the `qa`
preview edits `qa` and production edits `main`. Passkeys are bound to one domain:
production uses the production URL and previews use the branch URL. Registered
public keys live in `data/passkeys.json`.

Admin code lives in `blog/` (not `api/`, where every file becomes a Vercel
function). The editor is Toast UI Editor 3.2.2 (MIT), bundled into
`static/vendor/toastui/`.
