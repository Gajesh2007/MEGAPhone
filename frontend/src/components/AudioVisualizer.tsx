import React, { useRef, useEffect, useState } from 'react';

interface AudioVisualizerProps {
  mediaStream: MediaStream | null;
  isActive: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ mediaStream, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const prevHeightsRef = useRef<number[]>([]);
  const [dimensions, setDimensions] = useState({ width: 200, height: 80 });

  useEffect(() => {
    const setupAnalyzer = async () => {
      if (!mediaStream || !isActive) return;
      
      try {
        // Create audio context if it doesn't exist
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        
        // Create analyzer node
        analyzerRef.current = audioContextRef.current.createAnalyser();
        analyzerRef.current.fftSize = 1024; // Larger FFT size for more frequency data
        analyzerRef.current.smoothingTimeConstant = 0.7; // More responsive for voice
        
        // Connect the media stream to the analyzer
        const source = audioContextRef.current.createMediaStreamSource(mediaStream);
        source.connect(analyzerRef.current);
        
        // Start drawing
        startDrawing();
      } catch (error) {
        console.error('Error setting up audio analyzer:', error);
      }
    };
    
    const startDrawing = () => {
      if (!analyzerRef.current || !canvasRef.current) return;
      
      // Set canvas dimensions
      const canvas = canvasRef.current;
      const parentWidth = canvas.parentElement?.clientWidth || 200;
      setDimensions({
        width: parentWidth,
        height: 80
      });
      
      // Draw visualizer
      const draw = () => {
        if (!isActive || !analyzerRef.current || !canvasRef.current) {
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          return;
        }
        
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const analyzer = analyzerRef.current;
        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Get frequency data
        analyzer.getByteFrequencyData(dataArray);
        
        // Create trailing effect by not fully clearing the canvas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // Semi-transparent black for fading effect
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw frequency bars - use fewer bars for a cleaner EQ look
        const totalBars = 16; // Limit to 16 bars for a cleaner EQ look
        const barSpacing = 3; // Space between bars
        const barWidth = Math.max(4, (canvas.width - (totalBars - 1) * barSpacing) / totalBars);
        
        // Start position to center the bars
        let x = (canvas.width - (totalBars * barWidth + (totalBars - 1) * barSpacing)) / 2;
        
        // Initialize previous heights array if needed
        if (prevHeightsRef.current.length !== totalBars) {
          prevHeightsRef.current = Array(totalBars).fill(0);
        }
        
        // Human voice frequency optimization
        // Sample rate is typically 48000 Hz for our audio context
        // Each frequency bin represents (sampleRate / fftSize) Hz
        // For 48000Hz and fftSize of 1024, each bin is ~46.9Hz
        
        // Calculate bin range for human voice (500Hz-8000Hz)
        const sampleRate = audioContextRef.current?.sampleRate || 48000;
        const binSize = sampleRate / analyzer.fftSize;
        
        // Calculate start and end bins for our frequency range
        // Human voice is typically 500Hz to 8000Hz, but we'll emphasize certain ranges
        const minFreqBin = Math.floor(500 / binSize); // ~500Hz
        const maxFreqBin = Math.floor(8000 / binSize); // ~8000Hz
        
        // Calculate voice frequency range
        const voiceFreqRange = maxFreqBin - minFreqBin;
        const binsPerBar = Math.ceil(voiceFreqRange / totalBars);
        
        // Distribution of importance across the spectrum (more weight to mid frequencies)
        // Voice fundamentals (~500-2000Hz) and formants (~2000-4000Hz) are most important
        const frequencyWeights = [
          0.5,  0.6,  0.7,  0.8,  0.9,  1.0,  1.0,  1.0,  // Lower frequencies (500-2000Hz)
          1.0,  1.0,  0.9,  0.9,  0.8,  0.7,  0.6,  0.5   // Higher frequencies (2000-8000Hz)
        ];
        
        for (let i = 0; i < totalBars; i++) {
          // Get weighted average of a range of frequencies for this bar
          let sum = 0;
          let count = 0;
          
          // Calculate frequency range for this bar focusing on voice frequencies
          const startIndex = minFreqBin + (i * binsPerBar);
          const endIndex = Math.min(startIndex + binsPerBar, maxFreqBin);
          
          for (let j = startIndex; j < endIndex; j++) {
            // Apply weight to emphasize voice frequencies
            sum += dataArray[j] * (frequencyWeights[i] || 0.8);
            count++;
          }
          
          // Calculate bar height with some minimum height for aesthetics
          // Apply dynamic scaling to make the visualization more expressive for voice
          const avgValue = count > 0 ? sum / count : 0;
          
          // Apply a non-linear curve to make small differences more noticeable
          // This makes the visualization more expressive for speech
          const scaledValue = Math.pow(avgValue / 255, 0.8) * 255;
          
          // Add some baseline activity for a more lively visualization
          let rawBarHeight = Math.max(4, (scaledValue / 255) * canvas.height);
          
          // Smooth transitions between frames for a more natural animation
          // Apply momentum and dampening for more natural movement
          const dampening = 0.3; // Lower value = smoother but less responsive
          const momentum = 0.7;  // Higher value = more persistent motion
          
          // Calculate new height with dampening (smoother transitions)
          let barHeight = prevHeightsRef.current[i] * momentum + rawBarHeight * dampening;
          
          // Update previous heights for next frame
          prevHeightsRef.current[i] = barHeight;
          
          // Create gradient from bottom to top with color based on frequency
          // Use warmer colors for mid-range frequencies (where voice is most present)
          const barPosition = i / totalBars; // 0 to 1 across the frequency range
          
          // Pick appropriate colors for the voice range
          let primaryColor, secondaryColor;
          
          if (barPosition < 0.3) {
            // Lower frequencies - green with glow effect
            primaryColor = 'rgba(52, 199, 89, 0.95)';
            secondaryColor = 'rgba(52, 199, 89, 0.1)';
          } else if (barPosition < 0.7) {
            // Mid frequencies (main voice range) - brighter green with yellow hint
            primaryColor = 'rgba(100, 220, 100, 0.95)';
            secondaryColor = 'rgba(100, 220, 100, 0.1)';
          } else {
            // Higher frequencies - green with blue hint
            primaryColor = 'rgba(52, 199, 150, 0.95)';
            secondaryColor = 'rgba(52, 199, 150, 0.1)';
          }
          
          const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
          gradient.addColorStop(0, primaryColor);
          gradient.addColorStop(1, secondaryColor);
          
          ctx.fillStyle = gradient;
          
          // Draw rounded top bar with glow effect for a more modern look
          // Main bar
          ctx.beginPath();
          ctx.moveTo(x, canvas.height - barHeight + 2);
          ctx.lineTo(x, canvas.height);
          ctx.lineTo(x + barWidth, canvas.height);
          ctx.lineTo(x + barWidth, canvas.height - barHeight + 2);
          ctx.quadraticCurveTo(x + barWidth/2, canvas.height - barHeight - 2, x, canvas.height - barHeight + 2);
          ctx.fill();
          
          // Add a subtle glow at the top of active bars
          if (barHeight > 10) {
            const glowColor = primaryColor.replace(/[^,]+(?=\))/, '0.3'); // Use same color with reduced opacity
            ctx.fillStyle = glowColor;
            ctx.beginPath();
            ctx.ellipse(
              x + barWidth/2, 
              canvas.height - barHeight + 2, 
              barWidth/2 + 1, 
              4, 
              0, 0, Math.PI * 2
            );
            ctx.fill();
          }
          
          // Move to next bar position
          x += barWidth + barSpacing;
        }
        
        // Request next frame
        animationFrameRef.current = requestAnimationFrame(draw);
      };
      
      // Start animation loop
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    
    // Setup analyzer when stream changes or becomes active
    if (mediaStream && isActive) {
      setupAnalyzer();
    }
    
    // Cleanup function
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      analyzerRef.current = null;
    };
  }, [mediaStream, isActive]);
  
  useEffect(() => {
    // Handle window resize
    const handleResize = () => {
      if (canvasRef.current) {
        const parentWidth = canvasRef.current.parentElement?.clientWidth || 200;
        setDimensions({
          width: parentWidth,
          height: 80
        });
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return (
    <div className="audio-visualizer">
      <canvas 
        ref={canvasRef} 
        width={dimensions.width} 
        height={dimensions.height}
        style={{ 
          display: isActive ? 'block' : 'none',
          borderRadius: '12px',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)'
        }}
      />
    </div>
  );
};

export default AudioVisualizer;