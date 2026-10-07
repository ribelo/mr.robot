# Chrome for a Robot's browser in a Cloudflare Container (v1.1 tickets 02, 03).
# Built with Nix's dockerTools so no Docker daemon is needed: nix-build infra/chrome/image.nix
{ pkgs ? import <nixpkgs> { } }:
let
  start = pkgs.writeShellScriptBin "start" ''
    set -eu
    export PATH=${pkgs.coreutils}/bin:${pkgs.socat}/bin:${pkgs.wireproxy}/bin:${pkgs.chromium}/bin:$PATH
    mkdir -p /tmp/profile
    proxy=""
    # Container Chrome via VPN: the Home's Proton WireGuard config arrives as WG_CONFIG; wireproxy
    # runs it in userspace (no privileges) and offers a local SOCKS5 proxy Chrome uses.
    if [ -n "''${WG_CONFIG:-}" ]; then
      printf '%s\n' "$WG_CONFIG" > /tmp/wg.conf
      printf '[Socks5]\nBindAddress = 127.0.0.1:1080\n' >> /tmp/wg.conf
      wireproxy -c /tmp/wg.conf &
      sleep 2
      proxy="--proxy-server=socks5://127.0.0.1:1080"
    fi
    # DevTools listens on loopback only; socat makes it reachable on the container port.
    socat TCP-LISTEN:9222,fork,reuseaddr TCP:127.0.0.1:9223 &
    exec chromium \
      --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check \
      --disable-blink-features=AutomationControlled --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223 \
      --remote-allow-origins='*' --user-data-dir=/tmp/profile --window-size=1280,800 --lang=pl-PL \
      --user-agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' \
      $proxy about:blank
  '';
in
pkgs.dockerTools.buildLayeredImage {
  name = "mrrobot-chrome";
  tag = "latest";
  contents = [ start pkgs.chromium pkgs.socat pkgs.wireproxy pkgs.bashInteractive pkgs.coreutils pkgs.cacert pkgs.fontconfig pkgs.dejavu_fonts pkgs.noto-fonts pkgs.noto-fonts-cjk-sans pkgs.noto-fonts-color-emoji ];
  extraCommands = "mkdir -p tmp && chmod 1777 tmp";
  config = {
    Cmd = [ "/bin/start" ];
    ExposedPorts = { "9222/tcp" = { }; };
    Env = [ "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt" "FONTCONFIG_FILE=${pkgs.fontconfig.out}/etc/fonts/fonts.conf" "HOME=/tmp" "PATH=/bin" ];
  };
}
