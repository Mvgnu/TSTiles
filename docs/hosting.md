# Host your own maps

The default deployment is one Caddy server reading static files from disk.
Node is used to build the viewer and publish archives; it does not run while
visitors use the map. Start with spare VPS disk and included traffic. Move the
same intact archives to object storage only when capacity, geography, or an
observed operating cost makes that useful.

## What is published

| Public path | Content | Cache policy |
| --- | --- | --- |
| `/archives/<sha256>.pmtiles` | Exact, immutable archive bytes | One year, immutable |
| `/maps/<id>.json` | Current archive pointer and metadata | Revalidate every use (`no-cache`) |
| `/`, `/index.html` | Map viewer | Revalidate every use |
| `/assets/**`, `/styles/**` | Viewer bundles and supplied style resources | Five minutes, then revalidate |

Error responses use `no-store`. Caddy serves only these public paths, blocks
dot paths, and does not enable directory listings. Its document root must be
the prepared `site/`, never the repository or a directory containing secrets.
Keep `site/` free of symlinks: a file server root is not a symlink sandbox.

The public configuration uses `Access-Control-Allow-Origin: *` without
credentials so all your sites can embed the same map. It permits GET, HEAD,
and OPTIONS, including Range/If-Match preflights, and exposes validators and
range metadata. **CORS, a referrer check, and a key shipped in browser code
are not access control or a spending cap.** These archives are public. Budget
for public traffic; introduce real authentication only for a separate private
map requirement.

## 1. Prove the local path

Use Node 22 or 24 and Caddy **2.11.7**. Obtain the binary for your platform from
the [official release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)
and check it against that release's checksums. The Docker deployment below
uses the [official `caddy:2.11.7-alpine` image](https://hub.docker.com/_/caddy).
The version is pinned; update it deliberately with the hosting checks.

From the repository root:

```sh
npm ci
npm run build
npm run demo:prepare
CADDY_BIN=/absolute/path/to/caddy npm run test:hosting
TSTILES_ROOT="$PWD/site" /absolute/path/to/caddy run --config ops/Caddyfile.local
```

Open <http://127.0.0.1:8080/?manifest=./maps/fixture.json>. The checked-in fixture
contains one test polygon. It proves delivery/rendering, not roads, labels,
coverage, map-data licensing, or the quality of your eventual basemap. Stop
the local server with Ctrl-C. To use another local port, set
`TSTILES_LISTEN=127.0.0.1:8081` on the same command. The local configuration
explicitly binds only to `127.0.0.1`.

`test:hosting` launches real Caddy against temporary static files and checks
exact range bytes, partial-body size, HEAD, suffix/invalid ranges, ETag
conditions, cross-origin preflights, caching, rejected service-file paths, and
refused TCP connections on other local network addresses.
It fails when Caddy is missing. It neither contacts a storage provider nor
provisions infrastructure. A sandbox running this test must allow a loopback
listener and child processes.

## 2. Prepare your archive

For your own file:

```sh
npm run archive:inspect -- /path/map.pmtiles
npm run archive:publish -- /path/map.pmtiles \
  --out site --id basemap --name Basemap \
  --attribution 'The required attribution for this dataset'
```

Read the inspection output before publishing. This milestone accepts vector
PMTiles v3. Container validity does not establish which cartographic style
fits the archive's layer names and properties. Without a supplied style the
viewer is a labelled data preview, not a finished basemap.

The publisher records exact bytes under a SHA-256 filename and writes
`site/maps/basemap.json` last. It keeps old archives. Its header/metadata checks
are not a complete traversal of every directory or tile. For structural
verification, use the established [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli):

```sh
pmtiles show /path/map.pmtiles --metadata
pmtiles verify /path/map.pmtiles
```

`verify` checks archive ordering and header information; it is not a
cryptographic comparison with the data publisher. Compare a publisher-provided
checksum separately when one exists.

A full basemap needs a compatible MapLibre style, appropriate font glyphs,
sprites where used, and correct attribution. Put self-hosted style resources
under `site/styles/`, preserving their required directory structure. A supplied
style is a complete document; TSTiles does not rewrite its sources, glyphs,
sprites, or additional data layers. Set its source to the published archive
URL using `pmtiles://https://maps.example.com/archives/<sha256>.pmtiles`, and use
deliberate absolute resource URLs when mixing hosts. Attach that ready-to-serve
style by publishing the same archive again:

```sh
npm run archive:publish -- /path/map.pmtiles \
  --out site --id basemap --name Basemap \
  --attribution 'The required attribution for this dataset' \
  --style ../styles/basemap-v1.json
```

The digest archive is reused and the manifest pointer is replaced. Inspect the
browser network panel for unexpected external dependencies. See the official
[Protomaps asset guide](https://docs.protomaps.com/basemaps/maplibre) and
[basemap release/schema information](https://docs.protomaps.com/basemaps/downloads).

Keep the test fixture out of production releases. Measure free space before
copying: the build machine needs room for its source and published copy; the
VPS needs the current archive, new archive, temporary upload, and all retained
rollback versions. Do not size disk for only the final active file. An archive
can be reduced to a region/maximum zoom with the official `pmtiles extract`
command if that matches the actual sites' coverage needs.

## 3. Start the VPS service

Use a Linux VPS with Docker Engine and Compose v2 installed, a hostname whose
A/AAAA records point to it, and available TCP ports 80/443. UDP 443 enables
HTTP/3. If another proxy already owns those ports, integrate with that proxy
instead of starting a second listener on them.

Only `site/` and the deployment configuration need to reach the VPS. For
example, replace the SSH destination with your own account:

```sh
ssh deploy@your-vps 'mkdir -p tstiles/site tstiles/ops'
rsync -a site/ deploy@your-vps:tstiles/site/
rsync -a --exclude=.env --exclude=state/ ops/ deploy@your-vps:tstiles/ops/
```

On the VPS:

```sh
cd ~/tstiles
cp ops/.env.example ops/.env
```

Edit `ops/.env` and replace `maps.example.com` with your actual hostname,
without a scheme, path, or port. The file contains no storage credentials.
Prepare the two writable state directories and start Caddy:

```sh
sudo install -d -o 65532 -g 65532 -m 0700 ops/state/data ops/state/config
chmod -R a+rX site
docker compose --env-file ops/.env -f ops/compose.yaml config --quiet
docker compose --env-file ops/.env -f ops/compose.yaml up -d
docker compose --env-file ops/.env -f ops/compose.yaml logs --tail=50 caddy
```

The process runs as UID/GID 65532 with a read-only container filesystem. All
capabilities except `NET_BIND_SERVICE` are dropped: the official image's binary
carries that file capability and needs it retained in its bounding set to
execute. Caddy listens on internal ports 8080/8443, published as
80/443. Only certificate/config state and a bounded temporary directory are
writable. This follows Caddy's documented
[internal port mapping](https://caddyserver.com/docs/caddyfile/options#http-port)
and [persistent data requirements](https://caddyserver.com/docs/running#docker-compose).
Back up `ops/state/data` securely along with deployment configuration; it holds
TLS material and must survive container recreation. Do not copy it into `site/`.

Open `https://maps.example.com/?manifest=./maps/basemap.json`. Confirm HTTPS
and the actual map in a browser from a second site. Inspect a small raw request,
replacing the digest with the one in the manifest:

```sh
curl --fail --silent --show-error --dump-header - \
  --header 'Origin: https://your-site.example' \
  --range 0-126 \
  --output /tmp/tstiles-header.bin \
  https://maps.example.com/archives/REPLACE_WITH_SHA256.pmtiles
wc -c /tmp/tstiles-header.bin
```

Expect `206`, `Content-Range: bytes 0-126/<archive size>`, 127 bytes downloaded,
no `Content-Encoding`, and the public CORS header. Test from the final public
hostname: a reverse proxy/CDN can change behavior that passed locally. HTTP
tests cannot establish production certificate issuance, DNS, firewall rules,
or the quality of your own map data.

Static-file updates need no reload. For a Caddy configuration change, validate
and then gracefully reload:

```sh
docker compose --env-file ops/.env -f ops/compose.yaml exec caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file ops/.env -f ops/compose.yaml exec caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

The admin port is reachable only inside the container. Changing `.env` requires
`docker compose ... up -d` to recreate the container with the new environment.

## 4. Update and roll back without mixing archive versions

Never replace bytes under an existing digest URL. On your build machine,
publish the next archive to `site/` with the same map ID. Copy its new archive
and any new style resources first. A new style should have a versioned path
if its schema changes. Keep the previous style and archive available.

For a data-only update, from the build machine:

```sh
rsync -a --ignore-existing site/archives/ deploy@your-vps:tstiles/site/archives/
rsync -a site/styles/ deploy@your-vps:tstiles/site/styles/
scp site/maps/basemap.json deploy@your-vps:tstiles/site/maps/.basemap.next
```

Omit the styles command when no `site/styles/` exists. Before switching the
manifest, verify the new remote archive's size/digest and range behavior. On
the VPS, a first update can retain the previous pointer and activate the next
one with a same-filesystem atomic rename:

```sh
cd ~/tstiles
mkdir -p rollback
cp site/maps/basemap.json rollback/basemap.previous.json
mv site/maps/.basemap.next site/maps/basemap.json
```

Open the map again, including a new browser session. To roll back that update:

```sh
cp rollback/basemap.previous.json site/maps/.basemap.rollback
mv site/maps/.basemap.rollback site/maps/basemap.json
```

Each response sees a complete manifest, and old pages can continue reading
their old immutable archive. Retain separately named manifest snapshots if
you need more than one rollback point. Never run `rsync --delete` over the
archive directory as an update shortcut. No automatic archive garbage
collection is provided; deletion needs a deliberate retention decision because
existing pages and caches may still reference old versions.

For a viewer-code update, keep a snapshot of its `index.html` and `assets/`,
copy assets before the index, and keep manifest compatibility. Fixed-name
bundles have a five-minute cache lifetime, so allow that window for mixed
client versions; a breaking viewer change needs a coordinated release or
versioned viewer path. The data-only rollback above does not roll back code.

## Existing nginx host (itstiles.com)

The production host `https://itstiles.com` is a shared VPS whose nginx already
owns 80/443 for other sites. There, nginx itself serves the static files; no
Caddy or Docker runs. `ops/nginx/` reproduces the route table above:

| File (repository) | Installed as | Context |
| --- | --- | --- |
| `ops/nginx/tstiles-http.conf` | `/etc/nginx/snippets/tstiles-http.conf` | http (`$tstiles_*` maps), included once by the site file |
| `ops/nginx/tstiles-routes.conf` | `/etc/nginx/snippets/tstiles-routes.conf` | server: routes, CORS, cache, MIME |
| `ops/nginx/tstiles-cloudflare-realip.conf` | `/etc/nginx/snippets/tstiles-cloudflare-realip.conf` | server: trust `CF-Connecting-IP` from Cloudflare only |
| `ops/nginx/itstiles.com.bootstrap.conf` | `/etc/nginx/sites-available/itstiles.com` (before the certificate) | :80 ACME only, 404 otherwise |
| `ops/nginx/itstiles.com.conf` | `/etc/nginx/sites-available/itstiles.com` (after the certificate) | :80 ACME + 301, :443 apex, www 301 |

Other sites' files are not touched. The site has no `default_server` and no
`reuseport`. `test:hosting` runs real nginx against the routes snippet
unmodified, and validates and runs a copy of the site file whose host paths
and ports point into a temporary directory.

### Install

Point DNS (A/AAAA for `itstiles.com` and `www.itstiles.com`) at the VPS,
DNS-only while the certificate is issued. As root:

```sh
install -m 0644 ops/nginx/tstiles-http.conf ops/nginx/tstiles-routes.conf \
  ops/nginx/tstiles-cloudflare-realip.conf /etc/nginx/snippets/
install -m 0644 ops/nginx/itstiles.com.bootstrap.conf /etc/nginx/sites-available/itstiles.com
ln -s /etc/nginx/sites-available/itstiles.com /etc/nginx/sites-enabled/itstiles.com
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d itstiles.com -d www.itstiles.com
install -m 0644 ops/nginx/itstiles.com.conf /etc/nginx/sites-available/itstiles.com
nginx -t && systemctl reload nginx
```

Never use `certbot --nginx`; it would rewrite the site file. Renewal reuses
the webroot. Rollback at any step:
`rm /etc/nginx/sites-enabled/itstiles.com && nginx -t && systemctl reload nginx`.
Static file changes need no reload.

Content lives at `/mnt/tstiles/site` (the dedicated volume). nginx workers run
as `www-data` and need read access only: directories `0755`, files `0644`,
owned by the operator (for example `chown -R root:root` and
`chmod -R u=rwX,go=rX /mnt/tstiles/site`). Do not make it writable by
`www-data`. Keep it free of symlinks and dot files (dot paths are 404 anyway).

The host enables brotli and `brotli_static` http-wide. The site file turns
brotli off for the whole site, because PMTiles/glyph bytes must not be
re-encoded and the shared routes snippet cannot name a module that stock
nginx lacks. gzip stays on for JSON/JS/CSS and is off for archives and `.pbf`.
Nothing is proxied, so large responses go out with `sendfile` and never touch
nginx temp files.

### Logs and disk

The root disk is shared and nearly full. The access log
(`/var/log/nginx/itstiles.access.log`, buffered) omits successful archive reads
(200/206/304): a single map view makes dozens of Range requests. Archive errors
and every other request are logged. Missing files are not repeated in the
error log (`log_not_found off`). The `.log` suffix puts both files under the
host's existing `/etc/logrotate.d/nginx` (daily, 14 compressed). To measure
archive traffic for a while, temporarily remove `if=$tstiles_loggable` from
the site file and reload; watch `df -h /`.

### Cloudflare: DNS-only versus proxied

`tstiles-cloudflare-realip.conf` is harmless while DNS-only: real IPs are only
taken from Cloudflare's published ranges. If the record is later proxied:

- Set SSL/TLS mode to **Full (strict)**; the origin has a valid certificate.
- Cloudflare forwards Range requests. A file over 512 MB (Free/Pro/Business) is
  never cached, so the planet archive is always fetched from the VPS; small
  manifests, styles, and glyphs may be cached according to their headers.
- Do not enable features that transform responses (Polish, Mirage, Rocket
  Loader, Email Obfuscation, compression rules for `application/octet-stream`).
  Re-run the curl checks below through the proxy; they must stay identical.
- Refresh the real-IP ranges when Cloudflare changes them.

### One planet: capacity and updates

The 147 GB volume holds one planet archive (about 139 GB). Publication must not
copy it: the archive publisher's same-filesystem hard-link mode links the file
to `archives/<sha256>.pmtiles` and writes the manifest last. Updating the planet
therefore needs either a larger volume or a deliberate removal of the old
archive first, which breaks pages still using it until they reload the
manifest. That retention choice is the operator's; the general update section
above (keep old archives) assumes spare space this host does not have. Embed
maps through `/maps/<id>.json` or a served style, never a hard-coded digest URL.

### Verify the live host

```sh
# The digest is the archive named in https://itstiles.com/maps/<id>.json.
ARCHIVE=https://itstiles.com/archives/REPLACE_WITH_SHA256.pmtiles
curl -sS -D - -o /tmp/h.bin -H 'Origin: https://your-site.example' \
  -H 'Accept-Encoding: gzip, br' -r 0-126 "$ARCHIVE"; wc -c /tmp/h.bin
curl -sS -D - -o /dev/null -X OPTIONS -H 'Origin: https://your-site.example' \
  -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: range' "$ARCHIVE"
curl -sS -D - -o /dev/null https://itstiles.com/maps/basemap.json
curl -sS -D - -o /dev/null https://itstiles.com/.env
curl -sS -D - -o /dev/null http://itstiles.com/ ; curl -sS -D - -o /dev/null https://www.itstiles.com/
```

Expect: `206`, `Content-Range: bytes 0-126/<size>`, 127 bytes, no
`Content-Encoding`, `Access-Control-Allow-Origin: *` once,
`Cache-Control: public, max-age=31536000, immutable`, and
`Strict-Transport-Security: max-age=31536000`; preflight `204` with
`Access-Control-Max-Age: 3600`; manifest `no-cache`; `/.env` `404` with
`no-store`; both redirects `301` to `https://itstiles.com/`.

Two nginx-specific differences from Caddy are deliberate and tested: an
unsatisfiable range (`416`) carries the archive's cache policy *and*
`no-store` (nginx runs its header filters twice for a 416; `no-store`
governs), and a `206` has no `Accept-Ranges` header (the `200`/HEAD response
does).

## Optional S3-compatible storage

S3 is an API, not a requirement to use Amazon. Keep each PMTiles archive intact.
Use an existing multipart-capable client such as the
[AWS CLI](https://docs.aws.amazon.com/cli/latest/topic/s3-config.html) or
[rclone](https://docs.protomaps.com/pmtiles/cloud-storage). Do not build an SDK
upload pipeline or expand the archive into individual tile objects.

After configuring the provider's credentials/profile locally, upload the exact
digest file with the desired object headers. This example uses an S3-compatible
API endpoint; it is not necessarily the public browser hostname:

```sh
aws --profile maps --endpoint-url https://YOUR_S3_API_ENDPOINT s3 cp \
  site/archives/REPLACE_WITH_SHA256.pmtiles \
  s3://YOUR_BUCKET/archives/REPLACE_WITH_SHA256.pmtiles \
  --content-type application/octet-stream \
  --cache-control 'public, max-age=31536000, immutable'
```

Do not set `--content-encoding gzip`. The CLI manages multipart transfer for
large local files; its thresholds/concurrency can be tuned for the connection.
After verification, upload the manifest last:

```sh
aws --profile maps --endpoint-url https://YOUR_S3_API_ENDPOINT s3 cp \
  site/maps/basemap.json s3://YOUR_BUCKET/maps/basemap.json \
  --content-type application/json --cache-control no-cache
```

Configure the bucket's public delivery hostname and CORS for GET/HEAD, Range,
If-Match, and exposed ETag/range headers. Copy style resources before the
manifest that points to them. Keep the `maps/`, `archives/`, and `styles/`
layout on that host so relative manifest URLs continue to resolve. If only
archives move to another host, update the manifest's archive URL explicitly;
do not leave `../archives/` pointing back at the VPS. The viewer may stay on
the VPS and consume a complete remote manifest URL.

Repeat the browser and Range checks against the real provider. Do not infer
compatibility from its S3 logo. Never put bucket credentials in manifests,
styles, frontend JavaScript, or `site/`.

### R2 cache limitation

Cloudflare R2 has no internet-egress fee, but a large directly served PMTiles
file is not automatically edge-cached. Cloudflare's Free/Pro/Business cache
limit is 512 MB per file; a small byte range does not bypass the complete-file
size check. `r2.dev` is a development endpoint, not a production cache setup.
Use a custom domain. If measured latency makes tile-sized edge caching
necessary, the official PMTiles Worker is a separate future architecture
option, not part of this static deployment.
Sources: [R2 cache integration](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/),
[Range behavior](https://developers.cloudflare.com/cache/reference/range-requests/),
[official PMTiles Worker](https://docs.protomaps.com/deploy/cloudflare).

## Estimate costs from the actual workload

Track archive GB-month (including retained versions), observed HTTP requests,
transferred bytes, and maps actually opened. Page views are not map sessions.
Lazy loading maps that visitors never open can avoid unnecessary requests.

```text
VPS incremental cost = additional compute + extra disk + bandwidth over allowance + backups
Object-storage cost = stored GB-month × storage rate
                    + billed read operations × read rate
                    + billed upload/list/multipart operations × write rate
                    + billable egress GB × egress rate
```

Apply each provider's allowances and rounding to the corresponding category.
Direct PMTiles can make directory/header requests as well as tile-data requests;
measure range reads instead of equating one displayed tile with one billable
GET. Do not assume an unmeasured cache-hit rate.

As checked on **2026-10-28**, R2 Standard lists $0.015/GB-month, $0.36/million
Class B reads, and $4.50/million Class A operations, without internet-egress
charges. Its monthly free tier includes 10 GB-month, 10 million Class B, and
1 million Class A operations, shared with other account use; billing units
round up. A constant 120 GB archive would therefore cost **$1.65/month for
storage alone** if the whole 10 GB allowance remains available. Requests,
retained versions, and any optional Worker are separate. This is an example,
not a quote for an unknown archive or audience.
[Official R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Use your VPS's actual current disk and bandwidth allowance; no hosting plan or
monthly audience size is assumed here. Compare against current
[Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) or
[Hetzner's storage model](https://docs.hetzner.com/storage/object-storage/overview/)
when relevant. Recheck provider rates before provisioning.

## What this milestone has not proved

The local HTTP gate is evidence about the shared Caddy routes. It is not a
production deployment, a container-runtime test, a multi-gigabyte load test,
a live S3 compatibility test, or a judgement of the owner's basemap. Those
require their real environment/archive and a fresh Gauntlet review. Record
each outcome separately; never turn an unavailable environment into a pass.
