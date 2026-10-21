# The Mr. Robot Host app as a NixOS service (v1.21 ticket 09, cw-dr33): an always-on Host with no window and no display.
#
#   imports = [ (mr-robot + "/infra/host/module.nix") ];   # or the flake's nixosModules.host
#   services.mr-robot-host.enable = true;
#
# Then pair it once as its user:  sudo -u mr-robot-host mr-robot-host pair <server>
# Robots act on this computer as that user: it is the real boundary (docs/hosts.md).
{ config, lib, pkgs, ... }:
let
  cfg = config.services.mr-robot-host;
  inherit (lib) mkEnableOption mkIf mkOption types;
in
{
  options.services.mr-robot-host = {
    enable = mkEnableOption "the Mr. Robot Host app as a service";
    package = mkOption {
      type = types.package;
      default = import ../../apps/host/package.nix { inherit pkgs; };
      description = "The Host app package.";
    };
    user = mkOption {
      type = types.str;
      default = "mr-robot-host";
      description = "The OS user the Robots act as. The default user is made for the service, with its home in /var/lib/mr-robot-host.";
    };
    home = mkOption {
      type = types.str;
      default = "/var/lib/mr-robot-host";
      description = "The user's home: the Robots' directories (~/mr-robot/<robot>/) and the app's config (~/.config/mr-robot-host) are in it.";
    };
    packages = mkOption {
      type = types.listOf types.package;
      default = with pkgs; [ git bash coreutils ];
      description = "Programs on the commands' PATH, besides the user's own profile.";
    };
  };

  config = mkIf cfg.enable {
    users.users = mkIf (cfg.user == "mr-robot-host") {
      mr-robot-host = { isSystemUser = true; group = "mr-robot-host"; home = cfg.home; createHome = true; shell = pkgs.bashInteractive; };
    };
    users.groups = mkIf (cfg.user == "mr-robot-host") { mr-robot-host = { }; };
    # bubblewrap confines the Robots' commands in user namespaces.
    security.unprivilegedUsernsClone = lib.mkDefault true;

    systemd.services.mr-robot-host = {
      description = "Mr. Robot Host (service)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = [ cfg.package pkgs.bubblewrap ] ++ cfg.packages;
      environment.HOME = cfg.home;
      serviceConfig = {
        User = cfg.user;
        ExecStart = "${cfg.package}/bin/mr-robot-host --service";
        Restart = "always";
        RestartSec = 5;
        # A stop: the app tells the server it stops (the Robots hear their jobs end), then its processes go.
        KillSignal = "SIGTERM";
        KillMode = "mixed";
        TimeoutStopSec = 30;
      };
    };
  };
}
