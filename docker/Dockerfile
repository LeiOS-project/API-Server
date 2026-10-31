# Production image: the compiled Bun binary on a slim Debian base.
# Build the binary first (CI does this): `bun run compile linux-x64-baseline --no-version-tag`
# → build/bin/leios-api-linux-x64-baseline (AppConstants.BINARY_NAME in src/utils/constants.ts).
# Layout: binary under app/, data/ and config/ are volumes beside it. The binary embeds the Drizzle
# migrations when it was built by a Bun with `bun build --asset`; the image also copies them next to
# it as a fallback (LRA_DB_MIGRATION_DIR). Runtime config: LRA_* env (see example.env).
FROM debian:stable-slim

# Host tools the API runs at runtime: git (branding repo), dpkg/dpkg-dev/build-essential (.deb checks
# and the branding package build), gnupg (repo signing), unzip + curl (Aptly download), curl for the
# HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
		bash bzip2 build-essential ca-certificates curl dpkg dpkg-dev git gnupg openssl tar unzip \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /opt/leicraftmc/leios-api

COPY ./build/bin/leios-api-linux-x64-baseline /opt/leicraftmc/leios-api/app/leios-api
COPY ./drizzle/migrations /opt/leicraftmc/leios-api/app/drizzle/migrations

RUN chmod u+x /opt/leicraftmc/leios-api/app/leios-api

EXPOSE 12151/tcp

ENV NODE_ENV=production

ENV LRA_API_HOST=::
ENV LRA_API_PORT=12151

ENV LRA_DB_PATH=/opt/leicraftmc/leios-api/data/db.sqlite
ENV LRA_DB_AUTO_MIGRATE=true
ENV LRA_DB_MIGRATION_DIR=/opt/leicraftmc/leios-api/app/drizzle/migrations

ENV LRA_LOG_DIR=/opt/leicraftmc/leios-api/data/logs
ENV LRA_APTLY_ROOT=/opt/leicraftmc/leios-api/data/aptly
ENV LRA_BRANDING_META_FILES_DATA_PATH=/opt/leicraftmc/leios-api/data/branding-meta-files
ENV LRA_CONFIG_BASE_DIR=/opt/leicraftmc/leios-api/config
ENV LRA_PRIVATE_KEY_PATH=/opt/leicraftmc/leios-api/config/keys/private-key.gpg
ENV LRA_PUBLIC_KEY_PATH=/opt/leicraftmc/leios-api/config/keys/public-key.gpg

VOLUME /opt/leicraftmc/leios-api/data
VOLUME /opt/leicraftmc/leios-api/config

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
	CMD curl -f http://localhost:12151/health || exit 1

ENTRYPOINT ["/opt/leicraftmc/leios-api/app/leios-api"]
