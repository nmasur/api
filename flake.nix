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
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
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

        formatter = pkgs.nixfmt-tree;
      }
    );
}
