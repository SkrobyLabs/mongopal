#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: $0 <semver>"
  echo "Example: $0 1.2.3"
  exit 1
fi

python3 - "$version" <<'PY'
import json
import sys
from pathlib import Path

version = sys.argv[1]
path = Path("wails.json")
data = json.loads(path.read_text())
data.setdefault("info", {})["productVersion"] = version
path.write_text(json.dumps(data, indent=2) + "\n")
PY
