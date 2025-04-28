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

    def interpolate_position(self, pos_data, timestamp):
        """Interpolate position for a given timestamp using nearby points."""
        # Create interpolation functions for lat, lon, height
        f_lat = interp1d(pos_data["seconds"], pos_data["lat"], bounds_error=False)
        f_lon = interp1d(pos_data["seconds"], pos_data["lon"], bounds_error=False)
        f_height = interp1d(pos_data["seconds"], pos_data["height"], bounds_error=False)

        # Interpolate values
        lat = f_lat(timestamp)
        lon = f_lon(timestamp)
        height = f_height(timestamp)

        if np.isnan(lat) or np.isnan(lon) or np.isnan(height):
            return None

        return {"lat": lat, "lon": lon, "height": height}

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
        """Find and interpolate missing triggers using sliding window technique with distance validation."""
        # Sort events by time
        events_data = events_data.sort_values("seconds")

        # Calculate time intervals between consecutive triggers
        intervals = np.diff(events_data["seconds"])

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
        distances = np.array(distances)

        # Initialize list to store interpolated triggers
        interpolated_triggers = []

        # Process each window
        for i in range(len(intervals) - self.config["window_size"] + 1):
            # Get current window of intervals and distances
            time_window = intervals[i : i + self.config["window_size"]]
            dist_window = distances[i : i + self.config["window_size"]]

            # Calculate median interval and distance in this window
            median_interval = np.median(time_window)
            median_distance = np.median(dist_window)
            min_acceptable_distance = (
                median_distance * self.config["min_distance_factor"]
            )

            # Define acceptable interval range
            max_interval = median_interval * self.config["max_interval_factor"]
            min_interval = median_interval * self.config["min_interval_factor"]

            # Check if the interval after the window is too large (indicating missing triggers)
            if i + self.config["window_size"] < len(intervals):
                current_interval = intervals[i + self.config["window_size"]]

                if current_interval > max_interval:
                    # Calculate how many triggers are missing
                    num_missing = int(round(current_interval / median_interval)) - 1

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
                        }
                        end_pos = {
                            "lat": events_data["lat"].iloc[start_idx + 1],
                            "lon": events_data["lon"].iloc[start_idx + 1],
                            "height": events_data["height"].iloc[start_idx + 1],
                        }

                        # Generate evenly spaced timestamps for missing triggers
                        missing_times = np.linspace(
                            start_time, end_time, num_missing + 2
                        )[1:-1]

                        # Track the last valid position for distance checking
                        last_valid_pos = start_pos

                        # Interpolate positions for each missing timestamp
                        for ts in missing_times:
                            pos = self.interpolate_position(pos_data, ts)
                            if pos:
                                # Check distance from last valid position
                                dist_from_last = self.haversine_distance(
                                    last_valid_pos["lat"],
                                    last_valid_pos["lon"],
                                    pos["lat"],
                                    pos["lon"],
                                )

                                # Only add if distance is acceptable
                                if dist_from_last >= min_acceptable_distance:
                                    # Get the GPS week from nearby points
                                    week = events_data["week"].iloc[start_idx]

                                    interpolated_triggers.append(
                                        {
                                            "week": week,
                                            "seconds": ts,
                                            "lat": pos["lat"],
                                            "lon": pos["lon"],
                                            "height": pos["height"],
                                            "interpolated": True,
                                            "distance_from_prev": dist_from_last,
                                        }
                                    )

                                    # Update last valid position
                                    last_valid_pos = pos

        return (
            pd.DataFrame(interpolated_triggers)
            if interpolated_triggers
            else pd.DataFrame()
        )

    def process_files(self, pos_file, events_file):
        """Process the position and events files to find missing triggers"""
        # Load position and events data
        pos_data = self.load_position_data(pos_file)
        events_data = self.load_events_data(events_file)

        # Find and interpolate missing triggers
        interpolated_data = self.find_missing_triggers(events_data, pos_data)

        # Return results
        return {
            "pos_data": pos_data,
            "events_data": events_data,
            "interpolated_data": interpolated_data,
        }
