import { task, types } from "hardhat/config";

/*
  Mint tokens to a target address.

  Usage examples:
    - npx hardhat --network localhost mint:token --token MedicineToken --to 0xabc... --amount 100000
    - npx hardhat --network localhost mint:token --token StableUSD --to 0xabc... --amount 1 --scaled true

  Parameters:
    --token  : Contract name deployed via hardhat-deploy (MedicineToken | StableUSD | BaseToken | QuoteToken)
    --to     : Recipient address
    --amount : Amount; raw units by default. If --scaled true, human units (scaled by token.decimals())
    --scaled : Optional boolean. When true, uses parseUnits(amount, decimals)
*/
task("mint:token", "Mint tokens to an address")
  .addParam("token", "Deployed token contract name")
  .addParam("to", "Recipient address")
  .addParam("amount", "Amount to mint (raw units unless --scaled true)")
  .addOptionalParam("scaled", "Treat amount as human units (scale by decimals)", false, types.boolean)
  .setAction(async (args, hre) => {
    const { deployments, ethers } = hre;
    const { token, to, amount, scaled } = args as { token: string; to: string; amount: string; scaled?: boolean };

    const dep = await deployments.get(token);
    const signer = (await ethers.getSigners())[0];
    const ctr = await ethers.getContractAt(token, dep.address, signer);

    let value: bigint;
    if (scaled) {
      const decimals: number = await ctr.decimals();
      value = ethers.parseUnits(String(amount), decimals);
    } else {
      value = BigInt(amount);
    }

    const tx = await ctr.mint(to, value);
    console.log(`Mint tx: ${tx.hash}`);
    await tx.wait();
    console.log(`Minted ${amount}${scaled ? " (scaled)" : ""} on ${token} to ${to}`);
  });

/*
  Mint 100000 units of MedicineToken and StableUSD to a target address in one shot.

  Usage:
    npx hardhat --network localhost mint:all --to 0xYourAddr
*/
task("mint:all", "Mint 100000 MED and 100000 USD to an address")
  .addParam("to", "Recipient address")
  .setAction(async ({ to }: { to: string }, hre) => {
    const { deployments, ethers } = hre;

    const medDep = await deployments.get("MedicineToken");
    const usdDep = await deployments.get("StableUSD");

    const signer = (await ethers.getSigners())[0];
    const med = await ethers.getContractAt("MedicineToken", medDep.address, signer);
    const usd = await ethers.getContractAt("StableUSD", usdDep.address, signer);

    const amount = 100000n; // decimals = 0, demo-friendly

    const tx1 = await med.mint(to, amount);
    console.log(`MedicineToken mint tx: ${tx1.hash}`);
    await tx1.wait();

    const tx2 = await usd.mint(to, amount);
    console.log(`StableUSD mint tx: ${tx2.hash}`);
    await tx2.wait();

    console.log(`Minted 100000 MED and 100000 USD to ${to}`);
  });

// npx hardhat --network sepolia mint:all --to 0xYourAddress
