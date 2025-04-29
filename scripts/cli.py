"""
Command-line interface for the Trigger Fix tool.
"""

import argparse
import os
import pandas as pd
import matplotlib.pyplot as plt
from core import TriggerFixer
from config import DEFAULT_CONFIG


def main():
    """Command-line entry point"""
    parser = argparse.ArgumentParser(
        description="Trigger Fix Tool - Find and interpolate missing triggers in GPS data"
    )

    # Define default paths to flight-1 data
    default_pos_file = "data/flight-1/Reach_raw_20250403105951.pos"
    default_events_file = "data/flight-1/Reach_raw_20250403105951_events.pos"

    parser.add_argument(
        "--pos_file", help="Path to the position file (.pos)", default=default_pos_file
    )
    parser.add_argument(
        "--events_file",
        help="Path to the events file (_events.pos)",
        default=default_events_file,
    )
    parser.add_argument(
        "--output-plot",
        help="Path to save the output plot (default: flight_path_with_interpolated.png in the same directory as input files)",
    )
    parser.add_argument(
        "--output-csv",
        help="Path to save interpolated triggers as CSV (default: interpolated_triggers.csv in the same directory as input files)",
    )
    parser.add_argument(
        "--output-events",
        help="Path to save combined events file (default: combined_events.pos in the same directory as input files)",
    )

    args = parser.parse_args()

    # Get the directory of the input files to save outputs in the same location
    input_dir = os.path.dirname(args.pos_file)

    # Set default output paths if not specified - now in the same directory as input files
    output_plot = args.output_plot or os.path.join(
        input_dir, "flight_path_with_interpolated.png"
    )
    output_csv = args.output_csv or os.path.join(input_dir, "interpolated_triggers.csv")
    output_events = args.output_events or os.path.join(input_dir, "combined_events.pos")

    # Create TriggerFixer instance with default config
    fixer = TriggerFixer(DEFAULT_CONFIG)

    # Process files
    print(f"Processing position file: {args.pos_file}")
    print(f"Processing events file: {args.events_file}")

    results = fixer.process_files(args.pos_file, args.events_file)

    pos_data = results["pos_data"]
    events_data = results["events_data"]
    interpolated_data = results["interpolated_data"]

    print(f"Loaded {len(pos_data)} position points")
    print(f"Loaded {len(events_data)} trigger events")
    print(f"Interpolated {len(interpolated_data)} missing triggers")

    # Save interpolated triggers to CSV if any were found
    if not interpolated_data.empty:
        interpolated_data.to_csv(output_csv, index=False)
        print(f"Saved interpolated triggers to {output_csv}")

        # Save combined events file
        if not interpolated_data.empty:
            # Convert interpolated data to match events format
            interpolated_events = []
            for _, row in interpolated_data.iterrows():
                # Convert decimal lat/lon back to DMS for consistency
                lat_d = int(row["lat"])
                lat_m = int((row["lat"] - lat_d) * 60)
                lat_s = ((row["lat"] - lat_d) * 60 - lat_m) * 60

                lon_d = int(row["lon"])
                lon_m = int((row["lon"] - lon_d) * 60)
                lon_s = ((row["lon"] - lon_d) * 60 - lon_m) * 60

                interpolated_events.append(
                    {
                        "week": int(row["week"]),
                        "seconds": row["seconds"],
                        "lat_d": lat_d,
                        "lat_m": lat_m,
                        "lat_s": lat_s,
                        "lon_d": lon_d,
                        "lon_m": lon_m,
                        "lon_s": lon_s,
                        "height": row["height"],
                        "interpolated": True,
                    }
                )

            # Create DataFrame for interpolated events
            interpolated_df = pd.DataFrame(interpolated_events)

            # Add interpolated column to original events
            events_data["interpolated"] = False

            # Combine both dataframes
            combined_df = pd.concat([events_data, interpolated_df], ignore_index=True)

            # Sort by time
            combined_df = combined_df.sort_values(by=["week", "seconds"])

            # Read the original file to preserve comments and format
            with open(args.events_file, "r") as f:
                original_lines = f.readlines()

            # Extract header comments
            header_lines = [line for line in original_lines if line.startswith("%")]

            # Write the combined file
            with open(output_events, "w") as f:
                # Write original header
                for line in header_lines:
                    f.write(line)

                # Add our own headers
                f.write("% Modified by Trigger Fix Tool\n")
                f.write("% Interpolated triggers have been added\n")
                f.write("% Original file: " + os.path.basename(args.events_file) + "\n")

                # Write all events in chronological order
                for _, row in combined_df.iterrows():
                    f.write(f"{int(row['week'])} {row['seconds']:.3f} ")
                    f.write(
                        f"{int(row['lat_d'])} {int(row['lat_m'])} {row['lat_s']:.9f} "
                    )
                    f.write(
                        f"{int(row['lon_d'])} {int(row['lon_m'])} {row['lon_s']:.9f} "
                    )
                    f.write(f"{row['height']:.4f}")

                    # Add a comment to mark interpolated points (optional)
                    if row["interpolated"]:
                        f.write(" # interpolated")

                    f.write("\n")

            print(f"Saved combined events file to {output_events}")

    # Create plot
    plt.figure(figsize=(15, 10))

    # Plot flight path
    plt.plot(
        pos_data["lon"],
        pos_data["lat"],
        "-",
        color=DEFAULT_CONFIG["path_color"],
        label="Flight path",
        alpha=DEFAULT_CONFIG["path_alpha"],
    )

    # Plot original triggers
    plt.scatter(
        events_data["lon"],
        events_data["lat"],
        color=DEFAULT_CONFIG["trigger_color"],
        marker=DEFAULT_CONFIG["trigger_marker"],
        s=DEFAULT_CONFIG["marker_size"],
        label="Original triggers",
        alpha=DEFAULT_CONFIG["trigger_alpha"],
    )

    # Plot interpolated triggers if any
    if not interpolated_data.empty:
        plt.scatter(
            interpolated_data["lon"],
            interpolated_data["lat"],
            color=DEFAULT_CONFIG["interpolated_color"],
            marker=DEFAULT_CONFIG["interpolated_marker"],
            s=DEFAULT_CONFIG["marker_size"],
            label="Interpolated triggers",
            alpha=DEFAULT_CONFIG["trigger_alpha"],
        )

    plt.grid(True)
    plt.xlabel("Longitude (°)")
    plt.ylabel("Latitude (°)")
    plt.title("Flight Path with Original and Interpolated Trigger Points")
    plt.legend()

    # Add statistics to plot
    text = f"Statistics:\n"
    text += f"Total flight points: {len(pos_data)}\n"
    text += f"Original triggers: {len(events_data)}\n"
    text += f"Interpolated triggers: {len(interpolated_data)}\n"
    text += f"Flight duration: {(pos_data['timestamp'].iloc[-1] - pos_data['timestamp'].iloc[0]).total_seconds():.1f}s\n"

    # Add distance statistics if we have interpolated triggers
    if (
        not interpolated_data.empty
        and "distance_from_prev" in interpolated_data.columns
    ):
        text += f"Min interpolated distance: {interpolated_data['distance_from_prev'].min():.1f}m\n"
        text += f"Avg interpolated distance: {interpolated_data['distance_from_prev'].mean():.1f}m\n"

    plt.text(
        0.02,
        0.98,
        text,
        transform=plt.gca().transAxes,
        verticalalignment="top",
        bbox=dict(boxstyle="round", facecolor="white", alpha=0.8),
    )

    plt.tight_layout()
    plt.savefig(output_plot, dpi=300, bbox_inches="tight")
    print(f"Plot saved to {output_plot}")


if __name__ == "__main__":
    main()
