"""Authenticated Crawl4AI browser-rendering fallback for product metadata.

Deploy behind a private network or outbound-filtering proxy: DNS checks alone
cannot prevent DNS rebinding. Never expose this directly to browsers.
"""
import asyncio
import hmac
import ipaddress
import os
import socket
from urllib.parse import urlsplit

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_HTML = 1_800_000
MAX_CONCURRENT = asyncio.Semaphore(2)


class RenderRequest(BaseModel):
    url: str = Field(min_length=12, max_length=2048)


def validate_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme != "https" or not host or parsed.username or
                parsed.password or parsed.port not in (None, 443) or
                not parsed.path or len(value) > 2048):
            raise ValueError("Invalid public HTTPS product URL")
        if host.lower() in {"localhost", "localhost.localdomain"} or host.lower().endswith(
            (".local", ".internal", ".test", ".localhost", ".onion")
        ):
            raise ValueError("Local host forbidden")
        try:
            ipaddress.ip_address(host)
            raise ValueError("IP literals forbidden")
        except ValueError as error:
            if str(error) == "IP literals forbidden":
                raise
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(
            not ipaddress.ip_address(entry[4][0]).is_global for entry in addresses
        ):
            raise ValueError("Non-public DNS result")
        return value
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Unsafe or unresolvable URL") from error


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/render")
async def render(payload: RenderRequest, authorization: str | None = Header(default=None)):
    token = os.environ.get("RENDERER_TOKEN", "")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not token or not hmac.compare_digest(supplied, token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    url = validate_url(payload.url)
    async with MAX_CONCURRENT:
        try:
            browser = BrowserConfig(headless=True, verbose=False)
            config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=18000,
                wait_until="domcontentloaded",
                delay_before_return_html=1.0,
                word_count_threshold=1,
            )
            async with AsyncWebCrawler(config=browser) as crawler:
                result = await asyncio.wait_for(crawler.arun(url=url, config=config), timeout=25)
            if not result.success:
                raise HTTPException(status_code=422, detail="Retailer page could not be rendered")
            # Never accept content for a redirected / different product URL.
            if result.url.rstrip("/") != url.rstrip("/"):
                raise HTTPException(status_code=422, detail="Product URL redirected")
            html = result.html or ""
            if not html or len(html.encode("utf-8")) > MAX_HTML:
                raise HTTPException(status_code=422, detail="Missing or oversized rendered HTML")
            return {"html": html, "rendered": True}
        except HTTPException:
            raise
        except (asyncio.TimeoutError, Exception) as error:
            raise HTTPException(status_code=422, detail="Browser rendering failed") from error
