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
docker build --quiet -f apps/server/Dockerfile \
  -t "127.0.0.1:5000/propi-server:$TAG" -t 127.0.0.1:5000/propi-server:latest .
for img in propi-web propi-server; do
  docker push --quiet "127.0.0.1:5000/$img:$TAG" >/dev/null
  docker push --quiet "127.0.0.1:5000/$img:latest" >/dev/null
done
if [ ! -f "$ROOT/propi.env" ]; then
  echo "missing $ROOT/propi.env (copy deploy/propi.env.example and fill it in)" >&2
  exit 1
fi
install -m 0644 deploy/traefik-propi.yaml /etc/easypanel/traefik/config/propi.yaml
PROPI_TAG="$TAG" docker stack deploy --with-registry-auth --detach=true -c deploy/stack.yml propi
for i in $(seq 1 60); do
  web=$(docker service ls --filter name=propi_web --format '{{.Replicas}}')
  srv=$(docker service ls --filter name=propi_server --format '{{.Replicas}}')
  img=$(docker service inspect propi_web --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')
  if [ "$web" = "1/1" ] && [ "$srv" = "1/1" ] && [ "${img%%@*}" = "127.0.0.1:5000/propi-web:$TAG" ]; then
    echo "deployed propi@$TAG (web $web, server $srv)"; exit 0
  fi
  sleep 5
done
echo "propi@$TAG did not converge in 5 minutes" >&2; exit 1
