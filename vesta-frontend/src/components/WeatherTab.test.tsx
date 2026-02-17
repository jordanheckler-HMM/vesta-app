import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import WeatherTab, { type WeatherDashboardResponse, type WeatherSettings, type WeatherStatus } from "./WeatherTab";

// Simple mock for the toast module to avoid errors
vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({
    toast: vi.fn(),
    toasts: [],
    dismiss: vi.fn(),
  })),
}));

const baseStatus: WeatherStatus = {
  enabled: true,
  reason: undefined,
  has_cached_data: false,
  last_refresh_ts: "1700000000",
};

const baseSettings: WeatherSettings = {
  mode: "general",
  location: {
    city: "Edwardsville",
    state: "IL",
    country: "US",
    lat: 38.8114,
    lon: -89.9532,
  },
  cache_ttl_minutes: 45,
  updated_at: "1700000000",
};

const makeForecast3h = (count = 10) =>
  Array.from({ length: count }).map((_, index) => ({
    forecast_ts: String(1700000000 + index * 10_800),
    temp_f: 60 + index,
    wind_mph: 8 + index,
    precip_in: Number((index * 0.02).toFixed(2)),
    condition_main: "Clouds",
    condition_desc: `clouds ${index}`,
  }));

const baseDashboard: WeatherDashboardResponse = {
  location: baseSettings.location!,
  mode: "general",
  current: {
    observed_ts: 1700000000,
    temp_f: 64,
    feels_like_f: 63,
    humidity_pct: 54,
    wind_mph: 11,
    wind_gust_mph: 15,
    precip_in: 0.02,
    condition_main: "Clouds",
    condition_desc: "scattered clouds",
  },
  forecast_daily: [
    {
      date: "2026-02-16",
      temp_min_f: 58,
      temp_max_f: 72,
      temp_avg_f: 65,
      wind_max_mph: 14,
      precip_total_in: 0.1,
      precip_prob_avg: 0.2,
      confidence_score: 0.8,
      condition_main: "Clouds",
      condition_desc: "cloudy",
    },
    {
      date: "2026-02-17",
      temp_min_f: 56,
      temp_max_f: 70,
      temp_avg_f: 63,
      wind_max_mph: 12,
      precip_total_in: 0.05,
      precip_prob_avg: 0.15,
      confidence_score: 0.78,
      condition_main: "Rain",
      condition_desc: "light rain",
    },
    {
      date: "2026-02-18",
      temp_min_f: 55,
      temp_max_f: 68,
      temp_avg_f: 61,
      wind_max_mph: 10,
      precip_total_in: 0.0,
      precip_prob_avg: 0.1,
      confidence_score: 0.76,
      condition_main: "Clear",
      condition_desc: "clear sky",
    },
    {
      date: "2026-02-19",
      temp_min_f: 54,
      temp_max_f: 67,
      temp_avg_f: 60,
      wind_max_mph: 9,
      precip_total_in: 0.03,
      precip_prob_avg: 0.08,
      confidence_score: 0.75,
      condition_main: "Clouds",
      condition_desc: "broken clouds",
    },
    {
      date: "2026-02-20",
      temp_min_f: 53,
      temp_max_f: 66,
      temp_avg_f: 59,
      wind_max_mph: 8,
      precip_total_in: 0.0,
      precip_prob_avg: 0.05,
      confidence_score: 0.74,
      condition_main: "Clear",
      condition_desc: "sunny",
    },
  ],
  forecast_3h: makeForecast3h(10),
  alerts: [],
  coherence: {
    integrity: 71.4,
    resilience: 69.8,
    meaning: 74.2,
    cci: 71.8,
  },
  predictions: [
    {
      id: "pred-1",
      created_at: "1700000000",
      mode: "general",
      target_date: "2026-02-17",
      integrity: 71.4,
      resilience: 69.8,
      meaning: 74.2,
      cci_score: 71.8,
      probability: 62,
      prediction_text: "62% probability of notable weather shift in 1 day(s)",
    },
    {
      id: "pred-2",
      created_at: "1700000000",
      mode: "general",
      target_date: "2026-02-18",
      integrity: 71.4,
      resilience: 69.8,
      meaning: 74.2,
      cci_score: 71.8,
      probability: 55,
      prediction_text: "55% probability of notable weather shift in 2 day(s)",
    },
  ],
  insights: [
    "Coherence is moderate: conditions are usable with some uncertainty.",
    "General mode balances overall weather significance across core signals.",
  ],
  cache_age_seconds: 120,
  source: "live",
  stale: false,
  warning: null,
};

const installFetchMock = (options?: {
  status?: Partial<WeatherStatus>;
  settings?: Partial<WeatherSettings>;
  dashboard?: Partial<WeatherDashboardResponse>;
}) => {
  const status: WeatherStatus = { ...baseStatus, ...(options?.status || {}) };
  const settings: WeatherSettings = { ...baseSettings, ...(options?.settings || {}) };
  const dashboard: WeatherDashboardResponse = {
    ...baseDashboard,
    ...(options?.dashboard || {}),
  };

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/weather/status")) {
      return Promise.resolve(new Response(JSON.stringify(status), { status: 200 }));
    }
    if (url.endsWith("/weather/settings")) {
      return Promise.resolve(new Response(JSON.stringify(settings), { status: 200 }));
    }
    if (url.endsWith("/weather/dashboard")) {
      return Promise.resolve(new Response(JSON.stringify(dashboard), { status: 200 }));
    }
    if (url.includes("ipapi.co")) {
      return Promise.resolve(new Response(JSON.stringify({
        city: "Chicago",
        region_code: "IL",
        country_code: "US"
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WeatherTab", () => {
  it("renders Today card using first daily fallback when current conditions are missing", async () => {
    installFetchMock({
      dashboard: {
        current: null,
        forecast_daily: [
          {
            ...baseDashboard.forecast_daily[0],
            temp_avg_f: 88,
          },
          ...baseDashboard.forecast_daily.slice(1),
        ],
      },
    });

    render(<WeatherTab />);

    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText("88F")).toBeInTheDocument();
  });

  it("renders next 8 hourly entries and 5 day rows", async () => {
    installFetchMock();
    render(<WeatherTab />);

    await screen.findByText("Hourly (next 24h)");

    await waitFor(() => {
      expect(screen.getAllByTestId("hourly-item")).toHaveLength(8);
      expect(screen.getAllByTestId("daily-row")).toHaveLength(5);
    });
  });

  it("shows predictions in Insights and keeps advanced details collapsed by default", async () => {
    installFetchMock();
    render(<WeatherTab />);

    expect(await screen.findByText("Insights")).toBeInTheDocument();
    expect(screen.getAllByTestId("insight-prediction").length).toBeGreaterThan(0);
    expect(screen.queryByText("Integrity")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced insights/i }));
    expect(await screen.findByText("Integrity")).toBeInTheDocument();
    expect(screen.getByText("Resilience")).toBeInTheDocument();
    expect(screen.getByText("Meaning")).toBeInTheDocument();
  });

  it("keeps location editor hidden until Edit location is clicked", async () => {
    installFetchMock();
    render(<WeatherTab />);

    await screen.findByText("Weather");
    expect(screen.queryByLabelText("City")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit location/i }));
    expect(await screen.findByLabelText("City")).toBeInTheDocument();
    expect(screen.getByLabelText("State")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
  });

  it("renders degraded warning state without blanking primary weather sections", async () => {
    installFetchMock({
      dashboard: {
        stale: true,
        warning: "alerts_unavailable: OpenWeather One Call 3.0 subscription is required for alerts.",
        alerts: [],
      },
    });

    render(<WeatherTab />);

    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText("5-day forecast")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Alerts are unavailable for this OpenWeather plan/i,
      ),
    ).toBeInTheDocument();
  });

  it("populates location inputs when Use current location is clicked", async () => {
    installFetchMock();
    render(<WeatherTab />);

    fireEvent.click(screen.getByRole("button", { name: /edit location/i }));
    const useLocationBtn = await screen.findByRole("button", { name: /use current location/i });

    fireEvent.click(useLocationBtn);

    await waitFor(() => {
      expect(screen.getByLabelText("City")).toHaveValue("Chicago");
      expect(screen.getByLabelText("State")).toHaveValue("IL");
      expect(screen.getByLabelText("Country")).toHaveValue("US");
    });
  });

  it("disables use current location button while detecting", async () => {
    const fetchMock = installFetchMock();
    let resolveFetch: (value: Response) => void;
    (fetchMock as any).mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("ipapi.co")) {
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    render(<WeatherTab />);

    fireEvent.click(screen.getByRole("button", { name: /edit location/i }));
    const useLocationBtn = await screen.findByRole("button", { name: /use current location/i });

    fireEvent.click(useLocationBtn);

    expect(useLocationBtn).toBeDisabled();
    expect(screen.getByText(/Detecting.../i)).toBeInTheDocument();

    // Clean up
    resolveFetch!(new Response(JSON.stringify({ city: "Chicago" }), { status: 200 }));
  });
});
