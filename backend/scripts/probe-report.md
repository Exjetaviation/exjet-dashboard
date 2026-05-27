# Exjet API Probe — Report

Generated: 2026-05-21T21:47:04.447Z
ForeFlight base: `https://dispatch.foreflight.com`
LevelFlight base: `https://rest.levelflight.com/prod`

**Summary:** 36/37 OK · 1 client errors (4xx) · 0 server errors (5xx) · 0 no response

## ForeFlight Dispatch

| Method | Path | Status | Time | Result |
|---|---|---|---|---|
| GET | `/public/api/apiKeyInfo` | 200 | 552ms | object{ organisationName, createdBy, createdAt, organisationUUID, webHookUrl, storageAccountUUID } |
| GET | `/public/api/apiKeyInfo/WebHook` | 200 | 302ms | array[3] of object{ changeType, changedFields, flightId } |
| GET | `/public/api/aircraft` | 200 | 382ms | array[2] of object{ aircraftRegistration, aircraftModelCode, aircraftLicenses, cruiseProfiles, weightUnit, fuelUnit, fuelType } |
| GET | `/public/api/crew` | 200 | 303ms | array[29] of object{ fullname, username, crewCode, phoneNumber } |
| GET | `/public/api/contacts` | 200 | 334ms | array[27] of object{ id, role, name, email, crewCode, phoneNumber } |
| GET | `/public/api/airport/Airports` | 200 | 312ms | array (empty) |
| GET | `/public/api/savedroutes` | 200 | 343ms | object{ routes } |
| GET | `/public/api/Flights/flights` | 200 | 364ms | object{ flights, warnings } |
| GET | `/public/api/Flights/modified` | 400 | 306ms | string |
| GET | `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b` | 200 | 1073ms | object{ flightData, performance, filing, fboDetails, releaseStatus, flightId, errors, weightBalance, etops } |
| GET | `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/briefing` | 200 | 5643ms | object{ url, timeGenerated } |
| GET | `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/rwa` | 200 | 6857ms | object{ url, timeGenerated } |
| GET | `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/performance` | 200 | 728ms | object{ flightData, performance } |
| GET | `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/wb` | 200 | 923ms | object{ url, timeGenerated } |
| GET | `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/navlog` | 200 | 2816ms | object{ url, timeGenerated } |

## LevelFlight

| Method | Path | Status | Time | Result |
|---|---|---|---|---|
| GET | `/health` | 200 | 449ms | text/plain; charset=utf-8 (5 chars) |
| GET | `/api/user/authorize` | 200 | 426ms | object{ success, message, user } |
| GET | `/api/operation/basic` | 200 | 122ms | object{ success, message, operation } |
| GET | `/api/operation/tools` | 200 | 135ms | object{ success, message, tools, rights } |
| GET | `/api/pilots/list` | 200 | 141ms | object{ success, message, users } |
| GET | `/api/attendants/list` | 200 | 131ms | object{ success, message, users } |
| GET | `/api/mechanics/list` | 200 | 124ms | object{ success, message, users } |
| GET | `/api/safetyTeam/list` | 200 | 128ms | object{ success, message, users } |
| GET | `/api/users/list` | 200 | 140ms | object{ success, message, users } |
| GET | `/api/aircraft/list` | 200 | 140ms | object{ success, message, aircraft, active } |
| POST | `/api/dispatch/list` | 200 | 158ms | object{ success, message, dispatches, page } |
| POST | `/api/widgets/departingSoon` | 200 | 134ms | object{ success, message, legs } |
| POST | `/api/widgets/onDuty` | 200 | 120ms | object{ success, message, duties } |
| POST | `/api/widgets/pendingFlights` | 200 | 161ms | object{ success, message, legs } |
| POST | `/api/workOrder/all` | 200 | 139ms | object{ success, message, workOrders, completed } |
| POST | `/api/workOrder/ranged` | 200 | 137ms | object{ success, message, workOrders } |
| POST | `/api/analytics/dutyTimes` | 200 | 138ms | object{ success, message, legs, dutyTimes } |
| POST | `/api/analytics/tickets` | 200 | 129ms | object{ success, message, totals, tickets } |
| POST | `/api/analytics/scheduledLegs` | 200 | 729ms | object{ success, message, legs } |
| GET | `/api/aircraft/69a0fae31c00002a00611199` | 200 | 131ms | object{ success, message, aircraft } |
| GET | `/api/workOrder/6750f74c2900001b00da6f13` | 200 | 165ms | object{ success, message, workOrder } |
| GET | `/api/dispatch/69fb575a2900002600b1e1bd/itinerary` | 200 | 288ms | HTML page (120744 chars) |

## Response samples

### [FF] GET `/public/api/apiKeyInfo` — auth check + key scopes

```json
{
  "organisationName": "EXJET AVIATION",
  "createdBy": "Jaime Torres",
  "createdAt": "2026-03-19T17:50:46.969223Z",
  "organisationUUID": "24f8b84e-431a-44ef-a0e2-d8115cc10471",
  "webHookUrl": null,
  "storageAccountUUID": "24f8b84e-431a-44ef-a0e2-d8115cc10471"
}
```

### [FF] GET `/public/api/apiKeyInfo/WebHook` — webhook payload sample

```json
[
  {
    "changeType": "Flight",
    "changedFields": [
      "None",
      "Other",
      "Departure",
      "Destination",
      "Aircraft",
      "SoulsAboard",
      "DepartureDate",
      "LogTimeOff",
      "LogTimeOut",
      "LogTimeOn",
      "LogTimeIn",
      "RouteOfFlight",
      "CruiseAltitude",
      "RecallNumber",
      "Alternate1",
      "Alternate2",
      "AlternateTakeOff",
      "Fuel",
      "FlightRule",
      "EstimatedArrivalTime",
      "PeopleLoad",
      "Cargo",
      "Crew"
    ],
    "flightId": "b2afea37-b78f-4b7e-8807-6abafe14a97f"
  },
  {
    "changeType": "FlightCreated",
    "changedFields": [],
    "flightId": "9ae3cd0e-7042-4b0f-b000-af4102d82c3e"
  },
  {
    "changeType": "FlightDeleted",
    "changedFields": [],
    "flightId": "d0f109bd-a044-4ade-9f67-1339b3e6b19c"
  }
]
```

### [FF] GET `/public/api/aircraft`

```json
[
  {
    "aircraftRegistration": "N69FP",
    "aircraftModelCode": "GLF4",
    "aircraftLicenses": [
      "Dispatch",
      "FuelAdvisor",
      "RunwayAnalysis"
    ],
    "cruiseProfiles": [
      {
        "uuid": "5218d94e-1dab-4d55-8d7f-613e7376832c",
        "profileName": "Mach 0.80"
      },
      {
        "uuid": "2ce8ee2f-de1c-4d94-b723-9b2fb43472f9",
        "profileName": "Mach 0.85"
      },
      {
        "uuid": "6e7434c0-df67-4d26-9f81-014a5529f7ec",
        "profileName": "Mach 0.84"
      },
      {
        "uuid": "3b7d50e3-2723-4b33-9b74-6dfaca529b37",
        "profileName": "Mach 0.83"
      },
      {
        "uuid": "c2cc4ff9-eeba-41c7-9074-3dcf4d1a91e9",
        "profileName": "Mach 0.82"
      },
      {
        "uuid": "241e3ea7-2a11-4d3f-9032-c2ea5b8ff01b",
        "profileName": "Mach 0.81"
      },
      {
        "uuid": "3616a904-93dc-46aa-8bbe-28464a4dfa64",
        "profileName": "Mach 0.79"
      },
      {
        "uuid": "dec8fa30-f876-40ed-9ee7-2db51b835cae",
        "profileName": "Mach 0.78"
      },
      {
        "uuid": "a3fdd6c2-9bdc-4839-9826-beb3774c77b2",
        "profileName": "Mach 0.77"
      },
      {
        "uuid": "9c4b5a0a-244d-4555-8e60-793cb66fa795",
        "profileName": "Max Range Cruise"
      },
      {
        "uuid": "3022ed2e-cf69-451b-9940-28775af2bd1b",
        "profileName": "Long Range Cruise"
      }
    ],
    "weightUnit": "Pounds",
    "fuelUnit": "Pound",
    "fuelType": "Jet-A"
  },
  {
    "aircraftRegistration": "N408JS",
    "aircraftModelCode": "GLF4",
    "aircraftLicenses": [
      "Dispatch",
      "FuelAdvisor",
      "RunwayAnalysis"
    ],
    "cruiseProfiles": [
      {
        "uuid": "5218d94e-1dab-4d55-8d7f-613e7376832c",
        "profileName": "Mach 0.80"
      },
      {
        "uuid": "2ce8ee2f-de1c-4d94-b723-9b2fb43472f9",
        "profileName": "Mach 0.85"
      },
      {
        "uuid": "6e7434c0-df67-4d26-9f81-014a5529f7ec",
        "profileName": "Mach 0.84"
      },
      {
        "uuid": "3b7d50e3-2723-4b33-9b74-6dfaca529b37",
        "profileName": "Mach 0.83"
      },
      {
        "uuid": "c2cc4ff9-eeba-41c7-9074-3dcf4d1a91e9",
        "profileName": "
… (truncated)
```

### [FF] GET `/public/api/crew`

```json
[
  {
    "fullname": "John Arieta",
    "username": "jarieta@indaer.com",
    "crewCode": null,
    "phoneNumber": null
  },
  {
    "fullname": "Jaime Torres",
    "username": "j.torres@flyexjet.vip",
    "crewCode": null,
    "phoneNumber": "+19547011015"
  },
  {
    "fullname": "Adolfo Martinez",
    "username": "a.martinez@flyexjet.vip",
    "crewCode": null,
    "phoneNumber": "7862124530"
  },
  {
    "fullname": "Camilo Torres",
    "username": "camiwings@gmail.com",
    "crewCode": null,
    "phoneNumber": null
  },
  {
    "fullname": "Guillermo Dressler",
    "username": "guillermo.dressler@cdrmaguire.com",
    "crewCode": null,
    "phoneNumber": "+17864750217"
  },
  {
    "fullname": "Carlos Valecillos",
    "username": "carlos.valecillos@cdrmaguire.com",
    "crewCode": null,
    "phoneNumber": "9545043153"
  },
  {
    "fullname": "Yuliana Ossa",
    "username": "yulianaossa121@gmail.com",
    "crewCode": null,
    "phoneNumber": null
  },
  {
    "fullname": "Daniel Vaca",
    "username": "dvaca2544@gmail.com",
    "crewCode": null,
    "phoneNumber": null
  },
  {
    "fullname": "Juan Cifuentes",
    "username": "Jd_cifuentes@hotmail.com",
    "crewCode": null,
    "phoneNumber": "+19545996989"
  },
  {
    "fullname": "Harry Wood",
    "username": "atphw1@gmail.com",
    "crewCode": null,
    "phoneNumber": null
  },
  {
    "fullname": "Gerardo Antonio Matos Diaz",
    "username": "gerardo.matos@stajets.com",
    "crewCode": null,
    "phoneNumber": "+14072358009"
  },
  {
    "fullname": "Marco Gabriel Hernandez",
    "username": "foxmarkaviation@gmail.com",
    "crewCode": null,
    "phoneNumber": "+1 (817) 374-0949"
  },
  {
    "fullname": "Rafael Horacio Ayala",
    "username": "pollopiloto@hotmail.com",
    "crewCode": null,
    "phoneNumber": "+1 (954) 658-0615"
  },
  {
    "fullname": "Gustavo Adolfo Gomez",
    "username": "gustavogomezpilot@hotmail.com",
    "crewCode": null,
    "phoneNumber": "+1 (954) 842-9502"
  },
  {
    "fullname": "Chastity Moran",
    "username": "Chastitymoran112@gmail.com",
    "crewCode": null,
    "phoneNumber": null
  },
  {
    "fullname": "Fredy Torres",
    "username": "Aeroti@hotmail.com",
    "
… (truncated)
```

### [FF] GET `/public/api/Flights/flights`

```json
{
  "flights": [
    {
      "departure": "KORL",
      "destination": "MNMG",
      "route": "DCT",
      "aircraftRegistration": "N408JS",
      "flightId": "68be6bd279c84b31ad7a78603702db2b",
      "filingStatus": "None",
      "departureTime": "2026-05-27T13:00:00Z",
      "crew": [
        {
          "position": "PIC",
          "crewId": "j.torres@flyexjet.vip",
          "weight": 192.5
        },
        {
          "position": "SIC",
          "crewId": "r.dasilva@flyexjet.vip",
          "weight": 192.5
        },
        {
          "position": "CA",
          "crewId": "hannahortega13@gmail.com",
          "weight": 135
        }
      ],
      "released": false,
      "arrivalTime": "2026-05-27T15:21:42Z",
      "recallNumber": null,
      "callSign": null,
      "atcStatus": "None",
      "tripTime": 8502,
      "timeUpdated": "2026-05-20T21:59:36Z",
      "timeCreated": "2026-05-19T08:27:41Z",
      "flightLogTime": null,
      "flightMeter": null,
      "departureAirportDetails": {
        "fir": "KZJX"
      },
      "destinationAirportDetails": {
        "fir": "MHCC"
      },
      "load": {
        "people": 12,
        "averagePeopleWeight": 180.8083333333333,
        "cargo": 0,
        "passengers": [
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          },
          {
            "type": "Male",
            "weight": 183.3
          }
        ],
        "customWeight": {
          "pilotAvgWeight": 192.5,
          "caAvgWeight": 135,
          "aaAvgWeight": 190,
          "adultAvgWeight": 200,
          "maleAvgWeight": 183.3,
          "femaleAvgWeight":
… (truncated)
```

### [FF] GET `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b`

```json
{
  "flightData": {
    "departure": "KORL",
    "destination": "MNMG",
    "scheduledTimeOfDeparture": "2026-05-27T13:00:00Z",
    "aircraftRegistration": "N408JS",
    "callsign": null,
    "cruiseProfileUUID": "5218d94e-1dab-4d55-8d7f-613e7376832c",
    "routeToDestination": {
      "route": "DCT",
      "altitude": {
        "altitude": 430,
        "unit": "FL"
      }
    },
    "alternate": null,
    "secondAlternate": null,
    "takeOffAlternate": null,
    "routeToAlternate": null,
    "routeToSecondAlternate": null,
    "routeToTakeoffAlternate": null,
    "fuel": {
      "fuelPolicy": "MinimumRequiredFuel",
      "fuelPolicyValue": 0,
      "taxi": 400,
      "fuelType": "Jet-A",
      "fuelUnit": "Pound",
      "fuelAtShutdown": {
        "value": 0,
        "unit": "Pound"
      }
    },
    "load": {
      "people": 12,
      "averagePeopleWeight": 180.83333333333334,
      "cargo": 0,
      "passengers": [
        {
          "type": "Male",
          "weight": 180
        },
        {
          "type": "Male",
          "weight": 220
        },
        {
          "type": "Male",
          "weight": 180
        },
        {
          "type": "Male",
          "weight": 220
        },
        {
          "type": "Male",
          "weight": 200
        },
        {
          "type": "Male",
          "weight": 160
        },
        {
          "type": "Male",
          "weight": 200
        },
        {
          "type": "Male",
          "weight": 150
        },
        {
          "type": "Male",
          "weight": 140
        }
      ],
      "customWeight": {
        "pilotAvgWeight": 192.5,
        "caAvgWeight": 135,
        "aaAvgWeight": 190,
        "adultAvgWeight": 200,
        "maleAvgWeight": 183.33333333333334,
        "femaleAvgWeight": 175,
        "childrenAvgWeight": 87,
        "infantAvgWeight": 0
      }
    },
    "crew": [
      {
        "position": "PIC",
        "crewId": "j.torres@flyexjet.vip",
        "weight": 192.5
      },
      {
        "position": "SIC",
        "crewId": "r.dasilva@flyexjet.vip",
        "weight": 192.5
      },
      {
        "position": "CA",
        "crewId": "hannahortega13@gmail.com",
   
… (truncated)
```

### [FF] GET `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/briefing` — weather briefing

```json
{
  "url": "https://cdn.prod.foreflight.com/external-prod-briefings/8E344B759F891D332083CF87F2D32917/2026-05-21/fa0b41d3-23c1-7b27-1cfd-3fba11c10851.pdf?Expires=1779400126&Signature=hFsSJZWL~nP6B2yNTAKvYsslCNwcPjiPcuhu9J5I7yp90LIlR4kCbP~hmEwoIgkz0vFtlMzq6EKCv77p58hK6DgnjPm9maMvV2VfHO3KgCPOON7gt7MX-zXXPpSAyHE8-HN6-Sbxl8QLm4BYh1yAcRjH8ZN0U1Bjz01-XtubmFrhOr~HexU79NNVuCT955rqxU4IDtxZgpHlP1jwHOGI3uUNolAckRabi1bjkAAkLoeZ9JikXSlaOfTvpF5l687vQQ-Vbw3ZHIQpUE-3FL2UvjeDJ5-orKb2MEkW26brgHylM3ZulN75OpHSz5xw5ZNihZ7bJ5Ioz87QzTgeUUd-9A__&Key-Pair-Id=K12JTZIGZJNBIH",
  "timeGenerated": "2026-05-21T21:46:46.8177605Z"
}
```

### [FF] GET `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/rwa` — runway analysis

```json
{
  "url": "https://cdn.prod.foreflight.com/external-prod-briefings/foreflight/2026-05-21/RwyReport_N408JS_KORL_MNMGqzz5zyw2.0zn?Expires=1779400133&Signature=I3I6fcH6Y-dAxLdO7t9vyTHncjziPqAs5U-o8Sjdl-qVNDUXj-eWob2rbiqe~X51Nb3KugEAkJJ3ktrz~GegUFdvYD67utY3o4T299HUvwISuFdJvB2f4ohlo3ofISvCoz1upcyWyex7SzvU1a~~YRw~i2y4fvOBjYZwiOp6dSYBuidLFxEx-H6BvTgboIlFS8HI7CvaL3Kpv1T5YbBWKzfBn27zlRix~A3Jqv9hU3Vda6uaolHmA38PMsy~CL6by8tkJaIZ8TObnj4mzvqJkNnlrkrPYxPIRFJh2wsnpm~a~BpvOJMckYznIKDcUeRkLdoP6k9lMJ~78fdfV87pOg__&Key-Pair-Id=K12JTZIGZJNBIH",
  "timeGenerated": "2026-05-21T21:46:53.7994604Z"
}
```

### [FF] GET `/public/api/Flights/68be6bd279c84b31ad7a78603702db2b/performance` — performance

```json
{
  "flightData": {
    "departure": "KORL",
    "destination": "MNMG",
    "scheduledTimeOfDeparture": "2026-05-27T13:00:00Z",
    "aircraftRegistration": "N408JS",
    "callsign": null,
    "cruiseProfileUUID": "5218d94e-1dab-4d55-8d7f-613e7376832c",
    "routeToDestination": {
      "route": "DCT",
      "altitude": {
        "altitude": 430,
        "unit": "FL"
      }
    },
    "alternate": null,
    "secondAlternate": null,
    "takeOffAlternate": null,
    "routeToAlternate": null,
    "routeToSecondAlternate": null,
    "routeToTakeoffAlternate": null,
    "fuel": {
      "fuelPolicy": "MinimumRequiredFuel",
      "fuelPolicyValue": 0,
      "taxi": 400,
      "fuelType": "Jet-A",
      "fuelUnit": "Pound",
      "fuelAtShutdown": {
        "value": 0,
        "unit": "Pound"
      }
    },
    "load": {
      "people": 12,
      "averagePeopleWeight": 180.83333333333334,
      "cargo": 0,
      "passengers": [
        {
          "type": "Male",
          "weight": 180
        },
        {
          "type": "Male",
          "weight": 220
        },
        {
          "type": "Male",
          "weight": 180
        },
        {
          "type": "Male",
          "weight": 220
        },
        {
          "type": "Male",
          "weight": 200
        },
        {
          "type": "Male",
          "weight": 160
        },
        {
          "type": "Male",
          "weight": 200
        },
        {
          "type": "Male",
          "weight": 150
        },
        {
          "type": "Male",
          "weight": 140
        }
      ],
      "customWeight": {
        "pilotAvgWeight": 192.5,
        "caAvgWeight": 135,
        "aaAvgWeight": 190,
        "adultAvgWeight": 200,
        "maleAvgWeight": 183.33333333333334,
        "femaleAvgWeight": 175,
        "childrenAvgWeight": 87,
        "infantAvgWeight": 0
      }
    },
    "crew": [
      {
        "position": "PIC",
        "crewId": "j.torres@flyexjet.vip",
        "weight": 192.5
      },
      {
        "position": "SIC",
        "crewId": "r.dasilva@flyexjet.vip",
        "weight": 192.5
      },
      {
        "position": "CA",
        "crewId": "hannahortega13@gmail.com",
   
… (truncated)
```

### [LF] GET `/api/user/authorize` — token / session check

```json
{
  "success": true,
  "message": "Your account has been validated.",
  "user": {
    "_id": {
      "$oid": "673d0da92c00001c00d2f923"
    },
    "email": "info@flyexjet.vip",
    "operation": {
      "$oid": "673d0ce128be3d965cff2d14"
    },
    "operations": [
      {
        "$oid": "673d0ce128be3d965cff2d14"
      },
      {
        "$oid": "673d0ce128be3d965cff2d14"
      }
    ],
    "firstName": "Jaime ",
    "lastName": "Torres Gutierrez",
    "userTypes": [
      28,
      17,
      5,
      3,
      15,
      27,
      16,
      18,
      26,
      20,
      21
    ],
    "part": "135"
  }
}
```

### [LF] GET `/api/operation/basic` — operation profile

```json
{
  "success": true,
  "message": "Here is your operation",
  "operation": {
    "_id": {
      "$oid": "673d0ce128be3d965cff2d14"
    },
    "name": "EXJET AVIATION",
    "address": {
      "street": "4250 Execuair Street Suite G",
      "city": "Orlando",
      "state": "Florida",
      "postalCode": "32827",
      "country": "US"
    },
    "email": "info@flyexjet.vip",
    "phones": [
      "+1 (407) 677-7792"
    ],
    "fullName": "EXJET AVIATION",
    "fax": "+1 (407) 647-1080"
  }
}
```

### [LF] GET `/api/operation/tools` — enabled integrations

```json
{
  "success": true,
  "message": "Here are your tools",
  "tools": {
    "camp": true,
    "foreflight": "24f8b84e-431a-44ef-a0e2-d8115cc10471",
    "willCarry": false,
    "intuit": 2,
    "tsa": true,
    "avinode": true,
    "docusign": false
  },
  "rights": {
    "create": 0,
    "read": 255,
    "update": 0,
    "delete": 0
  }
}
```

### [LF] GET `/api/pilots/list`

```json
{
  "success": true,
  "message": "Here are your users",
  "users": [
    {
      "title": "Pilot",
      "_id": {
        "$oid": "673d0dd92c00001b00ee3c05"
      },
      "email": "j.torres@flyexjet.vip",
      "firstName": "Jaime ",
      "lastName": "Torres Parra",
      "ratings": [
        {
          "aircraft": {
            "_id": {
              "$oid": "57fdbd6dad34f31258000955"
            },
            "name": "Gulfstream GIV SP"
          },
          "date": 1614656402000,
          "legacy": {
            "date": 1732073955682,
            "hours": 709.1,
            "hoursPIC": 645.4,
            "cycles": 396
          },
          "seats": {
            "Part 135": 2,
            "Part 91": 2
          }
        }
      ],
      "middleName": "Arturo"
    },
    {
      "title": "Director of Maintenance / Pilot",
      "_id": {
        "$oid": "673d0e652c00001f00ee57c1"
      },
      "email": "j.arieta@flyexjet.vip",
      "firstName": "John",
      "lastName": "Arieta ",
      "middleName": "Jairo",
      "ratings": [
        {
          "aircraft": {
            "_id": {
              "$oid": "57fdbd6dad34f31258000955"
            },
            "name": "Gulfstream GIV SP"
          },
          "date": 1671077536000,
          "seats": {
            "Part 91": 3
          }
        }
      ]
    },
    {
      "_id": {
        "$oid": "6813f0f82f0000270042dd44"
      },
      "email": "pollopiloto@hotmail.com",
      "firstName": "Rafael",
      "lastName": "Ayala",
      "ratings": [
        {
          "aircraft": {
            "_id": {
              "$oid": "57fdbd6dad34f31258000955"
            },
            "knownAs": "GLF4",
            "name": "Gulfstream GIV SP"
          },
          "date": 1746137473000,
          "seats": {
            "Part 91": 2
          }
        }
      ],
      "middleName": "Horacio"
    },
    {
      "_id": {
        "$oid": "69a3b43c1c00002600a1b411"
      },
      "email": "r.dasilva@flyexjet.vip",
      "firstName": "Rafael",
      "lastName": "Da Silva",
      "ratings": [
        {
          "aircraft": {
            "_id": {
              "$oid": "57fdbd6dad34f31258000955"
            },
     
… (truncated)
```

### [LF] GET `/api/aircraft/list`

```json
{
  "success": true,
  "message": "Here are your available aircraft",
  "aircraft": [
    {
      "_id": {
        "$oid": "69a0fae31c00002a00611199"
      },
      "active": true,
      "tailNumber": "N408JS",
      "serial": "1402",
      "type": {
        "_id": {
          "$oid": "57fdbd6dad34f31258000955"
        },
        "name": "Gulfstream GIV SP",
        "engines": 2
      },
      "airport": "KFXE",
      "paxSeats": 14,
      "camp": true
    },
    {
      "_id": {
        "$oid": "673d145b2c00002200f03411"
      },
      "active": true,
      "tailNumber": "N69FP",
      "serial": "1180",
      "type": {
        "type": 7,
        "_id": {
          "$oid": "57fdbd6dad34f31258000955"
        },
        "name": "Gulfstream GIV SP",
        "engines": 2
      },
      "airport": "KFXE",
      "paxSeats": 15,
      "camp": true,
      "sort": 0
    }
  ],
  "active": true
}
```

### [LF] POST `/api/dispatch/list`
Request body: `{}`

```json
{
  "success": true,
  "message": "Here are your dispatches.",
  "dispatches": [
    {
      "_id": {
        "$oid": "69fb575a2900002600b1e1bd"
      },
      "_internal": {
        "created": {
          "timestamp": 1778079578000,
          "user": {
            "_id": {
              "$oid": "69fb575a2900002600b1e1b8"
            },
            "firstName": "Avinode Generated"
          }
        },
        "price": {
          "breakdown": {
            "override": 45560,
            "fees": 0,
            "expenses": 0,
            "flightTime": 36700,
            "min": 0,
            "landings": 0,
            "overnights": 0,
            "flightAttendant": 700,
            "additionalCrew": 600,
            "segment": 0,
            "fet": 0,
            "baseFET": 0,
            "feesTaxes": 0,
            "fuelSurcharge": 7560,
            "faDays": 1,
            "crewDays": 1,
            "overnightCount": 0,
            "flightMins": 252,
            "taxiMins": 0,
            "calculatedHourly": 8738.1,
            "calculatedTotal": 45560,
            "operationCost": 27342,
            "operationCostBlock": 27342
          },
          "total": 45560
        },
        "end": 1803231420000,
        "order": 1803207660000,
        "summary": "KFXE, MDLR, KTMB, KFXE"
      },
      "aircraft": {
        "_id": {
          "$oid": "673d145b2c00002200f03411"
        },
        "tailNumber": "N69FP",
        "type": {
          "type": 7,
          "_id": {
            "$oid": "57fdbd6dad34f31258000955"
          },
          "name": "Gulfstream GIV SP",
          "engines": 2
        },
        "trackHobbs": false,
        "trackOil": true,
        "paxSeats": 15
      },
      "avinode": {
        "actions": {
          "submitQuote": {
            "type": "submitQuote",
            "description": "Submit a quote",
            "httpMethod": "POST",
            "href": "https://services.avinode.com/api/tripmsgs/asellerlift-159203212/submitQuote"
          },
          "decline": {
            "type": "decline",
            "description": "Decline",
            "httpMethod": "POST",
            "href": "https://services.avinode.com/api/tripmsgs/asell
… (truncated)
```

### [LF] POST `/api/widgets/onDuty` — crew on duty
Request body: `{}`

```json
{
  "success": true,
  "message": "Here are your users currently on duty.",
  "duties": []
}
```

### [LF] POST `/api/workOrder/all`
Request body: `{}`

```json
{
  "success": true,
  "message": "Here are your work orders",
  "workOrders": [
    {
      "_id": {
        "$oid": "6750f74c2900001b00da6f13"
      },
      "aircraft": {
        "_id": {
          "$oid": "673d145b2c00002200f03411"
        },
        "paxSeats": 15,
        "tailNumber": "N69FP",
        "type": {
          "type": 7,
          "_id": {
            "$oid": "57fdbd6dad34f31258000955"
          },
          "name": "Gulfstream GIV SP",
          "engines": 2
        }
      },
      "airport": "KFXE",
      "assigned": {
        "_id": {
          "$oid": "674a9aba2b00001f0042143a"
        },
        "airport": "KMCO",
        "code": "9CSA421M",
        "name": "Exjet Aviation"
      },
      "completed": true,
      "end": 1733374124000,
      "findings": null,
      "maintenance": [],
      "name": "W/O 24000, 60 HZ Inverter",
      "operation": {
        "$oid": "673d0ce128be3d965cff2d14"
      },
      "proposedEnd": 1733445788000,
      "smsEvents": [
        {
          "$oid": "6750f6fd2900001e00da6df5"
        }
      ],
      "start": 1733013788000
    },
    {
      "_id": {
        "$oid": "6750f54f2c00001b0033e2b2"
      },
      "aircraft": {
        "_id": {
          "$oid": "673d145b2c00002200f03411"
        },
        "paxSeats": 15,
        "tailNumber": "N69FP",
        "type": {
          "type": 7,
          "_id": {
            "$oid": "57fdbd6dad34f31258000955"
          },
          "name": "Gulfstream GIV SP",
          "engines": 2
        }
      },
      "airport": "KFXE",
      "assigned": {
        "_id": {
          "$oid": "674a9aba2b00001f0042143a"
        },
        "airport": "KMCO",
        "code": "9CSA421M",
        "name": "Exjet Aviation"
      },
      "completed": true,
      "end": 1733375022000,
      "findings": "Troubleshoot Sign system ",
      "maintenance": [],
      "name": "W/O 24001, Seatbelt Sign ",
      "operation": {
        "$oid": "673d0ce128be3d965cff2d14"
      },
      "proposedEnd": 1733445231000,
      "smsEvents": [
        {
          "$oid": "674715cc2c00001f00a58fed"
        }
      ],
      "start": 1733358831000
    },
    {
      "_id": {
        "$oid": "676098612c00002000
… (truncated)
```

### [LF] POST `/api/analytics/dutyTimes` — duty times
Request body: `{"start":1771624022345,"end":1787176022345}`

```json
{
  "success": true,
  "message": "Here are your duty times summary.",
  "legs": [
    {
      "_id": {
        "$oid": "695edfae2a00001c0023a766"
      },
      "_calc": {
        "baseDistance": 967.2363824112934,
        "distance": {
          "value": 967,
          "unit": "nm"
        },
        "miles": {
          "value": 1112,
          "unit": "mi"
        },
        "time": "2:17",
        "unbiased": 140,
        "_minutes": 137,
        "minutes": 137,
        "fuel": {
          "value": 8050,
          "unit": "lbs"
        },
        "from": {
          "name": "FORT LAUDERDALE, FL",
          "timezone": "America/New_York",
          "country": "US",
          "runways": {
            "length": 6002,
            "width": 100,
            "surface": "ASP",
            "lights": "HIRL",
            "pcn": "18 /F/A/X/T"
          },
          "elevation": 13,
          "comms": {
            "TWR": " 120.900",
            "GND": " 121.750",
            "UNICOM": " 122.950",
            "CLRDEL1": " 127.950",
            "ATIS": " 119.850"
          },
          "location": {
            "lat": 26.19727897644043,
            "lng": -80.17070007324219
          }
        },
        "to": {
          "name": "CHARLOTTE AMALIE, VI",
          "timezone": "America/St_Thomas",
          "country": "VI",
          "runways": {
            "length": 7000,
            "width": 150,
            "surface": "ASP",
            "lights": "HIRL",
            "navaids": "RNAV|"
          },
          "elevation": 23,
          "comms": {
            "TWR": " 118.100",
            "GND": " 121.900",
            "UNICOM": " 122.950",
            "ATIS": " 124.000"
          },
          "location": {
            "lat": 18.33730697631836,
            "lng": -64.97333526611328
          }
        },
        "costs": {
          "segment": 23.4
        }
      },
      "arrival": {
        "airport": "TIST",
        "time": 1770639420000,
        "fbo": {
          "id": "141246",
          "name": "STANDARD AVIATION",
          "address": {
            "street": "8203 LINDBERG BAY",
            "city": "ST THOMAS IS.",
            "state": "ST. THOMAS IS.",
        
… (truncated)
```

### [LF] POST `/api/analytics/tickets` — maintenance tickets
Request body: `{"start":1771624022345,"end":1787176022345}`

```json
{
  "success": true,
  "message": "Here are your tickets.",
  "totals": {
    "3": [
      {
        "_id": {
          "$oid": "67fbee232b00002700e8f866"
        },
        "aircraft": {
          "_id": {
            "$oid": "673d145b2c00002200f03411"
          },
          "paxSeats": 15,
          "tailNumber": "N69FP",
          "type": {
            "type": 7,
            "_id": {
              "$oid": "57fdbd6dad34f31258000955"
            },
            "name": "Gulfstream GIV SP",
            "engines": 2
          }
        },
        "asapEvent": false,
        "ataCode": 0,
        "createdOn": 1744563747000,
        "description": "On April 8, 2025, aircraft N69FP repositioned from KOPF to KFXE following a multi-leg trip\nwith passengers. Upon arrival, the crew discovered that Runway 09/27 at KFXE was closed via\nNOTAM.",
        "eventDate": 1744131700000,
        "id": 13,
        "id_str": "13",
        "logs": {
          "opened": {
            "timestamp": 1744567839000,
            "user": {
              "_id": {
                "$oid": "673d0dd92c00001b00ee3c05"
              },
              "firstName": "Jaime ",
              "lastName": "Torres Parra"
            }
          },
          "processed": {
            "timestamp": 1744569834000,
            "user": {
              "_id": {
                "$oid": "673d0dd92c00001b00ee3c05"
              },
              "firstName": "Jaime ",
              "lastName": "Torres Parra"
            }
          },
          "analyzed": {
            "timestamp": 1744569111000,
            "user": {
              "_id": {
                "$oid": "673d0dd92c00001b00ee3c05"
              },
              "firstName": "Jaime ",
              "lastName": "Torres Parra"
            }
          },
          "corrected": {
            "timestamp": 1744571109000,
            "user": {
              "_id": {
                "$oid": "673d0dd92c00001b00ee3c05"
              },
              "firstName": "Jaime ",
              "lastName": "Torres Parra"
            }
          },
          "followedUp": {
            "assigned": {
              "title": "Chief Pilot",
              "_id": {
                
… (truncated)
```

### [LF] GET `/api/aircraft/69a0fae31c00002a00611199`

```json
{
  "success": true,
  "message": "Here is your aircraft",
  "aircraft": {
    "_id": {
      "$oid": "69a0fae31c00002a00611199"
    },
    "active": true,
    "tailNumber": "N408JS",
    "serial": "1402",
    "type": {
      "type": 7,
      "_id": {
        "$oid": "57fdbd6dad34f31258000955"
      },
      "name": "Gulfstream GIV SP",
      "engines": 2
    },
    "operation": {
      "$oid": "673d0ce128be3d965cff2d14"
    },
    "legacy": {
      "date": 1772157733380,
      "time": 8187.8,
      "cycles": 3926
    },
    "trackHobbs": false,
    "trackOil": true,
    "airport": "KFXE",
    "color": "White, Blue and Silver Trim",
    "fbo": {
      "id": "1039",
      "name": "BANYAN AIR SERVICE"
    },
    "is91Only": true,
    "paxSeats": 14,
    "year": 2000,
    "owner": {
      "_id": {
        "$oid": "69a0ff891c0000260061aaec"
      },
      "firstName": "",
      "lastName": "",
      "owner": {
        "company": "Agro Lewis LLC"
      }
    },
    "images": [
      {
        "id": "69a3bb0c2500001b0010826f",
        "etag": "\"fc5958fd42eda3ee04975e3766df2808\"",
        "timestamp": 1772337932000
      },
      {
        "id": "69a3bb1f25000029001082d5",
        "etag": "\"9692ef6a0ba793ea701b1fc354207359\"",
        "timestamp": 1772337951000
      }
    ],
    "foreflight": {
      "active": true
    },
    "components": {
      "engines": {
        "1": {
          "_id": {
            "$oid": "69a1016a2500001d00d08d6f"
          },
          "manufacturer": "ROLLS-ROYCE DERBY PLC",
          "model": "TAY611-8",
          "serial": "16933"
        },
        "2": {
          "_id": {
            "$oid": "69a102322500001b00d0a58d"
          },
          "manufacturer": "ROLLS-ROYCE DERBY PLC",
          "model": "TAY611-8",
          "serial": "16934"
        }
      },
      "apu": {
        "_id": {
          "$oid": "69a102911c00001e00622130"
        },
        "manufacturer": "HONEYWELL",
        "model": "GTCP36-150[G]",
        "serial": "P-903"
      }
    },
    "cruiseSpeed": 464,
    "fuelBurns": [
      4000,
      3200,
      3000
    ],
    "limits": {
      "minPilots": 2,
      "baggage": {
        "external": 0,
        "internal
… (truncated)
```

### [LF] GET `/api/workOrder/6750f74c2900001b00da6f13`

```json
{
  "success": true,
  "message": "Here are your work order",
  "workOrder": {
    "_id": {
      "$oid": "6750f74c2900001b00da6f13"
    },
    "aircraft": {
      "_id": {
        "$oid": "673d145b2c00002200f03411"
      },
      "paxSeats": 15,
      "tailNumber": "N69FP",
      "type": {
        "type": 7,
        "_id": {
          "$oid": "57fdbd6dad34f31258000955"
        },
        "name": "Gulfstream GIV SP",
        "engines": 2
      }
    },
    "airport": "KFXE",
    "assigned": {
      "_id": {
        "$oid": "674a9aba2b00001f0042143a"
      },
      "airport": "KMCO",
      "code": "9CSA421M",
      "name": "Exjet Aviation"
    },
    "completed": true,
    "end": 1733374124000,
    "name": "W/O 24000, 60 HZ Inverter",
    "operation": {
      "$oid": "673d0ce128be3d965cff2d14"
    },
    "proposedEnd": 1733445788000,
    "smsEvents": [
      {
        "_id": {
          "$oid": "6750f6fd2900001e00da6df5"
        },
        "aircraft": {
          "_id": {
            "$oid": "673d145b2c00002200f03411"
          },
          "paxSeats": 15,
          "tailNumber": "N69FP",
          "type": {
            "type": 7,
            "_id": {
              "$oid": "57fdbd6dad34f31258000955"
            },
            "name": "Gulfstream GIV SP",
            "engines": 2
          }
        },
        "anonymous": false,
        "ataCode": 25,
        "createdBy": {
          "_id": {
            "$oid": "673d0dd92c00001b00ee3c05"
          },
          "firstName": "Jaime ",
          "lastName": "Torres Parra"
        },
        "createdOn": 1733359357000,
        "description": "60Hz inverter found to be faulty, intermittent electrical load",
        "discrepancy": true,
        "eventDate": 1733013737000,
        "id": 2,
        "id_str": "2",
        "logs": {
          "opened": {
            "timestamp": 1737850980000,
            "user": {
              "_id": {
                "$oid": "673d0dd92c00001b00ee3c05"
              },
              "firstName": "Jaime ",
              "lastName": "Torres Parra"
            }
          },
          "corrected": {
            "timestamp": 1733509639000,
            "user": {
              "_id": {
      
… (truncated)
```
