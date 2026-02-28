{
  description = "Lattice - runtime enforcement and identity infrastructure for autonomous AI agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        lattice = pkgs.stdenv.mkDerivation rec {
          pname = "lattice";
          version = self.rev or self.dirtyRev or "dev";

          src = ./.;

          nativeBuildInputs = with pkgs; [
            bun
            nodejs
            makeWrapper
            gnumake
            git # Needed by scripts/generate-version.sh
            python3 # Needed by node-gyp for native module builds
          ];

          buildInputs = with pkgs; [
            electron
            stdenv.cc.cc.lib # Provides libstdc++ for native modules like sharp
          ];

          # Fetch dependencies in a separate fixed-output derivation
          # Use only package.json and bun.lock to ensure consistent hashing
          # regardless of how the flake is evaluated (local vs remote)
          offlineCache = pkgs.stdenvNoCC.mkDerivation {
            name = "lattice-deps-${version}";

            src = pkgs.runCommand "lattice-lock-files" { } ''
              mkdir -p $out
              cp ${./package.json} $out/package.json
              cp ${./bun.lock} $out/bun.lock
            '';

            nativeBuildInputs = [
              pkgs.bun
              pkgs.cacert
            ];

            # Don't patch shebangs in node_modules - it creates /nix/store references
            dontPatchShebangs = true;
            dontFixup = true;

            # --ignore-scripts: postinstall scripts (e.g., lzma-native's node-gyp-build)
            # fail in the sandbox because shebangs like #!/usr/bin/env node can't resolve.
            # Native modules are rebuilt in the main derivation after patchShebangs runs.
            buildPhase = ''
              export HOME=$TMPDIR
              export BUN_INSTALL_CACHE_DIR=$TMPDIR/.bun-cache
              bun install --frozen-lockfile --no-progress --ignore-scripts
            '';

            installPhase = ''
              mkdir -p $out
              cp -r node_modules $out/
            '';

            outputHashMode = "recursive";
            # Marker used by scripts/update_flake_hash.sh to update this hash in place.
            outputHash = "sha256-UZTe8hlgnCBWsQ7Z60NjgE4003sB1Yx4ko/zLIDRe00="; # lattice-offline-cache-hash
          };

          configurePhase = ''
            export HOME=$TMPDIR
            # Use pre-fetched dependencies (copy so tools can write to it)
            cp -r ${offlineCache}/node_modules .
            chmod -R +w node_modules

            # Patch shebangs in node_modules binaries and scripts
            patchShebangs node_modules
            patchShebangs scripts

            # Run postinstall to rebuild node-pty for Electron
            # (skipped in offlineCache due to --ignore-scripts)
            ./scripts/postinstall.sh

            # Touch sentinel to prevent make from re-running bun install
            touch node_modules/.installed
          '';

          buildPhase = ''
            echo "Building lattice with make..."
            export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:$LD_LIBRARY_PATH"
            make SHELL=${pkgs.bash}/bin/bash build
          '';

          installPhase = ''
                        mkdir -p $out/lib/lattice
                        mkdir -p $out/bin

                        # Copy built files and runtime dependencies
                        cp -r dist $out/lib/lattice/
                        cp -r node_modules $out/lib/lattice/
                        cp package.json $out/lib/lattice/

                        # Create wrapper script. When running in Nix, lattice doesn't know that
                        # it's packaged. Use LATTICE_E2E_LOAD_DIST to force using compiled
                        # assets instead of a dev server.
                        makeWrapper ${pkgs.electron}/bin/electron $out/bin/lattice \
                          --add-flags "$out/lib/lattice/dist/cli/index.js" \
                          --set LATTICE_E2E_LOAD_DIST "1" \
                          --prefix LD_LIBRARY_PATH : "${pkgs.stdenv.cc.cc.lib}/lib" \
                          --prefix PATH : ${
                            pkgs.lib.makeBinPath [
                              pkgs.git
                              pkgs.bash
                            ]
                          }

                        # Install desktop file and icon for launcher integration
                        install -Dm644 public/icon.png $out/share/icons/hicolor/512x512/apps/lattice.png
                        mkdir -p $out/share/applications
                        cat > $out/share/applications/lattice.desktop << EOF
            [Desktop Entry]
            Name=Lattice
            GenericName=Lattice Workbench
            Comment=Runtime enforcement and identity infrastructure for autonomous AI agents
            Exec=$out/bin/lattice %U
            Icon=lattice
            Terminal=false
            Type=Application
            Categories=Development;
            StartupWMClass=lattice
            EOF
          '';

          meta = with pkgs.lib; {
            description = "Lattice - runtime enforcement and identity infrastructure for autonomous AI agents";
            homepage = "https://github.com/latticeHQ/latticeWorkbench";
            license = licenses.mit;
            platforms = platforms.linux ++ platforms.darwin;
            mainProgram = "lattice";
          };
        };
      in
      {
        packages.default = lattice;
        packages.lattice = lattice;

        formatter = pkgs.nixfmt-rfc-style;

        apps.default = {
          type = "app";
          program = "${lattice}/bin/lattice";
        };

        devShells.default = pkgs.mkShell {
          buildInputs =
            with pkgs;
            [
              bun

              # Node + build tooling
              nodejs
              gnumake

              # Common CLIs
              git
              bash

              # Nix tooling
              nixfmt-rfc-style

              # Repo linting (make static-check)
              go
              shellcheck
              shfmt
              gh
              jq

              # Documentation
              mdbook
              mdbook-mermaid
              mdbook-linkcheck
              mdbook-pagetoc

              # Terminal bench
              uv
              asciinema
            ]
            ++ lib.optionals stdenv.isLinux [ docker ];
        };
      }
    );
}
