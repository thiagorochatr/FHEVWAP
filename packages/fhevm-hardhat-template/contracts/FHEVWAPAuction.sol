// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title VWAP Batch Auction with Escrow and Zama FHE
/// @notice Implements encrypted per-bid prices and homomorphic aggregation of price*qty. VWAP is revealed post-window.
contract FHEVWAPAuction is SepoliaConfig, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Auction {
        address seller;
        uint256 S; // total baseToken supplied by seller
        uint64 start;
        uint64 end;
        uint256 vwap; // public VWAP (integer)
        bool vwapSet;
        bool settled;
        uint256 sumQ; // clear sum of quantities
        euint64 encSumPQ; // encrypted sum of price*qty (approx on uint64 domain)
        euint64 encVWAP; // encrypted VWAP (encSumPQ / sumQ)
        bool encVWAPComputed;
        IERC20 baseToken;
        IERC20 quoteToken;
    }

    struct Bid {
        address buyer;
        uint256 qty; // requested base amount (clear)
        uint256 priceCap; // clear price cap
        uint256 maxSpend; // approved quote to escrow
        bool settled;
        // We don't store per-bid encrypted price beyond the homomorphic aggregation
    }

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, uint256 S, uint64 start, uint64 end);
    event BidSubmitted(uint256 indexed auctionId, address indexed buyer, uint256 qty, uint256 priceCap, uint256 maxSpend);
    event EncryptedVWAPComputed(uint256 indexed auctionId);
    event VWAPDecryptionRequested(uint256 indexed auctionId, uint256 requestId);
    event VWAPDecrypted(uint256 indexed auctionId, uint256 vwap);
    event Allocated(uint256 indexed auctionId, address indexed buyer, uint256 alloc, uint256 spend);
    event Refunded(uint256 indexed auctionId, address indexed buyer, uint256 amount);
    event SellerPaid(uint256 indexed auctionId, address indexed seller, uint256 amount);
    event BaseRemainderReturned(uint256 indexed auctionId, address indexed seller, uint256 amount);

    uint256 public auctionsCount;
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => Bid[]) internal _bidsByAuction;
    mapping(uint256 => uint256) internal _decryptReqToAuction; // requestId => auctionId

    /// @notice Create a new VWAP auction, deposits seller baseToken into escrow
    function createAuction(
        IERC20 baseToken,
        IERC20 quoteToken,
        uint256 S,
        uint64 start,
        uint64 end
    ) external nonReentrant returns (uint256 auctionId) {
        require(start < end, "invalid window");
        require(S > 0, "zero S");
        require(address(baseToken) != address(quoteToken), "same token");

        auctionId = ++auctionsCount;

        // Pull base from seller to escrow
        baseToken.safeTransferFrom(msg.sender, address(this), S);

        // Initialize encSumPQ to zero handle (implicit)
        Auction storage a = auctions[auctionId];
        a.seller = msg.sender;
        a.S = S;
        a.start = start;
        a.end = end;
        a.vwap = 0;
        a.vwapSet = false;
        a.settled = false;
        a.sumQ = 0;
        a.encSumPQ = FHE.asEuint64(0);
        a.encVWAP = FHE.asEuint64(0);
        a.encVWAPComputed = false;
        a.baseToken = baseToken;
        a.quoteToken = quoteToken;

        // allow contract to decrypt its own aggregate if needed in mock/testing
        FHE.allowThis(a.encSumPQ);

        emit AuctionCreated(auctionId, msg.sender, S, start, end);
    }

    /// @notice Submit a bid with encrypted price and clear qty/caps. Transfers maxSpend quote to escrow.
    function submitBid(
        uint256 auctionId,
        externalEuint64 encPrice,
        bytes calldata inputProof,
        uint256 qty,
        uint256 priceCap,
        uint256 maxSpend
    ) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "no auction");
        require(block.timestamp >= a.start && block.timestamp <= a.end, "not in window");
        require(qty > 0, "qty=0");
        require(maxSpend > 0, "maxSpend=0");

        // Pull quoteToken funds into escrow up to maxSpend
        a.quoteToken.safeTransferFrom(msg.sender, address(this), maxSpend);

        // Convert external encrypted price and accumulate encSumPQ += encPrice * qty
        euint64 price = FHE.fromExternal(encPrice, inputProof);
        // ct * pt then sum
        euint64 product = FHE.mul(price, uint64(qty));
        a.encSumPQ = FHE.add(a.encSumPQ, product);
        // keep permission to this contract
        FHE.allowThis(a.encSumPQ);

        a.sumQ += qty;

        _bidsByAuction[auctionId].push(
            Bid({buyer: msg.sender, qty: qty, priceCap: priceCap, maxSpend: maxSpend, settled: false})
        );

        emit BidSubmitted(auctionId, msg.sender, qty, priceCap, maxSpend);
    }

    /// @notice Computes encrypted VWAP = encSumPQ / sumQ (ciphertext/plaintext division). Does not reveal result.
    function computeEncryptedVWAP(uint256 auctionId) external {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "no auction");
        require(block.timestamp > a.end, "too early");
        require(a.sumQ > 0, "no demand");
        require(!a.encVWAPComputed, "already computed");

        // encVWAP = floor(encSumPQ / sumQ)
        a.encVWAP = FHE.div(a.encSumPQ, uint64(a.sumQ));
        a.encVWAPComputed = true;

        // Allow this contract and caller to decrypt handle off-chain if needed
        FHE.allowThis(a.encVWAP);
        FHE.allow(a.encVWAP, msg.sender);

        emit EncryptedVWAPComputed(auctionId);
    }

    /// @notice Returns the encrypted VWAP handle (requires computeEncryptedVWAP to be called first).
    function getEncryptedVWAP(uint256 auctionId) external view returns (euint64) {
        Auction storage a = auctions[auctionId];
        require(a.encVWAPComputed, "not computed");
        return a.encVWAP;
    }

    /// @notice Request on-chain decryption of the encrypted VWAP via FHE oracle.
    /// The caller may need to attach a fee depending on the deployed oracle configuration.
    function requestVWAPDecryption(uint256 auctionId) external payable returns (uint256 requestId) {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "no auction");
        require(block.timestamp > a.end, "too early");
        require(a.sumQ > 0, "no demand");
        require(a.encVWAPComputed, "not computed");
        require(!a.vwapSet, "already set");
        require(msg.sender == a.seller, "only seller");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(a.encVWAP);
        requestId = FHE.requestDecryption(cts, this.resolveVWAPCallback.selector);
        _decryptReqToAuction[requestId] = auctionId;
        emit VWAPDecryptionRequested(auctionId, requestId);
    }

    /// @notice Oracle callback invoked with clear VWAP. Validates signatures and persists VWAP on-chain.
    function resolveVWAPCallback(uint256 requestId, uint64 clearVWAP, bytes[] memory signatures) public {
        uint256 auctionId = _decryptReqToAuction[requestId];
        require(auctionId != 0, "unknown requestId");
        FHE.checkSignatures(requestId, signatures);

        Auction storage a = auctions[auctionId];
        a.vwap = uint256(clearVWAP);
        a.vwapSet = true;
        emit VWAPDecrypted(auctionId, a.vwap);

        delete _decryptReqToAuction[requestId];
    }

    /// @notice Settle allocations and payments. Performs pro-rata if needed. Requires on-chain decrypted VWAP.
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "no auction");
        require(a.vwapSet, "no vwap");
        require(!a.settled, "settled");
        require(msg.sender == a.seller, "only seller");

        Bid[] storage bids = _bidsByAuction[auctionId];

        // First, compute eligible demand Q (priceCap >= vwap)
        uint256 Q = 0;
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].settled) continue;
            if (bids[i].priceCap >= a.vwap) {
                Q += bids[i].qty;
            }
        }

        uint256 S = a.S;
        uint256 sellerProceeds = 0;

        if (Q == 0) {
            // refund all maxSpend and return base to seller
            for (uint256 i2 = 0; i2 < bids.length; i2++) {
                if (bids[i2].settled) continue;
                bids[i2].settled = true;
                // refund full maxSpend
                if (bids[i2].maxSpend > 0) {
                    a.quoteToken.safeTransfer(bids[i2].buyer, bids[i2].maxSpend);
                    emit Refunded(auctionId, bids[i2].buyer, bids[i2].maxSpend);
                }
            }

            // return all base to seller
            require(a.baseToken.transfer(a.seller, S), "base back failed");
            emit BaseRemainderReturned(auctionId, a.seller, S);
            a.settled = true;
            return;
        }

        // Compute allocations
        uint256 remainingBase = S;
        for (uint256 j = 0; j < bids.length; j++) {
            if (bids[j].settled) continue;
            if (bids[j].priceCap < a.vwap) {
                // ineligible: full refund
                bids[j].settled = true;
                if (bids[j].maxSpend > 0) {
                    a.quoteToken.safeTransfer(bids[j].buyer, bids[j].maxSpend);
                    emit Refunded(auctionId, bids[j].buyer, bids[j].maxSpend);
                }
                continue;
            }

            uint256 alloc;
            if (S >= Q) {
                alloc = bids[j].qty;
            } else {
                // floor((q_i / Q) * S)
                alloc = (bids[j].qty * S) / Q;
            }

            if (alloc > remainingBase) {
                alloc = remainingBase;
            }

            uint256 spend = alloc * a.vwap;
            require(spend <= bids[j].maxSpend, "insufficient escrow");

            // Transfers
            if (alloc > 0) {
                a.baseToken.safeTransfer(bids[j].buyer, alloc);
                remainingBase -= alloc;
            }

            if (spend > 0) {
                // move spend to seller
                a.quoteToken.safeTransfer(a.seller, spend);
                sellerProceeds += spend;
            }

            // refund remaining of maxSpend
            uint256 refund = bids[j].maxSpend - spend;
            if (refund > 0) {
                a.quoteToken.safeTransfer(bids[j].buyer, refund);
                emit Refunded(auctionId, bids[j].buyer, refund);
            }

            bids[j].settled = true;
            emit Allocated(auctionId, bids[j].buyer, alloc, spend);
        }

        // Return any unallocated base to seller
        if (remainingBase > 0) {
            a.baseToken.safeTransfer(a.seller, remainingBase);
            emit BaseRemainderReturned(auctionId, a.seller, remainingBase);
        }

        emit SellerPaid(auctionId, a.seller, sellerProceeds);
        a.settled = true;
    }

    // Convenience getters
    function getBids(uint256 auctionId) external view returns (Bid[] memory) {
        return _bidsByAuction[auctionId];
    }
}


