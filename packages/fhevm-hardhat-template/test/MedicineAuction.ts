/* eslint-disable */
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { Contract } from "ethers";

function typed(contract: Contract) {
  return contract as unknown as Contract & { [key: string]: any };
}

describe("MedicineAuction wrappers", function () {
  let mtk: Contract;
  let usd: Contract;
  let auction: Contract;
  let seller: any;
  let alice: any;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    const [deployer, s, a] = await ethers.getSigners();
    seller = s;
    alice = a;

    mtk = await (await ethers.getContractFactory("MedicineToken", deployer)).deploy(0n);
    usd = await (await ethers.getContractFactory("StableUSD", deployer)).deploy(0n);
    auction = await (await ethers.getContractFactory("MedicineAuction", deployer)).deploy();

    await (await typed(mtk).mint(seller.address, 1_000_000n)).wait();
    await (await typed(usd).mint(alice.address, 1_000_000n)).wait();
  });

  it("create + bid using wrapper functions works", async () => {
    const S = 50n;
    await (await typed(mtk).connect(seller).approve(await auction.getAddress(), S)).wait();
    const ts = Number((await ethers.provider.getBlock("latest"))!.timestamp);
    await (
      await typed(auction)
        .connect(seller)
        .createMedicineAuction(await mtk.getAddress(), await usd.getAddress(), S, ts - 1, ts + 600)
    ).wait();
    const enc = await fhevm.createEncryptedInput(await auction.getAddress(), alice.address).add64(100).encrypt();
    await (await typed(usd).connect(alice).approve(await auction.getAddress(), 1000n)).wait();
    await (
      await typed(auction)
        .connect(alice)
        .submitMunicipalityBid(1, enc.handles[0], enc.inputProof, 5, 120, 600)
    ).wait();
  });
});


