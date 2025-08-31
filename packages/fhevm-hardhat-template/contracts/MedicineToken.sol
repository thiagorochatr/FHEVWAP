// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MedicineToken (MTK)
/// @notice ERC20 representing "medicine kits" for the demo. Uses standard 18 decimals.
contract MedicineToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Medicine Token", "MTK") {
        _mint(msg.sender, initialSupply);
    }

    function decimals() public view override returns (uint8) {
        // Demo-friendly: display whole units (no fractional part)
        return 0;
    }

    // Demo faucet
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}


