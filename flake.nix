{
  description = "Mr. Robot";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # The host app (v1.2 ticket 04): nix build .#host, or add it to environment.systemPackages.
      packages = forAll (pkgs: {
        host = import ./apps/host/package.nix { inherit pkgs; };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.host;
      });
    };
}
