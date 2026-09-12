{
  config,
  lib,
  ...
}:

let
  cfg = config.services.api;

  # Build routes for enabled backends
  backendRoutes = lib.optional cfg.backends.actual.enable {
    match = [
      {
        host = [ cfg.hostname ];
        path = [
          "/actual/*"
          "/actual"
        ];
      }
    ];
    handle = [
      {
        handler = "rewrite";
        strip_path_prefix = "/actual";
      }
      {
        handler = "headers";
        request = {
          set = {
            "X-Forwarded-Prefix" = [ "/actual" ];
          };
        };
      }
      {
        handler = "reverse_proxy";
        upstreams = [
          { dial = "127.0.0.1:${builtins.toString cfg.backends.actual.port}"; }
        ];
      }
    ];
  };

  healthRoute = {
    match = [
      {
        host = [ cfg.hostname ];
        path = [ "/healthz" ];
      }
    ];
    handle = [
      {
        handler = "static_response";
        status_code = "200";
        headers = {
          "Content-Type" = [ "application/json" ];
        };
        body = builtins.toJSON { status = "ok"; };
      }
    ];
  };

  catchAllRoute = {
    match = [
      {
        host = [ cfg.hostname ];
      }
    ];
    handle = [
      {
        handler = "static_response";
        status_code = "404";
        headers = {
          "Content-Type" = [ "application/json" ];
        };
        body = builtins.toJSON {
          error = "not_found";
          message = "No backend matches this path prefix";
        };
      }
    ];
  };
in

{
  options.services.api = {
    enable = lib.mkEnableOption "API gateway host configuration and shared options";

    hostname = lib.mkOption {
      type = lib.types.str;
      default = "api.masu.rs";
      description = "Public hostname for the API service fronted by Caddy";
    };

    postgres = {
      createLocally = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to automatically configure local PostgreSQL databases and roles";
      };
    };

    caddyRoutes = lib.mkOption {
      type = lib.types.listOf lib.types.attrs;
      readOnly = true;
      default = [ healthRoute ] ++ backendRoutes ++ [ catchAllRoute ];
      description = "Generated Caddy JSON route definitions to append to Caddy routes";
    };
  };
}
