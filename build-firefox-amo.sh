#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

required_node_major=24
actual_node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "$actual_node_major" -ne "$required_node_major" ]; then
  echo "MindEase AMO build requires Node.js 24.x; found $(node --version)." >&2
  exit 1
fi

# The submitted build contains only this public build-time endpoint. Provider
# credentials are entered by users at runtime and must never be bundled.
unset VITE_DEEPSEEK_API_KEY VITE_NAPKIN_API_KEY VITE_OCR_SPACE_API_KEY
unset VITE_MURF_API_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY
export VITE_PREMIUM_API_URL="https://mindease-api.redcliff-7cf35a59.germanywestcentral.azurecontainerapps.io"

npm ci
npm run build:firefox

rm -f dist/mindease-firefox.zip
(
  cd dist/firefox
  zip -qr ../mindease-firefox.zip .
)

echo "Built dist/mindease-firefox.zip"
