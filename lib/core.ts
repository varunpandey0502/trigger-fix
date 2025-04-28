/**
 * Core functionality for the Trigger Fix tool.
 * Contains the algorithms for processing GPS data and finding missing triggers.
 */

// Configuration interface
export interface TriggerFixConfig {
  gpsEpoch: Date; // GPS epoch start date (January 6, 1980)
  windowSize: number; // Size of the sliding window for analysis
  maxIntervalFactor: number; // Maximum acceptable interval factor
  minIntervalFactor: number; // Minimum acceptable interval factor
  minDistanceFactor: number; // Minimum acceptable distance factor
  pathColor: string; // Color for the flight path
  pathAlpha: number; // Alpha/opacity for the flight path
  triggerColor: string; // Color for original triggers
  triggerMarker: string; // Marker shape for original triggers
  triggerAlpha: number; // Alpha/opacity for triggers
  interpolatedColor: string; // Color for interpolated triggers
  interpolatedMarker: string; // Marker shape for interpolated triggers
  markerSize: number; // Size of markers
}

// Default configuration
export const DEFAULT_CONFIG: TriggerFixConfig = {
  gpsEpoch: new Date(1980, 0, 6), // January 6, 1980
  windowSize: 5,
  maxIntervalFactor: 1.5,
  minIntervalFactor: 0.5,
  minDistanceFactor: 0.8,
  pathColor: "#8884d8",
  pathAlpha: 0.6,
  triggerColor: "#ff7300",
  triggerMarker: "star",
  triggerAlpha: 0.8,
  interpolatedColor: "#00C49F",
  interpolatedMarker: "diamond",
  markerSize: 100,
};

// Data interfaces
export interface PositionPoint {
  week: number;
  seconds: number;
  lat_d: number;
  lat_m: number;
  lat_s: number;
  lon_d: number;
  lon_m: number;
  lon_s: number;
  height: number;
  timestamp?: Date;
  lat?: number;
  lon?: number;
  [key: string]: any; // For additional fields
}

export interface EventPoint extends PositionPoint {
  interpolated?: boolean;
  distance_from_prev?: number;
}

export interface ProcessingResults {
  posData: PositionPoint[];
  eventsData: EventPoint[];
  interpolatedData: EventPoint[];
  stats: {
    totalPoints: number;
    originalTriggers: number;
    interpolatedTriggers: number;
    flightDuration: number;
    minDistance?: number;
    avgDistance?: number;
  };
}

export class TriggerFixer {
  private config: TriggerFixConfig;

  constructor(config: Partial<TriggerFixConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Convert GPS week and seconds to datetime
   */
  gpsToDatetime(week: number, seconds: number): Date {
    const milliseconds =
      this.config.gpsEpoch.getTime() +
      week * 7 * 24 * 60 * 60 * 1000 +
      seconds * 1000;
    return new Date(milliseconds);
  }

  /**
   * Convert degrees, minutes, seconds to decimal degrees
   */
  dmsToDecimal(d: number, m: number, s: number): number {
    return d + m / 60 + s / 3600;
  }

  /**
   * Parse position data from file content
   */
  parsePositionData(fileContent: string): PositionPoint[] {
    const lines = fileContent
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("%"));

    const posData: PositionPoint[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 19) continue;

      const point: PositionPoint = {
        week: parseInt(parts[0]),
        seconds: parseFloat(parts[1]),
        lat_d: parseInt(parts[2]),
        lat_m: parseInt(parts[3]),
        lat_s: parseFloat(parts[4]),
        lon_d: parseInt(parts[5]),
        lon_m: parseInt(parts[6]),
        lon_s: parseFloat(parts[7]),
        height: parseFloat(parts[8]),
        Q: parseInt(parts[9]),
        ns: parseInt(parts[10]),
        sdn: parseFloat(parts[11]),
        sde: parseFloat(parts[12]),
        sdu: parseFloat(parts[13]),
        sdne: parseFloat(parts[14]),
        sdeu: parseFloat(parts[15]),
        sdun: parseFloat(parts[16]),
        age: parseFloat(parts[17]),
        ratio: parseFloat(parts[18]),
      };

      // Convert GPS time to datetime
      point.timestamp = this.gpsToDatetime(point.week, point.seconds);

      // Convert lat/lon from DMS to decimal
      point.lat = this.dmsToDecimal(point.lat_d, point.lat_m, point.lat_s);
      point.lon = this.dmsToDecimal(point.lon_d, point.lon_m, point.lon_s);

      posData.push(point);
    }

    return posData;
  }

  /**
   * Parse events data from file content
   */
  parseEventsData(fileContent: string): EventPoint[] {
    const lines = fileContent
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("%"));

    const eventsData: EventPoint[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) continue;

      const event: EventPoint = {
        week: parseInt(parts[0]),
        seconds: parseFloat(parts[1]),
        lat_d: parseInt(parts[2]),
        lat_m: parseInt(parts[3]),
        lat_s: parseFloat(parts[4]),
        lon_d: parseInt(parts[5]),
        lon_m: parseInt(parts[6]),
        lon_s: parseFloat(parts[7]),
        height: parts.length > 8 ? parseFloat(parts[8]) : 0,
        interpolated: false,
      };

      // Convert GPS time to datetime
      event.timestamp = this.gpsToDatetime(event.week, event.seconds);

      // Convert lat/lon from DMS to decimal
      event.lat = this.dmsToDecimal(event.lat_d, event.lat_m, event.lat_s);
      event.lon = this.dmsToDecimal(event.lon_d, event.lon_m, event.lon_s);

      eventsData.push(event);
    }

    return eventsData;
  }

  /**
   * Interpolate position for a given timestamp using nearby points
   */
  interpolatePosition(
    posData: PositionPoint[],
    timestamp: number
  ): PositionPoint | null {
    // Find the closest points before and after the timestamp
    const sortedData = [...posData].sort((a, b) => a.seconds - b.seconds);

    let beforeIdx = -1;
    let afterIdx = -1;

    for (let i = 0; i < sortedData.length; i++) {
      if (sortedData[i].seconds <= timestamp) {
        beforeIdx = i;
      } else {
        afterIdx = i;
        break;
      }
    }

    // If we don't have points before and after, return null
    if (beforeIdx === -1 || afterIdx === -1) {
      return null;
    }

    const before = sortedData[beforeIdx];
    const after = sortedData[afterIdx];

    // Linear interpolation
    const ratio =
      (timestamp - before.seconds) / (after.seconds - before.seconds);

    const lat = before.lat! + ratio * (after.lat! - before.lat!);
    const lon = before.lon! + ratio * (after.lon! - before.lon!);
    const height = before.height + ratio * (after.height - before.height);

    return {
      week: before.week,
      seconds: timestamp,
      lat_d: 0, // These will be calculated later if needed
      lat_m: 0,
      lat_s: 0,
      lon_d: 0,
      lon_m: 0,
      lon_s: 0,
      height,
      lat,
      lon,
    };
  }

  /**
   * Calculate distance between two points in meters using the haversine formula
   */
  haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    // Earth's radius in meters
    const R = 6371000;

    // Convert to radians
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lon1Rad = (lon1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;
    const lon2Rad = (lon2 * Math.PI) / 180;

    // Haversine formula
    const dlat = lat2Rad - lat1Rad;
    const dlon = lon2Rad - lon1Rad;
    const a =
      Math.sin(dlat / 2) * Math.sin(dlat / 2) +
      Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(dlon / 2) *
        Math.sin(dlon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Find and interpolate missing triggers
   */
  findMissingTriggers(
    eventsData: EventPoint[],
    posData: PositionPoint[]
  ): EventPoint[] {
    // Sort events by time
    const sortedEvents = [...eventsData].sort((a, b) => a.seconds - b.seconds);

    // Calculate time intervals between consecutive triggers
    const intervals: number[] = [];
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      intervals.push(sortedEvents[i + 1].seconds - sortedEvents[i].seconds);
    }

    // Calculate distances between consecutive triggers
    const distances: number[] = [];
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const dist = this.haversineDistance(
        sortedEvents[i].lat!,
        sortedEvents[i].lon!,
        sortedEvents[i + 1].lat!,
        sortedEvents[i + 1].lon!
      );
      distances.push(dist);
    }

    // Initialize list to store interpolated triggers
    const interpolatedTriggers: EventPoint[] = [];

    // Process each window
    for (let i = 0; i < intervals.length - this.config.windowSize + 1; i++) {
      // Get current window of intervals and distances
      const timeWindow = intervals.slice(i, i + this.config.windowSize);
      const distWindow = distances.slice(i, i + this.config.windowSize);

      // Calculate median interval and distance in this window
      const medianInterval = this.median(timeWindow);
      const medianDistance = this.median(distWindow);
      const minAcceptableDistance =
        medianDistance * this.config.minDistanceFactor;

      // Define acceptable interval range
      const maxInterval = medianInterval * this.config.maxIntervalFactor;
      const minInterval = medianInterval * this.config.minIntervalFactor;

      // Check if the interval after the window is too large (indicating missing triggers)
      if (i + this.config.windowSize < intervals.length) {
        const currentInterval = intervals[i + this.config.windowSize];

        if (currentInterval > maxInterval) {
          // Calculate how many triggers are missing
          const numMissing = Math.round(currentInterval / medianInterval) - 1;

          if (numMissing > 0) {
            // Get start and end points for interpolation
            const startIdx = i + this.config.windowSize;
            const startTime = sortedEvents[startIdx].seconds;
            const endTime = sortedEvents[startIdx + 1].seconds;

            // Get start and end positions
            const startPos = {
              lat: sortedEvents[startIdx].lat!,
              lon: sortedEvents[startIdx].lon!,
              height: sortedEvents[startIdx].height,
            };

            // Generate evenly spaced timestamps for missing triggers
            const step = (endTime - startTime) / (numMissing + 1);
            const missingTimes: number[] = [];
            for (let j = 1; j <= numMissing; j++) {
              missingTimes.push(startTime + j * step);
            }

            // Track the last valid position for distance checking
            let lastValidPos = startPos;

            // Interpolate positions for each missing timestamp
            for (const ts of missingTimes) {
              const pos = this.interpolatePosition(posData, ts);
              if (pos) {
                // Check distance from last valid position
                const distFromLast = this.haversineDistance(
                  lastValidPos.lat,
                  lastValidPos.lon,
                  pos.lat!,
                  pos.lon!
                );

                // Only add if distance is acceptable
                if (distFromLast >= minAcceptableDistance) {
                  // Get the GPS week from nearby points
                  const week = sortedEvents[startIdx].week;

                  interpolatedTriggers.push({
                    week,
                    seconds: ts,
                    lat_d: 0, // These would be calculated if needed for export
                    lat_m: 0,
                    lat_s: 0,
                    lon_d: 0,
                    lon_m: 0,
                    lon_s: 0,
                    height: pos.height,
                    lat: pos.lat,
                    lon: pos.lon,
                    interpolated: true,
                    distance_from_prev: distFromLast,
                  });

                  // Update last valid position
                  lastValidPos = {
                    lat: pos.lat!,
                    lon: pos.lon!,
                    height: pos.height,
                  };
                }
              }
            }
          }
        }
      }
    }

    return interpolatedTriggers;
  }

  /**
   * Calculate the median of an array of numbers
   */
  private median(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Process the position and events files to find missing triggers
   */
  async processFiles(
    posFileContent: string,
    eventsFileContent: string
  ): Promise<ProcessingResults> {
    // Parse position and events data
    const posData = this.parsePositionData(posFileContent);
    const eventsData = this.parseEventsData(eventsFileContent);

    // Find and interpolate missing triggers
    const interpolatedData = this.findMissingTriggers(eventsData, posData);

    // Calculate statistics
    const flightDuration =
      posData.length > 1
        ? posData[posData.length - 1].seconds - posData[0].seconds
        : 0;

    let minDistance = 0;
    let avgDistance = 0;

    if (interpolatedData.length > 0) {
      const distances = interpolatedData
        .filter((point) => point.distance_from_prev !== undefined)
        .map((point) => point.distance_from_prev!);

      minDistance = Math.min(...distances);
      avgDistance =
        distances.reduce((sum, val) => sum + val, 0) / distances.length;
    }

    // Return results
    return {
      posData,
      eventsData,
      interpolatedData,
      stats: {
        totalPoints: posData.length,
        originalTriggers: eventsData.length,
        interpolatedTriggers: interpolatedData.length,
        flightDuration,
        minDistance: interpolatedData.length > 0 ? minDistance : undefined,
        avgDistance: interpolatedData.length > 0 ? avgDistance : undefined,
      },
    };
  }

  /**
   * Convert decimal degrees back to DMS for export
   */
  decimalToDms(decimal: number): { d: number; m: number; s: number } {
    const d = Math.floor(decimal);
    const mFloat = (decimal - d) * 60;
    const m = Math.floor(mFloat);
    const s = (mFloat - m) * 60;

    return { d, m, s };
  }

  /**
   * Format data for export to events file
   */
  formatForEventsExport(
    eventsData: EventPoint[],
    interpolatedData: EventPoint[]
  ): string {
    // Combine original and interpolated events
    const combined = [
      ...eventsData.map((e) => ({ ...e, interpolated: false })),
      ...interpolatedData,
    ].sort((a, b) => a.seconds - b.seconds);

    // Format each line
    const lines = combined.map((event) => {
      // For interpolated events, convert decimal lat/lon back to DMS
      let lat_d = event.lat_d;
      let lat_m = event.lat_m;
      let lat_s = event.lat_s;
      let lon_d = event.lon_d;
      let lon_m = event.lon_m;
      let lon_s = event.lon_s;

      if (event.interpolated) {
        const latDms = this.decimalToDms(event.lat!);
        const lonDms = this.decimalToDms(event.lon!);

        lat_d = latDms.d;
        lat_m = latDms.m;
        lat_s = latDms.s;
        lon_d = lonDms.d;
        lon_m = lonDms.m;
        lon_s = lonDms.s;
      }

      let line = `${event.week} ${event.seconds.toFixed(3)} `;
      line += `${lat_d} ${lat_m} ${lat_s.toFixed(9)} `;
      line += `${lon_d} ${lon_m} ${lon_s.toFixed(9)} `;
      line += `${event.height.toFixed(4)}`;

      // Add a comment to mark interpolated points
      if (event.interpolated) {
        line += " # interpolated";
      }

      return line;
    });

    // Add header
    const header = [
      "% Modified by Trigger Fix Tool",
      "% Interpolated triggers have been added",
      "% Original file: events.pos",
    ];

    return [...header, ...lines].join("\n");
  }

  /**
   * Format interpolated data for CSV export
   */
  formatForCsvExport(interpolatedData: EventPoint[]): string {
    if (interpolatedData.length === 0) {
      return "No interpolated triggers found";
    }

    // Get all unique keys from the data
    const allKeys = new Set<string>();
    interpolatedData.forEach((point) => {
      Object.keys(point).forEach((key) => allKeys.add(key));
    });

    // Create header row
    const header = Array.from(allKeys).join(",");

    // Create data rows
    const rows = interpolatedData.map((point) => {
      return Array.from(allKeys)
        .map((key) => {
          const value = point[key];
          if (value === undefined) return "";
          if (typeof value === "number") return value.toString();
          if (typeof value === "boolean") return value.toString();
          if (value instanceof Date) return value.toISOString();
          return `"${value}"`;
        })
        .join(",");
    });

    return [header, ...rows].join("\n");
  }
}
