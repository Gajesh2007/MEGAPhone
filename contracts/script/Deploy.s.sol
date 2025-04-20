// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../lib/forge-std/src/Script.sol";
import "../src/OnchainBroadcast.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        OnchainBroadcast broadcast = new OnchainBroadcast();
        
        vm.stopBroadcast();
        
        console.log("OnchainBroadcast deployed at: ", address(broadcast));
    }
}

// To run this script, you can use the following command:
// forge script:deploy --private-key ${PRIVATE_KEY} --broadcast --rpc-url ${RPC_URL}
