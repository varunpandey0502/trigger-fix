"""
Core functionality for the Trigger Fix tool.
Contains the algorithms for processing GPS data and finding missing triggers.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from scipy.interpolate import interp1d


class TriggerFixer:
    """Class that handles the core trigger fixing functionality"""

    def __init__(self, config):
        """Initialize with configuration parameters"""
        self.config = config

    def gps_to_datetime(self, week, seconds):
        """Convert GPS week and seconds to datetime."""
        date = self.config["gps_epoch"] + timedelta(weeks=week, seconds=seconds)
        return date

    def dms_to_decimal(self, d, m, s):
        """Convert degrees, minutes, seconds to decimal degrees."""
        return d + m / 60 + s / 3600

    def load_position_data(self, file_path):
        """Load and process position data from file."""
        # Read the file to determine format
        with open(file_path, "r") as f:
            content = f.read()

        # Determine format by checking header
        is_decimal_format = "latitude(deg)" in content
        is_dms_format = "latitude(d'\")" in content

        # If neither format is detected, try to infer from data lines
        if not (is_decimal_format or is_dms_format):
            data_lines = [
                line
                for line in content.split("\n")
                if line.strip() and not line.startswith("%")
            ]
            if data_lines:
                first_line = data_lines[0]
                # Check if first field looks like a date (YYYY/MM/DD)
                is_decimal_format = "/" in first_line.split()[0]
                is_dms_format = not is_decimal_format

        # Store the format for later use when exporting
        self.input_format = "decimal" if is_decimal_format else "dms"

        if is_decimal_format:
            # Handle decimal degrees format (YYYY/MM/DD HH:MM:SS.SSS)
            return self._load_decimal_format(file_path)
        else:
            # Handle DMS format (GPS week and seconds)
            return self._load_dms_format(file_path)

    def _load_decimal_format(self, file_path):
        """Load position data in decimal degrees format."""
        # Read the file line by line to handle the date-time format
        with open(file_path, "r") as f:
            lines = [line for line in f if line.strip() and not line.startswith("%")]

        data_list = []
        for line in lines:
            parts = line.strip().split()
            if len(parts) < 5:  # Need at least date, time, lat, lon, height
                continue

            # Parse date and time
            date_str = parts[0]
            time_str = parts[1]
            datetime_str = f"{date_str} {time_str}"

            # Convert to GPS week and seconds
            dt = datetime.strptime(datetime_str, "%Y/%m/%d %H:%M:%S.%f")
            gps_week, gps_seconds = self._datetime_to_gps(dt)

            # Parse lat, lon, height
            lat = float(parts[2])
            lon = float(parts[3])
            height = float(parts[4])

            # Convert decimal to DMS for consistency
            lat_d, lat_m, lat_s = self._decimal_to_dms(lat)
            lon_d, lon_m, lon_s = self._decimal_to_dms(lon)

            # Add other fields if available
            record = {
                "week": gps_week,
                "seconds": gps_seconds,
                "lat_d": lat_d,
                "lat_m": lat_m,
                "lat_s": lat_s,
                "lon_d": lon_d,
                "lon_m": lon_m,
                "lon_s": lon_s,
                "height": height,
                "lat": lat,
                "lon": lon,
                "timestamp": dt,
            }

            # Add additional fields if available
            if len(parts) > 5:
                record["Q"] = int(parts[5]) if len(parts) > 5 else 0
                record["ns"] = int(parts[6]) if len(parts) > 6 else 0
                # Add more fields as needed

            data_list.append(record)

        return pd.DataFrame(data_list)

    def _load_dms_format(self, file_path):
        """Load position data in DMS format (GPS week and seconds)."""
        # Read the position file
        pos_data = pd.read_csv(
            file_path,
            comment="%",  # Skip header comments if any
            sep="\s+",  # Split on whitespace
            names=[
                "week",
                "seconds",
                "lat_d",
                "lat_m",
                "lat_s",
                "lon_d",
                "lon_m",
                "lon_s",
                "height",
                "Q",
                "ns",
                "sdn",
                "sde",
                "sdu",
                "sdne",
                "sdeu",
                "sdun",
                "age",
                "ratio",
            ],
        )

        # Convert GPS time to datetime
        pos_data["timestamp"] = pos_data.apply(
            lambda x: self.gps_to_datetime(x["week"], x["seconds"]), axis=1
        )

        # Convert lat/lon from degrees, minutes, seconds to decimal degrees
        pos_data["lat"] = pos_data.apply(
            lambda x: self.dms_to_decimal(x["lat_d"], x["lat_m"], x["lat_s"]), axis=1
        )
        pos_data["lon"] = pos_data.apply(
            lambda x: self.dms_to_decimal(x["lon_d"], x["lon_m"], x["lon_s"]), axis=1
        )

        return pos_data

    def _datetime_to_gps(self, dt):
        """Convert datetime to GPS week and seconds."""
        # Calculate time difference from GPS epoch
        delta = dt - self.config["gps_epoch"]

        # Calculate GPS week
        gps_week = delta.days // 7

        # Calculate seconds of week
        seconds_of_week = (
            (delta.days % 7) * 86400 + delta.seconds + delta.microseconds / 1e6
        )

        return gps_week, seconds_of_week

    def _decimal_to_dms(self, decimal):
        """Convert decimal degrees to degrees, minutes, seconds."""
        d = int(decimal)
        m_float = (decimal - d) * 60
        m = int(m_float)
        s = (m_float - m) * 60

        return d, m, s

    def load_events_data(self, file_path):
        """Load and process events data from file."""
        # Read the events file
        with open(file_path, "r") as f:
            # Skip comment lines
            lines = [line for line in f if not line.startswith("%")]

        # Parse events data manually
        events_list = []
        for line in lines:
            parts = line.strip().split()
            if len(parts) >= 8:  # Ensure we have enough parts
                events_list.append(
                    {
                        "week": int(parts[0]),
                        "seconds": float(parts[1]),
                        "lat_d": int(parts[2]),
                        "lat_m": int(parts[3]),
                        "lat_s": float(parts[4]),
                        "lon_d": int(parts[5]),
                        "lon_m": int(parts[6]),
                        "lon_s": float(parts[7]),
                        "height": float(parts[8]) if len(parts) > 8 else 0,
                    }
                )

        events_data = pd.DataFrame(events_list)

        # Convert GPS time to datetime
        events_data["timestamp"] = events_data.apply(
            lambda x: self.gps_to_datetime(x["week"], x["seconds"]), axis=1
        )

        # Convert lat/lon from degrees, minutes, seconds to decimal degrees
        events_data["lat"] = events_data.apply(
            lambda x: self.dms_to_decimal(x["lat_d"], x["lat_m"], x["lat_s"]), axis=1
        )
        events_data["lon"] = events_data.apply(
            lambda x: self.dms_to_decimal(x["lon_d"], x["lon_m"], x["lon_s"]), axis=1
        )

        return events_data

    def interpolate_positions_by_distance(
        self, start_pos, end_pos, num_points, pos_data
    ):
        """
        Interpolate positions by distance between two points, following the actual flight path.

        Args:
            start_pos: Dictionary with lat, lon, height, seconds of start point
            end_pos: Dictionary with lat, lon, height, seconds of end point
            num_points: Number of points to interpolate
            pos_data: DataFrame with position data

        Returns:
            List of dictionaries with interpolated positions
        """
        result = []

        # Calculate total direct distance between start and end
        total_distance = self.haversine_distance(
            start_pos["lat"], start_pos["lon"], end_pos["lat"], end_pos["lon"]
        )

        # Calculate segment distance
        segment_distance = total_distance / (num_points + 1)

        # Find all position points between start and end times
        relevant_pos_data = pos_data[
            (pos_data["seconds"] >= start_pos["seconds"])
            & (pos_data["seconds"] <= end_pos["seconds"])
        ].sort_values("seconds")

        if len(relevant_pos_data) < 2:
            # Not enough position data, fall back to linear interpolation
            for i in range(1, num_points + 1):
                ratio = i / (num_points + 1)
                lat = start_pos["lat"] + ratio * (end_pos["lat"] - start_pos["lat"])
                lon = start_pos["lon"] + ratio * (end_pos["lon"] - start_pos["lon"])
                height = start_pos["height"] + ratio * (
                    end_pos["height"] - start_pos["height"]
                )
                seconds = start_pos["seconds"] + ratio * (
                    end_pos["seconds"] - start_pos["seconds"]
                )

                if i == 1:
                    distance_from_prev = segment_distance
                else:
                    distance_from_prev = self.haversine_distance(
                        result[-1]["lat"], result[-1]["lon"], lat, lon
                    )

                result.append(
                    {
                        "lat": lat,
                        "lon": lon,
                        "height": height,
                        "seconds": seconds,
                        "distance_from_prev": distance_from_prev,
                    }
                )

            return result

        # Calculate cumulative distances along the path
        cumulative_distances = [0]  # Start with 0 for the first point

        for i in range(1, len(relevant_pos_data)):
            prev_point = relevant_pos_data.iloc[i - 1]
            curr_point = relevant_pos_data.iloc[i]

            dist = self.haversine_distance(
                prev_point["lat"],
                prev_point["lon"],
                curr_point["lat"],
                curr_point["lon"],
            )

            cumulative_distances.append(cumulative_distances[i - 1] + dist)

        # Total path distance
        path_distance = cumulative_distances[-1]

        # Generate points at equal distance intervals
        last_point = {
            "lat": start_pos["lat"],
            "lon": start_pos["lon"],
            "height": start_pos["height"],
            "seconds": start_pos["seconds"],
        }

        for i in range(1, num_points + 1):
            # Target distance from start
            target_distance = (i * total_distance) / (num_points + 1)

            # Find the position in the path closest to the target distance
            idx = 0
            while (
                idx < len(cumulative_distances) - 1
                and cumulative_distances[idx] < target_distance
            ):
                idx += 1

            if idx == 0:
                # If target is before the first point, use the first point
                interpolated_point = {
                    "lat": relevant_pos_data["lat"].iloc[0],
                    "lon": relevant_pos_data["lon"].iloc[0],
                    "height": relevant_pos_data["height"].iloc[0],
                    "seconds": relevant_pos_data["seconds"].iloc[0],
                }
            else:
                # Interpolate between the two closest points
                prev_idx = idx - 1
                prev_dist = cumulative_distances[prev_idx]
                next_dist = cumulative_distances[idx]

                ratio = (target_distance - prev_dist) / (next_dist - prev_dist)

                prev_point = relevant_pos_data.iloc[prev_idx]
                next_point = relevant_pos_data.iloc[idx]

                interpolated_point = {
                    "lat": prev_point["lat"]
                    + ratio * (next_point["lat"] - prev_point["lat"]),
                    "lon": prev_point["lon"]
                    + ratio * (next_point["lon"] - prev_point["lon"]),
                    "height": prev_point["height"]
                    + ratio * (next_point["height"] - prev_point["height"]),
                    "seconds": prev_point["seconds"]
                    + ratio * (next_point["seconds"] - prev_point["seconds"]),
                }

            # Calculate distance from previous point
            dist_from_prev = self.haversine_distance(
                last_point["lat"],
                last_point["lon"],
                interpolated_point["lat"],
                interpolated_point["lon"],
            )

            interpolated_point["distance_from_prev"] = dist_from_prev
            result.append(interpolated_point)

            last_point = interpolated_point

        return result

    def haversine_distance(self, lat1, lon1, lat2, lon2):
        """Calculate distance between two points in meters using the haversine formula."""
        # Earth's radius in meters
        R = 6371000

        # Convert to radians
        lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])

        # Haversine formula
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
        c = 2 * np.arcsin(np.sqrt(a))

        return R * c

    def find_missing_triggers(self, events_data, pos_data):
        """Find and interpolate missing triggers using distance-based approach."""
        # Sort events by time
        events_data = events_data.sort_values("seconds").reset_index(drop=True)

        # Calculate distances between consecutive triggers
        distances = []
        for i in range(len(events_data) - 1):
            dist = self.haversine_distance(
                events_data["lat"].iloc[i],
                events_data["lon"].iloc[i],
                events_data["lat"].iloc[i + 1],
                events_data["lon"].iloc[i + 1],
            )
            distances.append(dist)
            # Store distance in the event point for later use
            if i > 0:
                events_data.loc[i, "distance_from_prev"] = dist

        # Initialize list to store interpolated triggers
        interpolated_triggers = []

        # Process each window
        for i in range(len(distances) - self.config["window_size"] + 1):
            # Get current window of distances
            dist_window = distances[i : i + self.config["window_size"]]

            # Calculate median distance in this window
            median_distance = np.median(dist_window)

            # Define acceptable distance range
            max_distance = median_distance * self.config["max_interval_factor"]
            min_distance = median_distance * self.config["min_interval_factor"]

            # Check if the distance after the window is too large (indicating missing triggers)
            if i + self.config["window_size"] < len(distances):
                current_distance = distances[i + self.config["window_size"]]

                if current_distance > max_distance:
                    # Calculate how many triggers are missing
                    num_missing = int(round(current_distance / median_distance)) - 1

                    if num_missing > 0:
                        # Get start and end points for interpolation
                        start_idx = i + self.config["window_size"]
                        start_time = events_data["seconds"].iloc[start_idx]
                        end_time = events_data["seconds"].iloc[start_idx + 1]

                        # Get start and end positions
                        start_pos = {
                            "lat": events_data["lat"].iloc[start_idx],
                            "lon": events_data["lon"].iloc[start_idx],
                            "height": events_data["height"].iloc[start_idx],
                            "seconds": start_time,
                        }

                        end_pos = {
                            "lat": events_data["lat"].iloc[start_idx + 1],
                            "lon": events_data["lon"].iloc[start_idx + 1],
                            "height": events_data["height"].iloc[start_idx + 1],
                            "seconds": end_time,
                        }

                        # Generate evenly spaced positions for missing triggers
                        interpolated_positions = self.interpolate_positions_by_distance(
                            start_pos, end_pos, num_missing, pos_data
                        )

                        # Add interpolated triggers
                        for pos in interpolated_positions:
                            # Get the GPS week from nearby points
                            week = events_data["week"].iloc[start_idx]

                            # Convert decimal lat/lon to DMS if needed
                            lat_decimal = pos["lat"]
                            lon_decimal = pos["lon"]

                            # Create interpolated trigger
                            interpolated_triggers.append(
                                {
                                    "week": week,
                                    "seconds": pos["seconds"],
                                    "lat": lat_decimal,
                                    "lon": lon_decimal,
                                    "height": pos["height"],
                                    "interpolated": True,
                                    "distance_from_prev": pos["distance_from_prev"],
                                }
                            )

        return (
            pd.DataFrame(interpolated_triggers)
            if interpolated_triggers
            else pd.DataFrame()
        )

    def median(self, values):
        """Calculate the median of an array of numbers."""
        if len(values) == 0:
            return 0
        return np.median(values)

    def process_files(self, pos_file, events_file):
        """Process the position and events files to find missing triggers"""
        # Load position and events data
        pos_data = self.load_position_data(pos_file)
        events_data = self.load_events_data(events_file)

        # Find and interpolate missing triggers
        interpolated_data = self.find_missing_triggers(events_data, pos_data)

        # Calculate statistics
        flight_duration = (
            pos_data["seconds"].max() - pos_data["seconds"].min()
            if len(pos_data) > 1
            else 0
        )

        min_distance = None
        avg_distance = None

        if (
            len(interpolated_data) > 0
            and "distance_from_prev" in interpolated_data.columns
        ):
            distances = interpolated_data["distance_from_prev"].dropna()
            if len(distances) > 0:
                min_distance = distances.min()
                avg_distance = distances.mean()

        # Return results
        return {
            "pos_data": pos_data,
            "events_data": events_data,
            "interpolated_data": interpolated_data,
            "stats": {
                "total_points": len(pos_data),
                "original_triggers": len(events_data),
                "interpolated_triggers": len(interpolated_data),
                "flight_duration": flight_duration,
                "min_distance": min_distance,
                "avg_distance": avg_distance,
            },
        }

    def format_for_events_export(self, events_data, interpolated_data):
        """Format data for export to events file, matching the input format for Emlid Studio compatibility."""
        # Combine original and interpolated events
        combined = (
            pd.concat(
                [
                    events_data.assign(interpolated=False),
                    interpolated_data
                    if not interpolated_data.empty
                    else pd.DataFrame(),
                ]
            )
            .sort_values("seconds")
            .reset_index(drop=True)
        )

        # Calculate time range
        start_time = combined["seconds"].min() if not combined.empty else 0
        end_time = combined["seconds"].max() if not combined.empty else 0
        start_week = combined["week"].iloc[0] if not combined.empty else 0
        end_week = combined["week"].iloc[-1] if not combined.empty else 0

        # Format each line according to the detected input format
        lines = []

        if hasattr(self, "input_format") and self.input_format == "decimal":
            # Format for decimal degrees (YYYY/MM/DD HH:MM:SS.SSS)
            for _, event in combined.iterrows():
                dt = event["timestamp"]
                date_str = dt.strftime("%Y/%m/%d")
                time_str = dt.strftime("%H:%M:%S.%f")[
                    :-3
                ]  # Trim microseconds to milliseconds

                # Emlid Studio format: fixed width columns with proper spacing
                line = f"{date_str} {time_str}   "
                line += f"{event['lat']:.9f}   {event['lon']:.9f}   "
                line += f"{event['height']:.4f}"

                # Add Q and ns if available (maintain exact spacing)
                if "Q" in event:
                    line += f"   {int(event['Q'])}"
                else:
                    line += "   5"  # Default Q value

                if "ns" in event:
                    line += f"   {int(event['ns'])}"
                else:
                    line += "   0"  # Default ns value

                # Add additional fields if they were in the original data
                for field in [
                    "sdn",
                    "sde",
                    "sdu",
                    "sdne",
                    "sdeu",
                    "sdun",
                    "age",
                    "ratio",
                ]:
                    if field in event:
                        line += f"   {event[field]:.4f}"

                # Add a comment for interpolated points (at the end with proper spacing)
                if event.get("interpolated", False):
                    line += "  # interpolated"

                lines.append(line)
        else:
            # Format for DMS (GPS week and seconds)
            for _, event in combined.iterrows():
                # Format GPS week and seconds with exact spacing
                line = f"{int(event['week'])} {event['seconds']:.3f}"

                # Format lat/lon in DMS with proper spacing
                if "lat_d" in event and "lat_m" in event and "lat_s" in event:
                    # Use stored DMS values
                    line += f"   {int(event['lat_d'])} {int(event['lat_m'])} {event['lat_s']:.9f}"
                    line += f"   {int(event['lon_d'])} {int(event['lon_m'])} {event['lon_s']:.9f}"
                else:
                    # Convert decimal to DMS
                    lat_d, lat_m, lat_s = self._decimal_to_dms(event["lat"])
                    lon_d, lon_m, lon_s = self._decimal_to_dms(event["lon"])
                    line += f"   {lat_d} {lat_m} {lat_s:.9f}"
                    line += f"   {lon_d} {lon_m} {lon_s:.9f}"

                # Add height with proper spacing
                line += f"   {event['height']:.4f}"

                # Add additional fields if they were in the original data
                for field in [
                    "Q",
                    "ns",
                    "sdn",
                    "sde",
                    "sdu",
                    "sdne",
                    "sdeu",
                    "sdun",
                    "age",
                    "ratio",
                ]:
                    if field in event:
                        if field in ["Q", "ns"]:
                            line += f"   {int(event[field])}"
                        else:
                            line += f"   {event[field]:.4f}"

                # Add a comment for interpolated points
                if event.get("interpolated", False):
                    line += "  # interpolated"

                lines.append(line)

        # Get current date and time
        now = datetime.now()
        date_str = now.strftime("%Y/%m/%d")
        time_str = now.strftime("%H:%M:%S")

        # Add comprehensive header that matches Emlid Studio format
        header = [
            "% program   : Trigger Fix Tool v1.0",
            f"% processed : {date_str} {time_str} UTC",
            "% original  : events.pos",
            "% developer : Aerosys Aviation",
            f"% summary   : Added {len(interpolated_data)} interpolated triggers",
            f"% obs start : week{start_week} {start_time:.1f}s",
            f"% obs end   : week{end_week} {end_time:.1f}s",
            "%",
        ]

        # Add format-specific header line
        if hasattr(self, "input_format") and self.input_format == "decimal":
            header.append(
                "% (lat/lon/height=WGS84/ellipsoidal,Q=1:fix,2:float,3:sbas,4:dgps,5:single,6:ppp,ns=# of satellites)"
            )
            header.append(
                "%  GPST                  latitude(deg) longitude(deg)  height(m)   Q  ns   sdn(m)   sde(m)   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio"
            )
        else:
            header.append(
                "% (lat/lon/height=WGS84/ellipsoidal,Q=1:fix,2:float,3:sbas,4:dgps,5:single,6:ppp,ns=# of satellites)"
            )
            header.append(
                "%  GPST            latitude(d'\")   longitude(d'\")  height(m)   Q  ns   sdn(m)   sde(m)   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio"
            )

        return "\n".join(header + lines)
