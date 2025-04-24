import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AudioPlayer, AudioPlayerOptions } from '../utils/audio';
import { listenToAudioBatches } from '../utils/blockchain';
import SignalStrength from '../components/SignalStrength';
import { keccak256, stringToHex } from 'viem';

const Listener: React.FC = () => {
  const [channelId, setChannelId] = useState<string>('hello-megaeth');
  const onchainChannelId = useMemo(() => {
    return keccak256(stringToHex(channelId))
  }, [channelId]);

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
  
  useEffect(() => {
    if (player) {
      player.setJitterBufferMs(jitterBufferMs);
      player.setVolume(volume);
    }
  }, [jitterBufferMs, player, volume]);
  
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
      if (!player) {
        console.warn('Received audio batch but player is not initialized');
        return;
      }
      
      if (batchData.channelId !== onchainChannelId) {
        console.warn(`Received batch for different channel: ${batchData.channelId} (we're listening to ${onchainChannelId})`);
        return;
      }
      
      console.log(`🎵 Received audio batch: seq=${batchData.seqStart}, count=${batchData.count}, size=${batchData.payload.length}B`);
      
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
      console.error('Cannot start listening: Audio player not initialized');
      setStatusMessage('Initializing...');
      return;
    }
    
    try {
      console.log(`Starting to listen on channel: ${channelId}`);
      
      // Reset metrics
      setTotalBytesReceived(0);
      setPacketsReceived(0);
      setPacketsPlayed(0);
      setPacketsLost(0);
      setLastSequence(null);
      
      // Initialize player
      await player.start();
      console.log('Audio player started successfully');
      
      // Subscribe to audio batches
      console.log(`Subscribing to audio batches on channel: ${channelId}`);
      const unsub = await listenToAudioBatches(channelId, handleAudioBatch);
      console.log('Subscription to audio batches successful');
      setUnsubscribe(() => unsub);
      
      setIsListening(true);
      setStatusMessage('LISTENING');
      
      // Setup periodic stats update
      statsIntervalRef.current = window.setInterval(() => {
        // Output active state to console periodically
        console.log(`Still listening on channel: ${channelId}, received: ${packetsReceived} packets`);
      }, 5000);
    } catch (error) {
      console.error('Error starting listener:', error);
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
      {/* Cell signal bars based on latency */}
      <SignalStrength latency={realtimeLatency > 0 ? realtimeLatency : null} />
      
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
        {/* Desktop view */}
        <div className="desktop-view">
          <span>Data <strong>{(totalBytesReceived / 1024).toFixed(2)} KB</strong></span>
          <span>Latency <strong className={realtimeLatency > 200 ? 'high-latency' : ''}>{realtimeLatency}ms</strong></span>
          <span>Block <strong>{blockTime}ms</strong></span>
        </div>
        
        {/* Mobile view */}
        <div className="mobile-view">
          <span><strong>{(totalBytesReceived / 1024).toFixed(2)}kb</strong></span>
          <span><strong className={realtimeLatency > 200 ? 'high-latency' : ''}>{realtimeLatency}ms</strong></span>
          <span><strong>{blockTime}ms/b</strong></span>
        </div>
      </div>
    </div>
  );
};

export default Listener;