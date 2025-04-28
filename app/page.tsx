"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InfoIcon, FileIcon, MapPinIcon, AlertCircle } from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  ResponsiveContainer,
  ZAxis,
} from "recharts";
import {
  TriggerFixer,
  DEFAULT_CONFIG,
  ProcessingResults,
} from "./_components/core";

export default function Home() {
  const [posFile, setPosFile] = useState<File | null>(null);
  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [processing, setProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<ProcessingResults | null>(null);

  // Initialize the TriggerFixer with default config
  const triggerFixer = new TriggerFixer();

  const handlePosFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPosFile(e.target.files[0]);
    }
  };

  const handleEventsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setEventsFile(e.target.files[0]);
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
        eventsFileContent
      );

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
              <Alert variant="outline">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Status</AlertTitle>
                <AlertDescription>{status}</AlertDescription>
              </Alert>
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
                        />
                        <Legend />

                        {/* Original triggers */}
                        <Scatter
                          name="Original Triggers"
                          data={prepareDataForChart(results.eventsData)}
                          fill={DEFAULT_CONFIG.triggerColor}
                          shape="star"
                          isAnimationActive={false}
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
