import React from 'react';

interface SignalStrengthProps {
  latency: number | null;
}

const SignalStrength: React.FC<SignalStrengthProps> = ({ latency }) => {
  // Determine bars based on latency thresholds
  const getSignalBars = (latency: number | null): number => {
    if (latency === null) return 0;
    if (latency < 105) return 5;
    if (latency < 110) return 4;
    if (latency < 200) return 3;
    if (latency < 300) return 2;
    if (latency < 1000) return 1;
    return 0; // No service for >=1s latency
  };

  const bars = getSignalBars(latency);
  
  // Text representation based on bars
  const getSignalText = (bars: number): string => {
    if (bars === 0) return 'NO SERVICE';
    if (bars === 1) return 'POOR';
    if (bars === 2) return 'FAIR';
    if (bars === 3) return 'GOOD';
    if (bars === 4) return 'VERY GOOD';
    return 'EXCELLENT';
  };

  // Get network name based on signal strength
  const getNetworkName = (bars: number): string => {
    if (bars === 0) return '';
    if (bars <= 2) return 'MEGA 3G';
    if (bars <= 4) return 'MEGA LTE';
    return 'MEGA 5G';
  };

  return (
    <div className="signal-strength">
      <div className="signal-bars">
        {[1, 2, 3, 4, 5].map(bar => (
          <div 
            key={bar} 
            className={`signal-bar ${bar <= bars ? 'active' : ''} bar-${bar}`}
          />
        ))}
      </div>
      {bars === 0 && <div className="signal-text">NO SERVICE</div>}
    </div>
  );
};

export default SignalStrength;