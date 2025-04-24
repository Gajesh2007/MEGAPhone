/**
 * Interface for encoded audio data
 */
export interface EncodedAudioBuffer {
  sequence: number;
  data: Uint8Array;
}

/**
 * 22050 kHz (often lazily called "22 kHz") has been a reasonably popular sample rate for low bit rate MP3s such as 64 kbps in years past. Audio quality is significantly affected, with higher frequency content missing. With the general rise in the availability of large file storage space and faster data links, 22 kHz is now of more limited use.
 */
const SAMPLE_RATE = 44_000; // 

/**
 * Class to handle Opus encoding of microphone input
 */
export class OpusEncoder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private sequence: number = 0;
  private callback: ((buffer: EncodedAudioBuffer) => void) | null = null;
  private isRecording: boolean = false;
  private frameInterval: number = 20; // 20ms per frame
  private frameSize: number = 160; // bytes per frame
  private processingInterval: number | null = null;
  private audioChunks: Uint8Array[] = [];
  
  constructor() {
    console.log('OpusEncoder initialized');
  }
  
  /**
   * Start recording and encoding audio
   * @param callback Function to call with encoded audio data
   */
  public async start(callback: (buffer: EncodedAudioBuffer) => void): Promise<void> {
    if (this.isRecording) return;
    
    try {
      this.callback = callback;
      
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      
      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: SAMPLE_RATE,
        latencyHint: 'interactive',
      });
      
      // Use MediaRecorder instead of AudioWorklet for better compatibility
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: 'audio/webm;codecs=pcm',
        audioBitsPerSecond: SAMPLE_RATE, // Opus typically works well at 24kbps for voice
      });
      
      // Collect data as it becomes available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Convert blob to arraybuffer
          event.data.arrayBuffer().then((buffer) => {
            const audioData = new Uint8Array(buffer);
            this.audioChunks.push(audioData);
          });
        }
      };
      
      // Start recording with small timeslices to get frequent data
      this.mediaRecorder.start(100);
      
      // Set up processing interval to send frames regularly
      this.processingInterval = window.setInterval(() => {
        this.processAudioChunks();
      }, this.frameInterval);
      
      this.isRecording = true;
      console.log('Recording started');
    } catch (error) {
      console.error('Error starting encoder:', error);
      throw error;
    }
  }
  
  /**
   * Process collected audio chunks into fixed-size frames
   */
  private processAudioChunks(): void {
    if (!this.isRecording || !this.callback || this.audioChunks.length === 0) return;
    
    // Combine all chunks into one buffer
    let totalLength = 0;
    this.audioChunks.forEach(chunk => totalLength += chunk.length);
    
    if (totalLength === 0) return;
    
    const combinedData = new Uint8Array(totalLength);
    let offset = 0;
    
    this.audioChunks.forEach(chunk => {
      combinedData.set(chunk, offset);
      offset += chunk.length;
    });
    
    // Clear the chunks array
    this.audioChunks = [];
    
    // Split into fixed-size frames
    const numFrames = Math.floor(combinedData.length / this.frameSize);
    
    for (let i = 0; i < numFrames; i++) {
      const frameData = combinedData.slice(i * this.frameSize, (i + 1) * this.frameSize);
      
      // Send frame to callback
      this.callback({
        sequence: this.sequence++,
        data: frameData
      });
    }
  }
  
  /**
   * Stop recording and encoding audio
   */
  public stop(): void {
    if (!this.isRecording) return;
    
    // Stop the processing interval
    if (this.processingInterval !== null) {
      window.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    // Stop the media recorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    
    // Stop all tracks in the media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    // Close the audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.isRecording = false;
    this.callback = null;
    console.log('Recording stopped');
  }
}

/**
 * Enhanced AudioPlayer interface
 */
export interface AudioPlayerOptions {
  onSequenceUpdate?: (seq: number) => void;
  onStatsUpdate?: (stats: {
    packetsPlayed: number;
    packetsLost: number;
    bufferSize?: number;
  }) => void;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private jitterBufferMs: number = 100;
  private volume: number = 1.0;
  private frameMap: Map<number, Uint8Array> = new Map();
  private expectedSequence: number = 0;
  private isPlaying: boolean = false;
  private statsInterval: number | null = null;
  private processingInterval: number | null = null;
  private packetsPlayed: number = 0;
  private packetsLost: number = 0;
  private options: AudioPlayerOptions;

  constructor(options: AudioPlayerOptions = {}) {
    this.options = options;
  }

  /**
   * Start the audio playback system
   */
  public async start(): Promise<void> {
    if (this.isPlaying) return;

    try {
      // Create audio context with appropriate settings
      this.audioContext = new AudioContext({
        sampleRate: SAMPLE_RATE,
        latencyHint: 'interactive'
      });

      // Reset state
      this.frameMap.clear();
      this.expectedSequence = 0;
      this.packetsPlayed = 0;
      this.packetsLost = 0;
      this.isPlaying = true;

      // Create a gain node for volume control instead of using AudioWorklet
      // This avoids the worklet loading errors
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioContext.destination);

      // Start the frame processing interval - check for frames every 10ms
      this.processingInterval = window.setInterval(() => {
        if (this.isPlaying) {
          this.processFrames();
        }
      }, 10);

      // Start stats reporting
      this.startStatsReporting();

      console.log('Audio player started');
    } catch (error) {
      console.error('Error starting audio player:', error);
      throw error;
    }
  }

  /**
   * Stop the audio playback system
   */
  public stop(): void {
    if (!this.isPlaying) return;

    // Stop stats reporting
    if (this.statsInterval) {
      window.clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Stop frame processing
    if (this.processingInterval) {
      window.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Cleanup audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.gainNode = null;
    this.isPlaying = false;
    this.frameMap.clear();

    console.log('Audio player stopped');
  }

  /**
   * Process an audio batch from the blockchain
   * @param seqStart Starting sequence number
   * @param count Number of frames in the batch
   * @param payload Raw audio data
   */
  public processBatch(seqStart: number, count: number, payload: Uint8Array): void {
    if (!this.isPlaying || !payload || payload.length === 0) return;

    try {
      // Frame size is fixed at 160 bytes for our Opus implementation
      const FRAME_SIZE = 160;
      
      // Validate payload size to ensure we have complete frames
      const expectedSize = count * FRAME_SIZE;
      if (payload.length < expectedSize) {
        console.warn(`Invalid payload size: expected ${expectedSize} bytes, got ${payload.length}`);
        count = Math.floor(payload.length / FRAME_SIZE); // Adjust count to match available data
      }

      // Store frames in our jitter buffer map
      for (let i = 0; i < count; i++) {
        const sequence = seqStart + i;
        const offset = i * FRAME_SIZE;
        
        // Make sure we don't go beyond array bounds
        if (offset + FRAME_SIZE <= payload.length) {
          // Create a copy of the frame data to prevent reference issues
          const frameData = new Uint8Array(payload.slice(offset, offset + FRAME_SIZE));
          
          // Add frame to buffer, only if we don't already have this sequence
          // (avoid duplicates which could be caused by blockchain re-orgs)
          if (!this.frameMap.has(sequence)) {
            this.frameMap.set(sequence, frameData);
          }
        }
      }

      // Process frames immediately to reduce latency
      this.processFrames();
      
      // Update our sequence tracker
      if (this.options.onSequenceUpdate && count > 0) {
        const highestProcessedSeq = seqStart + (count - 1);
        this.options.onSequenceUpdate(highestProcessedSeq);
      }
      
      // Debug: Report buffer status
      const bufferSize = this.frameMap.size;
      const bufferTimeMs = bufferSize * 20; // 20ms per frame
      console.debug(`Buffer status: ${bufferSize} frames (${bufferTimeMs}ms of audio)`);
      
    } catch (error) {
      console.error('Error processing audio batch:', error);
    }
  }

  /**
   * Set the jitter buffer size
   * @param ms Jitter buffer size in milliseconds
   */
  public setJitterBufferMs(ms: number): void {
    this.jitterBufferMs = ms;
    console.log(`Jitter buffer set to ${ms}ms`);
  }

  /**
   * Set the playback volume
   * @param value Volume from 0.0 to 1.0
   */
  public setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    
    // Update gain if active
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
    
    console.log(`Volume set to ${this.volume}`);
  }

  /**
   * Process frames from the jitter buffer at regular intervals
   */
  private processFrames(): void {
    // If no frames in the buffer, nothing to do
    if (this.frameMap.size === 0) return;
    
    // Calculate jitter buffer size in frames (20ms per frame)
    const jitterBufferFrames = Math.ceil(this.jitterBufferMs / 20);
    
    // Get all available sequence numbers and sort them
    const availableSeqs = Array.from(this.frameMap.keys()).sort((a, b) => a - b);
    const lowestSeq = availableSeqs[0];
    const highestSeq = availableSeqs[availableSeqs.length - 1];
    
    // Initialize expected sequence if it's the first frame
    if (this.expectedSequence === 0 && lowestSeq > 0) {
      this.expectedSequence = lowestSeq;
    }
    
    // Buffer status logging (only in debug)
    const bufferDepth = highestSeq - this.expectedSequence + 1;
    if (bufferDepth < jitterBufferFrames) {
      // Still buffering, waiting for more frames
      console.debug(`Buffering: ${bufferDepth}/${jitterBufferFrames} frames (${this.jitterBufferMs}ms)`);
      return;
    }
    
    // Process frames that are ready to be played
    while (this.frameMap.has(this.expectedSequence)) {
      // Get the frame data
      const frameData = this.frameMap.get(this.expectedSequence);
      
      // Play the audio if we have valid frame data and audio context
      if (frameData && this.audioContext && this.gainNode) {
        try {
          this.playAudioFrame(frameData);
          this.packetsPlayed++;
        } catch (error) {
          console.error('Error playing audio frame:', error);
        }
      }
      
      // Remove the frame from our buffer and advance sequence
      this.frameMap.delete(this.expectedSequence);
      this.expectedSequence++;
    }
    
    // Handle packet loss: if we have frames ahead but missed some in between
    const nextSeq = availableSeqs.find(seq => seq > this.expectedSequence);
    if (nextSeq && nextSeq > this.expectedSequence) {
      // We missed some frames, count them as lost
      const missedCount = nextSeq - this.expectedSequence;
      this.packetsLost += missedCount;
      
      // For better audio continuity, we could insert "comfort noise" frames
      // here in a full implementation, but for now we'll just advance
      console.debug(`Missed ${missedCount} frames, skipping to sequence ${nextSeq}`);
      
      // Jump to the next available sequence
      this.expectedSequence = nextSeq;
    }
    
    // Clean up old frames (more than 2 seconds old)
    const oldestFrameToKeep = this.expectedSequence - 100; // ~2 seconds at 20ms per frame
    availableSeqs.forEach(seq => {
      if (seq < oldestFrameToKeep) {
        this.frameMap.delete(seq);
      }
    });
  }

  /**
   * Play the actual audio frame data from the Opus-encoded stream
   * @param frameData The audio frame data to play
   */
  private playAudioFrame(frameData: Uint8Array): void {
    if (!this.audioContext || !this.gainNode) return;
    
    try {
      const audioCtx = this.audioContext;
      
      // Debug the incoming data to see what we're actually receiving
      const isAllZeros = frameData.every(byte => byte === 0);
      // const sum = frameData.reduce((acc, val) => acc + val, 0);
      //const avg = sum / frameData.length;
      const min = Math.min(...frameData);
      const max = Math.max(...frameData);
      
      // If the data is all zeros or doesn't vary much, it's likely not valid audio
      if (isAllZeros || (max - min < 5)) {
        console.debug("Skipping silent or invalid frame");
        return;
      }
      
      try {
        // If we have 160 bytes, and each 16-bit sample is 2 bytes, we have 80 samples
        const numSamples = Math.floor(frameData.length / 2);
        const audioBuffer = audioCtx.createBuffer(1, numSamples, SAMPLE_RATE);
        const channelData = audioBuffer.getChannelData(0);
        
        // Convert byte pairs to 16-bit PCM samples
        for (let i = 0; i < numSamples; i++) {
          // Get the byte pair for this sample
          const lsb = frameData[i * 2];
          const msb = frameData[i * 2 + 1];
          
          // Combine them into a 16-bit value
          // Little-endian: least significant byte first
          const int16Sample = (msb << 8) | lsb;
          
          // Convert from 16-bit signed integer [-32768, 32767] to float [-1, 1]
          channelData[i] = int16Sample / 32768;
        }
        
        // Create the audio source
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        
        // Connect audio graph: source -> gain -> destination
        source.connect(this.gainNode);
        
        // Play the audio
        source.start();
        console.debug("Playing audio using 16-bit PCM decoding");
        
        // Return early - we won't try the other methods
        return;
      } catch (pcm16Error) {
        console.debug("16-bit PCM decoding failed, trying alternates:", pcm16Error);
      }
    } catch (error) {
      console.error('Error playing audio frame:', error);
    }
  }

  /**
   * Start stats reporting
   */
  private startStatsReporting(): void {
    if (this.statsInterval) {
      window.clearInterval(this.statsInterval);
    }

    this.statsInterval = window.setInterval(() => {
      if (this.options.onStatsUpdate) {
        this.options.onStatsUpdate({
          packetsPlayed: this.packetsPlayed,
          packetsLost: this.packetsLost,
          bufferSize: this.frameMap.size
        });
      }
    }, 500);
  }
}