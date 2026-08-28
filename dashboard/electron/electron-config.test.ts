import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  main?: string;
  scripts?: Record<string, string>;
  build?: { appId?: string; productName?: string; files?: string[] };
};

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as PackageManifest;

describe("Electron desktop packaging", () => {
  it("declares the secure Electron entry points and scripts", () => {
    expect(manifest.main).toBe("electron/main.cjs");
    expect(manifest.scripts?.["electron:dev"]).toContain("electron electron/main.cjs");
    expect(manifest.scripts?.["electron:pack"]).toContain("electron-builder --dir");
    expect(existsSync(resolve(projectRoot, "electron/main.cjs"))).toBe(true);
    expect(existsSync(resolve(projectRoot, "electron/preload.cjs"))).toBe(true);
  });

  it("includes deterministic desktop identity and packaged files", () => {
    expect(manifest.build?.appId).toBe("com.lupin.commanddeck");
    expect(manifest.build?.productName).toBe("Lupin Command Deck");
    expect(manifest.build?.files).toEqual(expect.arrayContaining(["dist/**/*", "electron/**/*"]));
  });
});
