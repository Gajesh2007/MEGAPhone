import React, { useState, useEffect, useRef } from 'react';
import { AudioPlayer, AudioPlayerOptions } from '../utils/audio';
import { listenToAudioBatches } from '../utils/blockchain';
import MetricsDashboard from '../components/MetricsDashboard';

const Listener: React.FC = () => {
  const [channelId, setChannelId] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [unsubscribe, setUnsubscribe] = useState<(() => void) | null>(null);
  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  const [jitterBufferMs, setJitterBufferMs] = useState<number>(100);
  const [volume, setVolume] = useState<number>(1.0);
  const [lastSequence, setLastSequence] = useState<number | null>(null);
  const [packetsReceived, setPacketsReceived] = useState<number>(0);
  const [packetsPlayed, setPacketsPlayed] = useState<number>(0);
  const [packetsLost, setPacketsLost] = useState<number>(0);
  
  // Metrics state
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [totalBytesReceived, setTotalBytesReceived] = useState<number>(0);
  const [blockTime, setBlockTime] = useState<number>(10); // Default 10ms for MegaETH
  const [realtimeLatency, setRealtimeLatency] = useState<number>(0);
  const [lastEventTime, setLastEventTime] = useState<number | null>(null);
  
  // Stats interval
  const statsIntervalRef = useRef<number | null>(null);
  
  // Create audio player
  useEffect(() => {
    const playerOptions: AudioPlayerOptions = {
      onSequenceUpdate: (seq: number) => setLastSequence(seq),
      onStatsUpdate: (stats: { packetsPlayed: number; packetsLost: number; bufferSize?: number }) => {
        setPacketsPlayed(stats.packetsPlayed);
        setPacketsLost(stats.packetsLost);
      }
    };
    
    const newPlayer = new AudioPlayer(playerOptions);
    setPlayer(newPlayer);
    
    return () => {
      if (isListening && newPlayer) {
        newPlayer.stop();
      }
    };
  }, []);
  
  // Apply jitter buffer size changes
  useEffect(() => {
    if (player) {
      player.setJitterBufferMs(jitterBufferMs);
    }
  }, [jitterBufferMs, player]);
  
  // Apply volume changes
  useEffect(() => {
    if (player) {
      player.setVolume(volume);
    }
  }, [volume, player]);
  
  // Handle audio batch from blockchain
  const handleAudioBatch = (batchData: {
    channelId: string;
    seqStart: number;
    count: number;
    payload: Uint8Array;
    blockNumber: bigint;
    transactionHash: string;
  }) => {
    try {
      if (!player || batchData.channelId !== channelId) return;
      
      const now = Date.now();
      const txLatency = lastEventTime ? now - lastEventTime : 0;
      setLastEventTime(now);
      
      // Update metrics
      setPacketsReceived(prev => prev + batchData.count);
      setTotalBytesReceived(prev => prev + batchData.payload.length);
      if (txLatency > 0) {
        setLatencyHistory(prev => [...prev, txLatency]);
        setRealtimeLatency(txLatency);
      }
      
      // Simulated block time (would come from chain in real implementation)
      setBlockTime(Math.floor(Math.random() * 3) + 8); // Random between 8-10ms for demo
      
      // Process the audio batch
      player.processBatch(
        batchData.seqStart,
        batchData.count,
        batchData.payload
      );
      
      const seqEnd = batchData.seqStart + batchData.count - 1;
      setStatusMessage(`Received batch: seq ${batchData.seqStart}-${seqEnd} (${batchData.count} frames)`);
    } catch (error) {
      console.error('Error processing batch:', error);
      setStatusMessage(`Error: ${(error as Error).message}`);
    }
  };
  
  // Start listening
  const startListening = async () => {
    if (!player || !channelId) {
      setStatusMessage('Please enter a channel ID');
      return;
    }
    
    try {
      // Reset metrics
      setLatencyHistory([]);
      setTotalBytesReceived(0);
      setPacketsReceived(0);
      setPacketsPlayed(0);
      setPacketsLost(0);
      setLastSequence(null);
      
      // Initialize player
      await player.start();
      
      // Subscribe to audio batches
      const unsub = await listenToAudioBatches(channelId, handleAudioBatch);
      setUnsubscribe(() => unsub);
      
      setIsListening(true);
      setStatusMessage(`Listening to channel: ${channelId}`);
      
      // Setup periodic stats update
      statsIntervalRef.current = window.setInterval(() => {
        if (latencyHistory.length > 0) {
          // Calculate average latency for last 10 frames
          const recentLatencies = latencyHistory.slice(-10);
          const avgLatency = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
          setRealtimeLatency(Math.round(avgLatency));
        }
      }, 500);
    } catch (error) {
      setStatusMessage(`Error starting listener: ${(error as Error).message}`);
    }
  };
  
  // Stop listening
  const stopListening = () => {
    if (player) {
      player.stop();
    }
    
    if (unsubscribe) {
      unsubscribe();
      setUnsubscribe(null);
    }
    
    setIsListening(false);
    setStatusMessage('Listening stopped');
    
    // Clear stats interval
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
  };
  
  return (
    <div className="listener-container">
      <h1>MEGAPhone Listener</h1>
      <p>Listen to on-chain voice broadcasts from MegaETH</p>
      
      <div className="listening-controls">
        <div>
          <label htmlFor="channel-id">Channel ID:</label>
          <input
            id="channel-id"
            type="text"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="Enter broadcaster's channel ID"
            disabled={isListening}
          />
        </div>
        
        <div className="controls">
          {isListening ? (
            <button
              onClick={stopListening}
              className="stop-button"
            >
              Stop Listening
            </button>
          ) : (
            <button
              onClick={startListening}
              className="start-button"
              disabled={!channelId}
            >
              Start Listening
            </button>
          )}
        </div>
        
        {player && (
          <div className="audio-controls">
            <div className="control-group">
              <label htmlFor="jitter-buffer">Jitter Buffer: {jitterBufferMs}ms</label>
              <input
                id="jitter-buffer"
                type="range"
                min="10"
                max="500"
                step="10"
                value={jitterBufferMs}
                onChange={(e) => setJitterBufferMs(Number(e.target.value))}
              />
            </div>
            
            <div className="control-group">
              <label htmlFor="volume">Volume: {Math.round(volume * 100)}%</label>
              <input
                id="volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>
          </div>
        )}
        
        <div className="status">
          <p>{statusMessage}</p>
          {isListening && (
            <>
              <p>Packets received: {packetsReceived}</p>
              <p>Packets played: {packetsPlayed}</p>
              <p>Packets lost: {packetsLost}</p>
              {lastSequence !== null && <p>Last sequence: {lastSequence}</p>}
            </>
          )}
        </div>
      </div>
      
      {/* Metrics Dashboard */}
      <MetricsDashboard 
        isActive={isListening}
        latencyHistory={latencyHistory}
        batchesSent={packetsReceived} // Reusing the same component
        totalBytesTransmitted={totalBytesReceived} // Reusing the same component
        lastBlockTime={blockTime}
        realtimeLatency={realtimeLatency}
      />
    </div>
  );
};

export default Listener;
