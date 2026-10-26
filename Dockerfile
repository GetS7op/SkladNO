# Сборка SkladNO для сервера: frontend + backend в одном образе, отдаются с одного порта.

FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM rust:1-slim-bookworm AS api
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY migrations migrations
RUN cargo build --release --locked -p skladno

FROM debian:bookworm-slim
RUN useradd --system --no-create-home skladno
COPY --from=api /src/target/release/skladno /usr/local/bin/skladno
COPY --from=web /web/dist /srv/skladno/web
ENV BIND=0.0.0.0:8090 \
    STATIC_DIR=/srv/skladno/web \
    RUST_LOG=info,sqlx=warn
USER skladno
EXPOSE 8090
CMD ["skladno"]
