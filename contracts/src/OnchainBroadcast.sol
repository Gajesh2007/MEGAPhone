// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OnchainBroadcast {
    event Batch(
        bytes32 indexed channelId,
        uint32  seqStart,
        uint8   count,
        bytes   payload   // packed Opus frames
    );

    /**
     * @notice Send a batch of audio frames to a channel
     * @param channelId Unique identifier for the broadcast channel
     * @param seqStart Starting sequence number for this batch
     * @param frames Encoded Opus audio frames
     */
    function sendBatch(bytes32 channelId, uint32 seqStart, bytes calldata frames) external {
        // Calculate how many frames are in this batch
        uint8 count = uint8(frames.length / 160); // Assuming 160 bytes per Opus frame
        
        // Emit the batch event
        emit Batch(channelId, seqStart, count, frames);
    }
}
