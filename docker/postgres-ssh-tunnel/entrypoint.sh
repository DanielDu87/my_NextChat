#!/bin/sh
set -eu

: "${SSH_TUNNEL_HOST:?missing SSH_TUNNEL_HOST}"
: "${SSH_TUNNEL_PORT:=22}"
: "${SSH_TUNNEL_USER:?missing SSH_TUNNEL_USER}"
: "${SSH_TUNNEL_PASSWORD:?missing SSH_TUNNEL_PASSWORD}"
: "${SSH_TUNNEL_REMOTE_HOST:=127.0.0.1}"
: "${SSH_TUNNEL_REMOTE_PORT:=5432}"
: "${SSH_TUNNEL_LOCAL_PORT:=5432}"

exec sshpass -p "${SSH_TUNNEL_PASSWORD}" \
  ssh \
  -N \
  -g \
  -o StrictHostKeyChecking=no \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "0.0.0.0:${SSH_TUNNEL_LOCAL_PORT}:${SSH_TUNNEL_REMOTE_HOST}:${SSH_TUNNEL_REMOTE_PORT}" \
  -p "${SSH_TUNNEL_PORT}" \
  "${SSH_TUNNEL_USER}@${SSH_TUNNEL_HOST}"
