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

  nativeBuildInputs = [ pkgs.nodejs_24 pnpm pkgs.pnpmConfigHook pkgs.makeWrapper pkgs.copyDesktopItems pkgs.patchelf ];

  pnpmWorkspaces = [ "@mr-robot/host..." ];
  pnpmDeps = pkgs.fetchPnpmDeps {
    inherit (finalAttrs) pname version src pnpmWorkspaces;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-ltOdpwc8rhGN37d/kvbb6qeNjRaBAB/r0aVHKpNopDY=";
  };

  buildPhase = ''
    runHook preBuild
    (cd apps/host && node build.mjs)
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/mr-robot-host
    cp apps/host/dist/main.cjs apps/host/dist/preload.cjs apps/host/dist/window.html apps/host/dist/shell-check.cjs $out/share/mr-robot-host/
    # DSH's Landlock launcher (build.mjs copies it beside the bundle); the app points DSH at it.
    cp apps/host/dist/landlock-run $out/share/mr-robot-host/
    # DSH's process runner and koffi, which start every command in a systemd scope of its own (build.mjs).
    cp -r apps/host/dist/runners apps/host/dist/node_modules $out/share/mr-robot-host/
    # koffi's prebuilt binary needs libstdc++, which Electron does not load (Node does); the musl build is of no use here.
    rm -rf $out/share/mr-robot-host/node_modules/@koromix/*/musl_*
    for binary in $out/share/mr-robot-host/node_modules/@koromix/*/*/koffi.node; do
      patchelf --add-rpath ${lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ]} "$binary"
    done
    # Autostart entries run the command from the user's profile, so they survive updates.
    makeWrapper ${pkgs.electron}/bin/electron $out/bin/mr-robot-host \
      --add-flags $out/share/mr-robot-host/main.cjs \
      --set MR_ROBOT_HOST_EXEC mr-robot-host \
      --prefix PATH : ${lib.makeBinPath [ pkgs.bubblewrap pkgs.systemd ]}
    # The shell check of the installed app (src/shell-check.ts), with the app's program as Node.
    makeWrapper ${pkgs.electron}/bin/electron $out/bin/mr-robot-host-shell-check \
      --add-flags $out/share/mr-robot-host/shell-check.cjs \
      --set ELECTRON_RUN_AS_NODE 1 \
      --prefix PATH : ${lib.makeBinPath [ pkgs.bubblewrap pkgs.systemd ]}
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
