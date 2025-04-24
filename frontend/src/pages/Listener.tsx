import React, { useState, useEffect, useRef } from 'react';
import { AudioPlayer, AudioPlayerOptions } from '../utils/audio';
import { listenToAudioBatches } from '../utils/blockchain';

const Listener: React.FC = () => {
  const [channelId, setChannelId] = useState<string>('hello-megaeth');
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
  const [totalBytesReceived, setTotalBytesReceived] = useState<number>(0);
  const [blockTime, setBlockTime] = useState<number>(10);
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
      
      setStatusMessage('LISTENING');
    } catch (error) {
      console.error('Error processing batch:', error);
      setStatusMessage(`Error: ${(error as Error).message}`);
    }
  };
  
  // Start listening
  const startListening = async () => {
    if (!player) {
      setStatusMessage('Initializing...');
      return;
    }
    
    try {
      // Reset metrics
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
      setStatusMessage('LISTENING');
      
      // Setup periodic stats update
      statsIntervalRef.current = window.setInterval(() => {
        // Keep stats updated periodically if needed
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
    setStatusMessage('Call Ended');
    
    // Clear stats interval
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
  };
  
  return (
    <div className="listener-container">
      <div className="call-button-container">
        {isListening ? (
          <button 
            onClick={stopListening}
            className="call-button decline-button"
            aria-label="Decline call"
          >
            ✕
          </button>
        ) : (
          <button
            onClick={startListening}
            className="call-button accept-button"
            aria-label="Accept call"
          >
            ✓
          </button>
        )}
      </div>
      
      {isListening && (
        <div className="status-indicator">
          <div className="pulse"></div>
          <span className="status-text">LISTENING</span>
        </div>
      )}
      
      <div className="stats-footer">
        <span>Audio: <strong>{(totalBytesReceived / 1024).toFixed(2)} KB</strong></span>
        <span>Latency: <strong>{realtimeLatency} ms</strong></span>
        <span>Block Time: <strong>{blockTime} ms</strong></span>
      </div>
    </div>
  );
};

export default Listener;