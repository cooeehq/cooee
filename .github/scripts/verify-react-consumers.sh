#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
consumer_root="$(mktemp -d)"
trap 'rm -rf "$consumer_root"' EXIT

npm pack \
  --pack-destination "$consumer_root" \
  "$repository_root/packages/embed-react" >/dev/null

package_tarball="$(find "$consumer_root" -maxdepth 1 -name 'cooeehq-react-*.tgz' -print -quit)"
test -n "$package_tarball"

for react_major in 18 19; do
  consumer_directory="$consumer_root/react-$react_major"
  mkdir -p "$consumer_directory/src"
  cd "$consumer_directory"

  npm init --yes >/dev/null
  npm pkg set type=module scripts.build="vite build" >/dev/null
  npm install --no-package-lock \
    "$package_tarball" \
    "react@$react_major" \
    "react-dom@$react_major" \
    "@types/react@$react_major" \
    "@types/react-dom@$react_major" \
    typescript@5.9.3 \
    vite@6.4.3 >/dev/null

  cat > index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Cooee consumer</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
HTML

  cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["src"]
}
JSON

  cat > src/main.tsx <<'TSX'
import { CooeeUpdates, type CooeeUpdatesProps } from "@cooeehq/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const props: CooeeUpdatesProps = {
  feedUrl: "https://cooee.sh/api/public/changelogs/example/feed.json",
  labels: { viewAll: "View every update" },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode><CooeeUpdates {...props} /></StrictMode>,
);
TSX

  npx tsc --project tsconfig.json
  npm run build >/dev/null
  echo "React $react_major consumer passed NodeNext type resolution and production build."
done
