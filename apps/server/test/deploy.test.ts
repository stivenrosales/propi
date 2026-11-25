// deploy/stack.yml wiring that unit tests can pin without Docker: every service that needs secrets
// reads /opt/propi/propi.env, and every service that talks to Postgres shares its network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const stack = readFileSync(join(import.meta.dirname, "..", "..", "..", "deploy", "stack.yml"), "utf8");

/** The lines of one top-level service (two-space indented key under `services:`), comments dropped. */
function service(name: string): string {
  const lines = stack.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) throw new Error(`service ${name} not found in deploy/stack.yml`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break;
    if (!line.trim().startsWith("#")) body.push(line);
  }
  return body.join("\n");
}

const networks = (svc: string): string[] => {
  const m = /^ {4}networks: \[([^\]]*)\]/m.exec(svc);
  return m === null ? [] : m[1]!.split(",").map((s) => s.trim());
};

describe("deploy/stack.yml", () => {
  test("web reads the secrets file and joins the propi network to reach postgres:5432", () => {
    const web = service("web");
    expect(web).toMatch(/^ {4}env_file: \/opt\/propi\/propi\.env$/m);
    expect(networks(web)).toEqual(expect.arrayContaining(["easypanel", "propi"]));
  });
  test("postgres, migrate and server share the propi network and the secrets file", () => {
    expect(networks(service("postgres"))).toContain("propi");
    for (const name of ["postgres", "migrate", "server", "web"]) expect(service(name)).toContain("env_file: /opt/propi/propi.env");
    for (const name of ["migrate", "server"]) expect(networks(service(name))).toContain("propi");
  });
});
