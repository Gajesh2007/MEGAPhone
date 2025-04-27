import { 
  createWalletClient, 
  createPublicClient, 
  type WalletClient, 
  type Account,
  http,
  formatEther,
  webSocket,
  getContract,
  hexToBytes,
  stringToHex,
  encodeFunctionData,
  toHex,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';
import { megaethTestnet } from 'viem/chains';
import { abi as OnchainBroadcastAbi } from './OnchainBroadcast.abi';

const USE_WSS = false; // Using HTTP instead since WebSocket endpoints are currently broken

export const MEGA_ETH_WSS = 'https://carrot.megaeth.com/mafia/ws/1f81b9d19ac74804b41085bc1018be8ea5d9c6e8';
export const DEFAULT_TRANSPORT = USE_WSS ? webSocket(MEGA_ETH_WSS) : http('https://carrot.megaeth.com/mafia/rpc/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u');

// Contract address
export const CONTRACT_ADDRESS = '0xF2A6dA0098eEa4A62802BB87A5447C987a39B5b9' as const;

// Create a local wallet client for broadcasting
// Stores the private key in localStorage for persistent identity
export function createLocalWalletClient(): WalletClient {
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
  
  return walletClient;
}

const client = createPublicClient({
  chain: megaethTestnet,
  transport: DEFAULT_TRANSPORT
});

const contract = getContract({
  abi: OnchainBroadcastAbi,
  address: CONTRACT_ADDRESS,
  client: client,
});



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
    const channelIdBytes = keccak256(stringToHex(channelId));

    const data = encodeFunctionData({
      functionName: 'sendBatch',
      abi: OnchainBroadcastAbi,
      args: [channelIdBytes, seqStart, toHex(frames)]
    })
    
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
  _channelId: string,
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
    const channelId = keccak256(stringToHex(_channelId));

    console.log(`Listening on channel: ${channelId}`);

    const cancelLogs = contract.watchEvent.Batch({
      channelId
    }, {pollingInterval: 20, onLogs: (logs) => {
      console.log(`Got ${logs.length} frames.`);
      logs.forEach(log => {
        const seqStart = Number(log.args.seqStart);
        const count = Number(log.args.count);
        const payloadData = log.args.payload; 
        const framesBytes =  hexToBytes(payloadData!);
       
        callback({
          channelId,
          seqStart,
          count,
          payload: framesBytes,
          blockNumber: log.blockNumber || BigInt(0),
          transactionHash: log.transactionHash || '0x0',
        });
      })
    }})
    
    return () => {
      console.log('Stopping audio batch polling');
      cancelLogs();
    };
  } catch (error) {
    console.error('Error listening to audio batches:', error);
    throw error;
  }
}

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