// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHEVWAPAuction} from "../FHEVWAPAuction.sol";

/// @title TestableFHEVWAPAuction
/// @notice Exposes helpers to set VWAP in tests without requiring oracle signatures.
contract TestableFHEVWAPAuction is FHEVWAPAuction {
    function testSetVWAP(uint256 auctionId, uint256 clearVWAP) external {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "no auction");
        a.vwap = clearVWAP;
        a.vwapSet = true;
        emit VWAPDecrypted(auctionId, a.vwap);
    }
}


