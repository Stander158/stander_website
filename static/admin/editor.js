(() => {
  const entry = JSON.parse(document.getElementById("entry-data").textContent);
  const form = document.getElementById("entry-form");
  const status = document.getElementById("status");
  const saveButton = document.getElementById("save");
  const draftKey = `admin-draft:${entry.kind}:${entry.slug || "new"}`;
  let isNew = !entry.sha;
  let dirty = false;
  let slugTouched = !isNew;

  const field = (name) => form.elements[name];
  const setStatus = (text, kind) => {
    status.textContent = text;
    status.dataset.kind = kind || "";
  };

  // --- image handling ------------------------------------------------------

  // Shrink large photos in the browser: Vercel caps request bodies at ~4.5 MB.
  async function shrink(file) {
    if (file.type === "image/gif" || file.size < 1024 * 1024) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
    const base = (file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${type === "image/jpeg" ? "jpg" : "webp"}`, { type });
  }

  async function upload(file, target) {
    const body = new FormData();
    body.append("file", await shrink(file), file.name || "image.png");
    body.append("target", target);
    const resp = await fetch("/admin/api/upload", { method: "POST", body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);
    return data;
  }

  // --- editor --------------------------------------------------------------

  const editor = new toastui.Editor({
    el: document.getElementById("editor"),
    height: "65vh",
    initialEditType: "wysiwyg",
    previewStyle: "vertical",
    theme: "dark",
    usageStatistics: false,
    initialValue: entry.body || "",
    hooks: {
      addImageBlobHook: async (blob, callback) => {
        setStatus("Uploading image…");
        try {
          const { url } = await upload(blob, "uploads");
          callback(url, blob.name ? blob.name.replace(/\.[^.]+$/, "") : "");
          setStatus("Image uploaded. It will show on the site after the next deploy.");
        } catch (err) {
          setStatus(err.message, "error");
        }
      },
    },
  });

  // --- form state ----------------------------------------------------------

  function load(values) {
    for (const name of ["title", "slug", "date", "summary", "link", "repo", "image"]) {
      if (field(name)) field(name).value = values[name] || "";
    }
    field("tags").value = (values.tags || []).join(", ");
    field("draft").checked = !!values.draft;
    if (values.body !== undefined) editor.setMarkdown(values.body || "", false);
    showArtPreview();
  }

  function collect() {
    const value = (name) => (field(name) ? field(name).value : "");
    return {
      kind: entry.kind,
      sha: entry.sha,
      title: value("title"),
      slug: value("slug"),
      date: value("date"),
      summary: value("summary"),
      tags: value("tags").split(",").map((t) => t.trim()).filter(Boolean),
      draft: field("draft").checked,
      link: value("link"),
      repo: value("repo"),
      image: value("image"),
      body: editor.getMarkdown(),
    };
  }

  const slugify = (text) =>
    text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

  // Unsaved work is kept in this browser until it is saved.
  const storage = {
    get() { try { return JSON.parse(localStorage.getItem(draftKey)); } catch { return null; } },
    set(v) { try { localStorage.setItem(draftKey, JSON.stringify(v)); } catch {} },
    clear() { try { localStorage.removeItem(draftKey); } catch {} },
  };

  let timer;
  function changed() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => storage.set(collect()), 500);
  }

  load(entry);
  const saved = storage.get();
  if (saved && JSON.stringify({ ...saved, sha: null }) !== JSON.stringify({ ...collect(), sha: null })) {
    if (confirm("Restore unsaved changes from your last visit?")) {
      load(saved);
      dirty = true;
    } else {
      storage.clear();
    }
  }

  form.addEventListener("input", (event) => {
    if (event.target.name === "slug") slugTouched = true;
    if (event.target.name === "title" && !slugTouched) field("slug").value = slugify(field("title").value);
    if (event.target.name === "image") showArtPreview();
    changed();
  });
  editor.on("change", changed);
  window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });

  // --- art image -----------------------------------------------------------

  function showArtPreview(src) {
    const preview = document.getElementById("art-preview");
    if (!preview) return;
    const value = field("image").value;
    const url = src || (/^https?:\/\//.test(value) ? value : value ? `/static/art/${value}` : "");
    preview.hidden = !url;
    if (url) preview.src = url;
  }

  const artButton = document.getElementById("art-upload");
  if (artButton) {
    const input = document.getElementById("art-file");
    artButton.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      setStatus("Uploading image…");
      try {
        const { filename } = await upload(file, "art");
        field("image").value = filename;
        showArtPreview(URL.createObjectURL(file));
        changed();
        setStatus("Image uploaded. Save to publish.");
      } catch (err) {
        setStatus(err.message, "error");
      }
      input.value = "";
    });
  }

  // --- save / delete -------------------------------------------------------

  async function post(url, body) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
    return data;
  }

  async function save() {
    if (!form.reportValidity()) return;
    saveButton.disabled = true;
    setStatus("Saving…");
    try {
      const data = collect();
      const result = await post("/admin/api/save", data);
      entry.sha = result.sha;
      dirty = false;
      storage.clear();
      if (isNew) {
        isNew = false;
        field("slug").readOnly = true;
        history.replaceState(null, "", `/admin/edit/${entry.kind}/${data.slug}`);
      }
      setStatus(data.draft
        ? "Saved as draft."
        : `Saved. Live at ${result.url} in about a minute.`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    }
    saveButton.disabled = false;
  }

  saveButton.addEventListener("click", save);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      save();
    }
  });

  const deleteButton = document.getElementById("delete");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete "${field("title").value}"? This cannot be undone from here.`)) return;
      try {
        await post("/admin/api/delete", { kind: entry.kind, slug: field("slug").value, sha: entry.sha });
        dirty = false;
        storage.clear();
        window.location.href = "/admin/";
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  }
})();
