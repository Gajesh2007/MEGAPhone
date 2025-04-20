declare module 'opus-recorder' {
  export default class Recorder {
    constructor(options?: {
      encoderPath?: string;
      encoderApplication?: number;
      encoderFrameSize?: number;
      numberOfChannels?: number;
      streamPages?: boolean;
      maxFramesPerPage?: number;
    });
    
    ondataavailable: (arrayBuffer: ArrayBuffer) => void;
    start(mediaStream: MediaStream): void;
    stop(): void;
  }
}
