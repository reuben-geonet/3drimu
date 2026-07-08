import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { execSync } from "node:child_process";

const appVersionManifest = createAppVersionManifest();

export default defineConfig({
  base: "/3drimu/",
  plugins: [appVersionManifestPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    sourcemap: false
  }
});

function appVersionManifestPlugin(): Plugin {
  const source = JSON.stringify(appVersionManifest, null, 2);

  return {
    name: "app-version-manifest",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0];

        if (pathname !== "/version.json" && pathname !== "/3drimu/version.json") {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source
      });
    }
  };
}

function createAppVersionManifest(): {
  version: string;
  commit: string | null;
  builtAt: string;
} {
  const commit = getGitCommit();
  const builtAt = new Date().toISOString();

  return {
    version: `${commit ?? "local"}-${builtAt}`,
    commit: commit ?? null,
    builtAt
  };
}

function getGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}
