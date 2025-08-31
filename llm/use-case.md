# Adapt `FHEVWAPAuction` for a Drug Use Case (Hackathon Demo)

## 🎯 Objective

Transform the generic VWAP auction contract into a clear application for the **use case of drugs in public consortiums**. In the demo, a supplier lists *drug kits* and municipalities send private bids.

-----

## 1\. Rename / Specialize

  - Rename the main contract to `MedicineAuction` (inheriting logic from `FHEVWAPAuction`).
  - Adjust names of structs, events, and variables to be readable within the drug context:
      - `baseToken` → `medicineToken`
      - `quoteToken` → `stableUSD`
      - `qty` → `kitsRequested`
      - `S` → `kitsAvailable`

-----

## 2\. Create Mock Tokens

Implement two simple mock ERC20 tokens (can use OpenZeppelin ERC20):

```solidity
contract MedicineToken is ERC20 {
    constructor() ERC20("Medicine Token", "MTK") {
        _mint(msg.sender, 1_000_000 * 1e18);
    }
}

contract StableUSD is ERC20 {
    constructor() ERC20("Stable USD", "sUSD") {
        _mint(msg.sender, 1_000_000 * 1e18);
    }
}

- MedicineToken (MTK) = represents "generic drug kits".
- StableUSD (sUSD) = represents a USD-pegged stable token for payment.
```

## 3\. Demo Setup

Actors

Supplier → owner of MedicineToken.

Municipality A, B, C → different addresses, hold StableUSD.

Flow

Supplier approves and creates an auction with 100 MTK.

Municipalities make bids:

A: 50 kits, priceCap = 120 sUSD/kit, maxSpend = 6000.

B: 30 kits, priceCap = 100 sUSD/kit, maxSpend = 3000.

C: 20 kits, priceCap = 140 sUSD/kit, maxSpend = 3000.

Closing: contract reveals VWAP = 110 sUSD/kit.

Settlement:

A buys 50 kits (5,500 sUSD paid, 600 refund).

B receives full refund (3,000).

C buys 20 kits (2,200 paid, 800 refund).

Supplier receives 7,700 sUSD, 30 MTK remain.

## 4\. UX / Event Adjustments

Add clearer events for the demo:

```solidity
event MunicipalityBid(
    uint256 indexed auctionId,
    address indexed municipality,
    uint256 kitsRequested,
    uint256 priceCap,
    uint256 maxSpend
);

event VWAPFinal(
    uint256 indexed auctionId,
    uint256 vwap,
    string unit // "USD per kit"
);

```

## 5\. Hardhat Scripts

Deploy MedicineToken and StableUSD.

Mint for supplier and municipalities.

Deploy MedicineAuction.

Supplier creates auction.

Municipalities A, B, C make bids.

Reveal + settle.

Final log: allocations, refunds, supplier balance.

Result

Code specialized for the drug narrative.

Mock tokens (MedicineToken, StableUSD) make the demo intuitive.

Script runs the entire cycle (create → bids → VWAP → settle).

Events/table allow a live demonstration that the system delivers privacy + fair price + transparency.