# syntax=docker/dockerfile:1
# The card game server with its web client baked in. One port: 3030.
#
# Base images are pinned by digest, each under the tag it was taken from
# (2026-10-06), so a rebuild gets the same bytes. To move one, look up the
# tag's current digest (`docker buildx imagetools inspect <tag>`) and put
# it here.

# node:24-bookworm-slim
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# rust:1-bookworm (at least Cargo.toml's rust-version)
FROM rust:1-bookworm@sha256:59037199c44290f2befcdd58dcc540164763fc296950255aaefeef096a1866b0 AS server
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

# gcr.io/distroless/cc-debian12:nonroot
FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f
COPY --from=server /server /usr/local/bin/server
COPY --from=web /web/dist /srv/web
# Saved tables; mount a volume here so they outlive the container.
COPY --from=server --chown=nonroot:nonroot /data /data
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["server", "--addr", "0.0.0.0:3030", "--healthcheck"]
ENTRYPOINT ["server", "--addr", "0.0.0.0:3030", "--web", "/srv/web", "--data", "/data"]
