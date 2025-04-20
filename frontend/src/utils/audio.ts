/**
 * Interface for encoded audio data
 */
export interface EncodedAudioBuffer {
  sequence: number;
  data: Uint8Array;
}

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
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      
      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });
      
      // Use MediaRecorder instead of AudioWorklet for better compatibility
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 24000, // Opus typically works well at 24kbps for voice
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

/**
 * AudioPlayer class - handles decoding and playing Opus audio frames
 */
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private jitterBufferMs: number = 100;
  private volume: number = 1.0;
  private frameMap: Map<number, Uint8Array> = new Map();
  private expectedSequence: number = 0;
  private isPlaying: boolean = false;
  private statsInterval: number | null = null;
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
        sampleRate: 48000,
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
    if (!this.isPlaying) return;

    try {
      // Frame size is fixed at 160 bytes for our Opus implementation
      const FRAME_SIZE = 160;

      // Store frames in our jitter buffer map
      for (let i = 0; i < count; i++) {
        const sequence = seqStart + i;
        const offset = i * FRAME_SIZE;
        const frameData = payload.slice(offset, offset + FRAME_SIZE);
        
        // Add frame to buffer
        this.frameMap.set(sequence, frameData);
      }

      // Clean up old frames (more than 2s of audio)
      const oldestSequenceToKeep = this.expectedSequence - 100;
      this.frameMap.forEach((_, seq) => {
        if (seq < oldestSequenceToKeep) {
          this.frameMap.delete(seq);
        }
      });

      // Process frames if we have any
      this.processFrames();

      // Report sequence number
      if (this.options.onSequenceUpdate) {
        this.options.onSequenceUpdate(seqStart + count - 1);
      }
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
    // In a real implementation, we would:
    // 1. Check if we have frames in sequence
    // 2. Check if we've waited long enough (jitter buffer)
    // 3. Decode and play frames that are ready
    // 4. Track missing frames
    
    // For this demo, we simulate processing by just tracking 
    // played vs. missed frames
    while (this.frameMap.has(this.expectedSequence)) {
      // Mark as played and advance
      this.packetsPlayed++;
      
      // Actually play the frame if we have an audio context
      if (this.audioContext && this.gainNode) {
        try {
          const frameData = this.frameMap.get(this.expectedSequence);
          if (frameData) {
            // Create an audio buffer from the frame data
            // For a real implementation, this would use OpusDecoder
            // Here we generate a simple tone as a placeholder
            this.playSimpleTone(this.expectedSequence);
          }
        } catch (error) {
          console.error('Error playing audio frame:', error);
        }
      }
      
      this.frameMap.delete(this.expectedSequence);
      this.expectedSequence++;
    }
    
    // If we have frames ahead but missed some, count them as lost
    const nextAvailableSeq = Array.from(this.frameMap.keys()).sort((a, b) => a - b)[0];
    if (nextAvailableSeq && nextAvailableSeq > this.expectedSequence) {
      const missedCount = nextAvailableSeq - this.expectedSequence;
      this.packetsLost += missedCount;
      this.expectedSequence = nextAvailableSeq;
    }
    
    // Apply jitter buffer wait time based on the configured MS value
    // This is a simplified simulation for demo purposes
    const jitterBufferFrames = Math.ceil(this.jitterBufferMs / 20); // 20ms per frame
    if (this.frameMap.size < jitterBufferFrames && nextAvailableSeq) {
      // In a real implementation, we would wait until we have enough frames
      console.debug(`Buffering: ${this.frameMap.size}/${jitterBufferFrames} frames (${this.jitterBufferMs}ms)`);
    }
  }

  /**
   * Play a simple tone as a placeholder for audio playback
   * @param frameSequence Sequence number of the frame
   */
  private playSimpleTone(frameSequence: number): void {
    if (!this.audioContext || !this.gainNode) return;
    
    // Create an oscillator to generate a simple tone
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = 'sine';
    
    // Vary frequency slightly based on sequence number to create more interesting sound
    const baseFreq = 440; // A4 note
    const freqVariation = (frameSequence % 10) * 20; // Vary by up to 200 Hz
    oscillator.frequency.value = baseFreq + freqVariation;
    
    oscillator.connect(this.gainNode);
    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.02); // Play for 20ms
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
