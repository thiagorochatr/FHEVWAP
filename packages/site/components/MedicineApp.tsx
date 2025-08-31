"use client";

import { useFhevm } from "../fhevm/useFhevm";
import { useMetaMaskEthersSigner } from "../hooks/metamask/useMetaMaskEthersSigner";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MedicineAuctionABI } from "@/abi/MedicineAuctionABI";
import { MedicineAuctionAddresses } from "@/abi/MedicineAuctionAddresses";
import { MedicineTokenABI } from "@/abi/MedicineTokenABI";
import { MedicineTokenAddresses } from "@/abi/MedicineTokenAddresses";
import { StableUSDABI } from "@/abi/StableUSDABI";
import { StableUSDAddresses } from "@/abi/StableUSDAddresses";

type AuctionView = {
  id: number;
  seller: string;
  kitsAvailable: bigint;
  start: number;
  end: number;
  vwap: bigint;
  vwapSet: boolean;
  settled: boolean;
  sumQ: bigint;
};

export const MedicineApp = () => {
  const { provider, chainId, isConnected, connect, ethersSigner, ethersReadonlyProvider } = useMetaMaskEthersSigner();
  const { instance } = useFhevm({ provider, chainId, enabled: true });

  const [, setMessage] = useState<string>("");
  type ToastKind = "error" | "success" | "info";
  type Toast = { id: string; type: ToastKind; text: string };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const pushToast = useCallback((type: ToastKind, text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => removeToast(id), 4500);
  }, [removeToast]);
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const lastLogRef = useRef<string>("");
  const addLog = useCallback((m: string) => {
    // Avoid consecutive duplicate messages
    if (lastLogRef.current === m) return;
    lastLogRef.current = m;
    setLogs((p) => [...p, `${new Date().toISOString()} — ${m}`]);
  }, []);
  const connectedAddressShort = useMemo(() => {
    const addr = ethersSigner?.address as string | undefined;
    return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : undefined;
  }, [ethersSigner]);

  const auctionAddress = useMemo(() => (chainId ? (MedicineAuctionAddresses[String(chainId) as keyof typeof MedicineAuctionAddresses]?.address as `0x${string}` | undefined) : undefined), [chainId]);
  const mtkAddress = useMemo(() => (chainId ? (MedicineTokenAddresses[String(chainId) as keyof typeof MedicineTokenAddresses]?.address as `0x${string}` | undefined) : undefined), [chainId]);
  const susdAddress = useMemo(() => (chainId ? (StableUSDAddresses[String(chainId) as keyof typeof StableUSDAddresses]?.address as `0x${string}` | undefined) : undefined), [chainId]);

  const auctionReadonly = useMemo(() => (auctionAddress && ethersReadonlyProvider ? new ethers.Contract(auctionAddress, MedicineAuctionABI.abi, ethersReadonlyProvider) : undefined), [auctionAddress, ethersReadonlyProvider]);
  const auctionSigner = useMemo(() => (auctionAddress && ethersSigner ? new ethers.Contract(auctionAddress, MedicineAuctionABI.abi, ethersSigner) : undefined), [auctionAddress, ethersSigner]);
  const mtk = useMemo(() => (mtkAddress && ethersSigner ? new ethers.Contract(mtkAddress, MedicineTokenABI.abi, ethersSigner) : undefined), [mtkAddress, ethersSigner]);
  const susd = useMemo(() => (susdAddress && ethersSigner ? new ethers.Contract(susdAddress, StableUSDABI.abi, ethersSigner) : undefined), [susdAddress, ethersSigner]);

  const [balances, setBalances] = useState<{ mtk?: bigint; susd?: bigint }>({});
  const refreshBalances = useCallback(async () => {
    if (!ethersSigner || !mtkAddress || !susdAddress || !ethersReadonlyProvider) return;
    try {
      const mtkRO = new ethers.Contract(mtkAddress, MedicineTokenABI.abi, ethersReadonlyProvider);
      const susdRO = new ethers.Contract(susdAddress, StableUSDABI.abi, ethersReadonlyProvider);
      const [bm, bs] = await Promise.all([
        mtkRO.balanceOf(ethersSigner.address),
        susdRO.balanceOf(ethersSigner.address),
      ]);
      setBalances({ mtk: bm as bigint, susd: bs as bigint });
    } catch {}
  }, [ethersSigner, mtkAddress, susdAddress, ethersReadonlyProvider]);
  useEffect(() => { refreshBalances(); }, [refreshBalances, auctions]);

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
          kitsAvailable: a.S as bigint,
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

  useEffect(() => {
    if (!auctionSigner) return;
    const onCreated = (id: bigint, seller: string, S: bigint, start: bigint, end: bigint) => {
      addLog(`AuctionCreated: #${Number(id)} seller=${seller} S=${String(S)} start=${Number(start)} end=${Number(end)}`);
    };
    const onBidEv = (id: bigint, buyer: string, qty: bigint, priceCap: bigint, maxSpend: bigint) => {
      addLog(`BidSubmitted: #${Number(id)} buyer=${buyer} qty=${String(qty)} cap=${String(priceCap)} maxSpend=${String(maxSpend)}`);
    };
    const onEnc = (id: bigint) => {
      addLog(`EncryptedVWAPComputed: #${Number(id)}`);
    };
    const onReq = (id: bigint, requestId: bigint) => {
      addLog(`VWAPDecryptionRequested: #${Number(id)} requestId=${String(requestId)}`);
    };
    const onDec = (id: bigint, v: bigint) => {
      addLog(`VWAPDecrypted: #${Number(id)} vwap=${String(v)}`);
      refreshAuctions();
    };
    const onAlloc = (id: bigint, buyer: string, alloc: bigint, spend: bigint) => {
      addLog(`Allocated: #${Number(id)} buyer=${buyer} alloc=${String(alloc)} spend=${String(spend)}`);
    };
    const onRefund = (id: bigint, buyer: string, amount: bigint) => {
      addLog(`Refunded: #${Number(id)} buyer=${buyer} amount=${String(amount)}`);
    };
    const onPaid = (id: bigint, seller: string, amount: bigint) => {
      addLog(`SellerPaid: #${Number(id)} seller=${seller} amount=${String(amount)}`);
    };
    const onRema = (id: bigint, seller: string, amount: bigint) => {
      addLog(`BaseRemainderReturned: #${Number(id)} seller=${seller} amount=${String(amount)}`);
    };

    auctionSigner.on("AuctionCreated", onCreated);
    auctionSigner.on("BidSubmitted", onBidEv);
    auctionSigner.on("EncryptedVWAPComputed", onEnc);
    auctionSigner.on("VWAPDecryptionRequested", onReq);
    auctionSigner.on("VWAPDecrypted", onDec);
    auctionSigner.on("Allocated", onAlloc);
    auctionSigner.on("Refunded", onRefund);
    auctionSigner.on("SellerPaid", onPaid);
    auctionSigner.on("BaseRemainderReturned", onRema);
    return () => {
      try {
        auctionSigner.off("AuctionCreated", onCreated);
        auctionSigner.off("BidSubmitted", onBidEv);
        auctionSigner.off("EncryptedVWAPComputed", onEnc);
        auctionSigner.off("VWAPDecryptionRequested", onReq);
        auctionSigner.off("VWAPDecrypted", onDec);
        auctionSigner.off("Allocated", onAlloc);
        auctionSigner.off("Refunded", onRefund);
        auctionSigner.off("SellerPaid", onPaid);
        auctionSigner.off("BaseRemainderReturned", onRema);
      } catch {}
    };
  }, [auctionSigner, refreshAuctions, addLog]);

  const [kits, setKits] = useState<string>("");
  const [startM, setStartM] = useState<string>("");
  const [endM, setEndM] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const onCreate = useCallback(async () => {
    if (!auctionSigner || !mtk || !mtkAddress || !susdAddress) {
      setMessage("Not ready: missing contracts or addresses. Check Status and run npm run genabi after deploy.");
      addLog("Create aborted: missing auctionSigner/mtk/addresses.");
      return;
    }
    try {
      setCreating(true);
      // Basic required fields
      if (!kits || !startM || !endM) {
        pushToast("error", "Please fill Kits, Start and End.");
        return;
      }
      const kitsNum = Number(kits);
      const startNum = Number(startM);
      const endNum = Number(endM);
      if (!Number.isFinite(kitsNum) || !Number.isFinite(startNum) || !Number.isFinite(endNum)) {
        pushToast("error", "Inputs must be numeric values.");
        return;
      }
      const S = BigInt(kitsNum);
      const now = Math.floor(Date.now() / 1000);
      const start = now + startNum * 60;
      const end = now + endNum * 60;
      // Preflight validations to avoid revert
      if (S === 0n) {
        setMessage("Kits must be > 0");
        addLog("Validation failed: S == 0");
        return;
      }
      if (start >= end) {
        setMessage("Invalid window: start must be before end");
        addLog(`Validation failed: start(${start}) >= end(${end})`);
        return;
      }
      if (mtkAddress === susdAddress) {
        setMessage("Medicine token and USD token must be different");
        addLog("Validation failed: same token addresses");
        return;
      }
      const bal: bigint = await mtk.balanceOf(ethersSigner!.address);
      if (bal < S) {
        setMessage(`Insufficient MED balance. Have ${bal}, need ${S}`);
        addLog(`Validation failed: balance ${bal} < S ${S}`);
        return;
      }
      addLog(`Approving MED allowance: S=${S}`);
      const apx = await mtk.approve(auctionSigner.target, S);
      addLog(`approve tx: ${apx.hash}`);
      await apx.wait();
      addLog(`approve confirmed`);
      addLog(`createMedicineAuction start`);
      const tx = await auctionSigner.createMedicineAuction(mtkAddress, susdAddress, S, start, end);
      addLog(`create tx: ${tx.hash}`);
      await tx.wait();
      addLog(`create confirmed`);
      setMessage("Auction created!");
      pushToast("success", "Auction created successfully.");
      refreshAuctions();
      // clear inputs
      setKits("");
      setStartM("");
      setEndM("");
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setMessage("Create failed: " + msg);
      addLog("Create failed: " + msg);
      pushToast("error", "Create failed. Check Activity Log for details.");
    } finally {
      setCreating(false);
    }
  }, [auctionSigner, mtk, mtkAddress, susdAddress, kits, startM, endM, refreshAuctions, addLog, ethersSigner, pushToast]);

  const [bidId, setBidId] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [cap, setCap] = useState<string>("");
  const [bidding, setBidding] = useState<boolean>(false);
  const onBid = useCallback(async () => {
    if (!auctionSigner || !instance || !susd || !ethersSigner) {
      addLog("Bid aborted: missing signer/instance/sUSD/signer address");
      return;
    }
    try {
      setBidding(true);
      if (!bidId || !price || !qty || !cap) {
        pushToast("error", "Please fill Auction ID, Price, Kits and Price Cap.");
        return;
      }
      const id = Number(bidId);
      const p = Number(price);
      const q = Number(qty);
      const c = Number(cap);
      if (!Number.isInteger(id) || !Number.isFinite(p) || !Number.isFinite(q) || !Number.isFinite(c)) {
        pushToast("error", "Inputs must be valid numbers.");
        return;
      }
      const ms = BigInt(c * q);
      addLog(`Bid start: auctionId=${id}, price(plain)=${p}, qty=${q}, cap=${c}, maxSpend=${ms}`);
      addLog(`Approving sUSD allowance: ${ms}`);
      const ap = await susd.approve(auctionSigner.target, ms);
      addLog(`sUSD approve tx: ${ap.hash}`);
      await ap.wait();
      addLog(`sUSD approve confirmed`);
      addLog(`Encrypting price with FHEVM`);
      const input = instance.createEncryptedInput(auctionSigner.target as `0x${string}`, ethersSigner.address);
      input.add64(p);
      const enc = await input.encrypt();
      const handleHex = ethers.hexlify(enc.handles[0]);
      const proofHex = ethers.hexlify(enc.inputProof);
      addLog(`Encrypted handle[0]: ${handleHex}`);
      addLog(`InputProof length: ${proofHex.length} hex chars, preview: ${proofHex.slice(0, 20)}...`);
      addLog(`submitMunicipalityBid sending...`);
      const tx = await auctionSigner.submitMunicipalityBid(id, enc.handles[0], enc.inputProof, q, c, ms);
      addLog(`bid tx: ${tx.hash}`);
      const rcpt = await tx.wait();
      addLog(`bid confirmed (block ${rcpt.blockNumber})`);
      setMessage("Bid submitted!");
      refreshAuctions();
      // clear inputs
      setBidId("");
      setPrice("");
      setQty("");
      setCap("");
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setMessage("Bid failed: " + msg);
      addLog("Bid failed: " + msg);
      pushToast("error", "Bid failed. Check Activity Log for details.");
    } finally {
      setBidding(false);
    }
  }, [auctionSigner, instance, susd, ethersSigner, bidId, price, qty, cap, refreshAuctions, addLog, pushToast]);

  // Removed standalone decrypt inputs; actions are per-auction

  // Removed standalone settle inputs; actions are per-auction

  // Per-auction actions (buttons inside the list)
  const decryptFor = useCallback(async (id: number) => {
    if (!auctionSigner || !auctionReadonly) {
      addLog("Decrypt aborted: missing auction contract instances");
      return;
    }
    try {
      addLog(`Decrypt (list) clicked for #${id}`);
      // compute if needed
      let computed = false;
      try {
        const h = await auctionReadonly.getEncryptedVWAP(id);
        if (h && h !== ethers.ZeroHash) computed = true;
      } catch {}
      if (!computed) {
        addLog(`computeEncryptedVWAP start for #${id}`);
        const txc = await auctionSigner.computeEncryptedVWAP(id);
        addLog(`compute tx: ${txc.hash}`);
        const rc = await txc.wait();
        addLog(`compute confirmed (block ${rc.blockNumber})`);
      } else {
        addLog(`Encrypted VWAP already computed for #${id}`);
      }
      addLog(`requestVWAPDecryption start for #${id}`);
      const txd = await auctionSigner.requestVWAPDecryption(id);
      addLog(`decrypt request tx: ${txd.hash}`);
      const rd = await txd.wait();
      addLog(`decrypt request confirmed (block ${rd.blockNumber})`);
      setMessage("On-chain decryption requested.");
      pushToast("success", "On-chain decryption requested.");
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setMessage("Decrypt request failed: " + msg);
      addLog("Decrypt request failed: " + msg);
      pushToast("error", "Decrypt request failed. Check Activity Log for details.");
    }
  }, [auctionSigner, auctionReadonly, addLog, pushToast]);

  const settleFor = useCallback(async (id: number) => {
    if (!auctionSigner) return;
    try {
      addLog(`Settle (list) clicked for #${id}`);
      const tx = await auctionSigner.settle(id);
      addLog(`settle tx: ${tx.hash}`);
      const r = await tx.wait();
      addLog(`settle confirmed (block ${r.blockNumber})`);
      setMessage("Settled!");
      pushToast("success", "Auction settled successfully.");
      refreshAuctions();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setMessage("Settle failed: " + msg);
      addLog("Settle failed: " + msg);
      pushToast("error", "Settle failed. Check Activity Log for details.");
    }
  }, [auctionSigner, refreshAuctions, addLog, pushToast]);

  const button = "inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-3 font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 disabled:pointer-events-none";
  const panel = "rounded-xl bg-white/90 backdrop-blur border-2 border-amber-900 p-5";
  const title = "font-bold text-amber-900 text-lg mb-2";
  const label = "text-sm text-amber-900";
  const input = "w-full rounded-md border px-3 py-2 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500";

  if (!isConnected) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-b from-amber-50 to-yellow-50">
        <div className="mx-auto mt-28 flex items-center justify-center">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-6 py-4 text-lg font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-amber-700 active:bg-amber-800"
            onClick={connect}
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-amber-50 to-yellow-50">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg border-2 px-4 py-3 shadow ${t.type === 'error' ? 'bg-red-50 border-red-800' : t.type === 'success' ? 'bg-green-50 border-green-800' : 'bg-amber-50 border-amber-800'}`}>
            <div className="flex items-start justify-between gap-3">
              <p className={`${t.type === 'error' ? 'text-red-900' : t.type === 'success' ? 'text-green-900' : 'text-amber-900'} font-semibold`}>{t.type === 'error' ? 'Error' : t.type === 'success' ? 'Success' : 'Notice'}</p>
              <button type="button" className="text-black/60 hover:text-black" onClick={() => removeToast(t.id)}>✕</button>
            </div>
            <p className="text-black mt-1 text-sm">{t.text}</p>
          </div>
        ))}
      </div>
      <div className="mx-8 mt-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-amber-900">Medicine Auction (FHE)</h1>
          <p className="text-amber-800 mt-1">Secure, privacy-preserving price discovery with on-chain decryption.</p>
        </div>
        <div className="rounded-xl bg-white/80 border-2 border-amber-900 px-4 py-3">
          <p className="text-amber-900 font-bold">Wallet: <span className="font-mono">{connectedAddressShort ?? "-"}</span></p>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <p className="text-black">MTK: <span className="font-mono">{String(balances.mtk ?? 0n)}</span></p>
            <p className="text-black">sUSD: <span className="font-mono">{String(balances.susd ?? 0n)}</span></p>
          </div>
          <div className="mt-2">
            <button type="button" className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-700 active:bg-amber-800" onClick={refreshBalances}>
              Refresh Balances
            </button>
          </div>
        </div>
      </div>
      <div className="mx-8 mt-3">
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-xl bg-white/80 border-2 border-amber-900 p-4">
            <p className="text-amber-900 font-bold">1) Create</p>
            <p className="text-black text-sm">Supplier deposits MED kits and sets a time window.</p>
          </div>
          <div className="rounded-xl bg-white/80 border-2 border-amber-900 p-4">
            <p className="text-amber-900 font-bold">2) Bid (Private)</p>
            <p className="text-black text-sm">Municipalities encrypt price caps; only totals are aggregated.</p>
          </div>
          <div className="rounded-xl bg-white/80 border-2 border-amber-900 p-4">
            <p className="text-amber-900 font-bold">3) Decrypt VWAP</p>
            <p className="text-black text-sm">After close, request on-chain decryption of the final VWAP.</p>
          </div>
          <div className="rounded-xl bg-white/80 border-2 border-amber-900 p-4">
            <p className="text-amber-900 font-bold">4) Settle</p>
            <p className="text-black text-sm">Allocate pro-rata at VWAP, transfer sUSD, and return remainders.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mx-8 mt-4">
        <div className={panel}>
          <p className={title}>Create Auction</p>
          <label htmlFor="kits" className={label}>Kits Available</label>
          <input id="kits" className={input} value={kits} onChange={(e) => setKits(e.target.value)} />
          <p className="text-xs text-black mt-1">Amount of MED kits the supplier is offering.</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label htmlFor="startM" className={label}>Start (minutes from now)</label>
              <input id="startM" className={input} value={startM} onChange={(e) => setStartM(e.target.value)} />
              <p className="text-xs text-black mt-1">When the auction becomes active.</p>
            </div>
            <div>
              <label htmlFor="endM" className={label}>End (minutes from now)</label>
              <input id="endM" className={input} value={endM} onChange={(e) => setEndM(e.target.value)} />
              <p className="text-xs text-black mt-1">Last moment to accept bids.</p>
            </div>
          </div>
          <button type="button" className={`${button} mt-3`} disabled={creating} onClick={onCreate}>{creating ? "Creating..." : "Create"}</button>
        </div>
        <div className={panel}>
          <p className={title}>Submit Municipality Bid</p>
          <label htmlFor="bidId" className={label}>Auction ID</label>
          <input id="bidId" className={input} value={bidId} onChange={(e) => setBidId(e.target.value)} />
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div>
              <label htmlFor="price" className={label}>Price (sUSD per kit, encrypted)</label>
              <input id="price" className={input} value={price} onChange={(e) => setPrice(e.target.value)} />
              <p className="text-xs text-black mt-1">This value is encrypted before going on-chain.</p>
            </div>
            <div>
              <label htmlFor="qty" className={label}>Kits</label>
              <input id="qty" className={input} value={qty} onChange={(e) => setQty(e.target.value)} />
              <p className="text-xs text-black mt-1">Number of kits requested.</p>
            </div>
            <div>
              <label htmlFor="cap" className={label}>Price Cap</label>
              <input id="cap" className={input} value={cap} onChange={(e) => setCap(e.target.value)} />
              <p className="text-xs text-black mt-1">Max sUSD you accept per kit.</p>
            </div>
          </div>
          <button type="button" className={`${button} mt-3`} disabled={bidding} onClick={onBid}>{bidding ? "Submitting..." : "Submit Bid"}</button>
        </div>
        {/* Removed standalone decrypt panel (actions now per auction) */}
      </div>
      {/* Removed standalone settle panel; Status relocated below Log */}

      <div className="mx-8 mt-4">
        <div className={panel}>
          <p className={title}>Auctions {isLoading ? "(loading...)" : ""}</p>
          <div className="grid grid-cols-1 gap-2">
            {auctions.length === 0 && <p className="text-black">No auctions yet.</p>}
            {auctions.map((a) => (
              <div key={a.id} className="rounded-md border-2 border-amber-900 p-4 text-black bg-white/70">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-amber-900">Auction #{a.id}</div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${a.vwapSet ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{a.vwapSet ? 'VWAP Ready' : 'Pending VWAP'}</span>
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${a.settled ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{a.settled ? 'Settled' : 'Open'}</span>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2 mt-2">
                  <div><span className="font-semibold">Seller</span><div className="font-mono text-xs break-all">{a.seller}</div></div>
                  <div><span className="font-semibold">Kits</span><div>{String(a.kitsAvailable)}</div></div>
                  <div><span className="font-semibold">sumQ</span><div>{String(a.sumQ)}</div></div>
                  <div><span className="font-semibold">VWAP</span><div>{a.vwapSet ? `${String(a.vwap)} sUSD/kit` : '-'}</div></div>
                  <div><span className="font-semibold">Window</span><div className="text-xs">{new Date(a.start * 1000).toLocaleString()} → {new Date(a.end * 1000).toLocaleString()}</div></div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  {ethersSigner?.address && a.seller && ethersSigner.address.toLowerCase() === a.seller.toLowerCase() ? (
                    <>
                      {!a.vwapSet && (
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 active:bg-amber-800"
                          onClick={() => decryptFor(a.id)}
                          title={'Decrypt final VWAP on-chain'}
                        >
                          Decrypt VWAP
                        </button>
                      )}
                      {a.vwapSet && !a.settled && (
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 active:bg-amber-800"
                          onClick={() => settleFor(a.id)}
                          title={'Settle allocations and payments'}
                        >
                          Settle
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-amber-800">Only the seller can decrypt and settle this auction.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-8 mt-4 mb-10">
        <div className={panel}>
          <p className={title}>Activity Log</p>
          <div className="grid grid-cols-1 gap-1 max-h-72 overflow-auto">
            {logs.length === 0 && <p className="text-black">No activity yet.</p>}
            {logs.map((l, i) => (
              <p key={i} className="text-black font-mono text-xs">{l}</p>
            ))}
          </div>
          <button type="button" className={`${button} mt-3`} onClick={() => setLogs([])}>Clear Log</button>
        </div>
        <div className={`${panel} mt-4`}>
          <p className={title}>Status</p>
          <p className="text-black">ChainId: <span className="font-mono">{String(chainId)}</span></p>
          <p className="text-black">MedicineAuction: <span className="font-mono">{auctionAddress}</span></p>
          <p className="text-black">MTK: <span className="font-mono">{mtkAddress}</span></p>
          <p className="text-black">sUSD: <span className="font-mono">{susdAddress}</span></p>
        </div>
      </div>
    </div>
  );
};


