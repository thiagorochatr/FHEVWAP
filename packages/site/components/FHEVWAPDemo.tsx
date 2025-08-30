"use client";

import { useFhevm } from "../fhevm/useFhevm";
import { useInMemoryStorage } from "../hooks/useInMemoryStorage";
import { useMetaMaskEthersSigner } from "../hooks/metamask/useMetaMaskEthersSigner";
import { ethers } from "ethers";
import { FHEVWAPAuctionABI } from "@/abi/FHEVWAPAuctionABI";
import { FHEVWAPAuctionAddresses } from "@/abi/FHEVWAPAuctionAddresses";
import { BaseTokenABI } from "@/abi/BaseTokenABI";
import { BaseTokenAddresses } from "@/abi/BaseTokenAddresses";
import { QuoteTokenABI } from "@/abi/QuoteTokenABI";
import { QuoteTokenAddresses } from "@/abi/QuoteTokenAddresses";

export const FHEVWAPDemo = () => {
  const { storage: _sigStore } = useInMemoryStorage();
  const { provider, chainId, isConnected, connect, ethersSigner } = useMetaMaskEthersSigner();

  const { instance } = useFhevm({ provider, chainId, enabled: true });

  const buttonClass =
    "inline-flex items-center justify-center rounded-xl bg-black px-4 py-4 font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:pointer-events-none";

  if (!isConnected) {
    return (
      <div className="mx-auto">
        <button type="button" className={buttonClass} disabled={isConnected} onClick={connect}>
          <span className="text-4xl p-6">Connect to MetaMask</span>
        </button>
      </div>
    );
  }

  const auctionAddr = chainId ? (FHEVWAPAuctionAddresses[String(chainId) as keyof typeof FHEVWAPAuctionAddresses]?.address as `0x${string}`) : undefined;
  const baseAddr = chainId ? (BaseTokenAddresses[String(chainId) as keyof typeof BaseTokenAddresses]?.address as `0x${string}`) : undefined;
  const quoteAddr = chainId ? (QuoteTokenAddresses[String(chainId) as keyof typeof QuoteTokenAddresses]?.address as `0x${string}`) : undefined;

  const createAuction = async () => {
    if (!ethersSigner || !auctionAddr || !baseAddr || !quoteAddr) return;
    const c = new ethers.Contract(auctionAddr, FHEVWAPAuctionABI.abi, ethersSigner);
    const base = new ethers.Contract(baseAddr, BaseTokenABI.abi, ethersSigner);
    // approve base
    const S = 100n;
    await (await base.approve(auctionAddr, S)).wait();
    const now = Math.floor(Date.now() / 1000);
    await (await c.createAuction(baseAddr, quoteAddr, S, now, now + 600)).wait();
  };

  const submitBid = async (auctionId: number, price: number, qty: number, priceCap: number) => {
    if (!ethersSigner || !auctionAddr || !instance || !quoteAddr) return;
    const c = new ethers.Contract(auctionAddr, FHEVWAPAuctionABI.abi, ethersSigner);
    const quote = new ethers.Contract(quoteAddr, QuoteTokenABI.abi, ethersSigner);
    const maxSpend = BigInt(priceCap * qty);
    await (await quote.approve(auctionAddr, maxSpend)).wait();

    const input = instance.createEncryptedInput(auctionAddr, ethersSigner.address);
    input.add64(price);
    const enc = await input.encrypt();
    await (await c.submitBid(auctionId, enc.handles[0], enc.inputProof, qty, priceCap, maxSpend)).wait();
  };

  const revealVWAP = async (auctionId: number, vwap: number) => {
    if (!ethersSigner || !auctionAddr) return;
    const c = new ethers.Contract(auctionAddr, FHEVWAPAuctionABI.abi, ethersSigner);
    await (await c.revealVWAP(auctionId, vwap)).wait();
  };

  const settle = async (auctionId: number) => {
    if (!ethersSigner || !auctionAddr) return;
    const c = new ethers.Contract(auctionAddr, FHEVWAPAuctionABI.abi, ethersSigner);
    await (await c.settle(auctionId)).wait();
  };

  return (
    <div className="grid w-full gap-4">
      <div className="col-span-full mx-20 bg-black text-white">
        <p className="font-semibold  text-3xl m-5">VWAP Auction Demo</p>
      </div>
      <div className="grid grid-cols-2 mx-20 gap-4">
        <button type="button" className={buttonClass} onClick={createAuction}>Create Auction (S=100, 10m)</button>
        <button type="button" className={buttonClass} onClick={() => submitBid(1, 100, 10, 120)}>Submit Bid #1 (p=100, q=10, cap=120)</button>
      </div>
      <div className="grid grid-cols-2 mx-20 gap-4">
        <button type="button" className={buttonClass} onClick={() => submitBid(1, 95, 80, 100)}>Submit Bid #2 (p=95, q=80, cap=100)</button>
        <button type="button" className={buttonClass} onClick={() => revealVWAP(1, 98)}>Reveal VWAP=98</button>
      </div>
      <div className="grid grid-cols-2 mx-20 gap-4">
        <button type="button" className={buttonClass} onClick={() => settle(1)}>Settle</button>
      </div>
    </div>
  );
};


