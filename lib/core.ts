/**
 * Core functionality for the Trigger Fix tool.
 * Contains the algorithms for processing GPS data and finding missing triggers.
 */

// Configuration interface
export interface TriggerFixConfig {
  gpsEpoch: Date; // GPS epoch start date (January 6, 1980)
  triggerColor: string; // Color for original triggers
  triggerMarker: string; // Marker shape for original triggers
  triggerAlpha: number; // Alpha/opacity for triggers
  interpolatedColor: string; // Color for interpolated triggers
  interpolatedMarker: string; // Marker shape for interpolated triggers
  markerSize: number; // Size of markers
  triggerDistance?: number; // Estimated trigger distance in meters
}

// Default configuration
export const DEFAULT_CONFIG: TriggerFixConfig = {
  gpsEpoch: new Date(1980, 0, 6), // January 6, 1980
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
    medianDistance?: number;
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
            // Add required DMS fields with default values
            lat_d: 0,
            lat_m: 0,
            lat_s: 0,
            lon_d: 0,
            lon_m: 0,
            lon_s: 0,
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
            // Add required DMS fields with default values
            lat_d: 0,
            lat_m: 0,
            lat_s: 0,
            lon_d: 0,
            lon_m: 0,
            lon_s: 0,
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

    // Initialize list to store interpolated triggers
    const interpolatedTriggers: EventPoint[] = [];

    // First pass: calculate distances between all consecutive triggers
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentTrigger = sortedEvents[i];
      const nextTrigger = sortedEvents[i + 1];

      // Find all position points between these two triggers
      const relevantPosData = posData
        .filter(
          (p) =>
            p.seconds >= currentTrigger.seconds &&
            p.seconds <= nextTrigger.seconds
        )
        .sort((a, b) => a.seconds - b.seconds);

      // Calculate the actual flight path distance by summing distances between consecutive points
      let actualPathDistance = 0;

      if (relevantPosData.length > 1) {
        for (let j = 0; j < relevantPosData.length - 1; j++) {
          actualPathDistance += this.haversineDistance(
            relevantPosData[j].lat!,
            relevantPosData[j].lon!,
            relevantPosData[j + 1].lat!,
            relevantPosData[j + 1].lon!
          );
        }
      } else {
        // If we don't have enough position data, use direct distance
        actualPathDistance = this.haversineDistance(
          currentTrigger.lat!,
          currentTrigger.lon!,
          nextTrigger.lat!,
          nextTrigger.lon!
        );
      }

      // Store the distance for reference
      nextTrigger.distance_from_prev = actualPathDistance;
    }

    // Calculate baseline statistics from all trigger distances
    const allDistances = sortedEvents
      .slice(1) // Skip the first trigger as it has no previous
      .map((e) => e.distance_from_prev!)
      .filter((d) => d !== undefined);

    // Calculate median distance as baseline
    const sortedDistances = [...allDistances].sort((a, b) => a - b);
    const medianDistance =
      sortedDistances.length % 2 === 0
        ? (sortedDistances[sortedDistances.length / 2 - 1] +
            sortedDistances[sortedDistances.length / 2]) /
          2
        : sortedDistances[Math.floor(sortedDistances.length / 2)];

    // Calculate min and average for reference
    const minDistance = Math.min(...allDistances);
    const avgDistance =
      allDistances.reduce((sum, d) => sum + d, 0) / allDistances.length;

    console.log(
      "Baseline distances - Min:",
      minDistance.toFixed(2),
      "m, Median:",
      medianDistance.toFixed(2),
      "m, Avg:",
      avgDistance.toFixed(2),
      "m"
    );

    // Use the provided trigger distance or default to median
    const triggerDistance = this.config.triggerDistance || medianDistance;

    // Set a minimum interpolation distance that's at least the global minimum
    // This ensures interpolated points aren't placed too close together
    const minInterpolationDistance = minDistance;

    // Second pass: interpolate missing triggers based on the threshold
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentTrigger = sortedEvents[i];
      const nextTrigger = sortedEvents[i + 1];
      const actualPathDistance = nextTrigger.distance_from_prev!;

      // If the distance is larger than the trigger distance, interpolate
      if (actualPathDistance > triggerDistance) {
        // Estimate how many triggers should be in this gap
        const numMissing = Math.max(
          0,
          Math.floor(actualPathDistance / triggerDistance) - 1
        );

        // Interpolate positions along the actual flight path
        const interpolatedPositions = this.interpolatePositionsByDistance(
          {
            lat: currentTrigger.lat!,
            lon: currentTrigger.lon!,
            height: currentTrigger.height,
            seconds: currentTrigger.seconds,
          },
          {
            lat: nextTrigger.lat!,
            lon: nextTrigger.lon!,
            height: nextTrigger.height,
            seconds: nextTrigger.seconds,
          },
          numMissing,
          posData
        );

        // Filter interpolated positions to ensure minimum distance between points
        const filteredPositions = [];
        let lastPoint = {
          lat: currentTrigger.lat!,
          lon: currentTrigger.lon!,
        };

        for (const pos of interpolatedPositions) {
          // Calculate distance from last point (either original or interpolated)
          const distFromLast = this.haversineDistance(
            lastPoint.lat,
            lastPoint.lon,
            pos.lat,
            pos.lon
          );

          // Only add this point if it's far enough from the last point
          if (distFromLast >= minInterpolationDistance) {
            filteredPositions.push(pos);
            lastPoint = { lat: pos.lat, lon: pos.lon };
          }
        }

        // Check distance to next original trigger
        if (filteredPositions.length > 0) {
          const lastInterpolated =
            filteredPositions[filteredPositions.length - 1];
          const distToNext = this.haversineDistance(
            lastInterpolated.lat,
            lastInterpolated.lon,
            nextTrigger.lat!,
            nextTrigger.lon!
          );

          // Remove last interpolated point if it's too close to the next original trigger
          if (distToNext < minInterpolationDistance) {
            filteredPositions.pop();
          }
        }

        // Add filtered interpolated triggers
        for (const pos of filteredPositions) {
          // Get the GPS week from nearby points
          const week = currentTrigger.week;

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
    const result: Array<{
      lat: number;
      lon: number;
      height: number;
      seconds: number;
      distance_from_prev: number;
    }> = [];

    // Find all position points between start and end times
    const relevantPosData = posData
      .filter(
        (p) => p.seconds >= startPos.seconds && p.seconds <= endPos.seconds
      )
      .sort((a, b) => a.seconds - b.seconds);

    if (relevantPosData.length < 2) {
      // Not enough position data, fall back to linear interpolation
      const totalDistance = this.haversineDistance(
        startPos.lat,
        startPos.lon,
        endPos.lat,
        endPos.lon
      );

      // Calculate segment distance
      const segmentDistance = totalDistance / (numPoints + 1);

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

    // Create a path from the position data
    const path: Array<{
      lat: number;
      lon: number;
      height: number;
      seconds: number;
      distance: number;
      cumulativeDistance: number;
    }> = [];

    // Add start point to the path
    path.push({
      lat: startPos.lat,
      lon: startPos.lon,
      height: startPos.height,
      seconds: startPos.seconds,
      distance: 0,
      cumulativeDistance: 0,
    });

    // Add all relevant position points to the path
    for (const point of relevantPosData) {
      // Skip points that are too close to the previous point (within 0.1m)
      if (path.length > 0) {
        const prevPoint = path[path.length - 1];
        const distance = this.haversineDistance(
          prevPoint.lat,
          prevPoint.lon,
          point.lat!,
          point.lon!
        );

        // Skip if too close to previous point
        if (distance < 0.1) continue;

        path.push({
          lat: point.lat!,
          lon: point.lon!,
          height: point.height,
          seconds: point.seconds,
          distance,
          cumulativeDistance: prevPoint.cumulativeDistance + distance,
        });
      } else {
        path.push({
          lat: point.lat!,
          lon: point.lon!,
          height: point.height,
          seconds: point.seconds,
          distance: 0,
          cumulativeDistance: 0,
        });
      }
    }

    // Add end point to the path if it's not already there
    const lastPathPoint = path[path.length - 1];
    const distanceToEnd = this.haversineDistance(
      lastPathPoint.lat,
      lastPathPoint.lon,
      endPos.lat,
      endPos.lon
    );

    if (distanceToEnd > 0.1) {
      path.push({
        lat: endPos.lat,
        lon: endPos.lon,
        height: endPos.height,
        seconds: endPos.seconds,
        distance: distanceToEnd,
        cumulativeDistance: lastPathPoint.cumulativeDistance + distanceToEnd,
      });
    }

    // Calculate total path distance
    const totalPathDistance = path[path.length - 1].cumulativeDistance;

    // Calculate segment distance for equal spacing
    const segmentDistance = totalPathDistance / (numPoints + 1);

    // Generate points at equal distance intervals along the path
    let lastInterpolatedPoint = {
      lat: startPos.lat,
      lon: startPos.lon,
      height: startPos.height,
      seconds: startPos.seconds,
    };

    for (let i = 1; i <= numPoints; i++) {
      // Target distance from start
      const targetDistance = i * segmentDistance;

      // Find the segment in the path that contains the target distance
      let segmentIdx = 0;
      while (
        segmentIdx < path.length - 1 &&
        path[segmentIdx + 1].cumulativeDistance < targetDistance
      ) {
        segmentIdx++;
      }

      // If we've reached the end of the path, use the last point
      if (segmentIdx >= path.length - 1) {
        const lastPoint = path[path.length - 1];
        const distFromPrev = this.haversineDistance(
          lastInterpolatedPoint.lat,
          lastInterpolatedPoint.lon,
          lastPoint.lat,
          lastPoint.lon
        );

        result.push({
          lat: lastPoint.lat,
          lon: lastPoint.lon,
          height: lastPoint.height,
          seconds: lastPoint.seconds,
          distance_from_prev: distFromPrev,
        });

        lastInterpolatedPoint = {
          lat: lastPoint.lat,
          lon: lastPoint.lon,
          height: lastPoint.height,
          seconds: lastPoint.seconds,
        };

        continue;
      }

      // Get the two points that bracket the target distance
      const p1 = path[segmentIdx];
      const p2 = path[segmentIdx + 1];

      // Calculate how far along the segment the target is
      const segmentLength = p2.cumulativeDistance - p1.cumulativeDistance;
      const segmentProgress =
        (targetDistance - p1.cumulativeDistance) / segmentLength;

      // Interpolate position along the segment
      const interpolatedPoint = {
        lat: p1.lat + segmentProgress * (p2.lat - p1.lat),
        lon: p1.lon + segmentProgress * (p2.lon - p1.lon),
        height: p1.height + segmentProgress * (p2.height - p1.height),
        seconds: p1.seconds + segmentProgress * (p2.seconds - p1.seconds),
      };

      // Calculate distance from previous interpolated point
      const distFromPrev = this.haversineDistance(
        lastInterpolatedPoint.lat,
        lastInterpolatedPoint.lon,
        interpolatedPoint.lat,
        interpolatedPoint.lon
      );

      result.push({
        ...interpolatedPoint,
        distance_from_prev: distFromPrev,
      });

      lastInterpolatedPoint = interpolatedPoint;
    }

    return result;
  }

  /**
   * Process the position and events files to find missing triggers
   */
  async processFiles(
    posFileContent: string,
    eventsFileContent: string,
    triggerDistance?: number
  ): Promise<ProcessingResults> {
    // Parse position and events data
    const posData = this.parsePositionData(posFileContent);
    const eventsData = this.parseEventsData(eventsFileContent);

    // Store the trigger distance in the config if provided
    if (triggerDistance) {
      this.config.triggerDistance = triggerDistance;
    }

    // Calculate median distance from original triggers before interpolation
    const sortedEvents = [...eventsData].sort((a, b) => a.seconds - b.seconds);

    // First calculate distances between consecutive triggers
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentTrigger = sortedEvents[i];
      const nextTrigger = sortedEvents[i + 1];

      // Calculate direct distance between consecutive triggers
      const distance = this.haversineDistance(
        currentTrigger.lat!,
        currentTrigger.lon!,
        nextTrigger.lat!,
        nextTrigger.lon!
      );

      // Store the distance
      nextTrigger.distance_from_prev = distance;
    }

    // Calculate median from these distances
    const allDistances = sortedEvents
      .slice(1) // Skip the first trigger as it has no previous
      .map((e) => e.distance_from_prev!)
      .filter((d) => d !== undefined);

    // Sort distances and find median
    const sortedDistances = [...allDistances].sort((a, b) => a - b);
    const medianDistance =
      sortedDistances.length % 2 === 0
        ? (sortedDistances[sortedDistances.length / 2 - 1] +
            sortedDistances[sortedDistances.length / 2]) /
          2
        : sortedDistances[Math.floor(sortedDistances.length / 2)];

    // Find and interpolate missing triggers
    const interpolatedData = this.findMissingTriggers(eventsData, posData);

    // Calculate statistics
    const flightDuration =
      posData.length > 1
        ? posData[posData.length - 1].seconds - posData[0].seconds
        : 0;

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
        minDistance:
          allDistances.length > 0 ? Math.min(...allDistances) : undefined,
        avgDistance:
          allDistances.length > 0
            ? allDistances.reduce((sum, d) => sum + d, 0) / allDistances.length
            : undefined,
        medianDistance: allDistances.length > 0 ? medianDistance : undefined,
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
    console.log(`Original events: ${eventsData.length}`);
    console.log(`Interpolated events: ${interpolatedData.length}`);
    console.log(
      `Total expected: ${eventsData.length + interpolatedData.length}`
    );

    // Combine original and interpolated events
    const combined = [
      ...eventsData.map((e) => ({ ...e, interpolated: false })),
      ...interpolatedData,
    ].sort((a, b) => a.seconds - b.seconds);

    console.log(`Combined events after sorting: ${combined.length}`);

    // Ensure no duplicate timestamps by adding tiny offsets if needed
    const uniqueCombined = combined.map((point, index) => {
      if (
        index > 0 &&
        Math.abs(point.seconds - combined[index - 1].seconds) < 0.001
      ) {
        // Add a tiny offset (0.001 seconds) to ensure uniqueness
        return { ...point, seconds: point.seconds + 0.001 };
      }
      return point;
    });

    console.log(
      `Combined events after ensuring unique timestamps: ${uniqueCombined.length}`
    );

    // Calculate time range
    const startTime = uniqueCombined.length > 0 ? uniqueCombined[0].seconds : 0;
    const endTime =
      uniqueCombined.length > 0
        ? uniqueCombined[uniqueCombined.length - 1].seconds
        : 0;
    const startWeek = uniqueCombined.length > 0 ? uniqueCombined[0].week : 0;
    const endWeek =
      uniqueCombined.length > 0
        ? uniqueCombined[uniqueCombined.length - 1].week
        : 0;

    // Count original and interpolated points in the final output
    const originalCount = uniqueCombined.filter((p) => !p.interpolated).length;
    const interpolatedCount = uniqueCombined.filter(
      (p) => p.interpolated
    ).length;

    console.log(`Final original count: ${originalCount}`);
    console.log(`Final interpolated count: ${interpolatedCount}`);
    console.log(`Final total count: ${uniqueCombined.length}`);

    // Format each line
    const lines = uniqueCombined.map((event, idx) => {
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
          // Use type assertion with a more specific type
          const typedEvent = event as { [key: string]: number };
          line += `   ${typedEvent[field].toFixed(4)}`;
        }
      }

      // Log every 10th point for debugging
      if (idx % 10 === 0) {
        console.log(`Formatting point ${idx + 1}/${uniqueCombined.length}`);
      }

      return line;
    });

    console.log(`Formatted lines: ${lines.length}`);

    // Add header with statistics and trigger distance information
    const header = [
      "% program   : Trigger Fix Tool v1.0",
      "% processed : " +
        new Date().toISOString().split("T")[0] +
        " " +
        new Date().toISOString().split("T")[1].split(".")[0] +
        " UTC",
      "% original  : events.pos",
      "% developer : Aerosys Aviation",
      "% summary   : Added " +
        interpolatedData.length +
        " interpolated triggers",
      "% stats     : Original: " +
        originalCount +
        ", Interpolated: " +
        interpolatedCount +
        ", Total: " +
        uniqueCombined.length,
      "% threshold : " +
        (this.config.triggerDistance
          ? this.config.triggerDistance.toFixed(2) + "m"
          : "auto"),
      "% obs start : week" + startWeek + " " + startTime.toFixed(1) + "s",
      "% obs end   : week" + endWeek + " " + endTime.toFixed(1) + "s",
      "%",
      "% (lat/lon/height=WGS84/ellipsoidal,Q=1:fix,2:float,3:sbas,4:dgps,5:single,6:ppp,ns=# of satellites)",
      "%  GPST            latitude(d'\")   longitude(d'\")  height(m)   Q  ns   sdn(m)   sde(m)   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio",
    ];

    // Ensure the last line has a newline
    return [...header, ...lines].join("\n") + "\n";
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
