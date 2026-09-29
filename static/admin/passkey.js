// WebAuthn ceremonies for /admin. Options come from the server as JSON with
// base64url-encoded binary fields; the browser API needs ArrayBuffers.
const passkey = (() => {
  const toBuffer = (b64url) => {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
  };
  const toB64url = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function post(url, body) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
    return data;
  }

  const describe = (cred) => ({
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
  });

  async function register(code, name) {
    const options = await post("/admin/api/register/options", { code, name });
    options.challenge = toBuffer(options.challenge);
    options.user.id = toBuffer(options.user.id);
    (options.excludeCredentials || []).forEach((c) => (c.id = toBuffer(c.id)));
    const cred = await navigator.credentials.create({ publicKey: options });
    await post("/admin/api/register/verify", {
      ...describe(cred),
      response: {
        clientDataJSON: toB64url(cred.response.clientDataJSON),
        attestationObject: toB64url(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : [],
      },
    });
  }

  async function login() {
    const options = await post("/admin/api/login/options");
    options.challenge = toBuffer(options.challenge);
    (options.allowCredentials || []).forEach((c) => (c.id = toBuffer(c.id)));
    const cred = await navigator.credentials.get({ publicKey: options });
    await post("/admin/api/login/verify", {
      ...describe(cred),
      response: {
        clientDataJSON: toB64url(cred.response.clientDataJSON),
        authenticatorData: toB64url(cred.response.authenticatorData),
        signature: toB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? toB64url(cred.response.userHandle) : null,
      },
    });
  }

  async function run(button, action, next) {
    const status = document.getElementById("status");
    if (!window.PublicKeyCredential) {
      status.textContent = "This browser does not support passkeys.";
      return;
    }
    button.disabled = true;
    status.textContent = "Waiting for your passkey…";
    try {
      await action();
      window.location.href = next;
    } catch (err) {
      status.textContent = err.name === "NotAllowedError" ? "Cancelled." : err.message;
      button.disabled = false;
    }
  }

  return { register, login, run };
})();
