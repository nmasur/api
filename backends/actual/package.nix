{
  lib,
  buildNpmPackage,
  nodejs_22,
  python3,
  pkg-config,
}:

buildNpmPackage {
  pname = "api-actual";
  version = "0.1.0";

  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./package.json
      ./package-lock.json
      ./tsconfig.json
      ./src
    ];
  };

  npmDepsHash = "sha256-ZLgSYFCLWkMn40/0GfxKLM5ZVkS16PeP3ll1koV/6RI=";

  nodejs = nodejs_22;
  npmBuildScript = "build";

  nativeBuildInputs = [
    python3
    pkg-config
  ];

  postInstall = ''
    mkdir -p $out/lib/node_modules/api-actual/dist/db/migrations
    cp src/db/migrations/*.sql $out/lib/node_modules/api-actual/dist/db/migrations/
    mkdir -p $out/bin
    cat <<EOF > $out/bin/api-actual
    #!/bin/sh
    exec ${lib.getExe nodejs_22} $out/lib/node_modules/api-actual/dist/main.js "\$@"
    EOF
    chmod +x $out/bin/api-actual
  '';

  meta = with lib; {
    description = "Actual Budget backend for api.masu.rs";
    license = licenses.mit;
    mainProgram = "api-actual";
  };
}
