#!/bin/sh
# Shared helper: resolve DATABASE_URL.
#
# Builds DATABASE_URL from POSTGRES_PASSWORD (+ optional component overrides)
# unless the caller has supplied a complete DATABASE_URL of their own. Sourced
# by both entrypoint.sh (server start) and migrate.sh (one-shot migration job)
# so the URL is assembled identically in either path.
#
# Rationale: a Postgres password is part of the userinfo segment of a URI and
# MUST be percent-encoded (RFC 3986). Embedding the raw password in a string
# (`postgresql://user:${POSTGRES_PASSWORD}@host/db`) silently corrupts the
# connection string whenever the password contains `/`, `+`, `=`, `@`, `?`,
# `#`, `:`, `%`, or space. Postgres itself accepts those characters fine, but
# `openssl rand -base64 32` produces `/` and `+` ~25% of the time, so the
# breakage is easy to hit in practice. Prisma reports this as a cryptic
# `P1013: invalid port number in database URL`.
#
# Constructing the URL here, with `encodeURIComponent` from the runtime that
# is already in the image, removes the footgun without forcing users to
# percent-encode their passwords by hand.
resolve_database_url() {
    if [ -n "${DATABASE_URL:-}" ]; then
        return 0
    fi

    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        echo "ERROR: either DATABASE_URL or POSTGRES_PASSWORD must be set." >&2
        exit 1
    fi

    PG_USER="${POSTGRES_USER:-vectorflow}"
    PG_HOST="${POSTGRES_HOST:-postgres}"
    PG_PORT="${POSTGRES_PORT:-5432}"
    PG_DB="${POSTGRES_DB:-vectorflow}"

    DATABASE_URL=$(
        VF_PG_USER="$PG_USER" \
        VF_PG_PASS="$POSTGRES_PASSWORD" \
        VF_PG_HOST="$PG_HOST" \
        VF_PG_PORT="$PG_PORT" \
        VF_PG_DB="$PG_DB" \
        node -e '
            const enc = encodeURIComponent;
            const u = enc(process.env.VF_PG_USER);
            const p = enc(process.env.VF_PG_PASS);
            // Bracket bare IPv6 literals so `host:port` parses correctly.
            // (RFC 3986 §3.2.2: IP-literal = "[" IPv6address "]".)
            let host = process.env.VF_PG_HOST;
            if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
            const port = process.env.VF_PG_PORT;
            const db = enc(process.env.VF_PG_DB);
            process.stdout.write(`postgresql://${u}:${p}@${host}:${port}/${db}`);
        '
    )
    export DATABASE_URL
}
