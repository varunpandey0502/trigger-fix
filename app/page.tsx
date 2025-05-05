"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, FileIcon, MapPinIcon } from "lucide-react";
import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ComposedChart,
  Bar,
} from "recharts";
import { DEFAULT_CONFIG, ProcessingResults, TriggerFixer } from "../lib/core";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// Define the EventPoint interface
interface EventPoint {
  lat: number;
  lon: number;
  seconds: number;
  distance_from_prev?: number;
  index?: number;
}

export default function Home() {
  const [posFile, setPosFile] = useState<File | null>(null);
  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [processing, setProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<ProcessingResults | null>(null);
  const [triggerDistance, setTriggerDistance] = useState<number | null>(null);
  const [minDistance, setMinDistance] = useState<number | null>(null);

  // Initialize the TriggerFixer with default config
  const triggerFixer = new TriggerFixer({
    ...DEFAULT_CONFIG,
    threshold: triggerDistance,
  });

  const handlePosFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPosFile(e.target.files[0]);
      // Reset trigger distance when a new file is selected
      setTriggerDistance(null);
      setMinDistance(null);
    }
  };

  const handleEventsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setEventsFile(e.target.files[0]);
      // Reset trigger distance when a new file is selected
      setTriggerDistance(null);
      setMinDistance(null);
    }
  };

  const processFiles = async () => {
    if (!posFile || !eventsFile) {
      setStatus("Please select both position and events files.");
      return;
    }

    setProcessing(true);
    setStatus("Processing files...");

    try {
      // Read file contents
      const posFileContent = await readFileAsText(posFile);
      const eventsFileContent = await readFileAsText(eventsFile);

      setStatus("Parsing position data...");

      // Process the files using our TriggerFixer
      const results = await triggerFixer.processFiles(
        posFileContent,
        eventsFileContent,
        triggerDistance ?? undefined
      );

      // Set the minimum distance if it's not already set
      if (results.stats.minDistance && !triggerDistance) {
        setMinDistance(results.stats.minDistance);
        setTriggerDistance(results.stats.minDistance);
      }

      setResults(results);
      setStatus(
        `Processing complete! Found ${results.interpolatedData.length} interpolated triggers.`
      );
    } catch (error) {
      setStatus(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setProcessing(false);
    }
  };

  // Helper function to read file as text
  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const exportCsv = () => {
    if (!results) return;

    // Format the interpolated data as CSV
    const csvContent = triggerFixer.formatForCsvExport(
      results.interpolatedData
    );

    // Create a blob and download link
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "interpolated_triggers.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportEvents = () => {
    if (!results) return;

    // Format the combined events data
    const eventsContent = triggerFixer.formatForEventsExport(
      results.eventsData,
      results.interpolatedData
    );

    // Create a blob and download link
    const blob = new Blob([eventsContent], {
      type: "text/plain;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "combined_events.pos");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const savePlot = () => {
    if (!results) return;

    // This would require a library like html2canvas
    alert(
      "To implement plot saving, you would need to use a library like html2canvas to capture the chart as an image."
    );
  };

  // Add this function to prepare data for Recharts
  const prepareDataForChart = (data: any[]) => {
    // Make sure each point has lat and lon as numbers
    return data.map((point) => ({
      ...point,
      lat: typeof point.lat === "number" ? point.lat : 0,
      lon: typeof point.lon === "number" ? point.lon : 0,
    }));
  };

  // Add this new component to visualize trigger distances
  const DistancePlot = ({ eventsData }: { eventsData: EventPoint[] }) => {
    // Sort events by time
    const sortedEvents = [...eventsData].sort((a, b) => a.seconds - b.seconds);

    // Calculate distances between consecutive triggers
    const distanceData = [];
    for (let i = 1; i < sortedEvents.length; i++) {
      const prev = sortedEvents[i - 1];
      const curr = sortedEvents[i];

      distanceData.push({
        index: i,
        seconds: curr.seconds,
        distance: curr.distance_from_prev || 0,
      });
    }

    return (
      <div className="h-[300px] border rounded-md p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={distanceData}
            margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="index"
              label={{ value: "Trigger Index", position: "bottom" }}
            />
            <YAxis
              label={{ value: "Distance (m)", angle: -90, position: "left" }}
              domain={["dataMin", "dataMax"]}
            />
            <Tooltip
              formatter={(value: any) => [`${value.toFixed(2)} m`, "Distance"]}
            />
            <Line
              type="monotone"
              dataKey="distance"
              stroke="#ff7300"
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
            {/* Add a reference line at 20m (our current threshold) */}
            <ReferenceLine y={20} stroke="red" strokeDasharray="3 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Add this handler for the input change
  const handleTriggerDistanceChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;
    if (value === "") {
      setTriggerDistance(null);
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        setTriggerDistance(numValue);
      }
    }
  };

  // Add this handler to reset to minimum
  const resetToMinimum = () => {
    if (minDistance) {
      setTriggerDistance(minDistance);
    }
  };

  // Add this new component to visualize the distance distribution
  const DistanceDistribution = ({
    eventsData,
  }: {
    eventsData: EventPoint[];
  }) => {
    // Extract distances between consecutive triggers
    const rawDistances = eventsData
      .filter((event) => event.distance_from_prev !== undefined)
      .map((event) => event.distance_from_prev!);

    if (rawDistances.length === 0) return <div>No distance data available</div>;

    // Round distances to whole numbers for better binning
    const distances = rawDistances.map((d) => Math.round(d));

    // Calculate statistics
    const min = Math.min(...distances);
    const max = Math.max(...distances);
    const mean =
      distances.reduce((sum, val) => sum + val, 0) / distances.length;

    // Calculate standard deviation
    const variance =
      distances.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      distances.length;
    const stdDev = Math.sqrt(variance);

    // Create histogram with integer bins
    // Instead of dividing into equal width bins, use integer bins
    const binMap = new Map<number, number>();

    // Count occurrences of each rounded distance
    distances.forEach((distance) => {
      binMap.set(distance, (binMap.get(distance) || 0) + 1);
    });

    // Convert map to array of bin data
    const histogramData = Array.from(binMap.entries())
      .map(([distance, count]) => ({ distance, count }))
      .sort((a, b) => a.distance - b.distance);

    // Create normal distribution curve data
    const curvePoints = 50;
    const curveData = Array(curvePoints)
      .fill(0)
      .map((_, index) => {
        const x = min + (max - min) * (index / (curvePoints - 1));
        // Normal distribution formula
        const y =
          (1 / (stdDev * Math.sqrt(2 * Math.PI))) *
          Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2)) *
          distances.length; // Scale to match histogram
        return { distance: x, normalValue: y };
      });

    return (
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={histogramData}
            margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="distance"
              label={{ value: "Distance (m)", position: "bottom" }}
              domain={[min - 1, max + 1]}
              tickCount={Math.min(20, max - min + 1)}
              type="number"
            />
            <YAxis
              label={{ value: "Frequency", angle: -90, position: "insideLeft" }}
            />
            <Tooltip formatter={(value: any) => [value, ""]} />
            <Legend />
            <Bar dataKey="count" fill="#8884d8" name="Frequency" />
            <Line
              data={curveData}
              type="monotone"
              dataKey="normalValue"
              stroke="#ff7300"
              dot={false}
              name="Normal Distribution"
            />
            <ReferenceLine
              x={mean}
              stroke="green"
              strokeDasharray="3 3"
              label={{ value: `Mean: ${mean.toFixed(1)}m`, position: "top" }}
            />
            <ReferenceLine
              x={Math.round(mean + stdDev)}
              stroke="blue"
              strokeDasharray="3 3"
              label={{
                value: `+1σ: ${(mean + stdDev).toFixed(1)}m`,
                position: "top",
              }}
            />
            <ReferenceLine
              x={Math.round(mean - stdDev)}
              stroke="blue"
              strokeDasharray="3 3"
              label={{
                value: `-1σ: ${(mean - stdDev).toFixed(1)}m`,
                position: "top",
              }}
            />
            {triggerDistance && (
              <ReferenceLine
                x={triggerDistance}
                stroke="red"
                strokeDasharray="3 3"
                label={{
                  value: `Threshold: ${triggerDistance.toFixed(1)}m`,
                  position: "top",
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">Trigger Fix Tool</h1>

      <div className="grid grid-cols-1 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileIcon className="h-5 w-5" />
              File Selection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Position File (.pos):
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById("posFile")?.click()}
                  >
                    Browse...
                  </Button>
                  <span className="text-sm truncate max-w-[200px]">
                    {posFile ? posFile.name : "No file selected"}
                  </span>
                  <input
                    type="file"
                    id="posFile"
                    accept=".pos"
                    className="hidden"
                    onChange={handlePosFileChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Events File (_events.pos):
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      document.getElementById("eventsFile")?.click()
                    }
                  >
                    Browse...
                  </Button>
                  <span className="text-sm truncate max-w-[200px]">
                    {eventsFile ? eventsFile.name : "No file selected"}
                  </span>
                  <input
                    type="file"
                    id="eventsFile"
                    accept=".pos"
                    className="hidden"
                    onChange={handleEventsFileChange}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Button
                onClick={processFiles}
                disabled={!posFile || !eventsFile || processing}
                className="w-full md:w-auto"
              >
                {processing ? "Processing..." : "Process Files"}
              </Button>
            </div>

            <div className="mt-4">
              <Alert variant="default">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Status</AlertTitle>
                <AlertDescription>{status}</AlertDescription>
              </Alert>
            </div>

            <div className="space-y-2 mt-4">
              <div className="flex justify-between items-center">
                <Label htmlFor="trigger-distance">
                  Estimated Trigger Distance (meters)
                </Label>
                {minDistance && (
                  <div className="text-xs text-muted-foreground">
                    Minimum: {minDistance.toFixed(2)}m
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="trigger-distance"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={triggerDistance || ""}
                  onChange={handleTriggerDistanceChange}
                  placeholder="Enter trigger distance"
                  className="w-full"
                />
                {minDistance && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetToMinimum}
                    title="Reset to minimum distance"
                  >
                    Reset
                  </Button>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Distances greater than this value will trigger interpolation
              </div>
            </div>
          </CardContent>
        </Card>

        {results && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPinIcon className="h-5 w-5" />
                Trigger Visualization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="map">
                <TabsList className="mb-4">
                  <TabsTrigger value="map">Map View</TabsTrigger>
                  <TabsTrigger value="distances">Trigger Distances</TabsTrigger>
                  <TabsTrigger value="stats">Statistics</TabsTrigger>
                </TabsList>

                <TabsContent value="map" className="space-y-4">
                  <div className="h-[500px] border rounded-md p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart
                        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                      >
                        <CartesianGrid />
                        <XAxis
                          type="number"
                          dataKey="lon"
                          name="Longitude"
                          unit="°"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(value) => value.toFixed(2)}
                        />
                        <YAxis
                          type="number"
                          dataKey="lat"
                          name="Latitude"
                          unit="°"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(value) => value.toFixed(2)}
                        />
                        <ZAxis range={[50, 50]} />
                        <Tooltip
                          cursor={{ strokeDasharray: "3 3" }}
                          formatter={(value: any) => [value.toFixed(6), ""]}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-2 border rounded shadow-sm">
                                  <p className="font-bold">{`Trigger ${
                                    data.index || "N/A"
                                  }`}</p>
                                  <p>{`Latitude: ${data.lat.toFixed(6)}°`}</p>
                                  <p>{`Longitude: ${data.lon.toFixed(6)}°`}</p>
                                  {data.distance_from_prev !== undefined && (
                                    <p>{`Distance: ${data.distance_from_prev.toFixed(
                                      2
                                    )}m`}</p>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend />

                        {/* Original triggers with index */}
                        <Scatter
                          name="Original Triggers"
                          data={prepareDataForChart(results.eventsData).map(
                            (point, idx) => ({
                              ...point,
                              index: idx + 1,
                            })
                          )}
                          fill={DEFAULT_CONFIG.triggerColor}
                          shape="star"
                          isAnimationActive={false}
                          label={(props) => {
                            const { x, y, index } = props;
                            return (
                              <text
                                x={x}
                                y={y}
                                dy={-10}
                                fontSize={10}
                                textAnchor="middle"
                                fill="#666"
                              >
                                {index}
                              </text>
                            );
                          }}
                        />

                        {/* Interpolated triggers */}
                        <Scatter
                          name="Interpolated Triggers"
                          data={prepareDataForChart(results.interpolatedData)}
                          fill={DEFAULT_CONFIG.interpolatedColor}
                          shape="diamond"
                          isAnimationActive={false}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={savePlot}>Save Plot</Button>
                    <Button
                      onClick={exportCsv}
                      variant="outline"
                      disabled={results.interpolatedData.length === 0}
                    >
                      Export Interpolated Triggers (CSV)
                    </Button>
                    <Button
                      onClick={exportEvents}
                      variant="outline"
                      disabled={results.interpolatedData.length === 0}
                    >
                      Export Combined Events File
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="distances" className="space-y-4">
                  <DistancePlot eventsData={results.eventsData} />
                  <div className="text-sm text-muted-foreground mt-2 mb-4">
                    This chart shows the distance between consecutive triggers.
                    The red line indicates the threshold distance used for
                    detecting missing triggers.
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Distance Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DistanceDistribution eventsData={results.eventsData} />
                      <div className="text-sm text-muted-foreground mt-2">
                        This histogram shows the distribution of distances
                        between consecutive triggers. The curve represents the
                        normal distribution based on the data.
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="stats">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">
                          Flight Statistics
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="space-y-2">
                          <div className="flex justify-between">
                            <dt>Total flight points:</dt>
                            <dd>
                              <Badge variant="outline">
                                {results.stats.totalPoints}
                              </Badge>
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt>Original triggers:</dt>
                            <dd>
                              <Badge variant="outline">
                                {results.stats.originalTriggers}
                              </Badge>
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt>Interpolated triggers:</dt>
                            <dd>
                              <Badge variant="secondary">
                                {results.stats.interpolatedTriggers}
                              </Badge>
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt>Flight duration:</dt>
                            <dd>
                              <Badge variant="outline">
                                {results.stats.flightDuration.toFixed(1)}s
                              </Badge>
                            </dd>
                          </div>
                        </dl>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">
                          Interpolation Statistics
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="space-y-2">
                          {results.stats.minDistance && (
                            <div className="flex justify-between">
                              <dt>Min interpolated distance:</dt>
                              <dd>
                                <Badge variant="outline">
                                  {results.stats.minDistance.toFixed(1)}m
                                </Badge>
                              </dd>
                            </div>
                          )}
                          {results.stats.avgDistance && (
                            <div className="flex justify-between">
                              <dt>Avg interpolated distance:</dt>
                              <dd>
                                <Badge variant="outline">
                                  {results.stats.avgDistance.toFixed(1)}m
                                </Badge>
                              </dd>
                            </div>
                          )}
                          {!results.stats.minDistance && (
                            <div className="text-muted-foreground">
                              No interpolated triggers found
                            </div>
                          )}
                        </dl>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
