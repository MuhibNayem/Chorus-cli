import { tool } from "@langchain/core/tools";
import { z } from "zod";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const GOOGLE_CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

export const InternetSearchTool = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    if (!SERPER_API_KEY) {
      return "Error: SERPER_API_KEY not set in environment";
    }

    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: maxResults }),
      });

      if (!response.ok) {
        return `Serper error: ${response.status}`;
      }

      const data = await response.json() as {
        results?: Array<{ title: string; snippet: string; link: string }>;
      };

      const results = data.results ?? [];
      if (!results.length) return "No results found";

      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.link}`)
        .join("\n\n");
    } catch (error) {
      return `Search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "internet_search",
    description: "Search the web using Serper API",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().default(5).describe("Maximum number of results"),
    }),
  }
);

export const WebSearchTool = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_ID) {
      return "Error: GOOGLE_CSE_API_KEY or GOOGLE_CSE_ID not set";
    }

    try {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", GOOGLE_CSE_API_KEY);
      url.searchParams.set("cx", GOOGLE_CSE_ID);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(maxResults));

      const response = await fetch(url.toString());
      if (!response.ok) {
        return `Google CSE error: ${response.status}`;
      }

      const data = await response.json() as {
        items?: Array<{ title: string; snippet: string; link: string }>;
      };

      const results = data.items ?? [];
      if (!results.length) return "No results found";

      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.link}`)
        .join("\n\n");
    } catch (error) {
      return `Search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "web_search",
    description: "Search the web using Google Custom Search Engine",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().default(5).describe("Maximum number of results"),
    }),
  }
);

export const WeatherTool = tool(
  async ({ city }: { city: string }) => {
    if (!WEATHER_API_KEY) {
      return "Error: WEATHER_API_KEY not set in environment";
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