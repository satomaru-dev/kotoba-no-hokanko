import { runSync } from "./sync.js";

const INTERVAL_MS = 30 * 60 * 1000;

const loop = async (): Promise<void> => {
  await runSync();
  setTimeout(() => {
    loop().catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      setTimeout(() => void loop(), INTERVAL_MS);
    });
  }, INTERVAL_MS);
};

void loop();
