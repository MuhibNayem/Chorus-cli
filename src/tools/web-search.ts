import { tool } from "./tool.js";
import { z } from "zod";
import { getSerperApiKey, getGoogleCseApiKey, getGoogleCseId, getWeatherApiKey } from "../settings/storage.js";

type SearchResult = {
  title: string;
  snippet: string;
  link: string;
};

function formatSearchResults(results: SearchResult[], provider: string): string {
  return [
    `Source: ${provider}`,
    "",
    ...results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.link}`),
  ].join("\n");
}

function normalizeMaxResults(maxResults: number | undefined): number {
  return Math.min(10, Math.max(1, Math.trunc(maxResults ?? 5)));
}

async function searchSerper(query: string, maxResults: number): Promise<SearchResult[] | string> {
  const apiKey = getSerperApiKey();
  if (!apiKey) {
    return "Serper API key is not configured.";
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: maxResults }),
  });

  if (!response.ok) {
    return `Serper error: ${response.status}`;
  }

  const data = await response.json() as {
    organic?: SearchResult[];
    news?: SearchResult[];
    results?: SearchResult[];
  };

  return [...(data.organic ?? []), ...(data.news ?? []), ...(data.results ?? [])].slice(0, maxResults);
}

async function searchGoogleCse(query: string, maxResults: number): Promise<SearchResult[] | string> {
  const apiKey = getGoogleCseApiKey();
  const cseId = getGoogleCseId();
  if (!apiKey || !cseId) {
    return "Google CSE is not configured.";
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(maxResults));

  const response = await fetch(url.toString());
  if (!response.ok) {
    return `Google CSE error: ${response.status}`;
  }

  const data = await response.json() as {
    items?: SearchResult[];
  };

  return (data.items ?? []).slice(0, maxResults);
}

export const InternetSearchTool = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    const limit = normalizeMaxResults(maxResults);
    const attempts: string[] = [];

    try {
      const serperResult = await searchSerper(query, limit);
      if (Array.isArray(serperResult) && serperResult.length > 0) {
        return formatSearchResults(serperResult, "Serper");
      }
      attempts.push(
        Array.isArray(serperResult) ? "Serper returned no results." : serperResult
      );

      const googleResult = await searchGoogleCse(query, limit);
      if (Array.isArray(googleResult) && googleResult.length > 0) {
        return formatSearchResults(googleResult, "Google CSE fallback");
      }
      attempts.push(
        Array.isArray(googleResult) ? "Google CSE returned no results." : googleResult
      );

      return `No results found.\n${attempts.map((a) => `- ${a}`).join("\n")}`;
    } catch (error) {
      return `Search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "internet_search",
    description: "Search the web. Uses Serper first and falls back to Google Custom Search when configured.",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().default(5).describe("Maximum number of results, 1-10"),
    }),
  }
);

export const WeatherTool = tool(
  async ({ city }: { city: string }) => {
    const WEATHER_API_KEY = getWeatherApiKey();
    if (!WEATHER_API_KEY) {
      return "Error: WEATHER_API_KEY not set. Run /config to configure it.";
    }

    try {
      const response = await fetch(
        `https://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(city)}&aqi=no`
      );

      if (!response.ok) {
        return `Weather API error: ${response.status}`;
      }

      const data = await response.json() as {
        current?: {
          temp_c: number;
          temp_f: number;
          condition: { text: string; icon: string };
          humidity: number;
          wind_kph: number;
          feelslike_c: number;
          feelslike_f: number;
        };
        location?: { name: string; region: string; country: string };
        error?: { message: string };
      };

      if (data.error) {
        return `Error: ${data.error.message}`;
      }

      const { current, location } = data;
      if (!current || !location) {
        return "Error: Unable to fetch weather data";
      }

      return `Weather in ${location.name}, ${location.region}, ${location.country}:
- Condition: ${current.condition.text}
- Temperature: ${current.temp_c}°C / ${current.temp_f}°F
- Feels like: ${current.feelslike_c}°C / ${current.feelslike_f}°F
- Humidity: ${current.humidity}%
- Wind: ${current.wind_kph} kph`;
    } catch (error) {
      return `Weather error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "weather",
    description: "Get current weather for a city",
    schema: z.object({
      city: z.string().describe("The city name to get weather for"),
    }),
  }
);
