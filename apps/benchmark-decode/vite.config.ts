import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { searchForWorkspaceRoot, type Plugin, defineConfig } from "vite";
import { createPumpBenchmarkAssets } from "./benchmark-fixture";

const FIXTURE_BASE_PATH = "/fixtures/pump";

export default defineConfig(({ mode }) => {
  return {
    server: {
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
      },
    },
    preview: {
      port: mode === "preview" ? 4173 : undefined,
    },
    plugins: [pumpFixturePlugin()],
  };
});

function pumpFixturePlugin(): Plugin {
  let appRoot = process.cwd();
  let outDir = "dist";
  let fixturePromise: ReturnType<typeof createPumpBenchmarkAssets> | undefined;

  const getFixture = () => {
    fixturePromise ??= createPumpBenchmarkAssets(appRoot);
    return fixturePromise;
  };

  const serveFixture = async (
    url: string | undefined,
    response: NodeJS.WritableStream & {
      setHeader(name: string, value: string): void;
      statusCode: number;
      end(chunk?: Uint8Array | string): void;
    },
  ) => {
    if (url !== `${FIXTURE_BASE_PATH}/index.json` && url !== `${FIXTURE_BASE_PATH}/payload.bin`) {
      return false;
    }

    const fixture = await getFixture();
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");

    if (url.endsWith("index.json")) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(fixture.indexJson);
    } else {
      response.setHeader("Content-Type", "application/octet-stream");
      response.end(fixture.payload);
    }

    return true;
  };

  return {
    name: "pump-benchmark-fixture",
    configResolved(config) {
      appRoot = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const handled = await serveFixture(request.url, response);
          if (handled) {
            return;
          }
        } catch (error) {
          next(error as Error);
          return;
        }

        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const handled = await serveFixture(request.url, response);
          if (handled) {
            return;
          }
        } catch (error) {
          next(error as Error);
          return;
        }

        next();
      });
    },
    async writeBundle() {
      const fixture = await getFixture();
      const fixtureDir = resolve(outDir, "fixtures/pump");

      await mkdir(fixtureDir, { recursive: true });
      await Promise.all([
        writeFile(resolve(fixtureDir, "index.json"), fixture.indexJson),
        writeFile(resolve(fixtureDir, "payload.bin"), fixture.payload),
      ]);
    },
  };
}