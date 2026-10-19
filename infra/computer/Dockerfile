# A Robot's computer (v1.14 ticket 10, ao-8x0c, ao-h1wn): one image, chosen here, built and pushed by the deploy.
# The base is Cloudflare's Sandbox python image: Ubuntu 22.04, Python 3.11 with NumPy, Pandas, matplotlib and
# IPython, Node 24, Bun, git, curl, jq and inotify-tools. Mr. Robot runs commands with the Container exec API,
# so the base's control server is replaced by an idle main process.
FROM docker.io/cloudflare/sandbox:0.12.10-python
ENTRYPOINT []
WORKDIR /workspace
CMD ["sleep", "infinity"]
