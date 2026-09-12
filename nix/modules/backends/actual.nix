{
  config,
  pkgs,
  lib,
  ...
}:

let
  cfg = config.services.api.backends.actual;
  budgetSubmodule = lib.types.submodule (
    { name, ... }:
    {
      options = {
        syncIdFile = lib.mkOption {
          type = lib.types.path;
          description = "Environment file containing ACTUAL_SYNC_ID_<NAME>=...";
        };
        encryptionPasswordFile = lib.mkOption {
          type = lib.types.nullOr lib.types.path;
          default = null;
          description = "Environment file containing ACTUAL_ENCRYPTION_PASSWORD_<NAME>=...";
        };
      };
    }
  );
in

{
  options.services.api.backends.actual = {
    enable = lib.mkEnableOption "Actual Budget API backend";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.api-actual;
      defaultText = lib.literalExpression "pkgs.api-actual";
      description = "The api-actual package to use";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4100;
      description = "Internal port to listen on (127.0.0.1 only)";
    };

    actualServerUrl = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:5006";
      description = "URL of the upstream Actual Budget server";
    };

    apiKeysFile = lib.mkOption {
      type = lib.types.path;
      description = "Path to environment file containing API_KEYS=...";
    };

    serverPasswordFile = lib.mkOption {
      type = lib.types.path;
      description = "Path to environment file containing ACTUAL_PASSWORD=...";
    };

    budgets = lib.mkOption {
      type = lib.types.attrsOf budgetSubmodule;
      default = { };
      description = "Budget configurations indexed by budget name";
    };

    extraEnvironment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Extra environment variables to pass to the service";
    };
  };

  config = lib.mkIf (config.services.api.enable && cfg.enable) {
    users.users.api_actual = {
      isSystemUser = true;
      group = "api_actual";
      home = "/var/lib/api-actual";
      createHome = false;
    };

    users.groups.api_actual = { };

    services.postgresql = lib.mkIf config.services.api.postgres.createLocally {
      ensureDatabases = [ "api_actual" ];
      ensureUsers = [
        {
          name = "api_actual";
          ensureDBOwnership = true;
        }
      ];
    };

    systemd.services.api-actual = {
      description = "Actual Budget REST API backend";
      wantedBy = [ "multi-user.target" ];
      after = [
        "network.target"
        "postgresql.service"
      ];
      wants = [ "postgresql.service" ];

      environment = {
        PORT = toString cfg.port;
        STATE_DIR = "/var/lib/api-actual";
        ACTUAL_SERVER_URL = cfg.actualServerUrl;
        BUDGETS = lib.concatStringsSep "," (lib.attrNames cfg.budgets);
        DATABASE_URL = "postgresql:///api_actual?host=/run/postgresql";
        NODE_ENV = "production";
      }
      // cfg.extraEnvironment;

      serviceConfig = {
        Type = "simple";
        ExecStart = "${lib.getExe cfg.package}";
        User = "api_actual";
        Group = "api_actual";
        StateDirectory = "api-actual";
        Restart = "on-failure";
        RestartSec = "5s";

        EnvironmentFile = [
          cfg.apiKeysFile
          cfg.serverPasswordFile
        ]
        ++ lib.concatLists (
          lib.mapAttrsToList (
            name: b:
            [ b.syncIdFile ]
            ++ (lib.optional (b.encryptionPasswordFile != null) b.encryptionPasswordFile)
          ) cfg.budgets
        );

        # Systemd hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];
      };
    };
  };
}
