#!/usr/bin/env tsx
/**
 * Generate an EVM wallet for x402 payments on Base Sepolia.
 * Outputs private key and address — save these to Railway env vars.
 */

// Simple EVM wallet generator using ethers
import { ethers } from "ethers";

function main() {
  // Generate a random wallet
  const wallet = ethers.Wallet.createRandom();

  console.log("=== x402 Payment Wallet ===\n");
  console.log("PRIVATE_KEY (save to X402_PRIVATE_KEY - DO NOT share):");
  console.log(wallet.privateKey);
  console.log("\nADDRESS (save to X402_PAY_TO_ADDRESS):");
  console.log(wallet.address);
  console.log("\nNetwork: Base Sepolia (eip155:84532)");
  console.log("\nNOTE: This wallet only needs to RECEIVE payments.");
  console.log("For testnet, you don't need to fund it (x402 facilitator covers gas).");
  console.log("\nFaucet for testing (if needed):");
  console.log("https://www.sepoliafaucet.com/ or https://faucet.quicknode.com/base/sepolia");
}

main();
