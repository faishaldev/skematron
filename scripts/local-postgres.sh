#!/bin/sh
# Disposable local PostgreSQL cluster for development and tests, kept in .local/ (git-ignored).
# It never touches any other PostgreSQL server: its own data directory, no TCP listener,
# a Unix socket only the current OS user can open (trust auth for that user), port 54329.
#
# Databases:
#   skematron       Skematron's own metadata database (SKEMATRON_DATABASE_URL)
#   skematron_test  integration tests and the sample "demo" schema (SKEMATRON_TEST_DATABASE_URL)
#
#   sh scripts/local-postgres.sh start     # first run initializes; adds missing .env keys
#   sh scripts/local-postgres.sh seed      # (re)creates a sample "demo" schema in skematron_test
#   sh scripts/local-postgres.sh seed v2   # the same, from the changed version (to try Compare)
#   sh scripts/local-postgres.sh stop
#
# Requires PostgreSQL 14+ server binaries (initdb, pg_ctl) on PATH, e.g. from Homebrew.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
dir="$root/.local/postgres"
port=54329
user=$(id -un)
env_file="$root/.env"

# Adds KEY=VALUE to .env unless KEY is already set there. Never overwrites.
ensure_env() {
  if [ ! -f "$env_file" ] || ! grep -q "^$1=" "$env_file"; then
    echo "$1=$2" >>"$env_file"
    echo "Added $1 to .env"
  fi
}

ensure_database() {
  if ! psql -h "$dir" -p "$port" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$1'" | grep -qx 1; then
    createdb -h "$dir" -p "$port" "$1"
  fi
}

case "${1:-}" in
  start)
    if [ ! -f "$dir/data/PG_VERSION" ]; then
      mkdir -p "$dir"
      initdb --pgdata="$dir/data" --auth=trust --locale=C --encoding=UTF8 --no-instructions >/dev/null
    fi
    if ! pg_ctl --pgdata="$dir/data" status >/dev/null 2>&1; then
      pg_ctl --pgdata="$dir/data" --log="$dir/postgres.log" --wait \
        -o "-p $port -k '$dir' -c listen_addresses='' -c unix_socket_permissions=0700" start >/dev/null
    fi
    ensure_database skematron
    ensure_database skematron_test
    ensure_env SKEMATRON_TEST_DATABASE_URL "postgresql:///skematron_test?host=$dir&port=$port"
    ensure_env SKEMATRON_DATABASE_URL "postgresql://$user@localhost:$port/skematron?host=$dir"
    ensure_env SKEMATRON_SECRET_KEY "$(openssl rand -base64 32)"
    ensure_env BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
    ensure_env BETTER_AUTH_URL "http://127.0.0.1:3100"
    echo "Local PostgreSQL is running (socket $dir, port $port)."
    ;;
  seed)
    if ! pg_ctl --pgdata="$dir/data" status >/dev/null 2>&1; then
      echo "Local PostgreSQL is not running. Run: pnpm db:start" >&2
      exit 1
    fi
    version="${2:-v1}"
    case "$version" in
      v1 | v2) ;;
      *)
        echo "usage: sh scripts/local-postgres.sh seed [v1|v2]" >&2
        exit 64
        ;;
    esac
    fixture="$root/packages/adapters/src/postgres/fixtures/$version.sql"
    {
      echo "SET client_min_messages = warning;"
      echo "DROP SCHEMA IF EXISTS demo CASCADE;"
      echo "CREATE SCHEMA demo;"
      sed 's/__SCHEMA__/demo/g' "$fixture"
    } | psql -h "$dir" -p "$port" -d skematron_test -v ON_ERROR_STOP=1 -q
    echo "Loaded a sample \"demo\" schema into skematron_test (from fixtures/$version.sql)."
    ;;
  stop)
    pg_ctl --pgdata="$dir/data" --mode=fast stop
    ;;
  *)
    echo "usage: sh scripts/local-postgres.sh start|seed [v1|v2]|stop" >&2
    exit 64
    ;;
esac
