
/*
  This file is auto-generated.
  Command: 'npm run genabi'
*/
export const FHEVWAPAuctionABI = {
  "abi": [
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "alloc",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "spend",
          "type": "uint256"
        }
      ],
      "name": "Allocated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "S",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint64",
          "name": "start",
          "type": "uint64"
        },
        {
          "indexed": false,
          "internalType": "uint64",
          "name": "end",
          "type": "uint64"
        }
      ],
      "name": "AuctionCreated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "BaseRemainderReturned",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "qty",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "priceCap",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "maxSpend",
          "type": "uint256"
        }
      ],
      "name": "BidSubmitted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        }
      ],
      "name": "EncryptedVWAPComputed",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "Refunded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "SellerPaid",
      "type": "event"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "auctions",
      "outputs": [
        {
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "S",
          "type": "uint256"
        },
        {
          "internalType": "uint64",
          "name": "start",
          "type": "uint64"
        },
        {
          "internalType": "uint64",
          "name": "end",
          "type": "uint64"
        },
        {
          "internalType": "bool",
          "name": "settled",
          "type": "bool"
        },
        {
          "internalType": "uint256",
          "name": "sumQ",
          "type": "uint256"
        },
        {
          "internalType": "euint64",
          "name": "encSumPQ",
          "type": "bytes32"
        },
        {
          "internalType": "euint64",
          "name": "encVWAP",
          "type": "bytes32"
        },
        {
          "internalType": "bool",
          "name": "encVWAPComputed",
          "type": "bool"
        },
        {
          "internalType": "contract IERC20",
          "name": "baseToken",
          "type": "address"
        },
        {
          "internalType": "contract IERC20",
          "name": "quoteToken",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "auctionsCount",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        }
      ],
      "name": "computeEncryptedVWAP",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "contract IERC20",
          "name": "baseToken",
          "type": "address"
        },
        {
          "internalType": "contract IERC20",
          "name": "quoteToken",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "S",
          "type": "uint256"
        },
        {
          "internalType": "uint64",
          "name": "start",
          "type": "uint64"
        },
        {
          "internalType": "uint64",
          "name": "end",
          "type": "uint64"
        }
      ],
      "name": "createAuction",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        }
      ],
      "name": "getBids",
      "outputs": [
        {
          "components": [
            {
              "internalType": "address",
              "name": "buyer",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "qty",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "priceCap",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "maxSpend",
              "type": "uint256"
            },
            {
              "internalType": "bool",
              "name": "settled",
              "type": "bool"
            }
          ],
          "internalType": "struct FHEVWAPAuction.Bid[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        }
      ],
      "name": "getEncryptedVWAP",
      "outputs": [
        {
          "internalType": "euint64",
          "name": "",
          "type": "bytes32"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "vwap",
          "type": "uint256"
        }
      ],
      "name": "settle",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "auctionId",
          "type": "uint256"
        },
        {
          "internalType": "externalEuint64",
          "name": "encPrice",
          "type": "bytes32"
        },
        {
          "internalType": "bytes",
          "name": "inputProof",
          "type": "bytes"
        },
        {
          "internalType": "uint256",
          "name": "qty",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "priceCap",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "maxSpend",
          "type": "uint256"
        }
      ],
      "name": "submitBid",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ]
} as const;
