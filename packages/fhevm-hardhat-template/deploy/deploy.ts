import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Deploy demo ERC20s
  const base = await deploy("BaseToken", {
    from: deployer,
    contract: "MockERC20",
    args: ["BaseToken", "BASE", hre.ethers.parseUnits("1000000", 0)],
    log: true,
  });

  const quote = await deploy("QuoteToken", {
    from: deployer,
    contract: "MockERC20",
    args: ["QuoteToken", "QUOTE", hre.ethers.parseUnits("1000000", 0)],
    log: true,
  });

  // Deploy auction
  const auction = await deploy("FHEVWAPAuction", {
    from: deployer,
    log: true,
  });

  console.log(`Mock BaseToken: `, base.address);
  console.log(`Mock QuoteToken: `, quote.address);
  console.log(`FHEVWAPAuction: `, auction.address);
};
export default func;
func.id = "deploy_vwapAuction"; // id required to prevent reexecution
func.tags = ["VWAPAuction"];
