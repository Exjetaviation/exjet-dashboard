// Anthropic tool schemas for the Exjet Operations Copilot.
// Each entry is { name, description, input_schema } — the shape the
// Anthropic Messages API expects for `tools`.
//
// All tools are read-only. Dates are ISO calendar dates (YYYY-MM-DD) at
// the schema layer; the dispatcher converts them to epoch-ms where needed.

const DATE = {
  type: 'string',
  description: 'ISO calendar date, YYYY-MM-DD (interpreted as UTC).',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
};

const ICAO = {
  type: 'string',
  description: 'ICAO airport identifier, 4 letters (e.g. "KORL", "MNMG").',
  pattern: '^[A-Za-z0-9]{4}$',
};

export const toolSchemas = [
  {
    name: 'list_flights',
    description:
      'List flights in ForeFlight Dispatch within a date range. Returns a compact list with flight ids, departure/destination, scheduled times, aircraft, and crew. Use this to find the flight_id to feed into the per-flight tools.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { ...DATE, description: 'Window start date (UTC). Filters on scheduled departureTime.' },
        end_date: { ...DATE, description: 'Window end date (UTC), inclusive. Filters on scheduled departureTime.' },
        tail: {
          type: 'string',
          description: 'Optional aircraft registration to filter by (e.g. "N408JS").',
        },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_flight',
    description:
      'Full flight record from ForeFlight Dispatch — route, fuel policy, load, crew, filing/release status, alternates, ETOPS, errors.',
    input_schema: {
      type: 'object',
      properties: {
        flight_id: { type: 'string', description: 'ForeFlight flightId (hex string).' },
      },
      required: ['flight_id'],
    },
  },
  {
    name: 'get_performance',
    description:
      'Performance computation for the flight (block/trip time, fuel burn, climb/cruise/descent breakdown). Source: ForeFlight Dispatch.',
    input_schema: {
      type: 'object',
      properties: {
        flight_id: { type: 'string', description: 'ForeFlight flightId.' },
      },
      required: ['flight_id'],
    },
  },
  {
    name: 'get_runway_analysis',
    description:
      "Returns the ForeFlight runway-analysis document for this flight as { url, timeGenerated, text, textLength, error? }. `text` is the extracted text of the PDF (already truncated if very long) — reason from it directly for runway lengths, weights, derate notes, obstacle clearances, and limit codes. Cite the URL alongside so the dispatcher can open the polished PDF. If `text` is null, `error` explains why extraction failed; in that case cite the URL and say what you couldn't read.",
    input_schema: {
      type: 'object',
      properties: {
        flight_id: { type: 'string', description: 'ForeFlight flightId.' },
      },
      required: ['flight_id'],
    },
  },
  {
    name: 'get_weather_briefing',
    description:
      "Returns the ForeFlight pre-flight weather briefing document for this flight as { url, timeGenerated, text, textLength, error? }. `text` is the extracted PDF text (truncated if very long) and includes the briefing's NOTAMs, area METARs/TAFs, AIRMETs/SIGMETs, and route summary — reason from it directly and cite specific lines. Also cite the URL so the dispatcher can open the formatted PDF. If `text` is null, `error` explains why; cite the URL and state what you couldn't read.",
    input_schema: {
      type: 'object',
      properties: {
        flight_id: { type: 'string', description: 'ForeFlight flightId.' },
      },
      required: ['flight_id'],
    },
  },
  {
    name: 'get_airport_weather',
    description:
      'Current METAR and active TAF for one or more airports, from aviationweather.gov. Use for live weather at departure, destination, and alternates.',
    input_schema: {
      type: 'object',
      properties: {
        icaos: {
          type: 'array',
          items: ICAO,
          minItems: 1,
          maxItems: 10,
          description: 'List of ICAO identifiers to pull METAR+TAF for.',
        },
      },
      required: ['icaos'],
    },
  },
  {
    name: 'list_aircraft',
    description:
      'Operator fleet from LevelFlight — tail number, type, serial, home airport, pax seats, active flag.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_aircraft',
    description:
      'Detailed aircraft record from LevelFlight (engines, APU, fuel burns, limits, owner, FBO). Accepts either a tail number (e.g. "N408JS") or a LevelFlight ObjectId.',
    input_schema: {
      type: 'object',
      properties: {
        tail_or_id: {
          type: 'string',
          description: 'Aircraft tail number or LevelFlight _id ($oid).',
        },
      },
      required: ['tail_or_id'],
    },
  },
  {
    name: 'get_aircraft_compliance',
    description:
      'Open maintenance and safety items for a tail in the given window — work orders that are not yet closed, plus SMS/safety tickets with description, ATA code, discrepancy flag, and lifecycle status (opened/processed/analyzed/corrected/followedUp/closed). Source: LevelFlight.',
    input_schema: {
      type: 'object',
      properties: {
        tail: { type: 'string', description: 'Aircraft tail number (e.g. "N69FP").' },
        start_date: DATE,
        end_date: DATE,
      },
      required: ['tail', 'start_date', 'end_date'],
    },
  },
  {
    name: 'get_crew_availability',
    description:
      "Per-crew rollup with two layers: (a) schedule — pilot roster, duty-hour totals, upcoming assignments, and overlap flag; (b) duty/rest analysis when `flight_id` is given. The duty/rest block, per pilot, includes the proposed duty period (planned departure → planned arrival + post-flight buffer) and its length vs the per-duty-period limit, cumulative flight time across rolling 24h / 7d / 30d windows plus the current calendar quarter and year, and hours of rest since the last duty period — each compared against thresholds with explicit violations, advisories, and a summary status of 'compliant' | 'advisory' | 'violation'. The thresholds are operationally common defaults; the GOM and the Chief Pilot are the authoritative source for any release decision.",
    input_schema: {
      type: 'object',
      properties: {
        flight_id: {
          type: 'string',
          description: 'Optional ForeFlight flightId. When given, the tool resolves the planned departure / arrival, matches the corresponding LevelFlight leg, and returns duty/rest analysis for that flight\'s assigned crew only.',
        },
        start_date: { ...DATE, description: 'Optional display-window start (UTC). Without flight_id, defaults to today; with flight_id, defaults to 7 days before the proposed flight.' },
        end_date: { ...DATE, description: 'Optional display-window end (UTC), inclusive. Without flight_id, defaults to today + 14 days; with flight_id, defaults to 7 days after the proposed flight.' },
      },
    },
  },
  {
    name: 'get_airport_safety_history',
    description:
      'Past SMS/safety tickets that reference this airport. The ICAO is matched against the ticket description and any other string field. Source: LevelFlight analytics/tickets, walked in 90-day chunks across a multi-year lookback.',
    input_schema: {
      type: 'object',
      properties: {
        icao: ICAO,
        years: {
          type: 'number',
          minimum: 0.25,
          maximum: 10,
          description: 'Optional lookback in years. Defaults to 3.',
        },
      },
      required: ['icao'],
    },
  },
  {
    name: 'search_manuals',
    description:
      "Search Exjet's operational manuals (currently the General Operations Manual) for a relevant section. Use this ONLY when a question genuinely requires a manual reference — regulations, ops spec authorizations, MEL deferrals, fuel policy, duty-time rules, or a procedure that is NOT already answered by data from the other tools. Do not call this 'just to check' something the live data already addresses. Returns the most relevant chunks with manual name, section, and page number. Cite manual + section in your evidence (e.g. 'per GOM §3.4.2').",
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language search query — what regulatory or procedural answer you need.',
        },
        manual: {
          type: 'string',
          description: "Optional restriction to one manual by name, e.g. 'GOM'. Omit to search all ingested manuals.",
        },
        top_k: {
          type: 'integer',
          description: 'How many chunks to return. Default 3, max 5.',
        },
      },
    },
  },
  {
    name: 'render_review',
    description:
      'Output a structured flight readiness review. Call this once at the END of a readiness review, after every relevant tool has been called and the analysis is complete. Do NOT call this for casual or follow-up questions — for those, just reply normally.',
    input_schema: {
      type: 'object',
      required: ['summary', 'overall_status', 'checks'],
      properties: {
        summary: { type: 'string', description: '1-3 sentence bottom-line summary' },
        overall_status: { type: 'string', enum: ['clean', 'watch', 'action', 'uncertain'] },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title', 'status', 'headline', 'evidence'],
            properties: {
              id: {
                type: 'string',
                enum: [
                  'crew',
                  'compliance',
                  'weather',
                  'airport_runway',
                  'performance',
                  'airport_intelligence',
                ],
              },
              title: { type: 'string' },
              status: { type: 'string', enum: ['clean', 'watch', 'action', 'uncertain'] },
              headline: { type: 'string' },
              evidence: { type: 'string', description: 'Detailed findings in markdown; cite sources.' },
              caveats: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        global_caveats: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

export const RENDER_REVIEW_TOOL = 'render_review';

export const toolNames = toolSchemas.map((t) => t.name);
