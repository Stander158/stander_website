"""Read and write repository files.

On Vercel the filesystem is read-only, so every change is a commit made through
the GitHub contents API. Locally (no GITHUB_TOKEN) files are written to disk.
"""
import base64
import hashlib
import os

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class StorageError(Exception):
    pass


class ConflictError(StorageError):
    """The file changed (or already exists) since it was read."""


class GitHubStorage:
    API = "https://api.github.com"

    def __init__(self, token, repo, branch):
        self.repo = repo
        self.branch = branch
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })

    def _request(self, method, path, **kwargs):
        resp = self.session.request(method, f"{self.API}/repos/{self.repo}/{path}", timeout=20, **kwargs)
        if resp.status_code == 409 or (resp.status_code == 422 and "sha" in resp.text):
            raise ConflictError(resp.json().get("message", "conflict"))
        return resp

    def list_files(self, prefix):
        resp = self._request("GET", f"git/trees/{self.branch}", params={"recursive": "1"})
        if not resp.ok:
            raise StorageError(f"GitHub list failed: {resp.status_code}")
        return sorted(
            item["path"] for item in resp.json()["tree"]
            if item["type"] == "blob" and item["path"].startswith(prefix)
        )

    def get(self, path):
        """Return (bytes, sha), or (None, None) if the file does not exist."""
        resp = self._request("GET", f"contents/{path}", params={"ref": self.branch})
        if resp.status_code == 404:
            return None, None
        if not resp.ok:
            raise StorageError(f"GitHub read failed: {resp.status_code}")
        data = resp.json()
        return base64.b64decode(data["content"]), data["sha"]

    def put(self, path, content, message, sha=None):
        """Create (sha=None) or update a file. Returns the new sha."""
        body = {
            "message": message,
            "content": base64.b64encode(content).decode(),
            "branch": self.branch,
        }
        if sha:
            body["sha"] = sha
        resp = self._request("PUT", f"contents/{path}", json=body)
        if not resp.ok:
            raise StorageError(f"GitHub write failed: {resp.status_code} {resp.text[:200]}")
        return resp.json()["content"]["sha"]

    def delete(self, path, message, sha):
        resp = self._request("DELETE", f"contents/{path}", json={
            "message": message, "sha": sha, "branch": self.branch,
        })
        if not resp.ok:
            raise StorageError(f"GitHub delete failed: {resp.status_code}")


def _blob_sha(content):
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


class LocalStorage:
    """Same interface as GitHubStorage, backed by the local checkout. For development."""

    def __init__(self, root):
        self.root = root

    def _abs(self, path):
        return os.path.join(self.root, path)

    def list_files(self, prefix):
        found = []
        for dirpath, _, filenames in os.walk(self.root):
            for name in filenames:
                rel = os.path.relpath(os.path.join(dirpath, name), self.root).replace(os.sep, "/")
                if rel.startswith(prefix):
                    found.append(rel)
        return sorted(found)

    def get(self, path):
        try:
            with open(self._abs(path), "rb") as f:
                content = f.read()
        except FileNotFoundError:
            return None, None
        return content, _blob_sha(content)

    def put(self, path, content, message, sha=None):
        _, current = self.get(path)
        if current != sha:
            raise ConflictError("file changed or already exists")
        os.makedirs(os.path.dirname(self._abs(path)), exist_ok=True)
        with open(self._abs(path), "wb") as f:
            f.write(content)
        return _blob_sha(content)

    def delete(self, path, message, sha):
        _, current = self.get(path)
        if current is None or current != sha:
            raise ConflictError("file changed or was already deleted")
        os.remove(self._abs(path))


def branch():
    # VERCEL_GIT_COMMIT_REF is the branch being deployed, so the qa deployment
    # commits to qa and production commits to main.
    return os.environ.get("GITHUB_BRANCH") or os.environ.get("VERCEL_GIT_COMMIT_REF") or "main"


def get_storage():
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        repo = os.environ.get("GITHUB_REPO", "Stander158/stander_website")
        return GitHubStorage(token, repo, branch())
    if os.environ.get("VERCEL"):
        raise StorageError("GITHUB_TOKEN is not set")
    return LocalStorage(os.environ.get("STORAGE_ROOT", ROOT))
