# syntax=docker/dockerfile:1

###############################################################################
# Stage 1 - build
#
# Usa l'immagine nightly (il progetto richiede nightly: vedi rust-toolchain.toml,
# simdnbt dentro azalea non compila su stable).
# Le dipendenze di sistema servono per aws-lc-sys / openssl / bevy.
###############################################################################
FROM rustlang/rust:nightly-bookworm AS builder

# Dipendenze di build native richieste da azalea (crypto + cmake).
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    pkg-config \
    libssl-dev \
    clang \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Limita il parallelismo della compilazione per non saturare la RAM su VPS
# piccoli. Di default cargo lancia 1 job per core: con azalea+bevy ogni job usa
# parecchia memoria e su una macchina con poca RAM va in OOM (il kernel uccide
# i processi e "crasha tutto"). 1 job = build piu' lenta ma stabile.
# Override a build-time:  docker build --build-arg CARGO_BUILD_JOBS=2 ...
ARG CARGO_BUILD_JOBS=1
ENV CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}
# Riduce ulteriormente il picco di RAM del linker tenendo i simboli di debug
# fuori dal passo di link (non servono in produzione).
ENV CARGO_PROFILE_RELEASE_DEBUG=0

# 1) Copia prima SOLO i manifest per sfruttare la cache dei layer Docker:
#    finche' Cargo.toml/Cargo.lock non cambiano, le dipendenze non si ricompilano.
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./

# 2) Crea un main fittizio e compila SOLO le dipendenze (layer cacheabile).
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo build --release --jobs ${CARGO_BUILD_JOBS} \
    && rm -rf src

# 3) Ora copia il codice vero e compila il binario.
#    Il touch forza la ricompilazione del nostro crate (non delle dipendenze).
COPY src ./src
RUN touch src/main.rs && cargo build --release --jobs ${CARGO_BUILD_JOBS}

###############################################################################
# Stage 2 - runtime
#
# Immagine finale minimale: solo le librerie runtime + il binario (~30-50 MB).
###############################################################################
FROM ubuntu:24.04 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia solo il binario compilato dallo stage di build.
COPY --from=builder /app/target/release/feather-bot /usr/local/bin/feather-bot

# La config viene letta da current_dir/feather_config.json (vedi src/main.rs).
# Montala come volume su /app/feather_config.json al run, cosi' la cambi senza
# ricostruire l'immagine.
#
# Avvio singolo:
#   docker run -d --name bot1 \
#     -v $(pwd)/feather_config.json:/app/feather_config.json \
#     feather-bot
ENTRYPOINT ["feather-bot"]
