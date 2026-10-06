"""Allowed extension and local origins, plus explicitly configured hosted surfaces."""

import os
from urllib.parse import urlsplit

DEFAULT_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",  # vite dev (chrome/firefox)
    "http://localhost:8000",  # local api / swagger
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
)

# Browser extension origins cannot be configured as one fixed HTTP origin.
# Firefox assigns a UUID-shaped moz-extension host at installation time, while
# Chrome uses its extension ID. API authentication remains responsible for
# authorizing the caller; CORS only permits the browser to send the request.
EXTENSION_ORIGIN_REGEX = r"^(?:moz-extension|chrome-extension)://[A-Za-z0-9-]+$"

# Any localhost/127.0.0.1 origin (any port) should be allowed in development.
# Starlette's CORSMiddleware takes a single allow_origin_regex, so we combine
# extension + localhost patterns. EXTENSION_ORIGIN_REGEX is kept unchanged for
# existing tests; this combined regex is what main.py actually uses.
LOCALHOST_ORIGIN_REGEX = r"^http://(?:localhost|127\.0\.0\.1)(?::\d+)?$"
CORS_ORIGIN_REGEX = r"^(?:(?:moz-extension|chrome-extension)://[A-Za-z0-9-]+|http://(?:localhost|127\.0\.0\.1)(?::\d+)?)$"

_DEFAULT_PORTS = {"http": 80, "https": 443}


def canonical_origin(origin: str) -> str:
    """Return ``origin`` exactly as a browser would send it in the ``Origin``
    header: lowercase scheme and host, default port omitted, nothing else.

    CORSMiddleware compares origins by string equality, so an entry that is
    merely *equivalent* (``HTTPS://Host:443``) would look configured while
    matching nothing. Anything that cannot be an origin at all — a path,
    query, fragment, userinfo, wildcard, or non-numeric port — raises.
    """
    if "*" in origin:
        raise ValueError(f"CORS_EXTRA_ORIGINS entry {origin!r}: wildcards are not origins")
    parts = urlsplit(origin)
    scheme = parts.scheme.lower()
    try:
        port = parts.port  # None when absent; ValueError when not numeric
    except ValueError as e:
        raise ValueError(f"CORS_EXTRA_ORIGINS entry {origin!r}: invalid port") from e
    if (
        scheme not in _DEFAULT_PORTS
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise ValueError(
            f"CORS_EXTRA_ORIGINS entry {origin!r} is not an origin "
            "(expected scheme://host[:port], no path/query/userinfo)"
        )
    host = parts.hostname.lower()
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    if port is None or port == _DEFAULT_PORTS[scheme]:
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


def allowed_origins() -> list[str]:
    origins = list(DEFAULT_ORIGINS)
    raw = os.getenv("CORS_EXTRA_ORIGINS", "")
    for item in raw.split(","):
        entry = item.strip()
        if not entry:
            continue
        origin = canonical_origin(entry)
        if origin not in origins:
            origins.append(origin)
    return origins
