import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

    // Deploy legacy demo (generic) as well
    const baseToken = await deploy("BaseToken", {
      from: deployer,
      contract: "MockERC20",
      args: ["BaseToken", "BASE", hre.ethers.parseUnits("100000000", 2)],
      log: true,
    });
  
    const quoteToken = await deploy("QuoteToken", {
      from: deployer,
      contract: "MockERC20",
      args: ["QuoteToken", "QUOTE", hre.ethers.parseUnits("100000000", 2)],
      log: true,
    });
  
    const fheVwapAuction = await deploy("FHEVWAPAuction", {
      from: deployer,
      log: true,
    });

  // Deploy use-case ERC20s
  const mtk = await deploy("MedicineToken", {
    from: deployer,
    contract: "MedicineToken",
    args: [hre.ethers.parseUnits("100000000", 2)],
    log: true,
  });

  const susd = await deploy("StableUSD", {
    from: deployer,
    contract: "StableUSD",
    args: [hre.ethers.parseUnits("100000000", 2)],
    log: true,
  });

  // Deploy medicine auction (inherits FHEVWAPAuction)
  const auction = await deploy("MedicineAuction", {
    from: deployer,
    contract: "MedicineAuction",
    log: true,
  });

  console.log(`MedicineToken (MTK): `, mtk.address);
  console.log(`StableUSD (sUSD): `, susd.address);
  console.log(`MedicineAuction: `, auction.address);
  console.log(`BaseToken: `, baseToken.address);
  console.log(`QuoteToken: `, quoteToken.address);
  console.log(`FHEVWAPAuction: `, fheVwapAuction.address);
};
export default func;
func.id = "deploy_medicineAuction"; // id required to prevent reexecution
func.tags = ["MedicineAuction"];
