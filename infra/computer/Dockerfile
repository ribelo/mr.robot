# A Robot's Box (v1.14 ticket 10, the Computer until v1.15, ao-8x0c, ao-h1wn): one image, chosen here, built and pushed by the deploy.
# The base is Cloudflare's Sandbox python image: Ubuntu 22.04, Python 3.11 with NumPy, Pandas, matplotlib and
# IPython, Node 24, Bun, git, curl, jq and inotify-tools. Mr. Robot runs commands with the Container exec API,
# so the base's control server is replaced by an idle main process.
FROM docker.io/cloudflare/sandbox:0.12.10-python

# ws (v1.16 ticket 06): the Box's way to its Workspace. One Bun script; its token and the Worker's address are written to
# /run/mr-robot/ when the Box boots.
COPY ws.ts ws-core.ts /tmp/ws/
RUN bun build /tmp/ws/ws.ts --target=bun --outfile=/usr/local/bin/ws && chmod +x /usr/local/bin/ws && rm -rf /tmp/ws

ENTRYPOINT []
WORKDIR /workspace
CMD ["sleep", "infinity"]
