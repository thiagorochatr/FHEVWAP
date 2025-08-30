# 🔒 Especificação do Projeto: Leilão VWAP com Escrow usando Zama FHE

## 🎯 Objetivo
Implementar um contrato inteligente de **leilão em janelas (batch auction)** com **VWAP (Volume Weighted Average Price)**, preservando a privacidade dos lances utilizando **Fully Homomorphic Encryption (FHE)** da **Zama**.

---

## 🪙 Tokens
- **baseToken (ERC20)**: ativo vendido (ex.: USDC).  
- **quoteToken (ERC20)**: ativo usado como pagamento (ex.: BRL-stable).  

---

## 🔄 Fluxo do leilão

1. **Criação do leilão — `createAuction(S, start, end)`**
   - O vendedor deposita `S` unidades de `baseToken` no contrato (escrow).
   - Define janela `[start, end]` para aceitar lances.
   - Estado inicial: leilão aberto.

2. **Envio de bid — `submitBid(encPrice, qty, priceCap, maxSpend)`**
   - O comprador envia:
     - `encPrice`: preço **cifrado** usando Zama TFHE.
     - `qty`: quantidade de `baseToken` desejada (em claro).
     - `priceCap`: teto de preço em claro (protege comprador contra VWAP alto).
     - `maxSpend`: quantidade máxima de `quoteToken` que autoriza gastar.
   - O contrato transfere `maxSpend` em `quoteToken` para escrow.
   - Bid armazenado com `encPrice` e metadados.

3. **Cálculo do VWAP (privado)**
   - Durante a janela, o contrato **agrega homomorficamente**:
     - `Enc(sumPQ) = Σ (encPrice_i × qty_i)`
     - `sumQ = Σ qty_i` (em claro)
   - Nenhum preço individual é revelado.

4. **Revelação do VWAP — `revealVWAP()`**
   - Após `end`, o contrato (ou co-processador FHE off-chain) decifra `Enc(sumPQ)` com a chave de decriptação da Zama.
   - Calcula:
     \[
     VWAP = \frac{Dec(Enc(sumPQ))}{sumQ}
     \]
   - Registra `VWAP` no contrato on-chain.
   - Nenhum bid individual é revelado.

5. **Liquidação — `settle()`**
   - Filtra **elegíveis**: somente bids com `priceCap ≥ VWAP`.
   - Demanda total: `Q = Σ qty_i` dos elegíveis.
   - **Alocação**:
     - Se `S ≥ Q`: cada elegível recebe o que pediu.
     - Se `S < Q`: rateio **pro-rata**:
       \[
       alloc_i = \lfloor \frac{q_i}{Q} \cdot S \rfloor
       \]
   - **Pagamentos**:
     - `spend_i = alloc_i × VWAP`
     - Deduzido do depósito `maxSpend`.
     - Refund do excedente.
   - **Resultado**:
     - Compradores recebem `alloc_i` de `baseToken`.
     - Vendedor recebe soma dos `spend_i` em `quoteToken`.
     - Base não utilizada devolvida ao vendedor.

---

## 📊 Matemática detalhada

- **VWAP**:
  \[
  VWAP = \frac{\sum_i (p_i \cdot q_i)}{\sum_i q_i}
  \]

- **Elegibilidade**:
  \[
  priceCap_i \geq VWAP
  \]

- **Alocação**:
  - `alloc_i = q_i` se `S ≥ Q`.
  - `alloc_i = (q_i/Q) · S` (com floor) se `S < Q`.

- **Pagamentos**:
  - `spend_i = alloc_i · VWAP`
  - `refund_i = maxSpend_i − spend_i`

---

## 🏗️ Estruturas Solidity

```solidity
struct Auction {
  address seller;
  uint256 S;
  uint64 start;
  uint64 end;
  uint256 vwap;
  bool vwapSet;
  bool settled;
}

struct Bid {
  address buyer;
  bytes encPrice;    // ciphertext TFHE (Zama)
  uint256 qty;
  uint256 priceCap;
  uint256 maxSpend;
  bool settled;
}

function createAuction(
  uint256 S,
  uint64 start,
  uint64 end
) external returns (uint256 auctionId);

function submitBid(
  uint256 auctionId,
  bytes calldata encPrice,
  uint256 qty,
  uint256 priceCap,
  uint256 maxSpend
) external;

function revealVWAP(uint256 auctionId) external;

function settle(uint256 auctionId) external;

function sellerWithdrawQuote(uint256 auctionId) external;
function sellerWithdrawBaseRemainder(uint256 auctionId) external;

Eventos

AuctionCreated(auctionId, seller, S, start, end)

BidSubmitted(auctionId, buyer, qty, priceCap)

VWAPRevealed(auctionId, vwap)

Allocated(auctionId, buyer, alloc, spend)

Refunded(auctionId, buyer, amount)

SellerPaid(auctionId, seller, amount)

BaseRemainderReturned(auctionId, seller, amount)

Integração com Zama (TFHE / Concrete)

Cifrar preço (encPrice) off-chain com biblioteca da Zama (relayer SDK).

Enviar ciphertext para o contrato como bytes.

Operações homomórficas suportadas:

encPrice × qty (ciphertext × plaintext)

Soma homomórfica (somatório incremental dos bids).

Decriptação feita no fechamento, via coprocessador FHE (ex.: off-chain worker + MPC/threshold key).

Apenas o VWAP agregado é revelado, nunca os preços individuais.

Testes recomendados

Happy path com bids válidos, VWAP dentro do range, elegíveis recebendo tokens.

Pro-rata: estoque menor que demanda → rateio proporcional correto.

Sem elegíveis: todos reembolsados, vendedor recupera estoque.

Arredondamento: validar pro-rata com decimais e floor.

Segurança: bids fora da janela, reentrância em settle, VWAP só revelado após o fim.

Demo (Hackathon)

Seller cria leilão com 100 USDC.

3 carteiras enviam bids (encPrice gerado com Zama TFHE, qty, priceCap, maxSpend).

Encerrada a janela → revealVWAP().

Demonstração: decriptação do Enc(sumPQ) com TFHE off-chain.

VWAP revelado on-chain (ex.: 98).

settle() redistribui tokens:

Buyers recebem baseToken.

Refunds automáticos.

Seller recebe quoteToken arrecadado + estoque sobrante.

Mostrar logs de eventos e saldos mudando.

Diferenciais

Privacidade real: bids cifrados com Zama TFHE.

Preço único e justo (VWAP) para todos os compradores.

Liquidação justa com escrow automático.

Extensível: pode ser usado em DeFi, FX, energia, IPOs, etc.

