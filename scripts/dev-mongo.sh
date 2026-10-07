#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.tools/mongo-data"
LOG="$ROOT/.tools/mongod.log"
mkdir -p "$DATA"
MONGOD="$(find "$ROOT/.tools" -type f -name mongod | head -n 1)"
if [ -z "$MONGOD" ]; then
  echo "MongoDB is not in .tools. Download the macOS tarball from https://www.mongodb.com/try/download/community and extract it there." >&2
  exit 1
fi
if python3 -c "import socket; socket.create_connection(('127.0.0.1', 27017), 1).close()" >/dev/null 2>&1; then
  echo "MongoDB is already accepting connections on port 27017."
  exit 0
fi
"$MONGOD" --replSet rs0 --bind_ip 127.0.0.1 --port 27017 --dbpath "$DATA" --fork --logpath "$LOG"
echo "Started MongoDB. Initiate the replica set once with: python scripts/initiate_replica.py"
