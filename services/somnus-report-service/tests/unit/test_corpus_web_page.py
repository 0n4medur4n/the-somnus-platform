"""One web page into a draft, and nothing that is not the public web (2026-10-18).

The URL is typed by a person and the fetch runs inside Google Cloud, so most of
these are SSRF refusals: the address must resolve to public addresses only,
before the first request and after every redirect.
"""

from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from report.corpus import web_page
from report.corpus.web_page import WebPageError, check_url, extract_text, fetch

PUBLIC = "93.184.216.34"


def _resolver(table: dict[str, list[str]]) -> Callable[[str], list[str]]:
    def resolve(host: str) -> list[str]:
        return table.get(host, [PUBLIC])

    return resolve


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


HTML = """<!doctype html><html><head><title> Higiene del sueño </title>
<style>body{color:red}</style><script>var secret = 1;</script></head>
<body><nav>Inicio · Contacto</nav><header>Cabecera</header>
<main><h1>Dormir mejor</h1><p>Mantén horarios <b>regulares</b>.</p>
<ul><li>Luz natural por la mañana</li><li>Pantallas fuera de la cama</li></ul></main>
<footer>© 2026</footer></body></html>"""


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.org/file",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://user:pass@example.org/",
        "https://example.org:8443/",
        "http:///nohost",
    ],
)
def test_only_plain_public_web_addresses_are_accepted(url: str) -> None:
    with pytest.raises(WebPageError):
        check_url(url, _resolver({}))


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.0.0.5", "192.168.1.10", "172.16.0.1", "169.254.169.254", "::1", "fd00::1"],
)
def test_a_name_that_resolves_to_a_private_address_is_refused(address: str) -> None:
    with pytest.raises(WebPageError, match="public internet"):
        check_url("https://internal.example/", _resolver({"internal.example": [address]}))


def test_one_private_address_among_public_ones_is_enough_to_refuse() -> None:
    with pytest.raises(WebPageError):
        check_url("https://mixed.example/", _resolver({"mixed.example": [PUBLIC, "10.0.0.1"]}))


def test_the_readable_text_leaves_out_scripts_styles_and_navigation() -> None:
    title, text = extract_text(HTML)
    assert title == "Higiene del sueño"
    assert "Dormir mejor" in text
    assert "Mantén horarios regulares." in text
    assert "Luz natural por la mañana" in text
    for absent in ("secret", "color:red", "Inicio", "Cabecera", "© 2026"):
        assert absent not in text


def test_a_page_is_fetched_once_and_its_text_returned() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=HTML)

    page = fetch("https://example.org/higiene", client=_client(handler), resolve=_resolver({}))
    assert seen == ["https://example.org/higiene"]
    assert page.url == "https://example.org/higiene"
    assert page.title == "Higiene del sueño"
    assert "Pantallas fuera de la cama" in page.text


def test_a_redirect_to_a_private_address_is_refused() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://metadata.internal/token"})

    with pytest.raises(WebPageError, match="public internet"):
        fetch(
            "https://example.org/",
            client=_client(handler),
            resolve=_resolver({"metadata.internal": ["169.254.169.254"]}),
        )


def test_a_public_redirect_is_followed_and_recorded() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return httpx.Response(200, headers={"content-type": "text/html"}, text=HTML)

    page = fetch("https://example.org/old", client=_client(handler), resolve=_resolver({}))
    assert page.url == "https://example.org/new"


def test_endless_redirects_stop() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "/again"})

    with pytest.raises(WebPageError, match="too many"):
        fetch("https://example.org/", client=_client(handler), resolve=_resolver({}))


@pytest.mark.parametrize(
    ("status", "content_type", "message"),
    [(404, "text/html", "404"), (200, "application/pdf", "not a web page")],
)
def test_an_error_or_a_non_page_is_refused(status: int, content_type: str, message: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, headers={"content-type": content_type}, content=b"x")

    with pytest.raises(WebPageError, match=message):
        fetch("https://example.org/", client=_client(handler), resolve=_resolver({}))


def test_a_page_over_the_size_limit_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(web_page, "MAX_PAGE_BYTES", 100)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<p>" + "a" * 500)

    with pytest.raises(WebPageError, match="too large"):
        fetch("https://example.org/", client=_client(handler), resolve=_resolver({}))


def test_a_page_with_no_readable_text_is_refused() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "text/html"}, text="<script>only()</script>"
        )

    with pytest.raises(WebPageError, match="no readable text"):
        fetch("https://example.org/", client=_client(handler), resolve=_resolver({}))
