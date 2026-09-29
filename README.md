# stander_website

Personal blog built with Flask, deployed on Vercel at https://standerwebsite.vercel.app.
Every push to `main` deploys to production.

## Writing content

Add a Markdown file to `content/posts/` (writing) or `content/projects/` (projects).
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
