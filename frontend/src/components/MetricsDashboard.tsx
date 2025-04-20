import React, { useState, useEffect, useRef } from 'react';

interface MetricsProps {
  isActive: boolean;
  latencyHistory: number[];
  batchesSent: number;
  totalBytesTransmitted: number;
  lastBlockTime?: number;
  realtimeLatency?: number;
}

const MetricsDashboard: React.FC<MetricsProps> = ({
  isActive,
  latencyHistory,
  batchesSent,
  totalBytesTransmitted,
  lastBlockTime = 10,
  realtimeLatency = 0
}) => {
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<number | null>(null);
  
  // Calculate average latency without triggering re-renders
  const avgLatency = latencyHistory.length > 0
    ? latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length
    : 0;
  
  // Set up elapsed time tracking when broadcast starts
  useEffect(() => {
    if (isActive && startTime === 0) {
      setStartTime(Date.now());
    } else if (!isActive && startTime !== 0) {
      setStartTime(0);
      setElapsedTime(0);
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [isActive, startTime]);
  
  // Update elapsed time at regular intervals
  useEffect(() => {
    if (isActive && startTime > 0) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      
      // Set up interval for timer
      intervalRef.current = window.setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 100);
      
      // Clean up on unmount
      return () => {
        if (intervalRef.current) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [isActive, startTime]);
  
  // Draw latency graph when latencyHistory changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || latencyHistory.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Find max value for scaling
    const maxLatency = Math.max(...latencyHistory, 100); // Minimum 100ms scale
    
    // Draw background grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const y = height - (height * (i / 4));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      
      // Add labels
      ctx.fillStyle = '#888';
      ctx.font = '10px monospace';
      ctx.fillText(`${Math.round(maxLatency * (i / 4))}ms`, 5, y - 5);
    }
    
    // Draw latency history
    ctx.strokeStyle = '#6342F5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    // Draw at most the last 100 points
    const startIdx = Math.max(0, latencyHistory.length - 100);
    const visibleHistory = latencyHistory.slice(startIdx);
    
    // Calculate point spacing
    const pointSpacing = width / (visibleHistory.length - 1 || 1);
    
    for (let i = 0; i < visibleHistory.length; i++) {
      const x = i * pointSpacing;
      const y = height - (visibleHistory[i] / maxLatency) * height;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    
    // Draw points
    ctx.fillStyle = '#FF5E5B';
    for (let i = 0; i < visibleHistory.length; i++) {
      const x = i * pointSpacing;
      const y = height - (visibleHistory[i] / maxLatency) * height;
      
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Add average line
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const avgY = height - (avgLatency / maxLatency) * height;
    ctx.moveTo(0, avgY);
    ctx.lineTo(width, avgY);
    ctx.stroke();
    
    // Add label for average
    ctx.fillStyle = '#4CAF50';
    ctx.font = '10px monospace';
    ctx.fillText(`Avg: ${avgLatency.toFixed(1)}ms`, width - 100, avgY - 5);
  }, [latencyHistory, avgLatency]);
  
  // Format time as mm:ss.ms
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
  };
  
  // Calculate data transmission rate in KB/s
  const dataRate = elapsedTime > 0 
    ? ((totalBytesTransmitted / 1024) / (elapsedTime / 1000)).toFixed(2)
    : '0.00';
  
  // Calculate audio frames processed
  const framesProcessed = totalBytesTransmitted / 160; // Assuming 160 bytes per frame
  
  // Calculate the transaction rate per minute
  const txRate = elapsedTime > 0
    ? (batchesSent / (elapsedTime / 60000)).toFixed(2)
    : '0.00';
  
  return (
    <div className="metrics-dashboard">
      <h3>Real-time Metrics 📊</h3>
      
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-title">Broadcast Time</div>
          <div className="metric-value primary">{formatTime(elapsedTime)}</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-title">Batches Sent</div>
          <div className="metric-value secondary">{batchesSent}</div>
          <div className="metric-subtitle">{txRate} per minute</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-title">Confirmation Latency</div>
          <div className="metric-value">
            <span className="highlight-text">{realtimeLatency}ms</span>
          </div>
          <div className="metric-subtitle">via eth_sendRawTransaction</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-title">Block Time</div>
          <div className="metric-value highlight">{lastBlockTime}ms</div>
          <div className="metric-subtitle">MegaETH Block Production</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-title">Audio Data</div>
          <div className="metric-value">{(totalBytesTransmitted / 1024).toFixed(2)} KB</div>
          <div className="metric-subtitle">{dataRate} KB/s</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-title">Audio Frames</div>
          <div className="metric-value">{Math.floor(framesProcessed)}</div>
          <div className="metric-subtitle">~{Math.floor(framesProcessed / 50 * 20 / 1000)} seconds</div>
        </div>
      </div>
      
      <div className="latency-graph">
        <h4>Transaction Latency (ms)</h4>
        <canvas ref={canvasRef} width={600} height={150}></canvas>
      </div>
      
      {isActive && (
        <div className="realtime-indicator">
          <div className="pulse"></div>
          <span>BROADCASTING LIVE ON-CHAIN</span>
        </div>
      )}
    </div>
  );
};

export default MetricsDashboard;
