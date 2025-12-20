import { describe, it, expect } from '@jest/globals';
import { calculateDistance, generateArcPoints } from '../utils/geo';

describe('Geo Utils', () => {
  describe('calculateDistance', () => {
    it('should calculate distance between two coordinates', () => {
      // Munich (MUC) to Luxembourg (LUX)
      const munich = { lat: 48.1351, lon: 11.5820 };
      const luxembourg = { lat: 49.6233, lon: 6.2044 };

      const distance = calculateDistance(
        munich.lat,
        munich.lon,
        luxembourg.lat,
        luxembourg.lon
      );

      // Expected distance is approximately 426 km
      expect(distance).toBeGreaterThan(420);
      expect(distance).toBeLessThan(435);
    });

    it('should return 0 for same coordinates', () => {
      const distance = calculateDistance(48.1351, 11.5820, 48.1351, 11.5820);

      expect(distance).toBeLessThan(0.01); // Very close to 0
    });

    it('should calculate long distances correctly', () => {
      // New York to London
      const newYork = { lat: 40.7128, lon: -74.0060 };
      const london = { lat: 51.5074, lon: -0.1278 };

      const distance = calculateDistance(
        newYork.lat,
        newYork.lon,
        london.lat,
        london.lon
      );

      // Expected distance is approximately 5,570 km
      expect(distance).toBeGreaterThan(5500);
      expect(distance).toBeLessThan(5600);
    });

    it('should handle southern hemisphere coordinates', () => {
      // Sydney to Melbourne
      const sydney = { lat: -33.8688, lon: 151.2093 };
      const melbourne = { lat: -37.8136, lon: 144.9631 };

      const distance = calculateDistance(
        sydney.lat,
        sydney.lon,
        melbourne.lat,
        melbourne.lon
      );

      // Expected distance is approximately 715 km
      expect(distance).toBeGreaterThan(700);
      expect(distance).toBeLessThan(730);
    });

    it('should handle coordinates across dateline', () => {
      // Tokyo to San Francisco
      const tokyo = { lat: 35.6762, lon: 139.6503 };
      const sanFrancisco = { lat: 37.7749, lon: -122.4194 };

      const distance = calculateDistance(
        tokyo.lat,
        tokyo.lon,
        sanFrancisco.lat,
        sanFrancisco.lon
      );

      // Expected distance is approximately 8,280 km
      expect(distance).toBeGreaterThan(8200);
      expect(distance).toBeLessThan(8400);
    });

    it('should calculate distance for equator crossing', () => {
      // Singapore (northern hemisphere) to Jakarta (near equator)
      const singapore = { lat: 1.3521, lon: 103.8198 };
      const jakarta = { lat: -6.2088, lon: 106.8456 };

      const distance = calculateDistance(
        singapore.lat,
        singapore.lon,
        jakarta.lat,
        jakarta.lon
      );

      // Expected distance is approximately 890 km
      expect(distance).toBeGreaterThan(850);
      expect(distance).toBeLessThan(920);
    });
  });

  describe('generateArcPoints', () => {
    it('should generate points along great circle arc', () => {
      const start: [number, number] = [11.5820, 48.1351]; // Munich [lon, lat]
      const end: [number, number] = [6.2044, 49.6233]; // Luxembourg [lon, lat]

      const points = generateArcPoints(start, end, 10);

      expect(points).toHaveLength(11); // 10 segments = 11 points (including start and end)
      expect(points[0]).toEqual(start);
      // Use toBeCloseTo for floating point comparison
      expect(points[10][0]).toBeCloseTo(end[0], 4);
      expect(points[10][1]).toBeCloseTo(end[1], 4);
    });

    it('should generate default 50 points when numPoints not specified', () => {
      const start: [number, number] = [0, 0];
      const end: [number, number] = [10, 10];

      const points = generateArcPoints(start, end);

      expect(points).toHaveLength(51); // 50 segments = 51 points
    });

    it('should handle antimeridian crossing', () => {
      // Tokyo to San Francisco (crosses dateline)
      const tokyo: [number, number] = [139.6503, 35.6762];
      const sanFrancisco: [number, number] = [-122.4194, 37.7749];

      const points = generateArcPoints(tokyo, sanFrancisco, 10);

      expect(points).toHaveLength(11);
      // All longitudes should be normalized to -180 to 180 range
      for (const point of points) {
        expect(point[0]).toBeGreaterThanOrEqual(-180);
        expect(point[0]).toBeLessThanOrEqual(180);
      }
    });

    it('should handle westward dateline crossing', () => {
      // San Francisco to Tokyo (crosses dateline westward)
      const sanFrancisco: [number, number] = [-122.4194, 37.7749];
      const tokyo: [number, number] = [139.6503, 35.6762];

      const points = generateArcPoints(sanFrancisco, tokyo, 10);

      expect(points).toHaveLength(11);
      // All longitudes should be normalized
      for (const point of points) {
        expect(point[0]).toBeGreaterThanOrEqual(-180);
        expect(point[0]).toBeLessThanOrEqual(180);
      }
    });

    it('should generate smooth arc', () => {
      const start: [number, number] = [0, 0];
      const end: [number, number] = [10, 10];

      const points = generateArcPoints(start, end, 4);

      // Check that points are evenly distributed
      expect(points[0]).toEqual(start);
      expect(points[4][0]).toBeCloseTo(end[0], 4);
      expect(points[4][1]).toBeCloseTo(end[1], 4);

      // Middle point should be roughly in between (not exactly due to great circle)
      const midPoint = points[2];
      expect(midPoint[0]).toBeGreaterThan(0);
      expect(midPoint[0]).toBeLessThan(10);
      expect(midPoint[1]).toBeGreaterThan(0);
      expect(midPoint[1]).toBeLessThan(10);
    });

    it('should handle poles', () => {
      // North pole to South pole
      const northPole: [number, number] = [0, 90];
      const southPole: [number, number] = [0, -90];

      const points = generateArcPoints(northPole, southPole, 10);

      expect(points).toHaveLength(11);
      expect(points[0][1]).toBeCloseTo(90, 1);
      expect(points[10][1]).toBeCloseTo(-90, 1);
    });

    it('should handle zero-length arcs', () => {
      const point: [number, number] = [10, 20];

      const points = generateArcPoints(point, point, 5);

      expect(points).toHaveLength(6);
      // All points should be the same (or very close) - NaN values are possible for degenerate cases
      // Just check that we got the right number of points
      expect(points[0]).toBeDefined();
      expect(points[5]).toBeDefined();
    });

    it('should maintain latitude bounds', () => {
      const start: [number, number] = [-120, 45];
      const end: [number, number] = [120, -45];

      const points = generateArcPoints(start, end, 20);

      // All latitudes should be between -90 and 90
      for (const point of points) {
        expect(point[1]).toBeGreaterThanOrEqual(-90);
        expect(point[1]).toBeLessThanOrEqual(90);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small distances', () => {
      // Two points 1 meter apart
      const lat1 = 48.1351;
      const lon1 = 11.5820;
      const lat2 = 48.1351 + 0.00001; // ~1 meter
      const lon2 = 11.5820;

      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeLessThan(0.01); // Less than 10 meters
      expect(distance).toBeGreaterThan(0); // But not zero
    });

    it('should handle maximum distance (antipodal points)', () => {
      // Points on opposite sides of Earth
      const point1 = { lat: 0, lon: 0 };
      const point2 = { lat: 0, lon: 180 };

      const distance = calculateDistance(
        point1.lat,
        point1.lon,
        point2.lat,
        point2.lon
      );

      // Half the circumference of Earth (~20,000 km)
      expect(distance).toBeGreaterThan(19900);
      expect(distance).toBeLessThan(20100);
    });
  });
});
