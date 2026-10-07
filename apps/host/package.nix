# The Mr. Robot host app for NixOS (v1.2 ticket 04): nix-build apps/host/package.nix
# Builds the app from this pnpm workspace and wraps it with nixpkgs' Electron.
{ pkgs ? import <nixpkgs> { } }:
let
  inherit (pkgs) lib;
  pnpm = pkgs.pnpm_11 or pkgs.pnpm;
  root = ../..;
  # Only what the host app needs: the workspace manifests, the lockfile, its sources and the shared protocol.
  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      (root + "/package.json")
      (root + "/pnpm-lock.yaml")
      (root + "/pnpm-workspace.yaml")
      (root + "/patches")
      (root + "/tsconfig.base.json")
      (lib.fileset.fileFilter (file: file.name == "package.json") (root + "/apps"))
      (lib.fileset.fileFilter (file: file.name == "package.json") (root + "/packages"))
      (root + "/apps/host/build.mjs")
      (root + "/apps/host/src")
      (root + "/packages/host-protocol/src")
    ];
  };
in
pkgs.stdenv.mkDerivation (finalAttrs: {
  pname = "mr-robot-host";
  version = "0.1.0";
  inherit src;

  nativeBuildInputs = [ pkgs.nodejs_24 pnpm pkgs.pnpmConfigHook pkgs.makeWrapper pkgs.copyDesktopItems ];

  pnpmWorkspaces = [ "@mr-robot/host..." ];
  pnpmDeps = pkgs.fetchPnpmDeps {
    inherit (finalAttrs) pname version src pnpmWorkspaces;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-BhM2on0VXe777h4pL3uLBh9CadSFX4blM0L4kafwJZw=";
  };

  buildPhase = ''
    runHook preBuild
    (cd apps/host && node build.mjs)
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/mr-robot-host
    cp apps/host/dist/main.cjs apps/host/dist/preload.cjs apps/host/dist/window.html $out/share/mr-robot-host/
    # Autostart entries run the command from the user's profile, so they survive updates.
    makeWrapper ${pkgs.electron}/bin/electron $out/bin/mr-robot-host \
      --add-flags $out/share/mr-robot-host/main.cjs \
      --set MR_ROBOT_HOST_EXEC mr-robot-host
    runHook postInstall
  '';

  desktopItems = [
    (pkgs.makeDesktopItem {
      name = "mr-robot-host";
      desktopName = "Mr. Robot host";
      comment = "Lets your robots use this computer";
      exec = "mr-robot-host";
      categories = [ "Utility" ];
    })
  ];

  meta = {
    description = "Mr. Robot host app: lets your robots use this computer (files, shell, Chrome)";
    mainProgram = "mr-robot-host";
    platforms = lib.platforms.linux;
  };
})
