#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DIR="$REPO_ROOT/.dev"
PGDATA="$DEV_DIR/pg"
PORT="5433"
DB_USER="api_actual"
DB_NAME="api_actual"

mkdir -p "$DEV_DIR"

init_db() {
  if [ -d "$PGDATA" ]; then
    echo "PostgreSQL data directory already exists at $PGDATA"
    return 0
  fi

  echo "Initializing PostgreSQL data directory at $PGDATA..."
  initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8

  echo "Starting temporary PostgreSQL instance to configure role and database..."
  pg_ctl -D "$PGDATA" -l "$DEV_DIR/postgres.log" -o "-p $PORT -k $DEV_DIR" start -w

  echo "Creating user $DB_USER and database $DB_NAME..."
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
    psql -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE ROLE $DB_USER WITH LOGIN SUPERUSER;"

  psql -h 127.0.0.1 -p "$PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    psql -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

  echo "Stopping temporary PostgreSQL instance..."
  pg_ctl -D "$PGDATA" -m fast stop
  echo "Database initialized successfully."
}

start_db() {
  if [ ! -d "$PGDATA" ]; then
    init_db
  fi

  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo "PostgreSQL is already running."
    return 0
  fi

  echo "Starting PostgreSQL on port $PORT..."
  pg_ctl -D "$PGDATA" -l "$DEV_DIR/postgres.log" -o "-p $PORT -k $DEV_DIR" start -w
  echo "PostgreSQL started. Ready to accept connections at postgresql://$DB_USER@127.0.0.1:$PORT/$DB_NAME"
}

stop_db() {
  if [ ! -d "$PGDATA" ] || ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo "PostgreSQL is not running."
    return 0
  fi

  echo "Stopping PostgreSQL..."
  pg_ctl -D "$PGDATA" -m fast stop
  echo "PostgreSQL stopped."
}

run_psql() {
  psql -h 127.0.0.1 -p "$PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

reset_db() {
  stop_db || true
  echo "Removing $PGDATA..."
  rm -rf "$PGDATA"
  init_db
}

case "${1:-help}" in
  init)
    init_db
    ;;
  start)
    start_db
    ;;
  stop)
    stop_db
    ;;
  psql)
    shift
    run_psql "$@"
    ;;
  reset)
    reset_db
    ;;
  *)
    echo "Usage: $0 {init|start|stop|psql|reset}"
    exit 1
    ;;
esac
