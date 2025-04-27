import React, { useState, useEffect, useRef } from 'react';
import { OpusEncoder, type EncodedAudioBuffer, type AudioMetrics } from '../utils/audio';
import { createLocalWalletClient, sendAudioBatch, getAccountBalance, DEFAULT_TRANSPORT } from '../utils/blockchain';
import { createPublicClient, type Account, type WalletClient } from 'viem';
import { megaethTestnet } from 'viem/chains';
import AudioVisualizer from '../components/AudioVisualizer';
import SignalStrength from '../components/SignalStrength';

const Broadcaster: React.FC = () => {
  const nonce = useRef(0);
  const [nonceReady, setNonceReady] = useState<boolean>(false);
  const [channelId, setChannelId] = useState<string>('hello-megaeth');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [batchesSent, setBatchesSent] = useState<number>(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [avgLatency, setAvgLatency] = useState<number | null>(null);
  const latencyHistoryRef = useRef<number[]>([]);
  const [encoder, setEncoder] = useState<OpusEncoder | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [walletAddress, setWalletAddress] = useState<`0x${string}` | undefined>();
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [balance, setBalance] = useState<string>('0.00000');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  
  // Metrics state
  const [totalBytesTransmitted, setTotalBytesTransmitted] = useState<number>(0);
  const [realtimeLatency, setRealtimeLatency] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const timerIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!walletAddress || nonceReady) {return;}

    // refresh the current nonce if the wallet changes. do this once.
    const client = createPublicClient({chain: megaethTestnet, transport: DEFAULT_TRANSPORT});
    client.getTransactionCount({address: walletAddress, blockTag: 'pending'}).then(count => {
      nonce.current = count;
      setNonceReady(true);
    });

  }, [walletAddress, nonceReady, setNonceReady])
  
  // Initialize wallet client and audio encoder
  useEffect(() => {
    // Create wallet client
    try {
      const client = createLocalWalletClient();
      setWalletClient(client);
      setAccount(client.account!);
      setWalletAddress(client.account!.address);
      setStatusMessage(`Wallet ready: ${client.account!.address.slice(0, 6)}...${client.account!.address.slice(-4)}`);
      
      // Get initial balance
      fetchBalance(client.account!.address);
    } catch (error) {
      console.error('Error creating wallet client:', error);
      setStatusMessage(`Error creating wallet: ${(error as Error).message}`);
    }

    // Create encoder
    const newEncoder = new OpusEncoder();
    setEncoder(newEncoder);
    
    return () => {
      if (isRecording && newEncoder) {
        newEncoder.stop();
      }
    };
  }, []);
  
  // Fetch account balance
  const fetchBalance = async (address: string) => {
    setIsRefreshing(true);
    try {
      const balanceStr = await getAccountBalance(address);
      setBalance(balanceStr);
    } catch (error) {
      console.error('Error fetching balance:', error);
    } finally {
      setIsRefreshing(false);
    }
  };
  
  // Handle sending audio data to the blockchain
  const sendAudioToBlockchain = async (buffer: EncodedAudioBuffer) => {
    if (!walletClient || !account || !channelId || !nonceReady) {
      throw new Error("Blockchain connection not ready");
    }
    
    const currentNonce = nonce.current++;
    
    try {
      // Send the audio batch to the blockchain
      const result = await sendAudioBatch(
        walletClient, 
        account, 
        channelId, 
        currentNonce, 
        buffer.sequence, 
        buffer.data
      );
      
      // Update status message
      const hashString = result.hash || 'unknown-hash';
      setStatusMessage(`Batch ${buffer.sequence} sent: ${hashString.slice(0, 6)}...${hashString.slice(-4)}`);
      
      return result;
    } catch (error) {
      console.error(`Error sending batch (nonce: ${currentNonce}):`, error);
      setStatusMessage(`Error: ${(error as Error).message}`);
      throw error;
    }
  };
  
  // Handle metrics updates
  const handleMetricsUpdate = (metrics: AudioMetrics) => {
    // Update UI metrics
    setBatchesSent(metrics.batchesSent);
    setTotalBytesTransmitted(metrics.bytesTransmitted);
    setRealtimeLatency(metrics.lastLatency);
    setLatency(metrics.lastLatency);
    
    // Update latency history and average
    updateLatencyAverage(metrics.lastLatency);
  };
  
  // Start broadcasting
  const startBroadcasting = async () => {
    if (!encoder || !account) {
      setStatusMessage('Initializing...');
      return;
    }
    
    // Check if we have enough balance
    if (parseFloat(balance) <= 0) {
      setStatusMessage('Insufficient balance. Please fund your wallet to broadcast.');
      return;
    }
    
    try {
      // Reset metrics
      setTotalBytesTransmitted(0);
      setBatchesSent(0);
      setLatency(null);
      setAvgLatency(null);
      latencyHistoryRef.current = [];
      setElapsedTime(0);
      
      // Get microphone access for visualizer
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      
      setMediaStream(stream);
      
      // Start the encoder with our blockchain sender function and metrics callback
      await encoder.start(sendAudioToBlockchain, handleMetricsUpdate);
      setIsRecording(true);
      setStatusMessage('LIVE');
      
      // Start the elapsed time timer
      const startTime = Date.now();
      timerIntervalRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    } catch (error) {
      setStatusMessage(`Error starting broadcast: ${(error as Error).message}`);
    }
  };
  
  // Stop broadcasting
  const stopBroadcasting = () => {
    if (encoder) {
      encoder.stop();
      setIsRecording(false);
      setStatusMessage('Call Ended');
      
      // Stop media stream for visualizer
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        setMediaStream(null);
      }
      
      // Stop the elapsed time timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      
      // Reset latency metrics
      setLatency(null);
      setAvgLatency(null);
      latencyHistoryRef.current = [];
      
      // Refresh balance after stopping
      fetchBalance(walletAddress || '');
    }
  };

  // Keep track of latency history and calculate moving average
  const updateLatencyAverage = (newLatency: number) => {
    // Keep last 5 latency measurements for a moving average
    const history = [...latencyHistoryRef.current, newLatency];
    if (history.length > 5) {
      history.shift(); // Remove oldest value when we have more than 5
    }
    latencyHistoryRef.current = history;
    
    // Calculate average latency
    const sum = history.reduce((acc, val) => acc + val, 0);
    const avg = Math.round(sum / history.length);
    setAvgLatency(avg);
  };
  
  // Format the elapsed time in MM:SS format
  const formatElapsedTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  // Copy wallet address to clipboard
  const copyWalletAddress = async () => {
    if (walletAddress) {
      try {
        await navigator.clipboard.writeText(walletAddress);
        setCopySuccess('Copied!');
        setTimeout(() => setCopySuccess(''), 2000);
      } catch (err) {
        setCopySuccess('Failed to copy');
        console.error('Failed to copy address: ', err);
      }
    }
  };
  
  return (
    <div className="broadcaster-container">
      {walletAddress && (
        <div className="wallet-address" onClick={copyWalletAddress} title="Click to copy">
          {copySuccess || `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
        </div>
      )}
      
      {/* Cell signal bars based on average latency */}
      <SignalStrength latency={avgLatency} />
      
      <div className="call-button-container">
        {isRecording ? (
          <>
            <button 
              onClick={stopBroadcasting}
              className="call-button decline-button"
              aria-label="Decline call"
            >
              ✕
            </button>
            <div className="call-timer">{formatElapsedTime(elapsedTime)}</div>
          </>
        ) : (
          <button
            onClick={startBroadcasting}
            className="call-button accept-button"
            disabled={!walletAddress || parseFloat(balance) <= 0}
            aria-label="Accept call"
          >
            ✓
          </button>
        )}
      </div>
      
      {isRecording && (
        <div className="status-indicator">
          <div className="pulse"></div>
          <span className="status-text">BROADCASTING</span>
        </div>
      )}
      
      <AudioVisualizer mediaStream={mediaStream} isActive={isRecording} />
      
      <div className="stats-footer">
        {/* Desktop view */}
        <div className="desktop-view">
          <span>Data <strong>{(totalBytesTransmitted / 1024).toFixed(2)} KB</strong></span>
          <span></span>
          <span>Latency <strong className={realtimeLatency > 200 ? 'high-latency' : ''}>{realtimeLatency}ms</strong></span>
        </div>
        
        {/* Mobile view */}
        <div className="mobile-view">
          <span><strong>{(totalBytesTransmitted / 1024).toFixed(2)}kb</strong></span>
          <span></span>
          <span><strong className={realtimeLatency > 200 ? 'high-latency' : ''}>{realtimeLatency}ms</strong></span>
        </div>
      </div>
    </div>
  );
};

export default Broadcaster;