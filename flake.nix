{
  description = "A generic self-hosted REST API service";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    flake-utils.lib.eachSystem supportedSystems (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ self.overlays.default ];
        };
      in
      {
        packages = rec {
          api-actual = pkgs.api-actual;
          default = api-actual;
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            typescript-language-server
            postgresql_15
            nixfmt
            prefetch-npm-deps
          ];

          shellHook = ''
            export PORT=''${PORT:-4100}
            export STATE_DIR=''${STATE_DIR:-"$PWD/.dev/state"}
            export DATABASE_URL=''${DATABASE_URL:-"postgresql://api_actual@127.0.0.1:5433/api_actual"}
            mkdir -p "$STATE_DIR"
          '';
        };

        checks = {
          api-actual = pkgs.api-actual;
        }
        // (pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          actual-vm = pkgs.callPackage ./nix/checks/actual-vm.nix { inherit self; };
        });

        formatter = pkgs.nixfmt-tree;
      }
    )
    // {
      overlays.default = import ./nix/overlay.nix;
      nixosModules.default = import ./nix/modules;
    };
}
