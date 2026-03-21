#!/bin/sh

set -eu

BUILDX_CONFIG_DIR="${BUILDX_CONFIG:-/tmp/nextchat-docker-buildx}"
mkdir -p "$BUILDX_CONFIG_DIR"

export BUILDX_CONFIG="$BUILDX_CONFIG_DIR"

exec docker compose "$@"
