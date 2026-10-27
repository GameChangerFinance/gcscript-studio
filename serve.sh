#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
exec pnpm dev --port "${1:-8000}"
