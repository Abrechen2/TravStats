declare module 'react-globe.gl' {
  import { FC } from 'react';

  interface GlobeProps {
    ref?: any;
    globeImageUrl?: string;
    backgroundImageUrl?: string | null;
    bumpImageUrl?: string;
    arcsData?: any[];
    arcColor?: string | ((arc: any) => string);
    arcDashLength?: number;
    arcDashGap?: number;
    arcDashInitialGap?: number | (() => number);
    arcDashAnimateTime?: number;
    arcStroke?: number;
    arcAltitude?: number | ((arc: any) => number);
    arcCurveResolution?: number;
    arcLabel?: string | ((arc: any) => string);
    onArcClick?: (arc: any) => void;
    pointsData?: any[];
    pointLat?: string | ((point: any) => number);
    pointLng?: string | ((point: any) => number);
    pointColor?: string | ((point: any) => string);
    pointAltitude?: number;
    pointRadius?: number | ((point: any) => number);
    pointLabel?: string | ((point: any) => string);
    atmosphereColor?: string;
    atmosphereAltitude?: number;
    enablePointerInteraction?: boolean;
    animateIn?: boolean;
    [key: string]: any;
  }

  const Globe: FC<GlobeProps>;
  export default Globe;
}
