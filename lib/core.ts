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

    // Determine format by checking header line
    const headerLine = fileContent
      .split("\n")
      .find((line) => line.includes("latitude") && line.includes("longitude"));

    const isDmsFormat =
      headerLine?.includes("latitude(d')") ||
      headerLine?.includes('latitude(d")');
    const isDecimalFormat = headerLine?.includes("latitude(deg)");

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) continue;

      let point: PositionPoint;

      if (isDmsFormat) {
        // Original DMS format
        point = {
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
      } else if (isDecimalFormat) {
        // Decimal degrees format
        // Format: YYYY/MM/DD HH:MM:SS.SSS lat(deg) lon(deg) height Q ns ...
        const dateTimeParts = parts.slice(0, 2);
        const gpstStr = dateTimeParts.join(" ");

        // Parse GPST date string to get week and seconds
        const { week, seconds } = this.parseGpstDateString(gpstStr);

        point = {
          week,
          seconds,
          lat_d: 0, // These will be calculated later if needed
          lat_m: 0,
          lat_s: 0,
          lon_d: 0,
          lon_m: 0,
          lon_s: 0,
          height: parseFloat(parts[4]),
          Q: parseInt(parts[5]),
          ns: parseInt(parts[6]),
          sdn: parseFloat(parts[7]),
          sde: parseFloat(parts[8]),
          sdu: parseFloat(parts[9]),
          sdne: parseFloat(parts[10]),
          sdeu: parseFloat(parts[11]),
          sdun: parseFloat(parts[12]),
          age: parseFloat(parts[13]),
          ratio: parseFloat(parts[14]),
        };

        // Decimal degrees are directly provided
        point.lat = parseFloat(parts[2]);
        point.lon = parseFloat(parts[3]);

        // Convert decimal to DMS for consistency
        const latDms = this.decimalToDms(point.lat);
        const lonDms = this.decimalToDms(point.lon);

        point.lat_d = latDms.d;
        point.lat_m = latDms.m;
        point.lat_s = latDms.s;
        point.lon_d = lonDms.d;
        point.lon_m = lonDms.m;
        point.lon_s = lonDms.s;

        // Convert GPS time to datetime
        point.timestamp = this.gpsToDatetime(point.week, point.seconds);
      } else {
        // Unknown format, try to handle generically
        console.warn(
          "Unknown position data format, attempting to parse generically"
        );

        // Check if first field looks like a GPS week or a date
        const isDateFormat = parts[0].includes("/") || parts[0].includes("-");

        if (isDateFormat) {
          // Assume date format: YYYY/MM/DD HH:MM:SS.SSS
          const { week, seconds } = this.parseGpstDateString(
            parts.slice(0, 2).join(" ")
          );

          point = {
            week,
            seconds,
            // Assume the next two fields are lat/lon in decimal
            lat: parseFloat(parts[2]),
            lon: parseFloat(parts[3]),
            height: parseFloat(parts[4]),
            // Fill in other fields as available
            Q: parts.length > 5 ? parseInt(parts[5]) : 0,
            ns: parts.length > 6 ? parseInt(parts[6]) : 0,
          };

          // Convert decimal to DMS
          const latDms = this.decimalToDms(point.lat!);
          const lonDms = this.decimalToDms(point.lon!);

          point.lat_d = latDms.d;
          point.lat_m = latDms.m;
          point.lat_s = latDms.s;
          point.lon_d = lonDms.d;
          point.lon_m = lonDms.m;
          point.lon_s = lonDms.s;
        } else {
          // Assume original format with GPS week and seconds
          point = {
            week: parseInt(parts[0]),
            seconds: parseFloat(parts[1]),
            lat_d: parseInt(parts[2]),
            lat_m: parseInt(parts[3]),
            lat_s: parseFloat(parts[4]),
            lon_d: parseInt(parts[5]),
            lon_m: parseInt(parts[6]),
            lon_s: parseFloat(parts[7]),
            height: parseFloat(parts[8]),
          };

          // Convert DMS to decimal
          point.lat = this.dmsToDecimal(point.lat_d, point.lat_m, point.lat_s);
          point.lon = this.dmsToDecimal(point.lon_d, point.lon_m, point.lon_s);
        }

        // Set timestamp
        point.timestamp = this.gpsToDatetime(point.week, point.seconds);
      }

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

    // Determine format by checking header line
    const headerLine = fileContent
      .split("\n")
      .find((line) => line.includes("latitude") && line.includes("longitude"));

    const isDmsFormat =
      headerLine?.includes("latitude(d')") ||
      headerLine?.includes('latitude(d")');
    const isDecimalFormat = headerLine?.includes("latitude(deg)");

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) continue;

      let event: EventPoint;

      if (isDmsFormat) {
        // Original DMS format
        event = {
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
      } else if (isDecimalFormat) {
        // Decimal degrees format
        // Format: YYYY/MM/DD HH:MM:SS.SSS lat(deg) lon(deg) height Q ns ...
        const dateTimeParts = parts.slice(0, 2);
        const gpstStr = dateTimeParts.join(" ");

        // Parse GPST date string to get week and seconds
        const { week, seconds } = this.parseGpstDateString(gpstStr);

        event = {
          week,
          seconds,
          lat_d: 0,
          lat_m: 0,
          lat_s: 0,
          lon_d: 0,
          lon_m: 0,
          lon_s: 0,
          height: parseFloat(parts[4]),
          interpolated: false,
        };

        // Decimal degrees are directly provided
        event.lat = parseFloat(parts[2]);
        event.lon = parseFloat(parts[3]);

        // Convert decimal to DMS for consistency
        const latDms = this.decimalToDms(event.lat);
        const lonDms = this.decimalToDms(event.lon);

        event.lat_d = latDms.d;
        event.lat_m = latDms.m;
        event.lat_s = latDms.s;
        event.lon_d = lonDms.d;
        event.lon_m = lonDms.m;
        event.lon_s = lonDms.s;

        // Convert GPS time to datetime
        event.timestamp = this.gpsToDatetime(event.week, event.seconds);
      } else {
        // Unknown format, try to handle generically
        console.warn(
          "Unknown event data format, attempting to parse generically"
        );

        // Check if first field looks like a GPS week or a date
        const isDateFormat = parts[0].includes("/") || parts[0].includes("-");

        if (isDateFormat) {
          // Assume date format: YYYY/MM/DD HH:MM:SS.SSS
          const { week, seconds } = this.parseGpstDateString(
            parts.slice(0, 2).join(" ")
          );

          event = {
            week,
            seconds,
            // Assume the next two fields are lat/lon in decimal
            lat: parseFloat(parts[2]),
            lon: parseFloat(parts[3]),
            height: parseFloat(parts[4]),
            interpolated: false,
          };

          // Convert decimal to DMS
          const latDms = this.decimalToDms(event.lat!);
          const lonDms = this.decimalToDms(event.lon!);

          event.lat_d = latDms.d;
          event.lat_m = latDms.m;
          event.lat_s = latDms.s;
          event.lon_d = lonDms.d;
          event.lon_m = lonDms.m;
          event.lon_s = lonDms.s;
        } else {
          // Assume original format with GPS week and seconds
          event = {
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

          // Convert DMS to decimal
          event.lat = this.dmsToDecimal(event.lat_d, event.lat_m, event.lat_s);
          event.lon = this.dmsToDecimal(event.lon_d, event.lon_m, event.lon_s);
        }

        // Set timestamp
        event.timestamp = this.gpsToDatetime(event.week, event.seconds);
      }

      eventsData.push(event);
    }

    return eventsData;
  }

  /**
   * Parse GPST date string to get GPS week and seconds
   * Format: YYYY/MM/DD HH:MM:SS.SSS
   */
  parseGpstDateString(gpstStr: string): { week: number; seconds: number } {
    const date = new Date(gpstStr);

    // Calculate milliseconds since GPS epoch
    const millisecondsSinceEpoch =
      date.getTime() - this.config.gpsEpoch.getTime();

    // Calculate GPS week
    const week = Math.floor(millisecondsSinceEpoch / (7 * 24 * 60 * 60 * 1000));

    // Calculate seconds of week
    const secondsOfWeek =
      (millisecondsSinceEpoch % (7 * 24 * 60 * 60 * 1000)) / 1000;

    return { week, seconds: secondsOfWeek };
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
      // Store distance in the event point for later use
      sortedEvents[i + 1].distance_from_prev = dist;
    }

    // Initialize list to store interpolated triggers
    const interpolatedTriggers: EventPoint[] = [];

    // Process each window
    for (let i = 0; i < distances.length - this.config.windowSize + 1; i++) {
      // Get current window of distances
      const distWindow = distances.slice(i, i + this.config.windowSize);

      // Calculate median distance in this window
      const medianDistance = this.median(distWindow);

      // Define acceptable distance range
      const maxDistance = medianDistance * this.config.maxIntervalFactor;
      const minDistance = medianDistance * this.config.minIntervalFactor;

      // Check if the distance after the window is too large (indicating missing triggers)
      if (i + this.config.windowSize < distances.length) {
        const currentDistance = distances[i + this.config.windowSize];

        if (currentDistance > maxDistance) {
          // Calculate how many triggers are missing
          const numMissing = Math.round(currentDistance / medianDistance) - 1;

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
              seconds: startTime,
            };

            const endPos = {
              lat: sortedEvents[startIdx + 1].lat!,
              lon: sortedEvents[startIdx + 1].lon!,
              height: sortedEvents[startIdx + 1].height,
              seconds: endTime,
            };

            // Generate evenly spaced positions for missing triggers
            const interpolatedPositions = this.interpolatePositionsByDistance(
              startPos,
              endPos,
              numMissing,
              posData
            );

            // Add interpolated triggers
            for (const pos of interpolatedPositions) {
              // Get the GPS week from nearby points
              const week = sortedEvents[startIdx].week;

              // Convert decimal lat/lon to DMS
              const latDms = this.decimalToDms(pos.lat);
              const lonDms = this.decimalToDms(pos.lon);

              interpolatedTriggers.push({
                week,
                seconds: pos.seconds,
                lat_d: latDms.d,
                lat_m: latDms.m,
                lat_s: latDms.s,
                lon_d: lonDms.d,
                lon_m: lonDms.m,
                lon_s: lonDms.s,
                height: pos.height,
                lat: pos.lat,
                lon: pos.lon,
                interpolated: true,
                distance_from_prev: pos.distance_from_prev,
              });
            }
          }
        }
      }
    }

    return interpolatedTriggers;
  }

  /**
   * Interpolate positions by distance between two points
   */
  interpolatePositionsByDistance(
    startPos: { lat: number; lon: number; height: number; seconds: number },
    endPos: { lat: number; lon: number; height: number; seconds: number },
    numPoints: number,
    posData: PositionPoint[]
  ): Array<{
    lat: number;
    lon: number;
    height: number;
    seconds: number;
    distance_from_prev: number;
  }> {
    const result = [];

    // Calculate total distance between start and end
    const totalDistance = this.haversineDistance(
      startPos.lat,
      startPos.lon,
      endPos.lat,
      endPos.lon
    );

    // Calculate segment distance
    const segmentDistance = totalDistance / (numPoints + 1);

    // Find all position points between start and end times
    const relevantPosData = posData
      .filter(
        (p) => p.seconds >= startPos.seconds && p.seconds <= endPos.seconds
      )
      .sort((a, b) => a.seconds - b.seconds);

    if (relevantPosData.length < 2) {
      // Not enough position data, fall back to linear interpolation
      for (let i = 1; i <= numPoints; i++) {
        const ratio = i / (numPoints + 1);
        const lat = startPos.lat + ratio * (endPos.lat - startPos.lat);
        const lon = startPos.lon + ratio * (endPos.lon - startPos.lon);
        const height =
          startPos.height + ratio * (endPos.height - startPos.height);
        const seconds =
          startPos.seconds + ratio * (endPos.seconds - startPos.seconds);

        result.push({
          lat,
          lon,
          height,
          seconds,
          distance_from_prev:
            i === 1
              ? segmentDistance
              : this.haversineDistance(
                  result[result.length - 1].lat,
                  result[result.length - 1].lon,
                  lat,
                  lon
                ),
        });
      }
      return result;
    }

    // Calculate cumulative distances along the path
    let cumulativeDistances = [0]; // Start with 0 for the first point
    for (let i = 1; i < relevantPosData.length; i++) {
      const dist = this.haversineDistance(
        relevantPosData[i - 1].lat!,
        relevantPosData[i - 1].lon!,
        relevantPosData[i].lat!,
        relevantPosData[i].lon!
      );
      cumulativeDistances.push(cumulativeDistances[i - 1] + dist);
    }

    // Total path distance
    const pathDistance = cumulativeDistances[cumulativeDistances.length - 1];

    // Generate points at equal distance intervals
    let lastPoint = {
      lat: startPos.lat,
      lon: startPos.lon,
      height: startPos.height,
      seconds: startPos.seconds,
    };

    for (let i = 1; i <= numPoints; i++) {
      // Target distance from start
      const targetDistance = (i * totalDistance) / (numPoints + 1);

      // Find the position in the path closest to the target distance
      let idx = 0;
      while (
        idx < cumulativeDistances.length - 1 &&
        cumulativeDistances[idx] < targetDistance
      ) {
        idx++;
      }

      let interpolatedPoint;

      if (idx === 0) {
        // If target is before the first point, use the first point
        interpolatedPoint = {
          lat: relevantPosData[0].lat!,
          lon: relevantPosData[0].lon!,
          height: relevantPosData[0].height,
          seconds: relevantPosData[0].seconds,
        };
      } else {
        // Interpolate between the two closest points
        const prevIdx = idx - 1;
        const prevDist = cumulativeDistances[prevIdx];
        const nextDist = cumulativeDistances[idx];

        const ratio = (targetDistance - prevDist) / (nextDist - prevDist);

        const prevPoint = relevantPosData[prevIdx];
        const nextPoint = relevantPosData[idx];

        interpolatedPoint = {
          lat: prevPoint.lat! + ratio * (nextPoint.lat! - prevPoint.lat!),
          lon: prevPoint.lon! + ratio * (nextPoint.lon! - prevPoint.lon!),
          height:
            prevPoint.height + ratio * (nextPoint.height - prevPoint.height),
          seconds:
            prevPoint.seconds + ratio * (nextPoint.seconds - prevPoint.seconds),
        };
      }

      // Calculate distance from previous point
      const distFromPrev = this.haversineDistance(
        lastPoint.lat,
        lastPoint.lon,
        interpolatedPoint.lat,
        interpolatedPoint.lon
      );

      result.push({
        ...interpolatedPoint,
        distance_from_prev: distFromPrev,
      });

      lastPoint = interpolatedPoint;
    }

    return result;
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

    // Calculate time range
    const startTime = combined.length > 0 ? combined[0].seconds : 0;
    const endTime =
      combined.length > 0 ? combined[combined.length - 1].seconds : 0;
    const startWeek = combined.length > 0 ? combined[0].week : 0;
    const endWeek =
      combined.length > 0 ? combined[combined.length - 1].week : 0;

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

      // Format with proper spacing for Emlid Studio compatibility
      let line = `${event.week} ${event.seconds.toFixed(3)}`;
      line += `   ${lat_d} ${lat_m} ${lat_s.toFixed(9)}`;
      line += `   ${lon_d} ${lon_m} ${lon_s.toFixed(9)}`;
      line += `   ${event.height.toFixed(4)}`;

      // Add Q and ns if available
      if ("Q" in event) {
        line += `   ${event.Q}`;
      }

      if ("ns" in event) {
        line += `   ${event.ns}`;
      }

      // Add additional fields if they exist
      const additionalFields = [
        "sdn",
        "sde",
        "sdu",
        "sdne",
        "sdeu",
        "sdun",
        "age",
        "ratio",
      ];
      for (const field of additionalFields) {
        if (field in event) {
          line += `   ${(event[field] as number).toFixed(4)}`;
        }
      }

      // Add a comment to mark interpolated points
      if (event.interpolated) {
        line += "  # interpolated";
      }

      return line;
    });

    // Get current date and time
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().split("T")[1].split(".")[0];

    // Add comprehensive header that matches Emlid Studio format
    const header = [
      "% program   : Trigger Fix Tool v1.0",
      "% processed : " + dateStr + " " + timeStr + " UTC",
      "% original  : events.pos",
      "% developer : Aerosys Aviation",
      "% summary   : Added " +
        interpolatedData.length +
        " interpolated triggers",
      "% obs start : week" + startWeek + " " + startTime.toFixed(1) + "s",
      "% obs end   : week" + endWeek + " " + endTime.toFixed(1) + "s",
      "%",
      "% (lat/lon/height=WGS84/ellipsoidal,Q=1:fix,2:float,3:sbas,4:dgps,5:single,6:ppp,ns=# of satellites)",
      "%  GPST            latitude(d'\")   longitude(d'\")  height(m)   Q  ns   sdn(m)   sde(m)   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio",
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
