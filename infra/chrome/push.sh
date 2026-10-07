#!/usr/bin/env bash
# Build the Container Chrome image with Nix (no Docker daemon) and push it to Cloudflare's registry.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Prints the tag to put in infra/stack.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=$(nix-build infra/chrome/image.nix --no-out-link)
tag=$(basename "$out" | cut -c1-12)
creds=$(curl -fsS -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/containers/registries/registry.cloudflare.com/credentials" \
  -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"expiration_minutes":60,"permissions":["push","pull"]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;process.stdout.write(r.username+":"+r.password)})')
nix run nixpkgs#skopeo -- copy --dest-creds "$creds" "docker-archive:$out" "docker://registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/mrrobot-chrome:$tag"
echo "$tag"
