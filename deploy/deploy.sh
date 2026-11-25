#!/usr/bin/env bash
# Deploy Propi on haiku-vps. Run from your machine: ssh haiku-vps 'bash -s' < deploy/deploy.sh [branch]
# Builds images from the public GitHub repo, pushes them to the VPS-local registry,
# installs the Traefik route and (re)deploys the swarm stack "propi". Touches nothing else.
set -euo pipefail
BRANCH="${1:-feat/core}"
ROOT=/opt/propi
mkdir -p "$ROOT"
if [ ! -d "$ROOT/src/.git" ]; then
  git clone --quiet https://github.com/stivenrosales/propi.git "$ROOT/src"
fi
cd "$ROOT/src"
git fetch --quiet origin
git checkout --quiet "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
TAG="$(git rev-parse --short HEAD)"
docker build --quiet -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=https://propi.swnb5v.easypanel.host \
  -t "127.0.0.1:5000/propi-web:$TAG" -t 127.0.0.1:5000/propi-web:latest .
docker push --quiet "127.0.0.1:5000/propi-web:$TAG" >/dev/null
docker push --quiet 127.0.0.1:5000/propi-web:latest >/dev/null
install -m 0644 deploy/traefik-propi.yaml /etc/easypanel/traefik/config/propi.yaml
PROPI_TAG="$TAG" docker stack deploy --with-registry-auth --detach=false -c deploy/stack.yml propi
echo "deployed propi@$TAG"
