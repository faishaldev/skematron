#!/bin/sh
# Disposable PostgreSQL cluster for the integration tests, kept in .local/ (git-ignored).
# It never touches any other PostgreSQL server: its own data directory, no TCP listener,
# a Unix socket only the current OS user can open (trust auth for that user), port 54329.
#
#   sh scripts/test-postgres.sh start   # first run initializes; creates skematron_test; writes .env if missing
#   sh scripts/test-postgres.sh seed    # (re)creates a sample "demo" schema in skematron_test
#   sh scripts/test-postgres.sh stop
#
# Requires PostgreSQL 14+ server binaries (initdb, pg_ctl) on PATH, e.g. from Homebrew.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
dir="$root/.local/postgres"
port=54329
url="postgresql:///skematron_test?host=$dir&port=$port"

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
    if ! psql -h "$dir" -p "$port" -d postgres -Atc \
      "SELECT 1 FROM pg_database WHERE datname = 'skematron_test'" | grep -qx 1; then
      createdb -h "$dir" -p "$port" skematron_test
    fi
    if [ ! -f "$root/.env" ]; then
      echo "SKEMATRON_TEST_DATABASE_URL=$url" >"$root/.env"
      echo "Wrote .env"
    fi
    echo "Test PostgreSQL is running: SKEMATRON_TEST_DATABASE_URL=$url"
    ;;
  seed)
    if ! pg_ctl --pgdata="$dir/data" status >/dev/null 2>&1; then
      echo "Test PostgreSQL is not running. Run: pnpm db:test:start" >&2
      exit 1
    fi
    fixture="$root/packages/adapters/src/postgres/fixtures/v1.sql"
    {
      echo "SET client_min_messages = warning;"
      echo "DROP SCHEMA IF EXISTS demo CASCADE;"
      echo "CREATE SCHEMA demo;"
      sed 's/__SCHEMA__/demo/g' "$fixture"
    } | psql -h "$dir" -p "$port" -d skematron_test -v ON_ERROR_STOP=1 -q
    echo "Loaded a sample \"demo\" schema into skematron_test (from fixtures/v1.sql)."
    ;;
  stop)
    pg_ctl --pgdata="$dir/data" --mode=fast stop
    ;;
  *)
    echo "usage: sh scripts/test-postgres.sh start|seed|stop" >&2
    exit 64
    ;;
esac
