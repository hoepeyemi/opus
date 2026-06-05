import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(configDir, ".env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = rawValue
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
}

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

function getPrivateKey(name: string): `0x${string}` | undefined {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined

  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a 32-byte private key formatted as 0x followed by 64 hex characters.`)
  }

  return normalized as `0x${string}`
}

const baseSepoliaDeployerKey = getPrivateKey("BASE_SEPOLIA_DEPLOYER_KEY");

if (!baseSepoliaDeployerKey) {
  throw new Error("BASE_SEPOLIA_DEPLOYER_KEY is required to deploy to Base Sepolia.");
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.29",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "prague",
        },
      },
      production: {
        version: "0.8.29",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "prague",
        },
      },
    },
  },

  networks: {
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: baseSepoliaRpcUrl,
      chainId: 84532,
      accounts: [baseSepoliaDeployerKey],
    },
  },

  chainDescriptors: {
    84532: {
      name: "base-sepolia",
      hardforkHistory: {
        cancun: { blockNumber: 0 },
      },
      blockExplorers: {
        etherscan: {
          name: "BaseScan Sepolia",
          url: "https://sepolia.basescan.org",
          apiUrl: "https://api-sepolia.basescan.org/api",
        },
      },
    },
  },

  verify: {
    etherscan: {
      apiKey: process.env.BASESCAN_API_KEY || "",
    },
  },
});
