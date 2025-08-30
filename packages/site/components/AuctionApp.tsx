"use client";

import { useFhevm } from "../fhevm/useFhevm";
import { FhevmDecryptionSignature } from "@/fhevm/FhevmDecryptionSignature";
import { useInMemoryStorage } from "@/hooks/useInMemoryStorage";
import { useMetaMaskEthersSigner } from "../hooks/metamask/useMetaMaskEthersSigner";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FhevmInstance } from "@/fhevm/fhevmTypes";
import type { GenericStringStorage } from "@/fhevm/GenericStringStorage";

import { FHEVWAPAuctionABI } from "@/abi/FHEVWAPAuctionABI";
import { FHEVWAPAuctionAddresses } from "@/abi/FHEVWAPAuctionAddresses";
import { BaseTokenABI } from "@/abi/BaseTokenABI";
import { BaseTokenAddresses } from "@/abi/BaseTokenAddresses";
import { QuoteTokenABI } from "@/abi/QuoteTokenABI";
import { QuoteTokenAddresses } from "@/abi/QuoteTokenAddresses";

type AuctionView = {
  id: number;
  seller: string;
  S: bigint;
  start: number;
  end: number;
  vwap: bigint;
  vwapSet: boolean;
  settled: boolean;
  sumQ: bigint;
};

export const AuctionApp = () => {
  const { provider, chainId, isConnected, connect, ethersSigner, ethersReadonlyProvider } = useMetaMaskEthersSigner();
  const { instance } = useFhevm({ provider, chainId, enabled: true });
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  const [message, setMessage] = useState<string>("");
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [decryptedVwaps, setDecryptedVwaps] = useState<Record<number, bigint>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const auctionAddress = useMemo(() => {
    if (!chainId) return undefined;
    return FHEVWAPAuctionAddresses[String(chainId) as keyof typeof FHEVWAPAuctionAddresses]?.address as
      | `0x${string}`
      | undefined;
  }, [chainId]);

  const baseAddress = useMemo(() => {
    if (!chainId) return undefined;
    return BaseTokenAddresses[String(chainId) as keyof typeof BaseTokenAddresses]?.address as `0x${string}` | undefined;
  }, [chainId]);

  const quoteAddress = useMemo(() => {
    if (!chainId) return undefined;
    return QuoteTokenAddresses[String(chainId) as keyof typeof QuoteTokenAddresses]?.address as
      | `0x${string}`
      | undefined;
  }, [chainId]);

  const auctionReadonly = useMemo(() => {
    if (!auctionAddress || !ethersReadonlyProvider) return undefined;
    return new ethers.Contract(auctionAddress, FHEVWAPAuctionABI.abi, ethersReadonlyProvider);
  }, [auctionAddress, ethersReadonlyProvider]);

  const auctionSigner = useMemo(() => {
    if (!auctionAddress || !ethersSigner) return undefined;
    return new ethers.Contract(auctionAddress, FHEVWAPAuctionABI.abi, ethersSigner);
  }, [auctionAddress, ethersSigner]);

  const baseToken = useMemo(() => {
    if (!baseAddress || !ethersSigner) return undefined;
    return new ethers.Contract(baseAddress, BaseTokenABI.abi, ethersSigner);
  }, [baseAddress, ethersSigner]);

  const quoteToken = useMemo(() => {
    if (!quoteAddress || !ethersSigner) return undefined;
    return new ethers.Contract(quoteAddress, QuoteTokenABI.abi, ethersSigner);
  }, [quoteAddress, ethersSigner]);

  const refreshAuctions = useCallback(async () => {
    if (!auctionReadonly) return;
    try {
      setIsLoading(true);
      const count: bigint = await auctionReadonly.auctionsCount();
      const list: AuctionView[] = [];
      for (let i = 1n; i <= count; i++) {
        const a = await auctionReadonly.auctions(i);
        list.push({
          id: Number(i),
          seller: a.seller as string,
          S: a.S as bigint,
          start: Number(a.start),
          end: Number(a.end),
          vwap: a.vwap as bigint,
          vwapSet: a.vwapSet as boolean,
          settled: a.settled as boolean,
          sumQ: a.sumQ as bigint,
        });
      }
      setAuctions(list);
    } catch (e) {
      setMessage("Failed to load auctions: " + (e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [auctionReadonly]);

  useEffect(() => {
    refreshAuctions();
  }, [refreshAuctions]);

  const [formS, setFormS] = useState<string>("100");
  const [formStartMins, setFormStartMins] = useState<string>("0");
  const [formEndMins, setFormEndMins] = useState<string>("10");
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  const onCreateAuction = useCallback(async () => {
    if (!auctionSigner || !baseToken || !baseAddress || !quoteAddress) return;
    try {
      setActionBusy(true);
      const S = BigInt(formS || "0");
      const now = Math.floor(Date.now() / 1000);
      const start = now + Number(formStartMins || 0) * 60;
      const end = now + Number(formEndMins || 0) * 60;
      await (await baseToken.approve(auctionSigner.target, S)).wait();
      const tx = await auctionSigner.createAuction(baseAddress, quoteAddress, S, start, end);
      await tx.wait();
      setMessage("Auction created!");
      await refreshAuctions();
    } catch (e) {
      setMessage("Create failed: " + (e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }, [auctionSigner, baseToken, baseAddress, quoteAddress, formS, formStartMins, formEndMins, refreshAuctions]);

  const [bidAuctionId, setBidAuctionId] = useState<string>("1");
  const [bidPrice, setBidPrice] = useState<string>("100");
  const [bidQty, setBidQty] = useState<string>("10");
  const [bidCap, setBidCap] = useState<string>("120");
  const [bidBusy, setBidBusy] = useState<boolean>(false);

  const onSubmitBid = useCallback(async () => {
    if (!auctionSigner || !instance || !quoteToken || !ethersSigner) return;
    try {
      setBidBusy(true);
      const auctionId = Number(bidAuctionId || "1");
      const price = Number(bidPrice || "0");
      const qty = Number(bidQty || "0");
      const cap = Number(bidCap || "0");
      const maxSpend = BigInt(cap * qty);
      await (await quoteToken.approve(auctionSigner.target, maxSpend)).wait();
      const input = instance.createEncryptedInput(auctionSigner.target as `0x${string}`, ethersSigner.address);
      input.add64(price);
      const enc = await input.encrypt();
      const tx = await auctionSigner.submitBid(auctionId, enc.handles[0], enc.inputProof, qty, cap, maxSpend);
      await tx.wait();
      setMessage("Bid submitted!");
      await refreshAuctions();
    } catch (e) {
      setMessage("Bid failed: " + (e as Error).message);
    } finally {
      setBidBusy(false);
    }
  }, [auctionSigner, instance, quoteToken, ethersSigner, bidAuctionId, bidPrice, bidQty, bidCap, refreshAuctions]);

  // read-only VWAP rendered from decryptedVwaps

  const [settleId, setSettleId] = useState<string>("1");
  const [settleBusy, setSettleBusy] = useState<boolean>(false);
  const onSettle = useCallback(async () => {
    if (!auctionSigner) return;
    try {
      setSettleBusy(true);
      const id = Number(settleId || "1");
      const vwapBig = decryptedVwaps[id];
      if (vwapBig === undefined) {
        setMessage("Decrypt VWAP first for this auction.");
        return;
      }
      const vwap = Number(vwapBig);
      const tx = await auctionSigner.settle(id, vwap);
      await tx.wait();
      setMessage("Settled!");
      await refreshAuctions();
    } catch (e) {
      setMessage("Settle failed: " + (e as Error).message);
    } finally {
      setSettleBusy(false);
    }
  }, [auctionSigner, settleId, decryptedVwaps, refreshAuctions]);

  const [balances, setBalances] = useState<{ base?: bigint; quote?: bigint }>({});
  const refreshBalances = useCallback(async () => {
    if (!ethersSigner || !baseAddress || !quoteAddress || !ethersReadonlyProvider) return;
    try {
      const baseRO = new ethers.Contract(baseAddress, BaseTokenABI.abi, ethersReadonlyProvider);
      const quoteRO = new ethers.Contract(quoteAddress, QuoteTokenABI.abi, ethersReadonlyProvider);
      const [b, q] = await Promise.all([
        baseRO.balanceOf(ethersSigner.address),
        quoteRO.balanceOf(ethersSigner.address),
      ]);
      setBalances({ base: b as bigint, quote: q as bigint });
    } catch {
      // ignore
    }
  }, [ethersSigner, baseAddress, quoteAddress, ethersReadonlyProvider]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  const buttonClass =
    "inline-flex items-center justify-center rounded-xl bg-black px-4 py-3 font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:pointer-events-none";
  const panelClass = "rounded-lg bg-white border-2 border-black p-4";
  const titleClass = "font-semibold text-black text-lg mb-2";
  const labelClass = "text-sm text-black";
  const inputClass =
    "w-full rounded-md border px-3 py-2 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  if (!isConnected) {
    return (
      <div className="mx-auto">
        <button type="button" className={buttonClass} disabled={isConnected} onClick={connect}>
          <span className="text-3xl p-6">Connect to MetaMask</span>
        </button>
      </div>
    );
  }

  if (!auctionAddress || auctionAddress === ethers.ZeroAddress) {
    return (
      <div className="mx-20 p-4 text-red-600 border-red-600 border-2 rounded-lg bg-white">
        Deployment not found for this chain. Please deploy contracts and run npm run genabi.
      </div>
    );
  }

  return (
    <div className="grid w-full gap-4">
      <div className="col-span-full mx-20 bg-black text-white">
        <p className="font-semibold text-3xl m-5">VWAP Auction dApp</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mx-20">
        <div className={panelClass}>
          <p className={titleClass}>Balances</p>
          <p className="text-black">Base ({baseAddress}): <span className="font-mono">{String(balances.base ?? 0n)}</span></p>
          <p className="text-black">Quote ({quoteAddress}): <span className="font-mono">{String(balances.quote ?? 0n)}</span></p>
        </div>
        <div className={panelClass}>
          <p className={titleClass}>Create Auction</p>
          <label htmlFor="s" className={labelClass}>S (base amount)</label>
          <input id="s" className={inputClass} value={formS} onChange={(e) => setFormS(e.target.value)} />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label htmlFor="startM" className={labelClass}>Start (minutes from now)</label>
              <input id="startM" className={inputClass} value={formStartMins} onChange={(e) => setFormStartMins(e.target.value)} />
            </div>
            <div>
              <label htmlFor="endM" className={labelClass}>End (minutes from now)</label>
              <input id="endM" className={inputClass} value={formEndMins} onChange={(e) => setFormEndMins(e.target.value)} />
            </div>
          </div>
          <button type="button" className={`${buttonClass} mt-3`} disabled={actionBusy} onClick={onCreateAuction}>
            {actionBusy ? "Creating..." : "Create"}
          </button>
        </div>
        <div className={panelClass}>
          <p className={titleClass}>Submit Bid</p>
          <label htmlFor="bidId" className={labelClass}>Auction ID</label>
          <input id="bidId" className={inputClass} value={bidAuctionId} onChange={(e) => setBidAuctionId(e.target.value)} />
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div>
              <label htmlFor="price" className={labelClass}>Price (encrypted)</label>
              <input id="price" className={inputClass} value={bidPrice} onChange={(e) => setBidPrice(e.target.value)} />
            </div>
            <div>
              <label htmlFor="qty" className={labelClass}>Qty</label>
              <input id="qty" className={inputClass} value={bidQty} onChange={(e) => setBidQty(e.target.value)} />
            </div>
            <div>
              <label htmlFor="cap" className={labelClass}>Price Cap</label>
              <input id="cap" className={inputClass} value={bidCap} onChange={(e) => setBidCap(e.target.value)} />
            </div>
          </div>
          <button type="button" className={`${buttonClass} mt-3`} disabled={bidBusy} onClick={onSubmitBid}>
            {bidBusy ? "Submitting..." : "Submit Bid"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mx-20">
        <div className={panelClass}>
          <p className={titleClass}>Settle</p>
          <label htmlFor="settleId" className={labelClass}>Auction ID</label>
          <input id="settleId" className={inputClass} value={settleId} onChange={(e) => setSettleId(e.target.value)} />
          <label htmlFor="vwap" className={`${labelClass} mt-2`}>VWAP (decrypted)</label>
          <input id="vwap" className={inputClass} value={decryptedVwaps[Number(settleId || "1")] !== undefined ? String(decryptedVwaps[Number(settleId || "1")]) : "-"} readOnly />
          <button type="button" className={`${buttonClass} mt-3`} disabled={settleBusy} onClick={onSettle}>
            {settleBusy ? "Settling..." : "Settle"}
          </button>
        </div>
        <div className={panelClass}>
          <p className={titleClass}>Status</p>
          <p className="text-black">ChainId: <span className="font-mono">{String(chainId)}</span></p>
          <p className="text-black">Auction: <span className="font-mono">{auctionAddress}</span></p>
          <p className="text-black">Base: <span className="font-mono">{baseAddress}</span></p>
          <p className="text-black">Quote: <span className="font-mono">{quoteAddress}</span></p>
          <p className="text-black mt-2">{message}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mx-20">
        <div className={panelClass}>
          <p className={titleClass}>Compute Enc VWAP</p>
          <ComputeEncVWAP
            buttonClass={buttonClass}
            inputClass={inputClass}
            labelClass={labelClass}
            titleClass={titleClass}
            auctionSigner={auctionSigner}
          />
        </div>
        <div className={panelClass}>
          <p className={titleClass}>Decrypt Enc VWAP</p>
          <DecryptEncVWAP
            buttonClass={buttonClass}
            inputClass={inputClass}
            labelClass={labelClass}
            auctionReadonly={auctionReadonly}
            auctionAddress={auctionAddress}
            instance={instance}
            ethersSigner={ethersSigner}
            fhevmDecryptionSignatureStorage={fhevmDecryptionSignatureStorage}
            onDecrypted={(id, v) => {
              setDecryptedVwaps((prev) => ({ ...prev, [id]: v }));
            }}
            setMessage={setMessage}
          />
        </div>
      </div>

      <div className="col-span-full mx-20">
        <div className={panelClass}>
          <p className={titleClass}>Auctions {isLoading ? "(loading...)" : ""}</p>
          <div className="grid grid-cols-1 gap-2">
            {auctions.length === 0 && <p className="text-black">No auctions yet.</p>}
            {auctions.map((a) => (
              <div key={a.id} className="rounded-md border p-3 text-black">
                <div className="grid grid-cols-6 gap-2">
                  <div><span className="font-semibold">ID</span>: {a.id}</div>
                  <div><span className="font-semibold">Seller</span>: {a.seller}</div>
                  <div><span className="font-semibold">S</span>: {String(a.S)}</div>
                  <div><span className="font-semibold">sumQ</span>: {String(a.sumQ)}</div>
                  <div><span className="font-semibold">VWAP</span>: {decryptedVwaps[a.id] !== undefined ? String(decryptedVwaps[a.id]) : "-"}</div>
                  <div><span className="font-semibold">Settled</span>: {a.settled ? "yes" : "no"}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div><span className="font-semibold">Start</span>: {new Date(a.start * 1000).toLocaleString()}</div>
                  <div><span className="font-semibold">End</span>: {new Date(a.end * 1000).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

function ComputeEncVWAP(props: {
  buttonClass: string;
  inputClass: string;
  labelClass: string;
  titleClass: string;
  auctionSigner: ethers.Contract | undefined;
}) {
  const { buttonClass, inputClass, labelClass, auctionSigner } = props;
  const [id, setId] = useState<string>("1");
  const [busy, setBusy] = useState(false);
  const onCompute = async () => {
    if (!auctionSigner) return;
    try {
      setBusy(true);
      const tx = await auctionSigner.computeEncryptedVWAP(Number(id || "1"));
      await tx.wait();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label htmlFor="cId" className={labelClass}>Auction ID</label>
      <input id="cId" className={inputClass} value={id} onChange={(e) => setId(e.target.value)} />
      <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={onCompute}>
        {busy ? "Computing..." : "Compute"}
      </button>
    </div>
  );
}

function DecryptEncVWAP(props: {
  buttonClass: string;
  inputClass: string;
  labelClass: string;
  auctionReadonly: ethers.Contract | undefined;
  auctionAddress: `0x${string}` | undefined;
  instance: FhevmInstance | undefined;
  ethersSigner: ethers.JsonRpcSigner | undefined;
  fhevmDecryptionSignatureStorage: GenericStringStorage;
  onDecrypted: (id: number, value: bigint) => void;
  setMessage: (m: string) => void;
}) {
  const { buttonClass, inputClass, labelClass, auctionReadonly, auctionAddress, instance, ethersSigner, fhevmDecryptionSignatureStorage, onDecrypted, setMessage } = props;
  const [id, setId] = useState<string>("1");
  const [busy, setBusy] = useState(false);

  const onDecrypt = async () => {
    if (!auctionReadonly || !auctionAddress || !instance || !ethersSigner) return;
    try {
      setBusy(true);
      const auctionId = Number(id || "1");
      const handle = await auctionReadonly.getEncryptedVWAP(auctionId);
      if (!handle || handle === ethers.ZeroHash) {
        setMessage("Encrypted VWAP not computed yet.");
        return;
      }

      const sig = await FhevmDecryptionSignature.loadOrSign(
        instance,
        [auctionAddress],
        ethersSigner,
        fhevmDecryptionSignatureStorage
      );
      if (!sig) {
        setMessage("Unable to build FHEVM decryption signature");
        return;
      }

      const res = await instance.userDecrypt(
        [{ handle, contractAddress: auctionAddress }],
        sig.privateKey,
        sig.publicKey,
        sig.signature,
        sig.contractAddresses,
        sig.userAddress,
        sig.startTimestamp,
        sig.durationDays
      );
      const value = res[handle as string] as bigint;
      onDecrypted(auctionId, value);
      setMessage("Decrypted VWAP: " + String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor="dId" className={labelClass}>Auction ID</label>
      <input id="dId" className={inputClass} value={id} onChange={(e) => setId(e.target.value)} />
      <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={onDecrypt}>
        {busy ? "Decrypting..." : "Decrypt"}
      </button>
    </div>
  );
}