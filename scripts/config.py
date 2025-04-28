"""
Configuration settings for the Trigger Fix tool.
"""

from datetime import datetime

# Default configuration
DEFAULT_CONFIG = {
    # GPS time
    "gps_epoch": datetime(1980, 1, 6),  # GPS epoch start date
    # Interpolation parameters
    "window_size": 10,  # Number of triggers to consider for sliding window
    "max_interval_factor": 1.5,  # Maximum allowed factor above median interval
    "min_interval_factor": 0.5,  # Minimum allowed factor below median interval
    "min_distance_factor": 0.8,  # Minimum acceptable distance as a factor of median distance
    # Plotting
    "path_alpha": 0.7,
    "trigger_alpha": 0.9,
    "path_color": "blue",
    "trigger_color": "red",
    "interpolated_color": "green",
    "trigger_marker": "x",
    "interpolated_marker": "o",
    "marker_size": 50,
}
