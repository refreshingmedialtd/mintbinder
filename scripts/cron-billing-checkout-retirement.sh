#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Retire hosted checkout links as soon as their 30-minute application lease has
# expired. Provider truth is checked before a link/session is closed.
npm run job:live-billing-checkout-retirement
