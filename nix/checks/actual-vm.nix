{
  pkgs,
  self,
}:

pkgs.testers.runNixOSTest {
  name = "actual-vm";

  nodes.machine =
    { config, pkgs, ... }:
    let
      fakeKeysFile = pkgs.writeText "fake-api-keys" ''
        API_KEYS=test-vm-api-key-123456789012345678901234
      '';
      fakePasswordFile = pkgs.writeText "fake-actual-password" ''
        ACTUAL_PASSWORD=testpassword
      '';
      fakeSyncIdFile = pkgs.writeText "fake-sync-id" ''
        ACTUAL_SYNC_ID_TESTBUDGET=sync-vm-test-12345
      '';
      fakeActualServer = pkgs.writeScript "actual-stub.py" ''
        #!${pkgs.python3}/bin/python3
        import json
        from http.server import HTTPServer, BaseHTTPRequestHandler

        class StubHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = {"status": "ok", "data": {"token": "fake-token"}}
                self.wfile.write(json.dumps(response).encode())

            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = {"status": "ok", "data": {"bootstrapped": True}}
                self.wfile.write(json.dumps(response).encode())

            def log_message(self, format, *args):
                pass

        HTTPServer(('127.0.0.1', 5006), StubHandler).serve_forever()
      '';
    in
    {
      imports = [
        self.nixosModules.default
      ];

      networking.useDHCP = false;
      virtualisation = {
        cores = 4;
        memorySize = 2048;
      };

      services.postgresql = {
        enable = true;
        enableTCPIP = false;
        authentication = ''
          local all all peer
        '';
      };

      services.api = {
        enable = true;
        hostname = "api.test.local";
        backends.actual = {
          enable = true;
          port = 4100;
          actualServerUrl = "http://127.0.0.1:5006";
          apiKeysFile = fakeKeysFile;
          serverPasswordFile = fakePasswordFile;
          budgets.testbudget = {
            syncIdFile = fakeSyncIdFile;
          };
        };
      };

      # Stub upstream actual server
      systemd.services.actual-stub = {
        description = "Stub Actual Server for testing";
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          ExecStart = "${fakeActualServer}";
          Restart = "always";
        };
      };
    };

  testScript = ''
    machine.wait_for_unit("postgresql.service")
    machine.wait_for_unit("actual-stub.service")
    machine.wait_for_unit("api-actual.service")
    machine.wait_for_open_port(4100)

    # 1. Assert healthz returns 200 and {"status":"ok"}
    out = machine.succeed("curl -sf http://127.0.0.1:4100/healthz")
    assert '"status":"ok"' in out, f"Unexpected healthz response: {out}"

    # 2. Assert unauthenticated request returns 401
    machine.fail("curl -sf http://127.0.0.1:4100/budgets")
    status = machine.succeed("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/budgets")
    assert status.strip() == "401", f"Expected 401 without key, got {status}"

    # 3. Assert authenticated request succeeds
    auth_out = machine.succeed(
        "curl -sf -H 'X-API-Key: test-vm-api-key-123456789012345678901234' http://127.0.0.1:4100/budgets"
    )
    assert '"testbudget"' in auth_out, f"Expected testbudget in response, got: {auth_out}"

    # 4. Assert database migrations ran and tables exist
    db_tables = machine.succeed("sudo -u api_actual psql -d api_actual -c '\\dt'")
    assert "schema_migrations" in db_tables, f"Expected schema_migrations table, got: {db_tables}"
    assert "transaction_log" in db_tables, f"Expected transaction_log table, got: {db_tables}"
  '';
}
