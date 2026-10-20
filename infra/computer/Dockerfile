# A Robot's Box (v1.14 ticket 10, the Computer until v1.15, ao-8x0c, ao-h1wn; v1.16 ticket 07, ob-asp3): one image, chosen here,
# built and pushed by the deploy. The base is Cloudflare's Sandbox python image: Ubuntu 22.04, Python 3.11 under /usr/local/python
# with NumPy, Pandas, matplotlib, IPython and Pillow, Node 22, Bun, git, curl and jq. Mr. Robot runs commands with the Container exec
# API, so the base's control server is replaced by an idle main process.
# box-manifest.sh runs last and writes /etc/box-manifest.json; the deploy turns it into docs/box.md's tool list (infra/box-tools.ts).
# Alchemy builds this image from this directory and pushes it. What is pinned here (the base image by tag, sd by checksum, the pip packages and
# pnpm by version) is the same in every build; the apt packages are the Ubuntu 22.04 archive's, and the dependencies of the pip packages float.
# infra/box-tools.ts records a hash of this directory with the tool list, and the plan test fails when the two differ.
FROM docker.io/cloudflare/sandbox:0.12.10-python

# Ubuntu 22.04 has no yq or sd package: yq comes from PyPI and sd from its release, below. fd-find installs as fdfind.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ripgrep fd-find less tree file \
      tar gzip xz-utils zip unzip zstd wget sqlite3 \
      ffmpeg imagemagick poppler-utils \
      build-essential python3-dev \
      locales tzdata procps iproute2 \
 && ln -s /usr/bin/fdfind /usr/local/bin/fd \
 && locale-gen en_US.UTF-8 pl_PL.UTF-8 \
 && rm -rf /var/lib/apt/lists/*

# Pinned to the versions the tool list in docs/box.md reports (their dependencies are not pinned).
RUN pip3 install --no-cache-dir \
      requests==2.34.2 httpx==0.28.1 openpyxl==3.1.5 python-docx==1.2.0 pypdf==6.21.1 Pillow==12.3.0 beautifulsoup4==4.15.0 \
      lxml==6.1.3 pyyaml==6.0.3 polars==2.0.0 yq==4.4.5 uv==0.13.3

RUN curl -fsSL -o /tmp/sd.tar.gz https://github.com/chmln/sd/releases/download/v1.1.0/sd-v1.1.0-x86_64-unknown-linux-musl.tar.gz \
 && echo "02f00f4777d43e8e95b7b8d49e1a0d6e502fed4b8e79c1c8b8063857a30caa2e  /tmp/sd.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/sd.tar.gz -C /tmp \
 && install -m 0755 /tmp/sd-v1.1.0-x86_64-unknown-linux-musl/sd /usr/local/bin/sd \
 && rm -rf /tmp/sd.tar.gz /tmp/sd-v1.1.0-x86_64-unknown-linux-musl

# pnpm through corepack. The base ships corepack without a link on the PATH, so the link is made here.
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && corepack enable pnpm \
 && corepack prepare pnpm@12.14.0 --activate

# ws (v1.16 ticket 06): the Box's way to its Workspace. One Bun script; its token and the Worker's address are written to
# /run/mr-robot/ when the Box boots.
COPY ws.ts ws-core.ts /tmp/ws/
RUN bun build /tmp/ws/ws.ts --target=bun --outfile=/usr/local/bin/ws && chmod +x /usr/local/bin/ws && rm -rf /tmp/ws

# The Python tools (uv, the yq and ipython commands) are in /usr/local/python/bin, the directory the Box's commands search first.
# The uv and Bun caches live under box/ (ob-phi5), so a second boot finds the packages the first one fetched.
ENV PATH=/usr/local/python/bin:$PATH \
    UV_CACHE_DIR=/workspace/box/.cache/uv \
    BUN_INSTALL_CACHE_DIR=/workspace/box/.cache/bun

COPY box-manifest.sh /tmp/box-manifest.sh
RUN bash /tmp/box-manifest.sh /etc/box-manifest.json && rm /tmp/box-manifest.sh

ENTRYPOINT []
WORKDIR /workspace
CMD ["sleep", "infinity"]
