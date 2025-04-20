import React, { useState, useEffect } from 'react';
import { OpusEncoder } from '../utils/audio';
import { createLocalWalletClient, sendAudioBatch, getAccountBalance } from '../utils/blockchain';
import type { Account, WalletClient } from 'viem';
import MetricsDashboard from '../components/MetricsDashboard';

const Broadcaster: React.FC = () => {
  const [channelId, setChannelId] = useState<string>('');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [batchesSent, setBatchesSent] = useState<number>(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [encoder, setEncoder] = useState<OpusEncoder | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [balance, setBalance] = useState<string>('0.00000');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  
  // Metrics state
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [totalBytesTransmitted, setTotalBytesTransmitted] = useState<number>(0);
  const [blockTime, setBlockTime] = useState<number>(10); // Default 10ms for MegaETH
  const [realtimeLatency, setRealtimeLatency] = useState<number>(0);
  
  // Initialize wallet client and audio encoder
  useEffect(() => {
    // Create wallet client
    try {
      const { walletClient: client, account: acc } = createLocalWalletClient();
      setWalletClient(client);
      setAccount(acc);
      setWalletAddress(acc.address);
      setStatusMessage(`Created local wallet: ${acc.address.slice(0, 6)}...${acc.address.slice(-4)}`);
      
      // Get initial balance
      fetchBalance(acc.address);
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
  
  // Refresh balance
  const refreshBalance = () => {
    if (walletAddress) {
      fetchBalance(walletAddress);
    }
  };
  
  // Handle audio data from the encoder
  const handleAudioData = async (buffer: { sequence: number; data: Uint8Array }) => {
    try {
      if (!walletClient || !account || !channelId) return;
      
      const startTime = Date.now();
      const result = await sendAudioBatch(walletClient, account, channelId, buffer.sequence, buffer.data);
      const endTime = Date.now();
      
      // Calculate transaction latency
      const txLatency = endTime - startTime;
      
      // Update metrics
      setBatchesSent(prev => prev + 1);
      setLatency(txLatency);
      setLatencyHistory(prev => [...prev, txLatency]);
      setTotalBytesTransmitted(prev => prev + buffer.data.length);
      setRealtimeLatency(txLatency);
      
      // Latest block time (simulated, in real implementation we could get this from chain)
      setBlockTime(Math.floor(Math.random() * 3) + 8); // Random between 8-10ms for demo purposes
      
      // Safely handle the hash (could be string or object)
      const hashString = result.hash || 'unknown-hash';
      setStatusMessage(`Batch sent: ${hashString.slice(0, 6)}...${hashString.slice(-4)}`);
      
      // Refresh balance periodically (e.g., every 5 batches)
      if (batchesSent % 5 === 0) {
        refreshBalance();
      }
    } catch (error) {
      console.error('Error sending batch:', error);
      setStatusMessage(`Error: ${(error as Error).message}`);
    }
  };
  
  // Start broadcasting
  const startBroadcasting = async () => {
    if (!encoder || !account || !channelId) {
      setStatusMessage('Please enter a channel ID');
      return;
    }
    
    // Check if we have enough balance
    if (parseFloat(balance) <= 0) {
      setStatusMessage('Insufficient balance. Please fund your wallet to broadcast.');
      return;
    }
    
    try {
      // Reset metrics
      setLatencyHistory([]);
      setTotalBytesTransmitted(0);
      setBatchesSent(0);
      setLatency(null);
      
      await encoder.start(handleAudioData);
      setIsRecording(true);
      setStatusMessage('Broadcasting started');
    } catch (error) {
      setStatusMessage(`Error starting broadcast: ${(error as Error).message}`);
    }
  };
  
  // Stop broadcasting
  const stopBroadcasting = () => {
    if (encoder) {
      encoder.stop();
      setIsRecording(false);
      setStatusMessage('Broadcasting stopped');
      // Refresh balance after stopping
      refreshBalance();
    }
  };

  // Copy wallet address to clipboard
  const copyWalletAddress = async () => {
    if (walletAddress) {
      try {
        await navigator.clipboard.writeText(walletAddress);
        setCopySuccess('Copied!');
        setTimeout(() => setCopySuccess(''), 2000); // Clear the "Copied!" message after 2 seconds
      } catch (err) {
        setCopySuccess('Failed to copy');
        console.error('Failed to copy address: ', err);
      }
    }
  };
  
  return (
    <div className="broadcaster-container">
      <h1>MEGAPhone Broadcaster</h1>
      <p>Broadcast your voice on-chain using MegaETH's 10ms blocks</p>
      
      <div className="wallet-section">
        {walletAddress ? (
          <div>
            <div className="wallet-info">
              <div className="wallet-address">
                <p>Local wallet: <span className="address-text">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span></p>
              </div>
              <div className="wallet-balance">
                <p>
                  Balance: <span className="balance-text">{balance} ETH</span>
                  <button 
                    onClick={refreshBalance} 
                    className="refresh-button"
                    disabled={isRefreshing}
                    title="Refresh balance"
                  >
                    {isRefreshing ? '⟳' : '↻'}
                  </button>
                </p>
              </div>
            </div>
            <div className="address-container">
              <input 
                type="text" 
                value={walletAddress} 
                readOnly 
                className="address-input"
              />
              <button 
                onClick={copyWalletAddress} 
                className="copy-button"
                title="Copy to clipboard"
              >
                {copySuccess || 'Copy Address'}
              </button>
            </div>
            <p className="wallet-note">Send some MEGA testnet ETH to this address to fund your broadcasts.</p>
          </div>
        ) : (
          <p>Creating local wallet...</p>
        )}
      </div>
      
      <div className="broadcast-controls">
        <div>
          <label htmlFor="channel-id">Channel ID:</label>
          <input
            id="channel-id"
            type="text"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="Enter a unique channel identifier"
            disabled={isRecording}
          />
        </div>
        
        <div className="controls">
          {isRecording ? (
            <button 
              onClick={stopBroadcasting}
              className="stop-button"
            >
              Stop Broadcasting
            </button>
          ) : (
            <button
              onClick={startBroadcasting}
              className="start-button"
              disabled={!walletAddress || !channelId || parseFloat(balance) <= 0}
            >
              {parseFloat(balance) <= 0 ? 'Need Funds to Broadcast' : 'Start Broadcasting'}
            </button>
          )}
        </div>
        
        <div className="status">
          <p>{statusMessage}</p>
          {isRecording && (
            <>
              <p>Batches sent: {batchesSent}</p>
              {latency !== null && <p>Last batch latency: {latency}ms</p>}
            </>
          )}
        </div>
      </div>
      
      {/* Metrics Dashboard */}
      <MetricsDashboard 
        isActive={isRecording}
        latencyHistory={latencyHistory}
        batchesSent={batchesSent}
        totalBytesTransmitted={totalBytesTransmitted}
        lastBlockTime={blockTime}
        realtimeLatency={realtimeLatency}
      />
    </div>
  );
};

export default Broadcaster;
