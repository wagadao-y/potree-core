import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { searchForWorkspaceRoot, type Plugin, defineConfig } from "vite";
import { createBenchmarkAssets } from "./benchmark-fixture";

const FIXTURE_PATHS = {
  brotli: "/fixtures/brotli",
  zstd: "/fixtures/zstd",
} as const;

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
  let fixturePromise: ReturnType<typeof createBenchmarkAssets> | undefined;

  const getFixture = () => {
    fixturePromise ??= createBenchmarkAssets(appRoot);
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
    const requestUrl = url ?? "";
    const suite = Object.entries(FIXTURE_PATHS).find(([, basePath]) => {
      return (
        requestUrl === `${basePath}/index.json` ||
        requestUrl === `${basePath}/payload.bin`
      );
    })?.[0] as keyof typeof FIXTURE_PATHS | undefined;

    if (suite === undefined) {
      return false;
    }

    const fixture = (await getFixture())[suite];
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");

    if (requestUrl.endsWith("index.json")) {
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
      const fixtures = await getFixture();

      await Promise.all(
        Object.keys(FIXTURE_PATHS).map(async (suite) => {
          const fixtureDir = resolve(outDir, "fixtures", suite);
          const fixture = fixtures[suite as keyof typeof fixtures];

          await mkdir(fixtureDir, { recursive: true });
          await Promise.all([
            writeFile(resolve(fixtureDir, "index.json"), fixture.indexJson),
            writeFile(resolve(fixtureDir, "payload.bin"), fixture.payload),
          ]);
        }),
      );
    },
  };
}