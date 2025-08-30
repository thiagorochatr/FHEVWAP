import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";

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
  let base: Contract;
  let quote: Contract;
  let auction: Contract;

  before(async () => {
    const [deployer, seller, alice, bob] = await ethers.getSigners();
    signers = { deployer, seller, alice, bob };
  });

  beforeEach(async function () {
    // Only run on FHEVM mock environment
    if (!fhevm.isMock) {
      this.skip();
    }

    // Deploy tokens
    base = await (await ethers.getContractFactory("MockERC20", signers.deployer)).deploy("BaseToken", "BASE", 0n);
    quote = await (await ethers.getContractFactory("MockERC20", signers.deployer)).deploy("QuoteToken", "QUOTE", 0n);

    // Mint balances
    await (await typed(base).mint(signers.seller.address, 1_000_000n)).wait();
    await (await typed(quote).mint(signers.alice.address, 1_000_000n)).wait();
    await (await typed(quote).mint(signers.bob.address, 1_000_000n)).wait();

    // Deploy auction
    auction = await (await ethers.getContractFactory("FHEVWAPAuction", signers.deployer)).deploy();
  });

  it("happy path: S >= Q, all eligible, refunds remainder of maxSpend, returns base remainder", async () => {
    const S = 100n;

    // Approve base to escrow
    await (await typed(base).approve(await auction.getAddress(), S)).wait();

    // Create auction window
    const ts = await latestTimestamp();
    const start = ts - 10;
    const end = ts + 3600;
    const createTx = await typed(auction)
      .connect(signers.seller)
      .createAuction(await base.getAddress(), await quote.getAddress(), S, start, end);
    const receipt = await createTx.wait();
    const auctionId = 1; // first auction
    expect(receipt?.status).to.eq(1);

    // Alice bid: price 100, qty 30, cap 120
    const alicePrice = 100;
    const aliceQty = 30;
    const aliceCap = 120;
    const aliceMaxSpend = BigInt(aliceCap * aliceQty);
    await (await typed(quote).approve(await auction.getAddress(), aliceMaxSpend)).wait();
    const encAlice = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(alicePrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, encAlice.handles[0], encAlice.inputProof, aliceQty, aliceCap, aliceMaxSpend)
    ).wait();

    // Bob bid: price 95, qty 50, cap 105
    const bobPrice = 95;
    const bobQty = 50;
    const bobCap = 105;
    const bobMaxSpend = BigInt(bobCap * bobQty);
    await (await typed(quote).approve(await auction.getAddress(), bobMaxSpend)).wait();
    const encBob = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.bob.address)
      .add64(bobPrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.bob)
        .submitBid(auctionId, encBob.handles[0], encBob.inputProof, bobQty, bobCap, bobMaxSpend)
    ).wait();

    // Move past end
    await increaseTime(4000);
    const vwap = 98;

    // Pre balances
    const sellerBaseBefore = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteBefore = await typed(quote).balanceOf(signers.seller.address);
    const aliceBaseBefore = await typed(base).balanceOf(signers.alice.address);
    const bobBaseBefore = await typed(base).balanceOf(signers.bob.address);
    const aliceQuoteBefore = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteBefore = await typed(quote).balanceOf(signers.bob.address);

    await (await typed(auction).settle(auctionId, vwap)).wait();

    const sellerBaseAfter = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteAfter = await typed(quote).balanceOf(signers.seller.address);
    const aliceBaseAfter = await typed(base).balanceOf(signers.alice.address);
    const bobBaseAfter = await typed(base).balanceOf(signers.bob.address);
    const aliceQuoteAfter = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteAfter = await typed(quote).balanceOf(signers.bob.address);

    // Allocations equal qty because S (100) >= Q (80)
    expect(aliceBaseAfter - aliceBaseBefore).to.eq(30n);
    expect(bobBaseAfter - bobBaseBefore).to.eq(50n);

    // Seller receives spend at vwap
    const aliceSpend = BigInt(30 * vwap);
    const bobSpend = BigInt(50 * vwap);
    expect(sellerQuoteAfter - sellerQuoteBefore).to.eq(aliceSpend + bobSpend);

    // Refunds of maxSpend - spend
    expect(aliceQuoteAfter - aliceQuoteBefore).to.eq(aliceMaxSpend - aliceSpend);
    expect(bobQuoteAfter - bobQuoteBefore).to.eq(bobMaxSpend - bobSpend);

    // Base remainder returned (100 - 80 = 20)
    expect(sellerBaseAfter - sellerBaseBefore).to.eq(20n);

    // Cannot settle twice
    await expect(typed(auction).settle(auctionId, vwap)).to.be.revertedWith("settled");
  });

  it("pro-rata: S < Q, allocations floored, refunds and remainder", async () => {
    const S = 100n; // supply

    await (await typed(base).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    const start = ts - 10;
    const end = ts + 3600;
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(await base.getAddress(), await quote.getAddress(), S, start, end)
    ).wait();
    const auctionId = 1;

    // Alice: q=30, cap sufficient
    const aliceQty = 30;
    const aliceCap = 200;
    const alicePrice = 120;
    const aliceMaxSpend = BigInt(aliceCap * aliceQty);
    await (await typed(quote).approve(await auction.getAddress(), aliceMaxSpend)).wait();
    const encAlice = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(alicePrice)
      .encrypt();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, encAlice.handles[0], encAlice.inputProof, aliceQty, aliceCap, aliceMaxSpend)
    ).wait();

    // Bob: q=100, cap sufficient
    const bobQty = 100;
    const bobCap = 200;
    const bobPrice = 110;
    const bobMaxSpend = BigInt(bobCap * bobQty);
    await (await typed(quote).approve(await auction.getAddress(), bobMaxSpend)).wait();
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
    const vwap = 98;

    const aliceBaseBefore = await typed(base).balanceOf(signers.alice.address);
    const bobBaseBefore = await typed(base).balanceOf(signers.bob.address);
    const sellerBaseBefore = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteBefore = await typed(quote).balanceOf(signers.seller.address);
    const aliceQuoteBefore = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteBefore = await typed(quote).balanceOf(signers.bob.address);

    await (await typed(auction).settle(auctionId, vwap)).wait();

    const aliceBaseAfter = await typed(base).balanceOf(signers.alice.address);
    const bobBaseAfter = await typed(base).balanceOf(signers.bob.address);
    const sellerBaseAfter = await typed(base).balanceOf(signers.seller.address);
    const sellerQuoteAfter = await typed(quote).balanceOf(signers.seller.address);
    const aliceQuoteAfter = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteAfter = await typed(quote).balanceOf(signers.bob.address);

    // Q = 130, S = 100 => allocations floor(q_i * S / Q)
    const aliceAlloc = Math.floor((aliceQty * Number(S)) / 130);
    const bobAlloc = Math.floor((bobQty * Number(S)) / 130);

    expect(aliceBaseAfter - aliceBaseBefore).to.eq(BigInt(aliceAlloc));
    expect(bobBaseAfter - bobBaseBefore).to.eq(BigInt(bobAlloc));

    // Seller quote received equals sum alloc * vwap
    const expectedSellerQuote = BigInt(aliceAlloc * vwap + bobAlloc * vwap);
    expect(sellerQuoteAfter - sellerQuoteBefore).to.eq(expectedSellerQuote);

    // Refunds implied: from pre-settlement snapshot (post-escrow), delta equals (maxSpend - spend)
    const aliceSpend = BigInt(aliceAlloc * vwap);
    const bobSpend = BigInt(bobAlloc * vwap);
    const expectedAliceRefund = BigInt(aliceCap * aliceQty) - aliceSpend;
    const expectedBobRefund = BigInt(bobCap * bobQty) - bobSpend;
    expect(aliceQuoteAfter - aliceQuoteBefore).to.eq(expectedAliceRefund);
    expect(bobQuoteAfter - bobQuoteBefore).to.eq(expectedBobRefund);

    // Base remainder returned to seller
    const distributed = BigInt(aliceAlloc + bobAlloc);
    expect(sellerBaseAfter - sellerBaseBefore).to.eq(S - distributed);
  });

  it("no eligible: all refunded, seller gets back all base", async () => {
    const S = 100n;
    await (await typed(base).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(
          await base.getAddress(),
          await quote.getAddress(),
          S,
          ts - 10,
          ts + 3600
        )
    ).wait();
    const auctionId = 1;

    // Two bids with caps below final vwap
    const maxSpend1 = 100n;
    await (await typed(quote).approve(await auction.getAddress(), maxSpend1)).wait();
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
    await (await typed(quote).approve(await auction.getAddress(), maxSpend2)).wait();
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
    const vwap = 100;

    const sellerBaseBefore = await typed(base).balanceOf(signers.seller.address);
    const aliceQuoteBefore = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteBefore = await typed(quote).balanceOf(signers.bob.address);

    await (await typed(auction).settle(auctionId, vwap)).wait();

    const sellerBaseAfter = await typed(base).balanceOf(signers.seller.address);
    const aliceQuoteAfter = await typed(quote).balanceOf(signers.alice.address);
    const bobQuoteAfter = await typed(quote).balanceOf(signers.bob.address);

    // Seller recovered full base
    expect(sellerBaseAfter - sellerBaseBefore).to.eq(S);
    // Full refunds from pre-settlement snapshot
    expect(aliceQuoteAfter - aliceQuoteBefore).to.eq(maxSpend1);
    expect(bobQuoteAfter - bobQuoteBefore).to.eq(maxSpend2);
  });

  it("window and sequencing checks", async () => {
    const S = 10n;
    await (await typed(base).approve(await auction.getAddress(), S)).wait();
    const ts = await latestTimestamp();
    const start = ts + 120; // future
    const end = start + 60;
    await (
      await typed(auction)
        .connect(signers.seller)
        .createAuction(await base.getAddress(), await quote.getAddress(), S, start, end)
    ).wait();
    const auctionId = 1;

    // Cannot bid before window
    const enc = await fhevm
      .createEncryptedInput(await auction.getAddress(), signers.alice.address)
      .add64(100)
      .encrypt();
    await expect(
      typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, enc.handles[0], enc.inputProof, 1, 200, 200)
    ).to.be.revertedWith("not in window");

    // Cannot compute before end
    await expect(typed(auction).computeEncryptedVWAP(auctionId)).to.be.revertedWith("too early");

    // Move into window and place a bid
    await increaseTime(130);
    await (await typed(quote).approve(await auction.getAddress(), 1000n)).wait();
    await (
      await typed(auction)
        .connect(signers.alice)
        .submitBid(auctionId, enc.handles[0], enc.inputProof, 2, 150, 300)
    ).wait();

    // Move past end, compute
    await increaseTime(120);
    await (await typed(auction).computeEncryptedVWAP(auctionId)).wait();

    // Cannot compute twice
    await expect(typed(auction).computeEncryptedVWAP(auctionId)).to.be.revertedWith("already computed");
  });
});


