import { 
  createWalletClient, 
  createPublicClient, 
  custom,
  parseAbiItem,
  type WalletClient, 
  type Account,
  type Chain,
  http
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';

// MegaETH chain configuration
export const MEGA_ETH_CHAIN: Chain = {
  id: 6342,
  name: 'MegaETH',
  nativeCurrency: {
    decimals: 18,
    name: 'MEGA',
    symbol: 'MEGA',
  },
  rpcUrls: {
    default: {
      http: ['https://carrot.megaeth.com/mafia/rpc/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u'],
      webSocket: ['wss://carrot.megaeth.com/mafia/ws/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u'],
    },
    public: {
      http: ['https://carrot.megaeth.com/mafia/rpc/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u'],
      webSocket: ['wss://carrot.megaeth.com/mafia/ws/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u'],
    },
  },
  blockExplorers: {
    default: {
      name: 'MegaETH Explorer',
      url: 'https://megaexplorer.xyz',
    },
  },
};

// Contract address
export const CONTRACT_ADDRESS = '0xF2A6dA0098eEa4A62802BB87A5447C987a39B5b9' as const;

// Create a local wallet client for broadcasting
// Stores the private key in localStorage for persistent identity
export function createLocalWalletClient(): { walletClient: WalletClient; account: Account } {
  // Get private key from local storage or generate a new one
  let privateKey = localStorage.getItem('megaphone_private_key');
  if (!privateKey) {
    privateKey = generatePrivateKey();
    localStorage.setItem('megaphone_private_key', privateKey);
  }
  
  // Create account from private key
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  // Create wallet client
  const walletClient = createWalletClient({
    account,
    chain: MEGA_ETH_CHAIN,
    transport: http()
  });
  
  return { walletClient, account };
}

// Create a nonce tracker to manage nonces across multiple transactions
let currentNonce: number | null = null;
const NONCE_REFRESH_INTERVAL = 10; // Refresh nonce from chain every 10 transactions
let transactionCount = 0; // Counter to track when to refresh the nonce

// Function to synchronize nonce with blockchain
async function refreshNonce(address: `0x${string}`): Promise<number> {
  try {
    console.log('Refreshing nonce from blockchain...');
    const httpClient = createHTTPClient();
    const nonce = await httpClient.getTransactionCount({
      address,
    });
    
    console.log(`Refreshed nonce: ${nonce}`);
    currentNonce = nonce;
    return nonce;
  } catch (error) {
    console.error('Error refreshing nonce:', error);
    if (currentNonce !== null) {
      return currentNonce;
    }
    throw error;
  }
}

// Transaction performance metrics
interface TransactionMetrics {
  creationTime: number;      // Time to create and sign transaction
  submissionTime: number;    // Time to submit to blockchain
  confirmationTime?: number; // Time to confirm (if tracked)
  totalTime: number;         // Total time from creation to confirmation or latest stage
}

const transactionMetrics: Record<string, TransactionMetrics> = {};

// Transaction receipt polling system
interface PendingTransaction {
  hash: `0x${string}`;
  nonce: number;
  timestamp: number;
  maxPolls: number;
  currentPoll: number;
  onConfirmed?: () => void;
  onError?: (error: Error) => void;
  // Transaction timing metrics
  sentAt: number;
  confirmedAt?: number;
}

const pendingTransactions: PendingTransaction[] = [];
const POLL_INTERVAL_MS = 50; // Poll every 25ms for ultra-low latency
let isPolling = false;

// Start transaction receipt polling
function startTxPolling() {
  if (!isPolling) {
    isPolling = true;
    pollPendingTransactions();
  }
}

// Poll for transaction receipts - optimized for ultra-low latency
async function pollPendingTransactions() {
  if (pendingTransactions.length === 0) {
    isPolling = false;
    return;
  }
  
  isPolling = true;
  
  // Make a shallow copy of pending transactions
  const txsToPoll = [...pendingTransactions];
  
  // Poll each transaction in parallel
  for (const pendingTx of txsToPoll) {
    // Don't wait for the response, fire and forget
    pollSingleTransaction(pendingTx).catch(err => {
      console.error(`Error polling transaction ${pendingTx.hash.slice(0, 10)}...`, err);
    });
  }
  
  // Schedule next polling cycle regardless of current poll status
  setTimeout(pollPendingTransactions, POLL_INTERVAL_MS);
}

// Poll a single transaction
async function pollSingleTransaction(pendingTx: PendingTransaction): Promise<void> {
  try {
    const client = createHTTPClient();
    const receipt = await client.getTransactionReceipt({ hash: pendingTx.hash });
    
    if (receipt) {
      // Transaction confirmed
      pendingTx.confirmedAt = performance.now();
      
      // Update confirmationTime in transactionMetrics if it exists
      if (transactionMetrics[pendingTx.hash]) {
        transactionMetrics[pendingTx.hash].confirmationTime = 
          pendingTx.confirmedAt - pendingTx.sentAt;
        transactionMetrics[pendingTx.hash].totalTime = 
          pendingTx.confirmedAt - (transactionMetrics[pendingTx.hash].totalTime - pendingTx.sentAt);
          
        console.log(`Transaction ${pendingTx.hash.slice(0, 10)}... confirmed in ${Math.round(transactionMetrics[pendingTx.hash].confirmationTime || 0)}ms`);
      }
      
      // Remove from pending transactions
      const index = pendingTransactions.indexOf(pendingTx);
      if (index !== -1) {
        pendingTransactions.splice(index, 1);
      }
      
      if (pendingTx.onConfirmed) {
        pendingTx.onConfirmed();
      }
    } else {
      // Transaction not yet confirmed, increment poll count
      pendingTx.currentPoll += 1;
      
      if (pendingTx.currentPoll >= pendingTx.maxPolls) {
        // Max polls exceeded
        const index = pendingTransactions.indexOf(pendingTx);
        if (index !== -1) {
          pendingTransactions.splice(index, 1);
        }
        
        if (pendingTx.onError) {
          pendingTx.onError(new Error(`Transaction ${pendingTx.hash} not confirmed after ${pendingTx.maxPolls} polls`));
        }
      }
    }
  } catch (err) {
    // Don't remove transaction on error, just increment poll count
    pendingTx.currentPoll += 1;
    
    if (pendingTx.currentPoll >= pendingTx.maxPolls) {
      const index = pendingTransactions.indexOf(pendingTx);
      if (index !== -1) {
        pendingTransactions.splice(index, 1);
      }
      
      if (pendingTx.onError) {
        pendingTx.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
    
    throw err;
  }
}

/**
 * Send a batch of audio frames to the blockchain
 */
export async function sendAudioBatch(
  walletClient: WalletClient,
  account: Account,
  channelId: string,
  seqStart: number,
  frames: Uint8Array
): Promise<{ hash: string }> {
  try {
    // Start timing for transaction creation
    const creationStart = performance.now();
    
    console.log(`Sending audio: channel=${channelId}, seqStart=${seqStart}, size=${frames.byteLength}B`);
    
    // Get the latest nonce for the account - only refresh if needed
    if (currentNonce === null) {
      await refreshNonce(account.address);
      if (currentNonce === null) {
        throw new Error('Failed to get nonce');
      }
    }
    
    // Local nonce management
    const useNonce = currentNonce;
    currentNonce++;
    
    // Periodically refresh nonce in the background (not blocking)
    transactionCount++;
    if (transactionCount >= NONCE_REFRESH_INTERVAL) {
      refreshNonce(account.address).catch(err => {
        console.error('Error refreshing nonce:', err);
      });
      transactionCount = 0;
    }
    
    // Encode the function call to the contract
    const channelIdBytes = stringToBytes32(channelId) as `0x${string}`;
    const data = encodeABISendBatch(channelIdBytes, seqStart, frames);
    
    // Get the transaction request
    const transactionRequest = {
      to: CONTRACT_ADDRESS,
      account,
      data,
      nonce: useNonce,
      maxFeePerGas: 2500000n, // 0.0025 Gwei
      maxPriorityFeePerGas: 2000000n, // 0.002 Gwei
      chain: MEGA_ETH_CHAIN, // Adding required chain parameter
      gas: 500000n, // Explicitly set gas limit to 500,000 units to avoid 'intrinsic gas too low' errors
    };
    
    // Sign the transaction
    const signedTx = await walletClient.signTransaction(transactionRequest);
    const signedAt = performance.now();
    
    // Create hash from signed transaction
    let hash: `0x${string}`;
    
    // Track this transaction for metrics
    const txMetrics = {
      creationTime: signedAt - creationStart,
      submissionTime: 0, // Will update this later if needed
      totalTime: performance.now() - creationStart
    };
    
    // Fire-and-forget approach: send transaction without waiting
    try {
      // Send transaction asynchronously but capture hash
      hash = await sendRawTransaction(signedTx, 3, false);
      
      // Store metrics with the hash
      transactionMetrics[hash] = txMetrics;
      
      // Start polling for receipt immediately
      trackTransaction(hash, useNonce, 100); // Poll up to 100 times (2 seconds at 25ms polling)
      
      return { hash };
    } catch (error) {
      console.error('Error sending transaction:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error sending audio batch:', error);
    throw error;
  }
}

// Continue using the existing sendRawTransaction for cases where wait is needed
async function sendRawTransaction(
  signedTx: `0x${string}`, 
  maxRetries = 3,
  waitForResponse = true
): Promise<`0x${string}`> {
  return new Promise((resolve, reject) => {
    let retryCount = 0;
    const initialBackoffMs = 100;
    
    const attemptRequest = (retryCount: number, backoffMs: number) => {
      const httpClient = createHTTPClient();
      
      const requestPromise = httpClient.request({
        method: 'eth_sendRawTransaction',
        params: [signedTx],
      });
      
      // If we don't need to wait, resolve immediately with a synthetic hash
      // The real hash will be available in the background
      if (!waitForResponse) {
        // Create a deterministic hash based on the signed transaction
        // This is just a best-effort estimate, not the actual hash
        const estimatedHash = `0x${signedTx.slice(8, 72)}` as `0x${string}`;
        resolve(estimatedHash);
        
        // Continue processing in the background
        requestPromise.then((realHash) => {
          console.log(`Transaction sent: ${realHash.slice(0, 10)}...`);
          
          // If we have metrics for the estimated hash, move them to the real hash
          if (transactionMetrics[estimatedHash]) {
            transactionMetrics[realHash] = transactionMetrics[estimatedHash];
            delete transactionMetrics[estimatedHash];
          }
          
          // Update pending transaction hash if needed
          const pendingTx = pendingTransactions.find(tx => tx.hash === estimatedHash);
          if (pendingTx) {
            pendingTx.hash = realHash;
          }
        }).catch(error => {
          console.error('Error sending transaction:', error);
        });
        
        return;
      }
      
      // Normal blocking behavior
      requestPromise.then(hash => {
        resolve(hash);
      }).catch(error => {
        const errorMsg = error.message || '';
        
        if (errorMsg.includes('503') || 
            errorMsg.includes('429') || 
            errorMsg.includes('temporarily unavailable') ||
            errorMsg.includes('intrinsic gas too low')) {  // Add specific handling for gas issues
          if (retryCount < maxRetries) {
            console.log(`Retrying (${retryCount + 1}/${maxRetries}) in ${backoffMs}ms...`);
            setTimeout(() => attemptRequest(retryCount + 1, backoffMs * 2), backoffMs);
          } else {
            reject(new Error(`Max retries exceeded: ${errorMsg}`));
          }
        } else if (errorMsg.includes('nonce')) {
          reject(new Error(`Nonce error: ${errorMsg}`));
        } else {
          reject(error);
        }
      });
    };
    
    attemptRequest(retryCount, initialBackoffMs);
  });
}

/**
 * Get the account balance in ETH
 */
export async function getAccountBalance(address: string): Promise<string> {
  try {
    const client = createHTTPClient();
    const balanceWei = await client.getBalance({
      address: address as `0x${string}`,
    });
    const balanceEth = Number(balanceWei) / 1e18;
    return balanceEth.toFixed(5);
  } catch (error) {
    console.error('Error getting account balance:', error);
    throw error;
  }
}

/**
 * Listen to audio batches for a specific channel
 */
export async function listenToAudioBatches(
  channelId: string,
  callback: (batchData: {
    channelId: string;
    seqStart: number;
    count: number;
    payload: Uint8Array;
    blockNumber: bigint;
    transactionHash: string;
  }) => void
): Promise<() => void> {
  try {
    const wsClient = createWSClient();
    const bytes32ChannelId = stringToBytes32(channelId);
    
    console.log(`Listening to batches for channel: ${channelId}`);
    
    // Parse the ABI for the Batch event
    const batchEventAbi = parseAbiItem('event Batch(bytes32 channelId, uint32 seqStart, uint8 count, bytes frames)');
    
    // Set up logs subscription
    const unwatch = wsClient.watchEvent({
      onLogs: (logs) => {
        for (const log of logs) {
          try {
            // Check if log topics match our event
            if (log.topics.length > 1) {
              const eventChannelId = log.topics[1];
              
              // Only process if it matches our channel
              if (eventChannelId === bytes32ChannelId) {
                const data = log.data;
                
                // Decode the event data
                const frameCount = Number(BigInt(`0x${data.slice(66, 68)}`));
                const seqStart = Number(BigInt(`0x${data.slice(2, 66)}`));
                
                // Extract the frames payload
                const framesHex = `0x${data.slice(68)}`;
                const framesBytes = new Uint8Array(
                  Array.from({ length: Math.floor((framesHex.slice(2).length) / 2) }, (_, i) =>
                    parseInt(framesHex.slice(2).substring(i * 2, i * 2 + 2), 16)
                  )
                );
                
                // Call the callback with the batch data
                callback({
                  channelId,
                  seqStart,
                  count: frameCount,
                  payload: framesBytes,
                  blockNumber: log.blockNumber || BigInt(0),
                  transactionHash: log.transactionHash || '0x0',
                });
              }
            }
          } catch (error) {
            console.error('Error processing log:', error);
          }
        }
      },
      events: [batchEventAbi],
    });
    
    return unwatch;
  } catch (error) {
    console.error('Error listening to audio batches:', error);
    throw error;
  }
}

// Helper function to convert string to bytes32
export function stringToBytes32(str: string): `0x${string}` {
  // TextEncoder is browser-compatible for converting string to bytes
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  
  // Create a padded byte array (32 bytes)
  const paddedBytes = new Uint8Array(32);
  // Copy the bytes from the string (up to 32 bytes)
  paddedBytes.set(bytes.slice(0, 32));
  
  // Convert to hex string
  let hexString = '0x';
  for (let i = 0; i < paddedBytes.length; i++) {
    hexString += paddedBytes[i].toString(16).padStart(2, '0');
  }
  
  return hexString as `0x${string}`;
}

// Helper function to encode the sendBatch function call
function encodeABISendBatch(
  channelId: `0x${string}`,
  seqStart: number,
  frames: Uint8Array
): `0x${string}` {
  // Function signature: sendBatch(bytes32 channelId, uint32 seqStart, bytes calldata frames)
  const functionSelector = '0x6e53d495';
  
  // Encode channelId (bytes32) - already in the right format
  const encodedChannelId = channelId.slice(2).padStart(64, '0');
  
  // Encode seqStart (uint32)
  const encodedSeqStart = seqStart.toString(16).padStart(64, '0');
  
  // Encode frames (bytes)
  // Location of the frames data (dynamic type) - 3 * 32 bytes from the start
  const locationOfFramesData = (3 * 32).toString(16).padStart(64, '0');
  
  // Length of frames in bytes
  const framesLength = frames.length.toString(16).padStart(64, '0');
  
  // Convert frames to hex - browser compatible version without using Buffer
  const framesHex = Array.from(frames)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  
  // Pad framesHex to multiple of 32 bytes (64 hex chars)
  const paddingLength = 64 - (framesHex.length % 64);
  const paddedFramesHex = framesHex + '0'.repeat(paddingLength === 64 ? 0 : paddingLength);
  
  // Combine all parts
  const encodedData = functionSelector + 
                     encodedChannelId + 
                     encodedSeqStart + 
                     locationOfFramesData + 
                     framesLength + 
                     paddedFramesHex;
  
  return encodedData as `0x${string}`;
}

// Create HTTP client with standard transport
function createHTTPClient() {
  return createPublicClient({
    chain: MEGA_ETH_CHAIN,
    transport: http(),
    batch: {
      multicall: false
    }
  });
}

// Create WebSocket client
function createWSClient() {
  const wsTransport = custom({
    request: async ({ method, params }) => {
      try {
        const jsonRPC = {
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        };
        
        // Create WebSocket with null check for webSocket URL
        const wsUrl = MEGA_ETH_CHAIN.rpcUrls.default.webSocket?.[0] || 
                     'wss://carrot.megaeth.com/mafia/ws/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u';
        const ws = new WebSocket(wsUrl);
        
        // Wrap in a promise
        return new Promise((resolve, reject) => {
          ws.onopen = () => {
            // Send the request
            ws.send(JSON.stringify(jsonRPC));
          };
          
          ws.onmessage = (event) => {
            try {
              const response = JSON.parse(event.data);
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve(response.result);
              }
              ws.close();
            } catch (e) {
              reject(e);
              ws.close();
            }
          };
          
          ws.onerror = () => {
            reject(new Error('WebSocket error'));
            ws.close();
          };
        });
      } catch (error) {
        throw error;
      }
    },
  });

  return createPublicClient({
    chain: MEGA_ETH_CHAIN,
    transport: wsTransport,
  });
}

// Get transaction statistics and metrics
export function getTransactionStats() {
  // Calculate metrics
  let totalTxs = Object.keys(transactionMetrics).length;
  let totalCreationTime = 0;
  let totalSubmissionTime = 0;
  let totalConfirmationTime = 0;
  let confirmedTxs = 0;
  
  for (const hash in transactionMetrics) {
    const metrics = transactionMetrics[hash];
    totalCreationTime += metrics.creationTime;
    totalSubmissionTime += metrics.submissionTime;
    
    if (metrics.confirmationTime) {
      totalConfirmationTime += metrics.confirmationTime;
      confirmedTxs++;
    }
  }
  
  // Get stats about transactions in flight
  const pendingCount = pendingTransactions.length;
  
  return {
    totalTransactions: totalTxs,
    confirmedTransactions: confirmedTxs,
    pendingTransactions: pendingCount,
    averages: totalTxs > 0 ? {
      creationTime: Math.round(totalCreationTime / totalTxs),
      submissionTime: Math.round(totalSubmissionTime / totalTxs),
      confirmationTime: confirmedTxs > 0 ? Math.round(totalConfirmationTime / confirmedTxs) : null,
      totalTime: confirmedTxs > 0 ? 
        Math.round((totalCreationTime + totalSubmissionTime + totalConfirmationTime) / confirmedTxs) : 
        Math.round((totalCreationTime + totalSubmissionTime) / totalTxs)
    } : null,
    // Last 5 transaction metrics for detailed analysis
    recentTransactions: Object.keys(transactionMetrics)
      .slice(-5)
      .reduce((acc, hash) => {
        acc[hash] = transactionMetrics[hash];
        return acc;
      }, {} as Record<string, TransactionMetrics>)
  };
}

// Track a transaction for confirmation
export function trackTransaction(
  hash: `0x${string}`, 
  nonce: number, 
  maxPolls = 10, 
  onConfirmed?: () => void, 
  onError?: (error: Error) => void
) {
  pendingTransactions.push({
    hash,
    nonce,
    timestamp: Date.now(),
    maxPolls,
    currentPoll: 0,
    onConfirmed,
    onError,
    sentAt: performance.now(),
  });
  
  if (!isPolling) {
    startTxPolling();
  }
}
