{
  description = "3D RIMU map";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      apps = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };

          ci = pkgs.writeShellApplication {
            name = "rimu-ci";
            runtimeInputs = [ pkgs.nodejs_24 ];
            text = ''
              npm ci --no-audit --no-fund
              ./node_modules/.bin/playwright install chromium
              npm test
            '';
          };
        in
        {
          ci = {
            type = "app";
            program = "${ci}/bin/rimu-ci";
          };
          default = {
            type = "app";
            program = "${ci}/bin/rimu-ci";
          };
          test = {
            type = "app";
            program = "${ci}/bin/rimu-ci";
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_24 ];
          };
        }
      );
    };
}
