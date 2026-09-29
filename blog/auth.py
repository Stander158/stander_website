"""Single-owner passkey (WebAuthn) authentication.

Public keys live in data/passkeys.json in the repository. They are read through
storage on every login, so a freshly registered passkey works before the next
deploy. The setup code only works while no passkey is registered for this domain.
"""
import functools
import hmac
import json
import os
import time
from datetime import datetime, timezone

from flask import jsonify, redirect, request, session, url_for
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

PASSKEYS_PATH = "data/passkeys.json"
CHALLENGE_TTL = 300
USER_ID = b"stander-site-owner"


def rp_id():
    """The domain passkeys are bound to."""
    if os.environ.get("WEBAUTHN_RP_ID"):
        return os.environ["WEBAUTHN_RP_ID"]
    env = os.environ.get("VERCEL_ENV")
    if env == "production" and os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
        return os.environ["VERCEL_PROJECT_PRODUCTION_URL"]
    if env == "preview" and os.environ.get("VERCEL_BRANCH_URL"):
        return os.environ["VERCEL_BRANCH_URL"]
    return "localhost"


def expected_origin():
    if os.environ.get("WEBAUTHN_ORIGIN"):
        return os.environ["WEBAUTHN_ORIGIN"]
    rp = rp_id()
    return "http://localhost:5000" if rp == "localhost" else f"https://{rp}"


# --- passkey store ---------------------------------------------------------

def load_passkeys(storage):
    """Return (all passkeys, sha, passkeys for this domain)."""
    content, sha = storage.get(PASSKEYS_PATH)
    keys = json.loads(content) if content else []
    return keys, sha, [k for k in keys if k["rp_id"] == rp_id()]


def _descriptors(keys):
    return [PublicKeyCredentialDescriptor(id=base64url_to_bytes(k["id"])) for k in keys]


# --- sessions --------------------------------------------------------------

def is_logged_in():
    return session.get("owner") is True


def _start_session(credential_id):
    session.clear()
    session.permanent = True
    session["owner"] = True
    session["credential"] = credential_id


def _store_challenge(kind, challenge):
    session[f"{kind}_challenge"] = bytes_to_base64url(challenge)
    session[f"{kind}_challenge_at"] = time.time()


def _pop_challenge(kind):
    challenge = session.pop(f"{kind}_challenge", None)
    issued = session.pop(f"{kind}_challenge_at", 0)
    if not challenge or time.time() - issued > CHALLENGE_TTL:
        return None
    return base64url_to_bytes(challenge)


def login_required(view):
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if not is_logged_in():
            if request.path.startswith("/admin/api/"):
                return jsonify(error="Not signed in."), 401
            return redirect(url_for("admin.login"))
        return view(*args, **kwargs)
    return wrapper


def same_origin_only(view):
    """Reject state-changing requests that did not come from this site's own pages."""
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if request.headers.get("Origin") != expected_origin():
            return jsonify(error="Bad origin."), 403
        return view(*args, **kwargs)
    return wrapper


# --- registration ----------------------------------------------------------

def registration_options(storage, setup_code, name):
    _, _, domain_keys = load_passkeys(storage)
    if domain_keys:
        # Adding another device requires being signed in already.
        if not is_logged_in():
            return None, "Sign in first to add another passkey."
    else:
        configured = os.environ.get("SETUP_CODE", "")
        if not configured:
            return None, "SETUP_CODE is not configured."
        if not hmac.compare_digest(setup_code.encode(), configured.encode()):
            return None, "Wrong setup code."

    options = generate_registration_options(
        rp_id=rp_id(),
        rp_name="Stander admin",
        user_id=USER_ID,
        user_name="owner",
        user_display_name="Site owner",
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=_descriptors(domain_keys),
    )
    _store_challenge("register", options.challenge)
    session["register_name"] = (name or "Passkey")[:60]
    return options_to_json(options), None


def finish_registration(storage, credential):
    challenge = _pop_challenge("register")
    name = session.pop("register_name", "Passkey")
    if challenge is None:
        return "Registration expired. Try again."

    keys, sha, domain_keys = load_passkeys(storage)
    # Re-check: the setup code only covers the very first passkey.
    if domain_keys and not is_logged_in():
        return "Sign in first to add another passkey."

    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id(),
            expected_origin=expected_origin(),
            require_user_verification=True,
        )
    except Exception as exc:
        return f"Passkey verification failed: {exc}"

    credential_id = bytes_to_base64url(verified.credential_id)
    keys.append({
        "id": credential_id,
        "public_key": bytes_to_base64url(verified.credential_public_key),
        "rp_id": rp_id(),
        "name": name,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    content = (json.dumps(keys, indent=2) + "\n").encode()
    storage.put(PASSKEYS_PATH, content, f"Register passkey: {name}", sha)
    _start_session(credential_id)
    return None


# --- login -----------------------------------------------------------------

def authentication_options(storage):
    _, _, domain_keys = load_passkeys(storage)
    if not domain_keys:
        return None, "No passkey registered yet."
    options = generate_authentication_options(
        rp_id=rp_id(),
        allow_credentials=_descriptors(domain_keys),
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    _store_challenge("login", options.challenge)
    return options_to_json(options), None


def finish_authentication(storage, credential):
    challenge = _pop_challenge("login")
    if challenge is None:
        return "Sign-in expired. Try again."

    _, _, domain_keys = load_passkeys(storage)
    credential_id = credential.get("id") if isinstance(credential, dict) else None
    key = next((k for k in domain_keys if k["id"] == credential_id), None)
    if key is None:
        return "Unknown passkey."

    try:
        verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id(),
            expected_origin=expected_origin(),
            credential_public_key=base64url_to_bytes(key["public_key"]),
            # Synced passkeys report a sign count of 0, so the count is not tracked.
            credential_current_sign_count=0,
            require_user_verification=True,
        )
    except Exception as exc:
        return f"Passkey verification failed: {exc}"

    _start_session(key["id"])
    return None
