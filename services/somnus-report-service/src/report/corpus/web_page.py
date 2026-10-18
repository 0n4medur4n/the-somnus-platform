"""One web page's readable text, fetched on an admin's request (owner decision 2026-10-18).

Exactly one page per request -- never a crawl -- and only when an admin asks:
fetching is how a page's text becomes a draft's text, which then follows every
corpus rule unchanged (rights gate at publish, embedding only on publish).

The URL is typed by a person, and this service runs inside Google Cloud, so the
fetch is guarded against reaching anything that is not the public web (SSRF):
http/https on the default ports only, every address the name resolves to must
be public, redirects are followed by hand and re-checked hop by hop, and the
body is read under a size and time limit.

What remains is the window between the check and the connection (DNS
rebinding). It is narrow, and what it could reach is narrower still: the service
has no VPC egress, so private ranges are not routable from it, and the metadata
server answers nothing without a `Metadata-Flavor` header this client never sends.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final
from urllib.parse import urljoin, urlsplit

import httpx

MAX_PAGE_BYTES: Final = 5 * 1024 * 1024
MAX_REDIRECTS: Final = 4
TIMEOUT_SECONDS: Final = 15.0
MAX_TEXT_CHARACTERS: Final = 1_000_000
USER_AGENT: Final = "TheSomnusCorpusBot/1.0 (+https://thesomnus.com)"

#: Elements whose text is never the page's content.
_SKIPPED: Final = frozenset(
    {"script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form"}
)
#: Elements that end a block of text.
_BLOCKS: Final = frozenset(
    {
        "p", "div", "section", "article", "main", "br", "li", "ul", "ol", "table", "tr",
        "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dd", "dt", "figcaption",
    }
)  # fmt: skip
#: HTML void elements: they never have a closing tag, so never open a skip.
_VOID: Final = frozenset({"br", "hr", "img", "input", "meta", "link", "area", "base", "col"})


class WebPageError(ValueError):
    """The page cannot become a document's text. The message is safe to show."""


@dataclass(frozen=True)
class FetchedPage:
    url: str
    title: str
    text: str


Resolver = Callable[[str], list[str]]


def _resolve(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as error:
        raise WebPageError("the address could not be found") from error
    return sorted({str(info[4][0]) for info in infos})


def check_url(url: str, resolve: Resolver = _resolve) -> str:
    """The URL, if it is a public http(s) page; WebPageError otherwise."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise WebPageError("only http and https addresses can be fetched")
    if parts.username or parts.password:
        raise WebPageError("an address with a user name or password cannot be fetched")
    host = parts.hostname
    if not host:
        raise WebPageError("the address has no host")
    if parts.port not in (None, 80, 443):
        raise WebPageError("only the standard web ports can be fetched")
    addresses = resolve(host)
    if not addresses:
        raise WebPageError("the address could not be found")
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        if not ip.is_global or ip.is_multicast:
            raise WebPageError("that address is not on the public internet")
    return parts.geturl()


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED and tag not in _VOID:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True
        if tag in _BLOCKS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False
        if tag in _BLOCKS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
            return
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        raw = "".join(self._parts)
        lines = [re.sub(r"\s+", " ", line).strip() for line in raw.split("\n")]
        joined = "\n".join(line for line in lines if line)
        return joined.strip()


def extract_text(html: str) -> tuple[str, str]:
    """(title, readable text) of an HTML document."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return re.sub(r"\s+", " ", parser.title).strip(), parser.text()


def fetch(
    url: str,
    *,
    client: httpx.Client | None = None,
    resolve: Resolver = _resolve,
) -> FetchedPage:
    """Fetch one page and return its readable text, or WebPageError."""
    owned = client is None
    http = client or httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=False,
        headers={"user-agent": USER_AGENT, "accept": "text/html,text/plain;q=0.9"},
    )
    try:
        current = check_url(url, resolve)
        for _ in range(MAX_REDIRECTS + 1):
            with http.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise WebPageError("the page redirected nowhere")
                    current = check_url(urljoin(current, location), resolve)
                    continue
                if response.status_code != 200:
                    raise WebPageError(f"the page answered {response.status_code}")
                content_type = response.headers.get("content-type", "").split(";")[0].strip()
                if content_type not in ("text/html", "application/xhtml+xml", "text/plain"):
                    raise WebPageError("the address is not a web page (HTML or plain text)")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_PAGE_BYTES:
                        raise WebPageError("the page is too large")
                decoded = bytes(body).decode(response.encoding or "utf-8", errors="replace")
                break
        else:
            raise WebPageError("the page redirected too many times")
    except httpx.HTTPError as error:
        raise WebPageError("the page could not be fetched") from error
    finally:
        if owned:
            http.close()

    if content_type == "text/plain":
        title, text = "", decoded.strip()
    else:
        title, text = extract_text(decoded)
    if not text:
        raise WebPageError("no readable text was found on the page")
    if len(text) > MAX_TEXT_CHARACTERS:
        raise WebPageError("the page holds more text than one corpus entry can")
    return FetchedPage(url=current, title=title, text=text)
