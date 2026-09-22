#!/bin/sh

set -eu

image_ref=${1:-}
if [ -z "$image_ref" ]; then
  echo "usage: $0 IMAGE" >&2
  exit 2
fi

container_id=""
cleanup() {
  if [ -n "$container_id" ]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM

container_id=$(docker run --rm --detach "$image_ref")
base_url=http://127.0.0.1:8080

attempt=0
until docker exec "$container_id" wget -q -O /dev/null "$base_url/"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "web image did not become ready" >&2
    exit 1
  fi
  sleep 1
done

fetch_headers() {
  docker exec "$container_id" wget -S -O /dev/null "$base_url$1" 2>&1
}

assert_header() {
  headers=$1
  expected=$2
  if ! printf '%s\n' "$headers" | grep -Eiq "$expected"; then
    echo "missing expected response header: $expected" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
}

index_body=$(docker exec "$container_id" wget -q -O - "$base_url/")
deep_link_body=$(docker exec "$container_id" wget -q -O - "$base_url/controller/deep-link")
if [ "$index_body" != "$deep_link_body" ]; then
  echo "SPA fallback did not return index.html" >&2
  exit 1
fi

index_headers=$(fetch_headers /)
assert_header "$index_headers" 'HTTP/[0-9.]+ 200'
assert_header "$index_headers" 'Content-Type: *text/html'
assert_header "$index_headers" 'Cache-Control: *no-cache'
assert_header "$index_headers" "Content-Security-Policy:.*default-src 'self'"
assert_header "$index_headers" "Content-Security-Policy:.*script-src 'self'"
assert_header "$index_headers" "Content-Security-Policy:.*worker-src 'self'"
assert_header "$index_headers" 'Permissions-Policy: *camera=\(\), geolocation=\(\), microphone=\(\)'
assert_header "$index_headers" 'Referrer-Policy: *strict-origin-when-cross-origin'
assert_header "$index_headers" 'X-Content-Type-Options: *nosniff'
assert_header "$index_headers" 'X-Frame-Options: *DENY'

worklet_headers=$(fetch_headers /assets/engine-audio-worklet.js)
assert_header "$worklet_headers" 'HTTP/[0-9.]+ 200'
assert_header "$worklet_headers" 'Content-Type: *(text|application)/javascript'
assert_header "$worklet_headers" 'Cache-Control: *no-cache'

hashed_asset=$(printf '%s\n' "$index_body" | grep -Eo '/assets/index-[^" ]+\.js' | head -n 1)
if [ -z "$hashed_asset" ]; then
  echo "could not find the hashed application entry in index.html" >&2
  exit 1
fi
hashed_headers=$(fetch_headers "$hashed_asset")
assert_header "$hashed_headers" 'HTTP/[0-9.]+ 200'
assert_header "$hashed_headers" 'Content-Type: *(text|application)/javascript'
assert_header "$hashed_headers" 'Cache-Control: *max-age=31536000'

missing_headers=$(fetch_headers /assets/does-not-exist.js || true)
assert_header "$missing_headers" 'HTTP/[0-9.]+ 404'

echo "production web image HTTP verification passed"
