/**
 * Enable EIP-7702 Smart Account
 *
 * This script enables the smart account by signing an EIP-7702 authorization
 * and sending a transaction with the authorization list.
 *
 * Usage:
 *   PRIVATE_KEY=0x... AGENT_DELEGATOR_ADDRESS=0x... npx hardhat run scripts/enable-smart-account.ts --network baseSepolia
 *
 * Note: EIP-7702 signAuthorization requires a local account (direct private key access),
 * not a JSON-RPC account. This is why we read the private key from environment directly.
 */

import hre from "hardhat";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

async function main() {
  // Get private key from environment
  // We need direct private key access for signAuthorization (JSON-RPC accounts won't work)
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    console.error("Error: PRIVATE_KEY environment variable not set.");
    console.error("");
    console.error("Usage:");
    console.error("  PRIVATE_KEY=0x... AGENT_DELEGATOR_ADDRESS=0x... npx hardhat run scripts/enable-smart-account.ts --network baseSepolia");
    console.error("");
    console.error("Note: This must be the same key stored in your Hardhat keystore as BASE_SEPOLIA_DEPLOYER_KEY");
    process.exit(1);
  }

  const contractAddress = process.env.AGENT_DELEGATOR_ADDRESS as Address | undefined;
  if (!contractAddress) {
    console.error("Error: AGENT_DELEGATOR_ADDRESS environment variable not set.");
    console.error("Set it to the AgentDelegator contract deployed on Base Sepolia.");
    process.exit(1);
  }

  // Create local account from private key
  const account = privateKeyToAccount(
    privateKey.startsWith("0x") ? privateKey : (`0x${privateKey}` as Hex)
  );

  // Connect to network to get chain info
  const connection = await hre.network.connect();
  const publicClientHh = await connection.viem.getPublicClient();
  const chainId = await publicClientHh.getChainId();

  console.log("Chain ID:", chainId);
  console.log("Account address:", account.address);

  // Determine chain config and RPC URL
  const chain = chainId === baseSepolia.id ? baseSepolia : undefined;
  const rpcUrl = chainId === baseSepolia.id ? process.env.BASE_SEPOLIA_RPC_URL : undefined;

  if (!chain || !rpcUrl) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Create viem clients with local account
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  // Get current nonce
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });
  console.log("Current nonce:", nonce);

  // Check current code at account address
  const currentCode = await publicClient.getCode({ address: account.address });
  if (currentCode) {
    const expectedPrefix = `0xef0100${contractAddress.slice(2).toLowerCase()}`;
    if (currentCode.toLowerCase() === expectedPrefix.toLowerCase()) {
      console.log("\n✅ Smart account is already enabled!");
      console.log("Current delegation:", currentCode);
      return;
    }
    console.log("Account has existing code:", currentCode);
  }

  console.log("\nEnabling smart account...");
  console.log("Delegating to:", contractAddress);

  // Sign the EIP-7702 authorization
  // This requires a local account (not JSON-RPC) because we need to sign with the private key
  const authorization = await walletClient.signAuthorization({
    contractAddress,
    executor: "self", // We're executing the transaction ourselves
  });

  console.log("Authorization signed:", {
    address: authorization.address,
    chainId: authorization.chainId,
    nonce: authorization.nonce,
  });

  // Send transaction with authorization list
  // The transaction sends 0 ETH to self with empty data
  // The authorization list is what sets the delegation
  // Note: EIP-7702 transactions require more gas than simple transfers due to the authorization list
  const hash = await walletClient.sendTransaction({
    to: account.address,
    data: "0x",
    authorizationList: [authorization],
    gas: 100000n, // EIP-7702 requires ~46000+ gas for the authorization list
  });

  console.log("Transaction sent:", hash);

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Transaction confirmed in block:", receipt.blockNumber);
  console.log("Status:", receipt.status);

  if (receipt.status === "success") {
    // Verify the delegation was applied
    const newCode = await publicClient.getCode({ address: account.address });
    console.log("\nAccount code after delegation:", newCode);

    const expectedCode = `0xef0100${contractAddress.slice(2).toLowerCase()}`;
    if (newCode?.toLowerCase() === expectedCode.toLowerCase()) {
      console.log("\n✅ Smart account enabled successfully!");
    } else {
      console.log("\n⚠️  Delegation may not have been applied correctly");
      console.log("Expected:", expectedCode);
      console.log("Got:", newCode);
    }
  } else {
    console.log("\n❌ Transaction failed");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
