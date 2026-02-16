import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CloudSun,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";

export type WeatherMode =
  | "storm_damage"
  | "lawn_care"
  | "construction"
  | "general";

export interface WeatherStatus {
  enabled: boolean;
  reason?: "missing_api_key" | "invalid_api_key" | "api_unreachable";
  has_cached_data: boolean;
  last_refresh_ts?: string | null;
}

export interface WeatherLocation {
  city: string;
  state?: string | null;
  country: string;
  lat: number;
  lon: number;
}

export interface WeatherSettings {
  mode: WeatherMode;
  location: WeatherLocation | null;
  cache_ttl_minutes: number;
  updated_at: string;
}

interface WeatherCurrent {
  observed_ts?: number;
  temp_f?: number;
  feels_like_f?: number;
  humidity_pct?: number;
  wind_mph?: number;
  wind_gust_mph?: number;
  precip_in?: number;
  condition_main?: string;
  condition_desc?: string;
}

interface WeatherForecastDay {
  date: string;
  temp_min_f?: number;
  temp_max_f?: number;
  temp_avg_f?: number;
  wind_max_mph?: number;
  precip_total_in?: number;
  precip_prob_avg?: number;
  confidence_score?: number;
  condition_main?: string;
  condition_desc?: string;
}

interface WeatherForecastPoint {
  forecast_ts: string;
  temp_f?: number;
  wind_mph?: number;
  precip_in?: number;
  condition_main?: string;
  condition_desc?: string;
}

interface WeatherAlert {
  event?: string | null;
  severity?: string | null;
  sender_name?: string | null;
  start_ts?: string | null;
  end_ts?: string | null;
  description?: string | null;
}

export interface WeatherPrediction {
  id: string;
  created_at: string;
  mode: WeatherMode;
  target_date: string;
  integrity: number;
  resilience: number;
  meaning: number;
  cci_score: number;
  probability: number;
  prediction_text: string;
}

interface CoherenceScore {
  integrity: number;
  resilience: number;
  meaning: number;
  cci: number;
}

export interface WeatherDashboardResponse {
  location: WeatherLocation;
  mode: WeatherMode;
  current: WeatherCurrent | null;
  forecast_daily: WeatherForecastDay[];
  forecast_3h: WeatherForecastPoint[];
  alerts: WeatherAlert[];
  coherence: CoherenceScore;
  predictions: WeatherPrediction[];
  insights: string[];
  cache_age_seconds?: number | null;
  source?: "cache" | "live";
  stale?: boolean;
  warning?: string | null;
}

interface WeatherLocationCandidate {
  name: string;
  state?: string | null;
  country: string;
  lat: number;
  lon: number;
}

interface WeatherTabProps {
  backendBaseUrl?: string;
}

const MODE_OPTIONS: { id: WeatherMode; label: string }[] = [
  { id: "storm_damage", label: "Storm Damage" },
  { id: "lawn_care", label: "Lawn Care" },
  { id: "construction", label: "Construction" },
  { id: "general", label: "General" },
];

const formatEpoch = (value?: string | number | null): string => {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }

  const asNumber =
    typeof value === "number"
      ? value
      : Number.isFinite(Number(value))
        ? Number(value)
        : NaN;

  let date: Date;
  if (Number.isFinite(asNumber)) {
    date = new Date(asNumber * 1000);
  } else {
    date = new Date(String(value));
  }

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
};

const scoreBarClass = (score: number): string => {
  if (score >= 75) {
    return "bg-emerald-500";
  }
  if (score >= 55) {
    return "bg-amber-500";
  }
  return "bg-rose-500";
};

const WeatherTab = ({ backendBaseUrl = "http://localhost:8090" }: WeatherTabProps) => {
  const [status, setStatus] = useState<WeatherStatus | null>(null);
  const [settings, setSettings] = useState<WeatherSettings | null>(null);
  const [dashboard, setDashboard] = useState<WeatherDashboardResponse | null>(null);
  const [candidates, setCandidates] = useState<WeatherLocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [modeInput, setModeInput] = useState<WeatherMode>("general");
  const [cityInput, setCityInput] = useState("");
  const [stateInput, setStateInput] = useState("");
  const [countryInput, setCountryInput] = useState("US");

  const applyLocationForm = useCallback((location: WeatherLocation | null) => {
    if (!location) {
      return;
    }
    setCityInput(location.city || "");
    setStateInput(location.state || "");
    setCountryInput(location.country || "US");
  }, []);

  const loadWeatherStatus = useCallback(async (): Promise<WeatherStatus> => {
    const response = await fetch(`${backendBaseUrl}/weather/status`);
    if (!response.ok) {
      throw new Error("Weather status unavailable");
    }
    const body = (await response.json()) as WeatherStatus;
    setStatus(body);
    return body;
  }, [backendBaseUrl]);

  const loadWeatherSettings = useCallback(async (): Promise<WeatherSettings> => {
    const response = await fetch(`${backendBaseUrl}/weather/settings`);
    if (!response.ok) {
      throw new Error("Weather settings unavailable");
    }
    const body = (await response.json()) as WeatherSettings;
    setSettings(body);
    setModeInput(body.mode);
    applyLocationForm(body.location);
    return body;
  }, [applyLocationForm, backendBaseUrl]);

  const loadDashboard = useCallback(
    async (showToast = false): Promise<WeatherDashboardResponse | null> => {
      try {
        const response = await fetch(`${backendBaseUrl}/weather/dashboard`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const detail = body.detail || "Weather dashboard unavailable.";
          throw new Error(detail);
        }
        const payload = (await response.json()) as WeatherDashboardResponse;
        setDashboard(payload);
        setErrorMessage(null);
        return payload;
      } catch (error) {
        const text =
          error instanceof Error
            ? error.message
            : "Weather dashboard unavailable.";
        setDashboard(null);
        setErrorMessage(text);
        if (showToast) {
          toast({
            variant: "destructive",
            title: "Could not load weather",
            description: text,
          });
        }
        return null;
      }
    },
    [backendBaseUrl],
  );

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextStatus, nextSettings] = await Promise.all([
        loadWeatherStatus(),
        loadWeatherSettings(),
      ]);

      if (nextStatus.enabled && nextSettings.location) {
        await loadDashboard(false);
      } else {
        setDashboard(null);
      }
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Weather setup unavailable.";
      setErrorMessage(text);
    } finally {
      setIsLoading(false);
    }
  }, [loadDashboard, loadWeatherSettings, loadWeatherStatus]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleResolve = async () => {
    const city = cityInput.trim();
    if (!city) {
      toast({
        variant: "destructive",
        title: "City required",
        description: "Enter a city before searching for a location.",
      });
      return;
    }

    setIsResolving(true);
    try {
      const params = new URLSearchParams();
      params.set("city", city);
      if (stateInput.trim()) {
        params.set("state", stateInput.trim());
      }
      params.set("country", countryInput.trim() || "US");

      const response = await fetch(
        `${backendBaseUrl}/weather/resolve-location?${params.toString()}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Location search failed.");
      }

      const body = await response.json();
      const next = (body.results || []) as WeatherLocationCandidate[];
      setCandidates(next);
      if (next.length === 0) {
        toast({
          title: "No matches found",
          description: "Try a more specific city/state combination.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not resolve location",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const handleSaveSettings = async () => {
    const city = cityInput.trim();
    if (!city) {
      toast({
        variant: "destructive",
        title: "City required",
        description: "Enter a city before saving weather settings.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${backendBaseUrl}/weather/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: modeInput,
          city,
          state: stateInput.trim() || undefined,
          country: (countryInput.trim() || "US").toUpperCase(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to save weather settings.");
      }

      const body = (await response.json()) as WeatherSettings;
      setSettings(body);
      setModeInput(body.mode);
      applyLocationForm(body.location);
      setCandidates([]);
      await Promise.all([loadWeatherStatus(), loadDashboard(false)]);
      toast({
        title: "Weather settings saved",
        description: "Location and tracking mode were updated.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save weather settings",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`${backendBaseUrl}/weather/refresh`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Weather refresh failed.");
      }

      await Promise.all([loadWeatherStatus(), loadWeatherSettings(), loadDashboard(false)]);
      toast({
        title: "Weather refreshed",
        description: "Current conditions and predictions are up to date.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not refresh weather",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const chartData = useMemo(() => {
    return (dashboard?.forecast_daily || []).map((day) => ({
      day: day.date
        ? new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : day.date,
      temp: Number(day.temp_avg_f || day.temp_max_f || 0),
      precip: Number(day.precip_total_in || 0),
      wind: Number(day.wind_max_mph || 0),
    }));
  }, [dashboard]);

  const cci = Number(dashboard?.coherence?.cci || 0);

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Weather</h2>
          <p className="text-sm text-muted-foreground">
            OpenWeather tracking with coherence scoring and predictive insights.
          </p>
          {status?.last_refresh_ts ? (
            <p className="text-xs text-muted-foreground mt-1">
              Last refresh: {formatEpoch(status.last_refresh_ts)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void handleManualRefresh();
          }}
          disabled={isLoading || isSaving || isRefreshing || !settings?.location}
        >
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh weather"}
        </Button>
      </div>

      {status && !status.enabled ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Weather integration is unavailable ({status.reason || "disabled"}).
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">Tracking setup</h3>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-1 space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="weather-mode">
              Tracking mode
            </label>
            <select
              id="weather-mode"
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              value={modeInput}
              onChange={(event) => setModeInput(event.target.value as WeatherMode)}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1 space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="weather-city">
              City
            </label>
            <Input
              id="weather-city"
              value={cityInput}
              onChange={(event) => setCityInput(event.target.value)}
              placeholder="Austin"
            />
          </div>

          <div className="md:col-span-1 space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="weather-state">
              State
            </label>
            <Input
              id="weather-state"
              value={stateInput}
              onChange={(event) => setStateInput(event.target.value)}
              placeholder="TX"
            />
          </div>

          <div className="md:col-span-1 space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="weather-country">
              Country
            </label>
            <Input
              id="weather-country"
              value={countryInput}
              onChange={(event) => setCountryInput(event.target.value.toUpperCase())}
              placeholder="US"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void handleResolve();
            }}
            disabled={isResolving || isSaving}
          >
            <Search className="w-4 h-4 mr-1.5" />
            {isResolving ? "Searching..." : "Find city"}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSaveSettings();
            }}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save weather settings"}
          </Button>
        </div>

        {candidates.length > 0 ? (
          <div className="rounded-md border border-vesta-header-border bg-background p-2.5 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Location matches
            </p>
            {candidates.map((candidate, index) => (
              <button
                key={`${candidate.name}-${candidate.lat}-${candidate.lon}-${index}`}
                type="button"
                className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  setCityInput(candidate.name);
                  setStateInput(candidate.state || "");
                  setCountryInput(candidate.country || "US");
                  setCandidates([]);
                }}
              >
                {candidate.name}
                {candidate.state ? `, ${candidate.state}` : ""}, {candidate.country}
              </button>
            ))}
          </div>
        ) : null}

        {settings?.location ? (
          <p className="text-xs text-muted-foreground">
            Active location: {settings.location.city}
            {settings.location.state ? `, ${settings.location.state}` : ""},{" "}
            {settings.location.country} ({settings.location.lat.toFixed(3)},{" "}
            {settings.location.lon.toFixed(3)})
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Set a city to enable weather tracking and predictions.
          </p>
        )}
      </section>

      {dashboard ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-vesta-header-border bg-card p-4">
              <div className="flex items-center gap-2">
                <CloudSun className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">
                  Current conditions
                </h3>
              </div>
              {dashboard.current ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <p>
                    Temp:{" "}
                    <span className="font-medium">
                      {Math.round(dashboard.current.temp_f || 0)}F
                    </span>
                  </p>
                  <p>
                    Feels like:{" "}
                    <span className="font-medium">
                      {Math.round(dashboard.current.feels_like_f || 0)}F
                    </span>
                  </p>
                  <p>
                    Humidity:{" "}
                    <span className="font-medium">
                      {Math.round(dashboard.current.humidity_pct || 0)}%
                    </span>
                  </p>
                  <p>
                    Wind:{" "}
                    <span className="font-medium">
                      {Math.round(dashboard.current.wind_mph || 0)} mph
                    </span>
                  </p>
                  <p>
                    Precip:{" "}
                    <span className="font-medium">
                      {(dashboard.current.precip_in || 0).toFixed(2)} in
                    </span>
                  </p>
                  <p>
                    Condition:{" "}
                    <span className="font-medium">
                      {dashboard.current.condition_desc ||
                        dashboard.current.condition_main ||
                        "Unknown"}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-3">
                  Current weather is unavailable.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-3">
              <h3 className="text-base font-semibold text-foreground">
                Coherence score
              </h3>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">CCI</span>
                  <span className="font-semibold text-foreground">
                    {cci.toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${scoreBarClass(cci)}`}
                    style={{ width: `${Math.max(0, Math.min(cci, 100))}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-border px-2 py-1.5">
                  <p className="text-muted-foreground">Integrity</p>
                  <p className="font-medium text-foreground">
                    {Number(dashboard.coherence.integrity || 0).toFixed(1)}
                  </p>
                </div>
                <div className="rounded border border-border px-2 py-1.5">
                  <p className="text-muted-foreground">Resilience</p>
                  <p className="font-medium text-foreground">
                    {Number(dashboard.coherence.resilience || 0).toFixed(1)}
                  </p>
                </div>
                <div className="rounded border border-border px-2 py-1.5">
                  <p className="text-muted-foreground">Meaning</p>
                  <p className="font-medium text-foreground">
                    {Number(dashboard.coherence.meaning || 0).toFixed(1)}
                  </p>
                </div>
              </div>
              {dashboard.stale ? (
                <p className="text-xs text-amber-600">
                  Showing cached weather data (provider unavailable).
                </p>
              ) : null}
              {dashboard.warning ? (
                <p className="text-xs text-amber-600">
                  Warning: {dashboard.warning}
                </p>
              ) : null}
            </section>
          </div>

          <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-3">
            <h3 className="text-base font-semibold text-foreground">5-day forecast</h3>
            {chartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis yAxisId="temp" unit="F" />
                    <YAxis yAxisId="precip" orientation="right" unit="in" />
                    <Tooltip />
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="temp"
                      name="Temp (F)"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      yAxisId="precip"
                      type="monotone"
                      dataKey="precip"
                      name="Precip (in)"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Forecast data is unavailable for this location.
              </p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-2">
              <h3 className="text-base font-semibold text-foreground">
                Prediction timeline
              </h3>
              {dashboard.predictions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No predictions available yet.
                </p>
              ) : (
                dashboard.predictions.slice(0, 5).map((prediction) => (
                  <div
                    key={prediction.id}
                    className="rounded border border-border px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">
                      {prediction.prediction_text}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Target date: {prediction.target_date} | Coherence{" "}
                      {Number(prediction.cci_score || 0).toFixed(1)}
                    </p>
                  </div>
                ))
              )}
            </section>

            <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-2">
              <h3 className="text-base font-semibold text-foreground">
                Severe alerts
              </h3>
              {dashboard.alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active weather alerts.
                </p>
              ) : (
                dashboard.alerts.map((alert, index) => (
                  <div
                    key={`${alert.event}-${alert.start_ts}-${index}`}
                    className="rounded border border-amber-300/50 bg-amber-100/20 px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      {alert.event || "Weather alert"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Severity: {alert.severity || "unknown"} | Start:{" "}
                      {formatEpoch(alert.start_ts)}
                    </p>
                    {alert.description ? (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                        {alert.description}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </section>
          </div>

          <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-2">
            <h3 className="text-base font-semibold text-foreground">Mode insights</h3>
            {dashboard.insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No insights available yet.
              </p>
            ) : (
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
                {dashboard.insights.map((insight, index) => (
                  <li key={`${insight}-${index}`}>{insight}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};

export default WeatherTab;
