/* eslint-disable */
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BaseContract, Contract } from "ethers";

function typed(contract: Contract) {
  return contract as unknown as Contract & { [key: string]: any };
}

type Signers = {
  deployer: HardhatEthersSigner;
  seller: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return Number(block!.timestamp);
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("FHEVWAPAuction", function () {
  let signers: Signers;
  let base: BaseContract;
  let quote: BaseContract;
  let auction: BaseContract;

  before(async () => {
    const [deployer, seller, alice, bob] = await ethers.getSigners();
    signers = { deployer, seller, alice, bob };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }

    base = await (await ethers.getContractFactory("MockERC20", signers.deployer)).deploy("BaseToken", "BASE", 0n);
    quote = await (await ethers.getContractFactory("MockERC20", signers.deployer)).deploy("QuoteToken", "QUOTE", 0n);

    await (await typed(base).mint(signers.seller.address, 1_000_000n)).wait();
    await (await typed(quote).mint(signers.alice.address, 1_000_000n)).wait();
    await (await typed(quote).mint(signers.bob.address, 1_000_000n)).wait();

    auction = await (await ethers.getContractFactory("TestableFHEVWAPAuction", signers.deployer)).deploy();
  });

  it("create reverts on invalid params and same token", async () => {
    await (await typed(base).connect(signers.seller).approve(await auction.getAddress(), 100n)).wait();
    const ts = await latestTimestamp();
    await expect(
      typed(auction).connect(signers.seller).createAuction(await base.getAddress(), await base.getAddress(), 100, ts, ts + 1)
    ).to.be.revertedWith("same token");

    await expect(
      typed(auction).connect(signers.seller).createAuction(await base.getAddress(), await quote.getAddress(), 0, ts, ts + 1)
    ).to.be.revertedWith("zero S");

    await expect(
      typed(auction).connect(signers.seller).createAuction(await base.getAddress(), await quote.getAddress(), 1, ts + 10, ts)
    ).to.be.revertedWith("invalid window");
  });

  it("happy path S>=Q with on-chain VWAP (testSetVWAP)", async () => {
    const S = 100n;
    await (await typed(base).connect(signers.seller).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    const start = ts - 1;
    const end = ts + 3600;
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(await base.getAddress(), await quote.getAddress(), S, start, end)
    ).wait();
    const auctionId = 1;

    // Alice bid
    const alicePrice = 100;
    const aliceQty = 30;
    const aliceCap = 120;
    const aliceMaxSpend = BigInt(aliceCap * aliceQty);
    await (await typed(quote).connect(signers.alice).approve(await auction.getAddress(), aliceMaxSpend)).wait();
    const encAlice = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(alicePrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, encAlice.handles[0], encAlice.inputProof, aliceQty, aliceCap, aliceMaxSpend)
    ).wait();

    // Bob bid
    const bobPrice = 95;
    const bobQty = 50;
    const bobCap = 105;
    const bobMaxSpend = BigInt(bobCap * bobQty);
    await (await typed(quote).connect(signers.bob).approve(await auction.getAddress(), bobMaxSpend)).wait();
    const encBob = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.bob.address)
      .add64(bobPrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.bob)
        .submitBid(auctionId, encBob.handles[0], encBob.inputProof, bobQty, bobCap, bobMaxSpend)
    ).wait();

    await increaseTime(4000);

    // Compute encrypted VWAP
    await (await typed(auction).computeEncryptedVWAP(auctionId)).wait();

    // Set vwap via test helper instead of oracle
    const assumedVWAP = 98;
    await (await typed(auction).testSetVWAP(auctionId, assumedVWAP)).wait();

    // Pre balances snapshot
    const sellerBaseBefore = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteBefore = await typed(quote).balanceOf(signers.seller.address);
    const aliceBaseBefore = await typed(base).balanceOf(signers.alice.address);
    const bobBaseBefore = await typed(base).balanceOf(signers.bob.address);
    const aliceQuoteBefore = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteBefore = await typed(quote).balanceOf(signers.bob.address);

    await (await typed(auction).connect(signers.seller).settle(auctionId)).wait();

    const sellerBaseAfter = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteAfter = await typed(quote).balanceOf(signers.seller.address);
    const aliceBaseAfter = await typed(base).balanceOf(signers.alice.address);
    const bobBaseAfter = await typed(base).balanceOf(signers.bob.address);
    const aliceQuoteAfter = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteAfter = await typed(quote).balanceOf(signers.bob.address);

    // Allocation: S(100) >= Q(80)
    expect(aliceBaseAfter - aliceBaseBefore).to.eq(30n);
    expect(bobBaseAfter - bobBaseBefore).to.eq(50n);

    const aliceSpend = BigInt(30 * assumedVWAP);
    const bobSpend = BigInt(50 * assumedVWAP);
    expect(sellerQuoteAfter - sellerQuoteBefore).to.eq(aliceSpend + bobSpend);

    expect(aliceQuoteAfter - aliceQuoteBefore).to.eq(aliceMaxSpend - aliceSpend);
    expect(bobQuoteAfter - bobQuoteBefore).to.eq(bobMaxSpend - bobSpend);

    expect(sellerBaseAfter - sellerBaseBefore).to.eq(20n);

    await expect(typed(auction).connect(signers.seller).settle(auctionId)).to.be.revertedWith("settled");
  });

  it("pro-rata S<Q, floors allocations, proceeds and refunds computed correctly", async () => {
    const S = 100n;
    await (await typed(base).connect(signers.seller).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    const start = ts - 1;
    const end = ts + 3600;
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(await base.getAddress(), await quote.getAddress(), S, start, end)
    ).wait();
    const auctionId = 1;

    const aliceQty = 30;
    const aliceCap = 200;
    const alicePrice = 120;
    const aliceMaxSpend = BigInt(aliceCap * aliceQty);
    await (await typed(quote).connect(signers.alice).approve(await auction.getAddress(), aliceMaxSpend)).wait();
    const encAlice = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(alicePrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, encAlice.handles[0], encAlice.inputProof, aliceQty, aliceCap, aliceMaxSpend)
    ).wait();

    const bobQty = 100;
    const bobCap = 200;
    const bobPrice = 110;
    const bobMaxSpend = BigInt(bobCap * bobQty);
    await (await typed(quote).connect(signers.bob).approve(await auction.getAddress(), bobMaxSpend)).wait();
    const encBob = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.bob.address)
      .add64(bobPrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.bob)
        .submitBid(auctionId, encBob.handles[0], encBob.inputProof, bobQty, bobCap, bobMaxSpend)
    ).wait();

    await increaseTime(4000);
    await (await typed(auction).computeEncryptedVWAP(auctionId)).wait();
    await (await typed(auction).testSetVWAP(auctionId, 98)).wait();

    const aliceBaseBefore = await typed(base).balanceOf(signers.alice.address);
    const bobBaseBefore = await typed(base).balanceOf(signers.bob.address);
    const sellerBaseBefore = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteBefore = await typed(quote).balanceOf(signers.seller.address);
    const aliceQuoteBefore = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteBefore = await typed(quote).balanceOf(signers.bob.address);

    await (await typed(auction).connect(signers.seller).settle(auctionId)).wait();

    const aliceBaseAfter = await typed(base).balanceOf(signers.alice.address);
    const bobBaseAfter = await typed(base).balanceOf(signers.bob.address);
    const sellerBaseAfter = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteAfter = await typed(quote).balanceOf(signers.seller.address);
    const aliceQuoteAfter = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteAfter = await typed(quote).balanceOf(signers.bob.address);

    const Q = 130;
    const aliceAlloc = Math.floor((aliceQty * Number(S)) / Q);
    const bobAlloc = Math.floor((bobQty * Number(S)) / Q);

    expect(aliceBaseAfter - aliceBaseBefore).to.eq(BigInt(aliceAlloc));
    expect(bobBaseAfter - bobBaseBefore).to.eq(BigInt(bobAlloc));

    const expectedSellerQuote = BigInt(aliceAlloc * 98 + bobAlloc * 98);
    expect(sellerQuoteAfter - sellerQuoteBefore).to.eq(expectedSellerQuote);

    const aliceSpend = BigInt(aliceAlloc * 98);
    const bobSpend = BigInt(bobAlloc * 98);
    expect(aliceQuoteAfter - aliceQuoteBefore).to.eq(BigInt(aliceCap * aliceQty) - aliceSpend);
    expect(bobQuoteAfter - bobQuoteBefore).to.eq(BigInt(bobCap * bobQty) - bobSpend);

    const distributed = BigInt(aliceAlloc + bobAlloc);
    expect(sellerBaseAfter - sellerBaseBefore).to.eq(S - distributed);
  });

  it("refund path when no eligible bids", async () => {
    const S = 100n;
    await (await typed(base).connect(signers.seller).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(await base.getAddress(), await quote.getAddress(), S, ts - 1, ts + 3600)
    ).wait();
    const auctionId = 1;

    const maxSpend1 = 100n;
    await (await typed(quote).connect(signers.alice).approve(await auction.getAddress(), maxSpend1)).wait();
    const encA = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(50)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, encA.handles[0], encA.inputProof, 1, 60, maxSpend1)
    ).wait();

    const maxSpend2 = 200n;
    await (await typed(quote).connect(signers.bob).approve(await auction.getAddress(), maxSpend2)).wait();
    const encB = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.bob.address)
      .add64(55)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.bob)
        .submitBid(auctionId, encB.handles[0], encB.inputProof, 2, 70, maxSpend2)
    ).wait();

    await increaseTime(5000);

    await (await typed(auction).computeEncryptedVWAP(auctionId)).wait();
    await (await typed(auction).testSetVWAP(auctionId, 100)).wait();

    const sellerBaseBefore = await typed(base).balanceOf(signers.seller.address);
    const aliceQuoteBefore = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteBefore = await typed(quote).balanceOf(signers.bob.address);

    await (await typed(auction).connect(signers.seller).settle(auctionId)).wait();

    const sellerBaseAfter = await typed(base).balanceOf(signers.seller.address);
    const aliceQuoteAfter = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteAfter = await typed(quote).balanceOf(signers.bob.address);

    expect(sellerBaseAfter - sellerBaseBefore).to.eq(S);
    expect(aliceQuoteAfter - aliceQuoteBefore).to.eq(maxSpend1);
    expect(bobQuoteAfter - bobQuoteBefore).to.eq(maxSpend2);
  });

  it("window/sequencing and role checks", async () => {
    const S = 10n;
    await (await typed(base).connect(signers.seller).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    const start = ts + 120;
    const end = start + 60;
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(await base.getAddress(), await quote.getAddress(), S, start, end)
    ).wait();
    const auctionId = 1;

    const enc = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(100)
      .encrypt();

    await expect(
      typed(auction).connect(signers.alice).submitBid(auctionId, enc.handles[0], enc.inputProof, 1, 200, 200)
    ).to.be.revertedWith("not in window");

    await increaseTime(130);
    await (await typed(quote).connect(signers.alice).approve(await auction.getAddress(), 1000n)).wait();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, enc.handles[0], enc.inputProof, 2, 150, 300)
    ).wait();

    await expect(typed(auction).computeEncryptedVWAP(auctionId)).to.be.revertedWith("too early");
    await increaseTime(120);
    await (await typed(auction).computeEncryptedVWAP(auctionId)).wait();

    await (await typed(auction).testSetVWAP(auctionId, 100)).wait();

    await expect(typed(auction).connect(signers.alice).settle(auctionId)).to.be.revertedWith("only seller");
    await (await typed(auction).connect(signers.seller).settle(auctionId)).wait();
  });
});


