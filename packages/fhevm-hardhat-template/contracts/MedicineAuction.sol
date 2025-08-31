// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHEVWAPAuction} from "./FHEVWAPAuction.sol";
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MedicineAuction
/// @notice Semantic specialization for the medicines use-case. Reuses FHEVWAPAuction logic.
contract MedicineAuction is FHEVWAPAuction {
    event MunicipalityBid(
        uint256 indexed auctionId,
        address indexed municipality,
        uint256 kitsRequested,
        uint256 priceCap,
        uint256 maxSpend
    );

    event VWAPFinal(uint256 indexed auctionId, uint256 vwap, string unit);

    function createMedicineAuction(
        IERC20 medicineToken,
        IERC20 stableBRL,
        uint256 kitsAvailable,
        uint64 start,
        uint64 end
    ) external returns (uint256 auctionId) {
        auctionId = createAuction(medicineToken, stableBRL, kitsAvailable, start, end);
    }

    function submitMunicipalityBid(
        uint256 auctionId,
        externalEuint64 encPriceSBRL,
        bytes calldata inputProof,
        uint256 kitsRequested,
        uint256 priceCap,
        uint256 maxSpend
    ) external {
        submitBid(auctionId, encPriceSBRL, inputProof, kitsRequested, priceCap, maxSpend);
        emit MunicipalityBid(auctionId, msg.sender, kitsRequested, priceCap, maxSpend);
    }

    function resolveVWAPCallback(uint256 requestId, uint64 clearVWAP, bytes[] memory signatures) public override {
        super.resolveVWAPCallback(requestId, clearVWAP, signatures);
        uint256 auctionId = 0; // not available here; UI can use base VWAPDecrypted event.
        emit VWAPFinal(auctionId, uint256(clearVWAP), "sBRL per kit");
    }
}


