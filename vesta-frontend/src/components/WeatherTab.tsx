import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CloudSun,
  Droplets,
  MapPin,
  RefreshCw,
  Search,
  Wind,
} from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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

interface TodayWeatherViewModel {
  headlineTempF: number | null;
  condition: string;
  feelsLikeF: number | null;
  highF: number | null;
  lowF: number | null;
  windMph: number | null;
  humidityPct: number | null;
  precipIn: number | null;
}

interface HourlyForecastViewModel {
  id: string;
  hourLabel: string;
  tempF: number | null;
  condition: string;
  precipIn: number;
  windMph: number | null;
}

interface DailyForecastViewModel {
  id: string;
  dayLabel: string;
  dateLabel: string;
  condition: string;
  highF: number | null;
  lowF: number | null;
  precipIn: number;
  precipChancePct: number;
  windMph: number | null;
}

interface AdvancedCoherenceViewModel {
  cci: number;
  integrity: number;
  resilience: number;
  meaning: number;
  modeLabel: string;
  modeExplanation: string;
}

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

const parseWeatherTimestamp = (value?: string | number | null): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric =
    typeof value === "number"
      ? value
      : Number.isFinite(Number(value))
        ? Number(value)
        : NaN;

  if (Number.isFinite(numeric)) {
    const date = new Date(numeric * 1000);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const formatNumeric = (value: number | null | undefined, digits = 0): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
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

const MODE_EXPLANATION: Record<WeatherMode, string> = {
  storm_damage:
    "Storm Damage mode weights wind severity, precipitation severity, and severe-alert signals most heavily.",
  lawn_care:
    "Lawn Care mode prioritizes moisture balance and ideal temperature windows for turf work.",
  construction:
    "Construction mode emphasizes weather-driven disruption risk from rain, wind, and temperature extremes.",
  general:
    "General mode balances weather significance across wind, precipitation, and temperature variance.",
};

const modeLabel = (mode: WeatherMode): string => {
  return MODE_OPTIONS.find((option) => option.id === mode)?.label || "General";
};

interface WeatherHeaderControlsProps {
  status: WeatherStatus | null;
  settings: WeatherSettings | null;
  modeInput: WeatherMode;
  isRefreshing: boolean;
  isSaving: boolean;
  isResolving: boolean;
  isLoading: boolean;
  cityInput: string;
  stateInput: string;
  countryInput: string;
  candidates: WeatherLocationCandidate[];
  isEditingLocation: boolean;
  isDetectingLocation: boolean;
  onToggleEditingLocation: () => void;
  onModeChange: (mode: WeatherMode) => void;
  onCityInputChange: (value: string) => void;
  onStateInputChange: (value: string) => void;
  onCountryInputChange: (value: string) => void;
  onResolveLocation: () => void;
  onUseCurrentLocation: () => void;
  onSaveSettings: () => void;
  onRefresh: () => void;
  onSelectCandidate: (candidate: WeatherLocationCandidate) => void;
}

const WeatherHeaderControls = ({
  status,
  settings,
  modeInput,
  isRefreshing,
  isSaving,
  isResolving,
  isLoading,
  cityInput,
  stateInput,
  countryInput,
  candidates,
  isEditingLocation,
  isDetectingLocation,
  onToggleEditingLocation,
  onModeChange,
  onCityInputChange,
  onStateInputChange,
  onCountryInputChange,
  onResolveLocation,
  onUseCurrentLocation,
  onSaveSettings,
  onRefresh,
  onSelectCandidate,
}: WeatherHeaderControlsProps) => {
  const location = settings?.location;
  const locationLabel = location
    ? `${location.city}${location.state ? `, ${location.state}` : ""}`
    : "Location not set";

  return (
    <section className="rounded-lg border border-vesta-header-border bg-card px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Weather</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {locationLabel}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {status?.last_refresh_ts
              ? `Updated ${formatEpoch(status.last_refresh_ts)}`
              : "No weather refresh yet"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="space-y-1">
            <label htmlFor="weather-mode-compact" className="sr-only">
              Tracking mode
            </label>
            <select
              id="weather-mode-compact"
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              value={modeInput}
              onChange={(event) => onModeChange(event.target.value as WeatherMode)}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleEditingLocation}
          >
            <MapPin className="w-3.5 h-3.5 mr-1.5" />
            {isEditingLocation ? "Hide location" : "Edit location"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading || isSaving || isRefreshing || !settings?.location}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {isEditingLocation ? (
        <div className="rounded-md border border-vesta-header-border bg-background p-3 space-y-2.5">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="weather-city" className="text-xs font-medium text-foreground">
                City
              </label>
              <Input
                id="weather-city"
                value={cityInput}
                onChange={(event) => onCityInputChange(event.target.value)}
                placeholder="Austin"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="weather-state" className="text-xs font-medium text-foreground">
                State
              </label>
              <Input
                id="weather-state"
                value={stateInput}
                onChange={(event) => onStateInputChange(event.target.value)}
                placeholder="TX"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="weather-country" className="text-xs font-medium text-foreground">
                Country
              </label>
              <Input
                id="weather-country"
                value={countryInput}
                onChange={(event) => onCountryInputChange(event.target.value.toUpperCase())}
                placeholder="US"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onResolveLocation}
              disabled={isResolving || isSaving}
            >
              <Search className="w-3.5 h-3.5 mr-1.5" />
              {isResolving ? "Searching..." : "Find city"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onUseCurrentLocation}
              disabled={isDetectingLocation || isSaving || isResolving}
            >
              <MapPin className={`w-3.5 h-3.5 mr-1.5 ${isDetectingLocation ? "animate-pulse" : ""}`} />
              {isDetectingLocation ? "Detecting..." : "Use current location"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSaveSettings}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>

          {candidates.length > 0 ? (
            <div className="rounded border border-vesta-header-border bg-card p-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Location matches
              </p>
              <div className="space-y-1">
                {candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.name}-${candidate.lat}-${candidate.lon}-${index}`}
                    type="button"
                    className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => onSelectCandidate(candidate)}
                  >
                    {candidate.name}
                    {candidate.state ? `, ${candidate.state}` : ""}, {candidate.country}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const TodayCard = ({ today }: { today: TodayWeatherViewModel | null }) => {
  if (!today) {
    return (
      <section className="rounded-lg border border-vesta-header-border bg-card p-4">
        <h3 className="text-base font-semibold text-foreground">Today</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Weather data is unavailable. Save a location and refresh.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-vesta-header-border bg-card p-4">
      <h3 className="text-base font-semibold text-foreground">Today</h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-md border border-border bg-background px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Current
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-semibold text-foreground">
              {today.headlineTempF === null
                ? "n/a"
                : `${Math.round(today.headlineTempF)}F`}
            </span>
            <span className="text-sm text-muted-foreground pb-1">
              {today.condition}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Feels like {formatNumeric(today.feelsLikeF)}F
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded border border-border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">High / Low</p>
            <p className="font-medium text-foreground">
              {formatNumeric(today.highF)}F / {formatNumeric(today.lowF)}F
            </p>
          </div>
          <div className="rounded border border-border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">Wind</p>
            <p className="font-medium text-foreground">
              {formatNumeric(today.windMph)} mph
            </p>
          </div>
          <div className="rounded border border-border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">Humidity</p>
            <p className="font-medium text-foreground">
              {formatNumeric(today.humidityPct)}%
            </p>
          </div>
          <div className="rounded border border-border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">Precipitation</p>
            <p className="font-medium text-foreground">
              {formatNumeric(today.precipIn, 2)} in
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

const HourlyStrip = ({ hourly }: { hourly: HourlyForecastViewModel[] }) => (
  <section className="rounded-lg border border-vesta-header-border bg-card p-4">
    <h3 className="text-base font-semibold text-foreground">Hourly (next 24h)</h3>
    {hourly.length === 0 ? (
      <p className="text-sm text-muted-foreground mt-2">
        Hourly forecast is unavailable.
      </p>
    ) : (
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {hourly.map((item) => (
          <div
            key={item.id}
            data-testid="hourly-item"
            className="min-w-[120px] rounded-md border border-border bg-background px-3 py-2 text-xs"
          >
            <p className="font-medium text-foreground">{item.hourLabel}</p>
            <p className="text-lg font-semibold text-foreground mt-1">
              {item.tempF === null ? "n/a" : `${Math.round(item.tempF)}F`}
            </p>
            <p className="text-muted-foreground truncate">{item.condition}</p>
            <p className="text-muted-foreground mt-1">
              {formatNumeric(item.precipIn, 2)} in
            </p>
          </div>
        ))}
      </div>
    )}
  </section>
);

const FiveDayForecast = ({ days }: { days: DailyForecastViewModel[] }) => (
  <section className="rounded-lg border border-vesta-header-border bg-card p-4">
    <h3 className="text-base font-semibold text-foreground">5-day forecast</h3>
    {days.length === 0 ? (
      <p className="text-sm text-muted-foreground mt-2">
        Forecast data is unavailable.
      </p>
    ) : (
      <div className="mt-3 divide-y divide-border rounded-md border border-border bg-background">
        {days.map((day) => (
          <div
            key={day.id}
            data-testid="daily-row"
            className="grid grid-cols-[90px_1fr_auto] items-center gap-3 px-3 py-2.5 text-sm"
          >
            <div>
              <p className="font-medium text-foreground">{day.dayLabel}</p>
              <p className="text-xs text-muted-foreground">{day.dateLabel}</p>
            </div>
            <div>
              <p className="text-foreground">{day.condition}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatNumeric(day.precipChancePct)}% chance • {formatNumeric(day.precipIn, 2)} in • {formatNumeric(day.windMph)} mph
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-foreground">
                {formatNumeric(day.highF)}F
              </p>
              <p className="text-xs text-muted-foreground">{formatNumeric(day.lowF)}F</p>
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);

const InsightsCard = ({
  predictions,
  insights,
}: {
  predictions: WeatherPrediction[];
  insights: string[];
}) => (
  <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-2">
    <h3 className="text-base font-semibold text-foreground">Insights</h3>
    {predictions.length === 0 && insights.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        No forecast insights available yet.
      </p>
    ) : (
      <div className="space-y-2">
        {predictions.slice(0, 5).map((prediction) => (
          <div
            key={prediction.id}
            data-testid="insight-prediction"
            className="rounded border border-border bg-background px-3 py-2"
          >
            <p className="text-sm font-medium text-foreground">
              {prediction.prediction_text}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Target: {prediction.target_date}
            </p>
          </div>
        ))}
        {insights.slice(0, 3).map((insight, index) => (
          <p key={`${insight}-${index}`} className="text-sm text-muted-foreground">
            {insight}
          </p>
        ))}
      </div>
    )}
  </section>
);

const AlertsCard = ({
  alerts,
  warning,
}: {
  alerts: WeatherAlert[];
  warning?: string | null;
}) => (
  <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-2">
    <h3 className="text-base font-semibold text-foreground">Alerts</h3>
    {alerts.length === 0 ? (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">No active weather alerts.</p>
        {warning && warning.toLowerCase().includes("alerts_unavailable") ? (
          <p className="text-xs text-amber-600">
            Alerts are unavailable for this OpenWeather plan. Current and forecast data are still shown.
          </p>
        ) : null}
      </div>
    ) : (
      alerts.map((alert, index) => (
        <div
          key={`${alert.event}-${alert.start_ts}-${index}`}
          className="rounded border border-amber-300/50 bg-amber-100/20 px-3 py-2"
        >
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            {alert.event || "Weather alert"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Severity: {alert.severity || "unknown"} | Start {formatEpoch(alert.start_ts)}
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
);

const AdvancedInsightsAccordion = ({
  advanced,
  source,
  stale,
  warning,
  mode,
}: {
  advanced: AdvancedCoherenceViewModel;
  source?: "cache" | "live";
  stale?: boolean;
  warning?: string | null;
  mode: WeatherMode;
}) => {
  const clampedCci = Math.max(0, Math.min(100, advanced.cci));
  return (
    <section className="rounded-lg border border-vesta-header-border bg-card px-4">
      <Accordion type="single" collapsible>
        <AccordionItem value="advanced" className="border-none">
          <AccordionTrigger className="py-3 no-underline hover:no-underline">
            <span className="font-semibold text-foreground">Advanced insights</span>
          </AccordionTrigger>
          <AccordionContent className="pt-1 space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">CCI</span>
                <span className="font-semibold text-foreground">
                  {advanced.cci.toFixed(1)}
                </span>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${scoreBarClass(advanced.cci)}`}
                  style={{ width: `${clampedCci}%` }}
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3 text-xs">
              <div className="rounded border border-border px-2 py-1.5 bg-background">
                <p className="text-muted-foreground">Integrity</p>
                <p className="font-medium text-foreground">{advanced.integrity.toFixed(1)}</p>
              </div>
              <div className="rounded border border-border px-2 py-1.5 bg-background">
                <p className="text-muted-foreground">Resilience</p>
                <p className="font-medium text-foreground">{advanced.resilience.toFixed(1)}</p>
              </div>
              <div className="rounded border border-border px-2 py-1.5 bg-background">
                <p className="text-muted-foreground">Meaning</p>
                <p className="font-medium text-foreground">{advanced.meaning.toFixed(1)}</p>
              </div>
            </div>

            <div className="rounded border border-border bg-background px-3 py-2 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Mode diagnostics
              </p>
              <p className="text-foreground mt-1">
                {advanced.modeLabel}: {advanced.modeExplanation}
              </p>
            </div>

            <div className="rounded border border-border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1">
              <p>Data source: {source || "unknown"}</p>
              <p>Cache state: {stale ? "stale" : "fresh"}</p>
              {warning ? <p>Provider warning: {warning}</p> : null}
              <p>Mode key: {mode}</p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
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
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);

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

  const handleUseCurrentLocation = async () => {
    setIsDetectingLocation(true);
    try {
      const response = await fetch("https://ipapi.co/json/");
      if (!response.ok) {
        throw new Error("Location detection service unavailable.");
      }
      const data = await response.json();

      // ipapi.co fields: city, region_code, country_code
      if (data.city) {
        setCityInput(data.city);
      }
      if (data.region_code) {
        setStateInput(data.region_code);
      }
      if (data.country_code) {
        setCountryInput(data.country_code);
      }

      setIsEditingLocation(true);

      toast({
        title: "Location detected",
        description: `Set to ${data.city}${data.region_code ? `, ${data.region_code}` : ""}. Click Save to update weather.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not detect location",
        description: error instanceof Error ? error.message : "IP geolocation failed.",
      });
    } finally {
      setIsDetectingLocation(false);
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
      setIsEditingLocation(false);
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
    return (dashboard?.forecast_daily || [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5)
      .map((day) => {
        const date = new Date(`${day.date}T00:00:00`);
        return {
          id: day.date,
          dayLabel: Number.isNaN(date.getTime())
            ? day.date
            : date.toLocaleDateString(undefined, { weekday: "short" }),
          dateLabel: Number.isNaN(date.getTime())
            ? day.date
            : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          condition: day.condition_desc || day.condition_main || "Unknown",
          highF: day.temp_max_f ?? null,
          lowF: day.temp_min_f ?? null,
          precipIn: Number(day.precip_total_in || 0),
          precipChancePct: Number((day.precip_prob_avg || 0) * 100),
          windMph: day.wind_max_mph ?? null,
          tempAvgF: day.temp_avg_f ?? null,
        };
      });
  }, [dashboard]);

  const hourly24 = useMemo<HourlyForecastViewModel[]>(() => {
    return (dashboard?.forecast_3h || [])
      .map((point, index) => {
        const timestamp = parseWeatherTimestamp(point.forecast_ts);
        return {
          id: `${point.forecast_ts}-${index}`,
          hourLabel: timestamp
            ? timestamp.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })
            : "n/a",
          tempF: point.temp_f ?? null,
          condition: point.condition_desc || point.condition_main || "Unknown",
          precipIn: Number(point.precip_in || 0),
          windMph: point.wind_mph ?? null,
          sortValue: timestamp ? timestamp.getTime() : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => a.sortValue - b.sortValue)
      .slice(0, 8)
      .map(({ sortValue, ...item }) => item);
  }, [dashboard]);

  const today = useMemo<TodayWeatherViewModel | null>(() => {
    if (!dashboard) {
      return null;
    }
    const firstDay = chartData[0];
    const current = dashboard.current;
    if (!current && !firstDay) {
      return null;
    }

    return {
      headlineTempF: current?.temp_f ?? firstDay?.tempAvgF ?? firstDay?.highF ?? null,
      condition:
        current?.condition_desc ||
        current?.condition_main ||
        firstDay?.condition ||
        "Unknown",
      feelsLikeF: current?.feels_like_f ?? current?.temp_f ?? firstDay?.tempAvgF ?? null,
      highF: firstDay?.highF ?? null,
      lowF: firstDay?.lowF ?? null,
      windMph: current?.wind_mph ?? firstDay?.windMph ?? null,
      humidityPct: current?.humidity_pct ?? null,
      precipIn: current?.precip_in ?? firstDay?.precipIn ?? null,
    };
  }, [chartData, dashboard]);

  const insightItems = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    return [...dashboard.predictions]
      .sort((a, b) => a.target_date.localeCompare(b.target_date))
      .map((item) => ({
        ...item,
        prediction_text: item.prediction_text.trim(),
      }));
  }, [dashboard]);

  const advancedCoherence = useMemo<AdvancedCoherenceViewModel>(() => {
    const coherence = dashboard?.coherence;
    const mode = (dashboard?.mode || modeInput) as WeatherMode;
    return {
      cci: Number(coherence?.cci || 0),
      integrity: Number(coherence?.integrity || 0),
      resilience: Number(coherence?.resilience || 0),
      meaning: Number(coherence?.meaning || 0),
      modeLabel: modeLabel(mode),
      modeExplanation: MODE_EXPLANATION[mode],
    };
  }, [dashboard, modeInput]);

  return (
    <div className="max-w-5xl mx-auto w-full px-6 py-6 space-y-5">
      <WeatherHeaderControls
        status={status}
        settings={settings}
        modeInput={modeInput}
        isRefreshing={isRefreshing}
        isSaving={isSaving}
        isResolving={isResolving}
        isLoading={isLoading}
        cityInput={cityInput}
        stateInput={stateInput}
        countryInput={countryInput}
        candidates={candidates}
        isEditingLocation={isEditingLocation}
        isDetectingLocation={isDetectingLocation}
        onToggleEditingLocation={() => {
          setIsEditingLocation((previous) => !previous);
          setCandidates([]);
        }}
        onModeChange={setModeInput}
        onCityInputChange={setCityInput}
        onStateInputChange={setStateInput}
        onCountryInputChange={setCountryInput}
        onResolveLocation={() => {
          void handleResolve();
        }}
        onUseCurrentLocation={() => {
          void handleUseCurrentLocation();
        }}
        onSaveSettings={() => {
          void handleSaveSettings();
        }}
        onRefresh={() => {
          void handleManualRefresh();
        }}
        onSelectCandidate={(candidate) => {
          setCityInput(candidate.name);
          setStateInput(candidate.state || "");
          setCountryInput(candidate.country || "US");
          setCandidates([]);
        }}
      />

      {status && !status.enabled ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Weather integration is unavailable ({status.reason || "disabled"}). Add a valid OpenWeather API key to continue.
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      {dashboard ? (
        <>
          <TodayCard today={today} />
          <HourlyStrip hourly={hourly24} />
          <FiveDayForecast days={chartData} />

          <div className="grid gap-4 lg:grid-cols-2">
            <InsightsCard predictions={insightItems} insights={dashboard.insights} />
            <AlertsCard alerts={dashboard.alerts} warning={dashboard.warning} />
          </div>

          <AdvancedInsightsAccordion
            advanced={advancedCoherence}
            source={dashboard.source}
            stale={dashboard.stale}
            warning={dashboard.warning}
            mode={dashboard.mode}
          />
        </>
      ) : (
        <section className="rounded-lg border border-vesta-header-border bg-card p-4 text-sm text-muted-foreground">
          Save a location and refresh to load today and forecast details.
        </section>
      )}
    </div>
  );
};

export default WeatherTab;
