# syntax=docker/dockerfile:1
# The card game server with its web client baked in. One port: 3030.

FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM rust:1-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
# The commit being built (deploy/update.sh passes it), which the server
# reports at /version and the bot worker names in its hello.
ARG GIT_COMMIT=
ENV GIT_COMMIT=$GIT_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p server && cp target/release/server /server \
    && mkdir /data

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /server /usr/local/bin/server
COPY --from=web /web/dist /srv/web
# Saved tables; mount a volume here so they outlive the container.
COPY --from=server --chown=nonroot:nonroot /data /data
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["server", "--addr", "0.0.0.0:3030", "--healthcheck"]
ENTRYPOINT ["server", "--addr", "0.0.0.0:3030", "--web", "/srv/web", "--data", "/data"]
