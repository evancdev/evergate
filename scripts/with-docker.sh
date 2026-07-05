#!/usr/bin/env sh
# Bring up a local Docker runtime (OrbStack) if none is running, point the
# integration tests at its socket, then run whatever command was passed.
set -e

SOCKET="$HOME/.orbstack/run/docker.sock"

if ! docker version >/dev/null 2>&1; then
  command -v open >/dev/null 2>&1 || {
    echo "No Docker runtime up, and can't start one automatically. Start Docker and retry." >&2
    exit 1
  }
  echo "No Docker runtime up; starting OrbStack…"
  open -a OrbStack
  i=0
  while [ "$i" -lt 60 ]; do
    if docker version >/dev/null 2>&1; then break; fi
    i=$((i + 1))
    sleep 1
  done
  docker version >/dev/null 2>&1 || {
    echo "Started OrbStack but its Docker socket never came up." >&2
    exit 1
  }
fi

# testcontainers doesn't always read the Docker context; hand it the socket, but
# only when a daemon actually answers there — a stale socket file must not
# hijack an otherwise-working Docker.
if [ -z "$DOCKER_HOST" ] && docker -H "unix://$SOCKET" version >/dev/null 2>&1; then
  export DOCKER_HOST="unix://$SOCKET"
fi

exec "$@"
