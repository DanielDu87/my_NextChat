import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
});

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  testMatch: ["**/*.test.js", "**/*.test.ts", "**/*.test.jsx", "**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@/app/mcp/actions$": "<rootDir>/test/__mocks__/mcp-actions.ts",
    "^@/app/locales$": "<rootDir>/test/__mocks__/locales.ts",
    "^\\.\\./mcp/actions$": "<rootDir>/test/__mocks__/mcp-actions.ts",
    "^\\.\\./locales$": "<rootDir>/test/__mocks__/locales.ts",
    "^lodash-es$": "lodash",
    "^lodash-es/(.*)$": "lodash/$1",
    "^nanoid$": "<rootDir>/test/__mocks__/nanoid.ts",
  },
  modulePathIgnorePatterns: ["<rootDir>/.next/standalone/"],
  transformIgnorePatterns: [
    "/node_modules/(?!(lodash-es|nanoid|@modelcontextprotocol/sdk)/)",
  ],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  injectGlobals: true,
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config);
