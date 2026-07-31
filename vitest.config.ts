import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./web/src/test-setup.ts"],
    include: ["tests/**/*.test.ts", "web/src/**/*.test.ts"]
  }
});
