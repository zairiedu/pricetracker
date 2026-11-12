# PricePilot open-source browser renderer

PricePilot keeps the existing Supabase `pricepilot-preview` HTML/JSON-LD extractor as the primary path.
If direct HTML retrieval fails or is missing useful metadata, the Edge Function can
use this **optional**, self-hosted Crawl4AI service to render JavaScript and return
HTML. The *same* existing product parser interprets that HTML; the renderer does
not supply AI-guessed prices.

## Deploy

Deploy `services/product-renderer/` as an isolated Docker service on a provider
of your choice, with **private ingress** (Supabase Edge Function egress must be
able to reach it), HTTPS, a strong random `RENDERER_TOKEN`, and a restrictive
network egress policy. Example local smoke test:

```sh
docker build -t pricepilot-renderer services/product-renderer
docker run --rm -p 127.0.0.1:8080:8080 -e RENDERER_TOKEN=replace-with-long-random-secret pricepilot-renderer
curl -H 'Authorization: Bearer replace-with-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/products/example"}' http://127.0.0.1:8080/render
```

Set these **private Supabase Edge Function secrets** after deploying:
`PRICEPILOT_RENDERER_URL=https://<your-private-renderer>/render` and
`PRICEPILOT_RENDERER_TOKEN=<same-secret>`.
No change to front-end URLs or database schema is needed.

**Security:** The renderer has its own bearer authentication, strict HTTPS URL
validation, DNS public-IP preflight, timeouts, bounded HTML size, two concurrent
renders, and no credentials forwarded to retailer pages. DNS validation alone
**does not** prevent rebinding, and browsers load subresources and follow
redirects before final-URL verification. This service **MUST** run with
infrastructure-enforced network egress policies blocking loopback, link-local,
RFC1918, metadata endpoints and other nonpublic addresses for every outbound
connection. If you cannot enforce that requirement, do not enable the renderer.
Respect retailers' robots/access policies and never attempt captcha bypass.

The Edge Function silently retains the original HTML extractor if the renderer
is unavailable. Rendered prices remain unverified page previews and cannot
trigger verified price alerts.

## Validation

```sh
python -m compileall services/product-renderer/app.py
```

Validate Canadian Tire and DSW with a real authenticated PricePilot session
after renderer deployment. No live retailer success is claimed before this test.
