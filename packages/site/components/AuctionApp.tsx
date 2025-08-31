"use client";

import { useFhevm } from "../fhevm/useFhevm";
import { useMetaMaskEthersSigner } from "../hooks/metamask/useMetaMaskEthersSigner";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";

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

  const [message, setMessage] = useState<string>("");
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  // on-chain vwap is fetched in refreshAuctions via a.vwap / a.vwapSet
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = useCallback((m: string) => {
    setLogs((prev) => [...prev, `${new Date().toISOString()} — ${m}`]);
  }, []);

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

  const connectedAddressShort = useMemo(() => {
    const addr = ethersSigner?.address as string | undefined;
    if (!addr) return undefined;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }, [ethersSigner]);

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
      addLog(`Refreshed auctions (count=${list.length}).`);
    } catch (e) {
      setMessage("Failed to load auctions: " + (e as Error).message);
      addLog(`Failed to load auctions: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [auctionReadonly, addLog]);

  useEffect(() => {
    refreshAuctions();
  }, [refreshAuctions]);

  // Listen for on-chain VWAP decryption completion and refresh UI immediately
  useEffect(() => {
    if (!auctionSigner) return;
    const handler = (auctionId: bigint, vwap: bigint) => {
      setMessage(`VWAP decrypted on-chain for #${Number(auctionId)}: ${String(vwap)}`);
      addLog(`Oracle callback: VWAPDecrypted(auctionId=${Number(auctionId)}, vwap=${String(vwap)})`);
      refreshAuctions();
    };
    auctionSigner.on("VWAPDecrypted", handler);
    return () => {
      try {
        auctionSigner.off("VWAPDecrypted", handler);
      } catch {}
    };
  }, [auctionSigner, refreshAuctions, addLog]);

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
      addLog(`Approving BaseToken allowance to auction...`);
      await (await baseToken.approve(auctionSigner.target, S)).wait();
      addLog(`BaseToken approved.`);
      const tx = await auctionSigner.createAuction(baseAddress, quoteAddress, S, start, end);
      addLog(`createAuction sent: tx=${tx.hash}`);
      await tx.wait();
      addLog(`createAuction confirmed.`);
      setMessage("Auction created!");
      await refreshAuctions();
    } catch (e) {
      setMessage("Create failed: " + (e as Error).message);
      addLog(`Create failed: ${(e as Error).message}`);
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
      addLog(`Approving QuoteToken allowance (maxSpend=${maxSpend})...`);
      await (await quoteToken.approve(auctionSigner.target, maxSpend)).wait();
      addLog(`QuoteToken approved.`);
      addLog(`Encrypting price with FHE (WASM)...`);
      const input = instance.createEncryptedInput(auctionSigner.target as `0x${string}`, ethersSigner.address);
      input.add64(price);
      const enc = await input.encrypt();
      addLog(`Encryption done. handle=${String(enc.handles[0])}, proofBytes=${enc.inputProof?.length ?? 0}`);
      const tx = await auctionSigner.submitBid(auctionId, enc.handles[0], enc.inputProof, qty, cap, maxSpend);
      addLog(`submitBid sent: tx=${tx.hash}`);
      await tx.wait();
      addLog(`submitBid confirmed.`);
      setMessage("Bid submitted!");
      await refreshAuctions();
    } catch (e) {
      setMessage("Bid failed: " + (e as Error).message);
      addLog(`Bid failed: ${(e as Error).message}`);
    } finally {
      setBidBusy(false);
    }
  }, [auctionSigner, instance, quoteToken, ethersSigner, bidAuctionId, bidPrice, bidQty, bidCap, refreshAuctions]);

  const [settleId, setSettleId] = useState<string>("1");
  const [settleBusy, setSettleBusy] = useState<boolean>(false);
  const currentAuction = useMemo(() => {
    const idNum = Number(settleId || "1");
    return auctions.find((a) => a.id === idNum);
  }, [auctions, settleId]);
  const onSettle = useCallback(async () => {
    if (!auctionSigner) return;
    try {
      setSettleBusy(true);
      const id = Number(settleId || "1");
      const tx = await auctionSigner.settle(id);
      addLog(`settle sent: tx=${tx.hash}`);
      await tx.wait();
      addLog(`settle confirmed.`);
      setMessage("Settled!");
      await refreshAuctions();
    } catch (e) {
      setMessage("Settle failed: " + (e as Error).message);
      addLog(`Settle failed: ${(e as Error).message}`);
    } finally {
      setSettleBusy(false);
    }
  }, [auctionSigner, settleId, refreshAuctions]);

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
          <p className="text-black">Wallet: <span className="font-mono">{connectedAddressShort ?? "-"}</span></p>
          <p className="text-black">Base: <span className="font-mono">{String(balances.base ?? 0n)}</span></p>
          <p className="text-black">Quote: <span className="font-mono">{String(balances.quote ?? 0n)}</span></p>
        </div>
        <div className={panelClass}>
          <p className={titleClass}>Create Auction</p>
          <label htmlFor="s" className={labelClass}>Base amount</label>
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
              <label htmlFor="price" className={labelClass}>Price (enc)</label>
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
          <label htmlFor="vwapOnChain" className={`${labelClass} mt-2`}>VWAP (on-chain)</label>
          <input id="vwapOnChain" className={inputClass} value={currentAuction?.vwapSet ? String(currentAuction.vwap) : "-"} readOnly />
          <button type="button" className={`${buttonClass} mt-3`} disabled={settleBusy} onClick={onSettle}>
            {settleBusy ? "Settling..." : "Settle"}
          </button>
        </div>
        <div className={`${panelClass} col-span-2`}>
          <p className={titleClass}>Status</p>
          <p className="text-black">ChainId: <span className="font-mono">{String(chainId)}</span></p>
          <p className="text-black">Auction: <span className="font-mono">{auctionAddress}</span></p>
          <p className="text-black">Base: <span className="font-mono">{baseAddress}</span></p>
          <p className="text-black">Quote: <span className="font-mono">{quoteAddress}</span></p>
          <p className="text-black mt-2">{message}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mx-20">
        <div className={panelClass}>
          <p className={titleClass}>Request On-Chain VWAP Decryption</p>
          <RequestDecVWAP
            buttonClass={buttonClass}
            inputClass={inputClass}
            labelClass={labelClass}
            auctionSigner={auctionSigner}
            auctionReadonly={auctionReadonly}
            setMessage={setMessage}
            addLog={addLog}
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
                  <div><span className="font-semibold">VWAP</span>: {a.vwapSet ? String(a.vwap) : "-"}</div>
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
      <div className="col-span-full mx-20">
        <div className={panelClass}>
          <p className={titleClass}>Activity Log</p>
          <div className="grid grid-cols-1 gap-1 max-h-72 overflow-auto">
            {logs.length === 0 && <p className="text-black">No activity yet.</p>}
            {logs.map((l, i) => (
              <p key={i} className="text-black font-mono text-xs">{l}</p>
            ))}
          </div>
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => setLogs([])}>Clear Log</button>
        </div>
      </div>
    </div>
  );
};

function RequestDecVWAP(props: {
  buttonClass: string;
  inputClass: string;
  labelClass: string;
  auctionSigner: ethers.Contract | undefined;
  auctionReadonly: ethers.Contract | undefined;
  setMessage: (m: string) => void;
  addLog: (m: string) => void;
}) {
  const { buttonClass, inputClass, labelClass, auctionSigner, auctionReadonly, setMessage, addLog } = props;
  const [id, setId] = useState<string>("1");
  const [busy, setBusy] = useState(false);
  const onRequest = async () => {
    if (!auctionSigner) return;
    try {
      setBusy(true);
      const auctionId = Number(id || "1");
      // If already computed by someone else, skip compute step to avoid 'already computed'
      let alreadyComputed = false;
      if (auctionReadonly) {
        try {
          const handle = await auctionReadonly.getEncryptedVWAP(auctionId);
          if (handle && handle !== ethers.ZeroHash) {
            alreadyComputed = true;
            addLog(`encVWAP already computed (handle exists).`);
          }
        } catch {
          // not computed yet -> proceed to compute
        }
      }
      if (!alreadyComputed) {
        const tx1 = await auctionSigner.computeEncryptedVWAP(auctionId);
        addLog(`computeEncryptedVWAP sent: tx=${tx1.hash}`);
        await tx1.wait();
        addLog(`computeEncryptedVWAP confirmed.`);
      }
      const tx2 = await auctionSigner.requestVWAPDecryption(auctionId);
      addLog(`requestVWAPDecryption sent: tx=${tx2.hash}`);
      await tx2.wait();
      addLog(`requestVWAPDecryption confirmed.`);
      setMessage("VWAP decryption requested on-chain.");
      // Optional immediate poll (in case event misses): try to fetch updated vwap after short delay
      if (auctionReadonly) {
        setTimeout(async () => {
          try {
            const a = await auctionReadonly.auctions(auctionId);
            if (a.vwapSet) {
              addLog(`Polled VWAP updated on-chain: ${String(a.vwap)}`);
            }
          } catch {}
        }, 1500);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label htmlFor="rId" className={labelClass}>Auction ID</label>
      <input id="rId" className={inputClass} value={id} onChange={(e) => setId(e.target.value)} />
      <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={onRequest}>
        {busy ? "Requesting..." : "Request"}
      </button>
    </div>
  );
}