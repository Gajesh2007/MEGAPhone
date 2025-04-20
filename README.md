# MEGAPhone: On-Chain Voice Broadcasting

MEGAPhone is an experimental application that demonstrates the ultra-fast block times of the MegaETH blockchain by enabling real-time voice broadcasting directly on-chain. With blocks produced every 10ms, MEGAPhone showcases how blockchain technology can support live audio streaming with latency comparable to traditional centralized services.

## 🚀 Features

- **Live Voice Broadcasting**: Stream your voice directly on-chain with minimal latency
- **Decentralized Listening**: Anyone with your channel ID can tune in to your broadcast
- **No Backend Services**: Pure browser + smart contract implementation, no servers involved
- **Transparent & Verifiable**: All audio transmissions are verifiable on-chain
- **Low Latency**: Leverages MegaETH's 10ms blocks for near real-time audio experience

## 🔧 Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Blockchain Interaction**: viem.js (Ethereum library)
- **Audio Processing**: Web Audio API + Opus codec
- **Smart Contract**: Solidity (stateless audio relay)
- **Blockchain**: MegaETH (Chain ID: 6342)

## 📊 Architecture

MEGAPhone consists of three main components:

1. **Smart Contract** (`contracts/src/OnchainBroadcast.sol`)
   - Stateless relay that accepts batched audio frames
   - Emits `Batch` events containing encoded audio data
   - No storage writes for minimal gas costs

2. **Broadcaster UI** (`frontend/src/pages/Broadcaster.tsx`)
   - Captures microphone audio
   - Encodes audio using Opus codec
   - Batches frames and sends to blockchain
   - Displays performance metrics and transaction status

3. **Listener UI** (`frontend/src/pages/Listener.tsx`)
   - Subscribes to blockchain events via WebSocket
   - Reassembles audio batches from on-chain events
   - Implements jitter-buffer to handle network timing variations
   - Decodes and plays audio via Web Audio API

## 🏃‍♂️ Getting Started

### Prerequisites

- Node.js 16+
- Metamask or another Web3 wallet (optional)
- A small amount of MegaETH testnet tokens for broadcasting

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/MEGAPhone.git
   cd MEGAPhone
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Install contract dependencies (if you want to modify the contract):
   ```bash
   cd ../contracts
   forge install
   ```

### Running the Application

1. Start the frontend development server:
   ```bash
   cd frontend
   npm run dev
   ```

2. Open your browser and navigate to `http://localhost:5173`

## 🎙️ How to Use

### Broadcasting

1. Visit the Broadcaster page
2. The app will create a local wallet for you automatically
3. Fund your wallet with a small amount of MegaETH tokens
4. Enter a unique channel ID or generate one
5. Click "Start Broadcasting" and allow microphone access
6. Share your channel ID with listeners
7. Monitor real-time metrics as you broadcast

### Listening

1. Visit the Listener page
2. Enter the broadcaster's channel ID
3. Click "Start Listening"
4. Adjust volume and buffer settings as needed
5. View real-time metrics of the audio stream

## 🧠 Technical Details

### MegaETH Configuration

- **Chain ID**: 6342
- **RPC Endpoint**: https://carrot.megaeth.com/mafia/rpc/20vd3cbmv2iwxxyi5x8kzef063q1ncjegg0ei27u
- **Contract Address**: 0xF2A6dA0098eEa4A62802BB87A5447C987a39B5b9
- **Block Time**: 10ms
- **EIP-1559 Support**:
  - Base fee target: 0.0025 Gwei
  - Base fee floor: 0.001 Gwei
  - Max block size: 2 Giga gas
  - Target block size: 50% (1 Giga gas)

### Audio Protocol

- **Sampling**: 16 kHz mono audio
- **Encoding**: Opus @ 16 kbps (~40 bytes per 20ms frame)
- **Batching**: 10 frames (200ms) per transaction
- **Jitter Buffer**: Configurable (default 100ms) to smooth playback

## 🛡️ Security and Privacy

- **Public Broadcasting**: All voice data is publicly accessible on-chain
- **Ephemeral Keys**: Local browser-stored keys for easy broadcasting
- **Chain ID Protection**: Prevents accidental broadcasting on mainnet

## 🔍 Limitations

- **One-way Communication**: Current version supports only unidirectional broadcasting
- **Gas Costs**: Broadcasting requires small amounts of gas for each audio batch
- **Browser Compatibility**: Requires modern browser with WebAudio support

## 🔮 Future Developments

- **Two-way Communication**: Enable conference-style conversations
- **Encryption**: Optional end-to-end encryption for private broadcasts
- **Custom Identities**: Integration with ENS or other identity systems
- **Improved Codec Options**: Adaptive bitrate based on network conditions

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📚 Resources

- [MegaETH Documentation](https://megaeth.com)
- [Opus Codec](https://opus-codec.org/)
- [viem.js Documentation](https://viem.sh)
