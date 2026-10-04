"""Fetch untrusted document URLs without accessing private networks."""

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin

import httpx

MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
MAX_REDIRECTS = 5


async def fetch_public_document(client: httpx.AsyncClient, value: str) -> httpx.Response:
    """Validate every hop and pin its connection to a validated DNS address.

    Caller supplies a client with trust_env=False so a proxy cannot resolve the
    original name again. TLS still verifies the original hostname via SNI.
    """
    for hop in range(MAX_REDIRECTS + 1):
        try:
            url = httpx.URL(value)
            if url.scheme not in ("http", "https") or not url.host or url.userinfo:
                raise ValueError("Use a public HTTP or HTTPS document URL without credentials.")
            addresses = await asyncio.get_running_loop().getaddrinfo(
                url.host, url.port or (443 if url.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        except (httpx.InvalidURL, socket.gaierror) as exc:
            raise ValueError("The document URL could not be resolved.") from exc
        ips = [address[4][0] for address in addresses]
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise ValueError("Document URLs must resolve only to public network addresses.")
        target = url.copy_with(host=ips[0])
        async with client.stream(
            "GET", target,
            headers={"Host": url.netloc.decode("ascii"), "User-Agent": "MindEase-Research-Visualizer/1.0"},
            extensions={"sni_hostname": url.host},
            follow_redirects=False,
        ) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location or hop == MAX_REDIRECTS:
                    raise ValueError("The document has an invalid or excessive redirect chain.")
                value = urljoin(str(url), location)
                continue
            response.raise_for_status()
            content = bytearray()
            async for chunk in response.aiter_bytes():
                if len(content) + len(chunk) > MAX_DOCUMENT_BYTES:
                    raise ValueError("The document exceeds the 20 MB download limit.")
                content.extend(chunk)
            headers = dict(response.headers)
            # aiter_bytes has already decoded compressed transfer bodies.
            headers.pop("content-encoding", None)
            headers.pop("content-length", None)
            return httpx.Response(response.status_code, headers=headers, content=bytes(content),
                                  request=httpx.Request("GET", url))
    raise ValueError("The document has too many redirects.")
