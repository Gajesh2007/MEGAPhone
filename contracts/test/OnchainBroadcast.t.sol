// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../lib/forge-std/src/Test.sol";
import "../src/OnchainBroadcast.sol";

contract OnchainBroadcastTest is Test {
    OnchainBroadcast public broadcast;
    
    bytes32 public constant CHANNEL_ID = bytes32("test-channel");
    uint32 public constant SEQ_START = 100;
    bytes public audioFrames;
    
    event Batch(
        bytes32 indexed channelId,
        uint32 seqStart,
        uint8 count,
        bytes payload
    );
    
    function setUp() public {
        broadcast = new OnchainBroadcast();
        
        // Create sample audio data (160 bytes per frame, 3 frames)
        audioFrames = new bytes(480);
        for (uint i = 0; i < 480; i++) {
            audioFrames[i] = bytes1(uint8(i % 256));
        }
    }
    
    function testSendBatch() public {
        // Expect the Batch event to be emitted with the correct parameters
        vm.expectEmit(true, true, true, true);
        emit Batch(CHANNEL_ID, SEQ_START, 3, audioFrames);
        
        // Call the sendBatch function
        broadcast.sendBatch(CHANNEL_ID, SEQ_START, audioFrames);
    }
    
    function testSendBatchEmptyPayload() public {
        bytes memory emptyFrames = new bytes(0);
        
        // Expect the Batch event to be emitted with zero count
        vm.expectEmit(true, true, true, true);
        emit Batch(CHANNEL_ID, SEQ_START, 0, emptyFrames);
        
        // Call the sendBatch function with empty payload
        broadcast.sendBatch(CHANNEL_ID, SEQ_START, emptyFrames);
    }
}
