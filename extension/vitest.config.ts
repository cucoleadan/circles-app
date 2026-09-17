import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["extension/tests/**/*.test.ts"] } });
