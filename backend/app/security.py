import hashlib
import secrets

import pyotp

SESSION_COOKIE = "vay_session"
SESSION_HOURS = 12
MAX_LOGIN_FAILURES = 5
LOGIN_WINDOW_MINUTES = 15


def name_key(value: str) -> str:
    return " ".join(value.split()).casefold()


_PBKDF2_ROUNDS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$", 1)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt_hex), _PBKDF2_ROUNDS
    )
    return secrets.compare_digest(digest.hex(), digest_hex)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def recovery_codes(count: int = 8) -> list[str]:
    return [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}".upper() for _ in range(count)]


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Vay Tutor")


def verify_totp(secret: str, code: str) -> bool:
    return bool(code) and pyotp.TOTP(secret).verify(code, valid_window=1)
