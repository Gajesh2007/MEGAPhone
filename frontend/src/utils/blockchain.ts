import { 
  createWalletClient, 
  createPublicClient, 
  custom,
  decodeEventLog,
  type WalletClient, 
  type Account,
  http,
  formatEther,
  keccak256,
  webSocket
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';
import { megaethTestnet } from 'viem/chains';

const USE_WSS = false; // Using HTTP instead since WebSocket endpoints are currently broken

export const MEGA_ETH_WSS = 'wss://carrot.megaeth.com/mafia/ws/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u';
export const DEFAULT_TRANSPORT = USE_WSS ? webSocket(MEGA_ETH_WSS) : http('https://carrot.megaeth.com/mafia/rpc/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u');

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
    chain: megaethTestnet,
    transport: DEFAULT_TRANSPORT
  });
  
  return { walletClient, account };
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

/**
 * Send a batch of audio frames to the blockchain
 */
export async function sendAudioBatch(
  walletClient: WalletClient,
  account: Account,
  channelId: string,
  nonce: number,
  seqStart: number,
  frames: Uint8Array
): Promise<{ hash: string; receipt?: any }> {
  try {
    // Start timing for transaction creation
    const creationStart = performance.now();

    // const framesHash = keccak256(frames);
    // console.log(`Sending audio(${framesHash}): channel=${channelId}, seqStart=${seqStart}, size=${frames.byteLength}B, nonce=${nonce}`);
    
    // Encode the function call to the contract
    const channelIdBytes = stringToBytes32(channelId) as `0x${string}`;
    const data = encodeABISendBatch(channelIdBytes, seqStart, frames);
    
    // Get the transaction request
    const transactionRequest = {
      chainId: megaethTestnet.id,
      to: CONTRACT_ADDRESS,
      account,
      data,
      nonce: nonce,
      maxFeePerGas: 2500000n, // 0.0025 Gwei
      maxPriorityFeePerGas: 2000000n, // 0.002 Gwei
      chain: megaethTestnet, // Adding required chain parameter
      gas: 500000n, // Explicitly set gas limit to 500,000 units to avoid 'intrinsic gas too low' errors
    };
    
    // Sign the transaction
    if (!walletClient.account || !walletClient.account.signTransaction) {
      // 
      throw new Error('invalid account.');
    }

    const signedTx = await walletClient.account.signTransaction!(transactionRequest);
    const signedAt = performance.now();
    
    // Create hash from signed transaction
    let hash: `0x${string}`;
    
    // Track this transaction for metrics
    const txMetrics = {
      creationTime: signedAt - creationStart,
      submissionTime: 0,
      totalTime: performance.now() - creationStart
    };
    
    try {
      // Use realtime_sendRawTransaction to get receipt directly without polling
      const publicClient = createPublicClient({
        chain: megaethTestnet,
        transport: DEFAULT_TRANSPORT,
      });
      
      // Send the transaction using realtime_sendRawTransaction
      const startSubmit = performance.now();
      
      // Use custom transport request to call the realtime method
      const receipt = await publicClient.request({
        // @ts-expect-error 'unknown method'
        method: 'realtime_sendRawTransaction',
        params: [signedTx]
      }) as {transactionHash: `0x${string}`} | undefined;
      const endSubmit = performance.now();
      
      // Extract hash from receipt
      hash = receipt?.transactionHash as `0x${string}`;
      
      // Update metrics
      txMetrics.submissionTime = endSubmit - startSubmit;
      txMetrics.totalTime = endSubmit - creationStart;
      transactionMetrics[hash] = txMetrics;
      
      // console.log(`Transaction confirmed in ${Math.round(txMetrics.submissionTime)}ms with hash: ${hash.slice(0, 10)}...`);
      
      return { hash, receipt };
    } catch (error: any) {
      console.error(`realtime_sendRawTransaction failed(${nonce}):`, error);
      
      // Re-throw the error since we're no longer using fallback
      throw new Error(`Failed to send transaction via realtime API: ${error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error sending audio batch:', error);
    throw error;
  }
}

/**
 * Get the account balance in ETH
 */
export async function getAccountBalance(address: string): Promise<string> {
  try {
    const client = createPublicClient({
      chain: megaethTestnet,
      transport: DEFAULT_TRANSPORT
    });
    const balanceWei = await client.getBalance({
      address: address as `0x${string}`,
    });
    return formatEther(balanceWei);
  } catch (error) {
    console.error('Error getting account balance:', error);
    throw error;
  }
}

/**
 * Listen to audio batches for a specific channel
 * Note: This implementation now uses polling rather than WebSockets due to WebSocket endpoints being broken
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
    // Create an HTTP client instead of WebSocket
    const client = createPublicClient({
      chain: megaethTestnet,
      transport: DEFAULT_TRANSPORT
    });
    
    const bytes32ChannelId = stringToBytes32(channelId);
    
    console.log(`Listening to batches for channel: ${channelId} using HTTP polling`);
    
    // Import ABI directly
    const contractAbi = [
      {
        "type": "event",
        "name": "Batch",
        "inputs": [
          {
            "name": "channelId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "seqStart",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "count",
            "type": "uint8",
            "indexed": false,
            "internalType": "uint8"
          },
          {
            "name": "payload",
            "type": "bytes",
            "indexed": false,
            "internalType": "bytes"
          }
        ],
        "anonymous": false
      }
    ];
    
        // Define a function to process logs
    const processLog = (log: any) => {
      try {
        // Check if log topics match our event
        if (log.topics && log.topics.length > 1) {
          const eventChannelId = log.topics[1];
          
          // Only process if it matches our channel
          if (eventChannelId === bytes32ChannelId) {
            console.log(`Received log for channel: ${channelId}`);
            
            // Decode the event data using the ABI
            const decoded = decodeEventLog({
              abi: contractAbi,
              data: log.data,
              topics: log.topics,
              eventName: 'Batch'
            });
            
            console.log('Decoded event data:', decoded);
            
            // Extract the values from the decoded data with proper type checking
            if (decoded && decoded.args) {
              // Type assertion to access the args with proper unknown conversion
              const args = decoded.args as unknown as {
                channelId: string;
                seqStart: bigint;
                count: number;
                payload: Uint8Array | string;
              };
              
              const seqStart = Number(args.seqStart);
              const count = Number(args.count);
              const payloadData = args.payload;
              
              // Convert the payload to Uint8Array
              let framesBytes: Uint8Array;
              if (typeof payloadData === 'string') {
                // Handle string payload (hex string)
                const hexString = payloadData.startsWith('0x') ? payloadData.slice(2) : payloadData;
                framesBytes = new Uint8Array(
                  Array.from({ length: Math.floor(hexString.length / 2) }, (_, i) => 
                    parseInt(hexString.substring(i * 2, i * 2 + 2), 16)
                  )
                );
              } else {
                // Already a Uint8Array
                framesBytes = payloadData;
              }
              
              // Call the callback with the batch data
              callback({
                channelId,
                seqStart,
                count,
                payload: framesBytes,
                blockNumber: log.blockNumber || BigInt(0),
                transactionHash: log.transactionHash || '0x0',
              });
            } else {
              console.error('Failed to decode event data properly', decoded);
            }
          }
        }
      } catch (error) {
        console.error('Error processing log:', error);
      }
    };

    // Get the current block number to use as a starting point
    const currentBlock = await client.getBlockNumber();
    console.log(`Starting to poll from block: ${currentBlock}`);
    
    // Save the most recent block we've processed
    let lastProcessedBlock = currentBlock;
    
    // Set up polling interval for new logs
    const pollInterval = setInterval(async () => {
      try {
        // Get the current block number
        const latestBlock = await client.getBlockNumber();
        
        // If there are no new blocks, skip this poll
        if (latestBlock <= lastProcessedBlock) {
          return;
        }
        
        console.log(`Polling for logs: blocks ${lastProcessedBlock + 1n} to ${latestBlock}`);
        
        // Query logs for our event in the new block range
        const logs = await client.getLogs({
          address: CONTRACT_ADDRESS,
          event: {
            type: 'event',
            name: 'Batch',
            inputs: [
              { type: 'bytes32', name: 'channelId', indexed: true },
              { type: 'uint32', name: 'seqStart', indexed: false },
              { type: 'uint8', name: 'count', indexed: false },
              { type: 'bytes', name: 'payload', indexed: false }
            ]
          },
          args: {
            channelId: bytes32ChannelId
          },
          fromBlock: lastProcessedBlock + 1n,
          toBlock: latestBlock
        });
        
        // Process any logs found
        if (logs.length > 0) {
          console.log(`Found ${logs.length} new logs in blocks ${lastProcessedBlock + 1n} to ${latestBlock}`);
          logs.forEach(processLog);
        }
        
        // Update the last processed block
        lastProcessedBlock = latestBlock;
      } catch (error) {
        console.error('Error polling for logs:', error);
      }
    }, 1000); // Poll every 1 second
    
    // Return a function that cleans up the polling interval
    return () => {
      console.log('Stopping audio batch polling');
      clearInterval(pollInterval);
    };
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

// Create WebSocket client
function createWSClient() {
  const wsTransport = custom({
    request: async ({ method, params }) => {
      const jsonRPC = {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      };
      
      // For subscription methods, we need a persistent connection
      if (method === 'eth_subscribe') {
        // Return a wrapped subscription handler
        return createWebSocketSubscription(MEGA_ETH_WSS, jsonRPC);
      }
      
      // For non-subscription methods, use a one-time request/response
      const ws = new WebSocket(MEGA_ETH_WSS);
      
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
    },
  });

  return createPublicClient({
    chain: megaethTestnet,
    transport: wsTransport,
  });
}

// Create a WebSocket subscription for real-time updates
function createWebSocketSubscription(url: string, request: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let subscriptionId: string = '';
    const ws = new WebSocket(url);
    
    // Define the callback handler function
    let onLogCallback: ((result: any) => void) | null = null;
    
    // Extract the callback from the watch parameters if available
    if (request.method === 'eth_subscribe' && 
        request.params && 
        request.params[0] === 'logs' && 
        request.params[1]?.onLogs) {
      
      // Extract the callback
      onLogCallback = request.params[1].onLogs;
      
      // Create clean params object without the callback
      const cleanParams = { ...request.params[1] };
      delete cleanParams.onLogs;
      
      // Update request to use standard format without the callback
      request = {
        ...request,
        params: [request.params[0], cleanParams]
      };
    }
    
    // Keep track of whether subscription was successfully established
    let subscriptionEstablished = false;
    
    ws.onopen = () => {
      console.log('WebSocket connection opened for subscription');
      ws.send(JSON.stringify(request));
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle subscription confirmation
        if (!subscriptionEstablished && data.result) {
          subscriptionId = data.result;
          subscriptionEstablished = true;
          console.log(`Subscription established with ID: ${subscriptionId}`);
          
          // Register the callback if available
          if (onLogCallback) {
            console.log(`Registering handler for subscription ID: ${subscriptionId}`);
            subscriptionHandlers.set(subscriptionId, onLogCallback);
          }
          
          // Return the subscription ID, but keep the connection open
          resolve(subscriptionId);
          return;
        }
        
        // Handle subscription events
        if (data.params?.subscription && data.method === 'eth_subscription') {
          // Find the registered event handler for this subscription
          const handler = subscriptionHandlers.get(data.params.subscription);
          if (handler) {
            handler(data.params.result);
          } else {
            // Log missing handler
            console.warn(`No handler found for subscription: ${data.params.subscription}`, data.params.result);
            
            // Register an on-the-fly handler for this subscription if possible
            // This helps in case the subscription ID was not properly stored
            if (request.method === 'eth_subscribe' && 
                request.params && 
                request.params[0] === 'logs' &&
                data.params.result && 
                data.params.result.topics && 
                data.params.result.topics.length > 0) {
              
              // This is a logs subscription, attempt to handle it
              console.log('Attempting to handle unregistered logs subscription');
              
              // Use all registered watchEvent handlers as fallbacks
              subscriptionHandlers.forEach((existingHandler) => {
                try {
                  existingHandler(data.params.result);
                } catch (err) {
                  // Ignore errors in fallback handling
                }
              });
            }
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket subscription error:', error);
      if (!subscriptionEstablished) {
        reject(new Error('Failed to establish WebSocket subscription'));
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket subscription closed');
      // Remove the subscription handler when the connection closes
      if (subscriptionId) {
        subscriptionHandlers.delete(subscriptionId);
      }
    };
    
    // Store the WebSocket connection for later cleanup
    if (activeSubscriptions.has(url)) {
      // Close any existing connection for this URL
      const existingWs = activeSubscriptions.get(url);
      if (existingWs && existingWs.readyState !== WebSocket.CLOSED) {
        existingWs.close();
      }
    }
    
    // Store the new connection
    activeSubscriptions.set(url, ws);
  });
}

// Store active WebSocket subscription connections
const activeSubscriptions = new Map<string, WebSocket>();

// Store subscription event handlers
const subscriptionHandlers = new Map<string, (result: any) => void>();

// Get transaction statistics and metrics
export function getTransactionStats() {
  // Calculate metrics
  const totalTxs = Object.keys(transactionMetrics).length;
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