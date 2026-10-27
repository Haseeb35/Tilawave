#!/bin/sh
# Runs every test suite against the local server (python3 -m http.server 8000 in the project folder).
# Needs Google Chrome and Node 22+.
cd "$(dirname "$0")"
for t in *.test.mjs; do
  printf "%-28s " "$t"
  node "$t" 2>&1 | grep -E "^FAIL|[0-9]+ passed, [0-9]+ failed|failing pages" | tr '\n' ' '
  echo
done
