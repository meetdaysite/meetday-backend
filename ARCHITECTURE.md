# Master Architecture & Technical Systems Specification: Meetday Ecosystem

**Document Title:** Unified Software Architecture Document (SAD) & Engineering Manual  
**Document Version:** 1.1.0 (Production Master with AI Subsystem)  
**GitHub Organization:** [`https://github.com/meetdaysite`](https://github.com/meetdaysite)  

---

# Table of Contents
1. [Executive Summary & Product Scope](#1-executive-summary--product-scope)
2. [GitHub Repositories & Workspace Topology](#2-github-repositories--workspace-topology)
3. [High-Level System Architecture (C4 Model)](#3-high-level-system-architecture-c4-model)
4. [Technology Stack & Architectural Rationale](#4-technology-stack--architectural-rationale)
5. [Comprehensive Subsystem & Module Directory](#5-comprehensive-subsystem--module-directory)
   - 5.1 [Backend Core Modules (`meetday-backend`)](#51-backend-core-modules-meetday-backend)
   - 5.2 [AI Microservice & Multi-Agent Architecture (`meetday-ai`)](#52-ai-microservice--multi-agent-architecture-meetday-ai)
6. [Data Architecture & Entity Relationship Model (ERD)](#6-data-architecture--entity-relationship-model-erd)
7. [End-to-End Runtime Execution Flows (Sequence Traces)](#7-end-to-end-runtime-execution-flows-sequence-traces)
8. [Unified Environment Variables Dictionary (.env Reference)](#8-unified-environment-variables-dictionary-env-reference)
9. [Security, Governance & Data Protection](#9-security-governance--data-protection)
10. [Background Processing, Queues & Scheduled Jobs](#10-background-processing-queues--scheduled-jobs)
11. [DevOps, Docker Topology & CI/CD Pipelines](#11-devops-docker-topology--cicd-pipelines)
12. [Architectural Risks, Technical Debt & Future Roadmap](#12-architectural-risks-technical-debt--future-roadmap)

---

# 1. Executive Summary & Product Scope

### 1.1 Product Mission
**Meetday** is a community-first, in-real-life (IRL) social experiences, community organizing, event ticketing, venue discovery, brand sponsorship, and generative AI copilot ecosystem.

Unlike traditional isolated event ticketing tools, Meetday unifies the complete offline-to-online experience lifecycle:
- **Attendees** *(codebase only — not currently active in the product)*: Discover curated local events, purchase tiered passes, network with other guests, engage in real-time community chat/channels, and check in at doors with anti-passback QR passes.
- **Community Organizers**: Create and manage persistent community hubs, schedule events, run AI-assisted event drafting via Host Copilot, define ticketing tiers, run door-scanner sessions, receive payouts, and secure brand sponsorships. *(Note: event creation from the community side is implemented in the codebase but is not currently active in the product.)*
- **Brands**: Browse relevant niche communities, execute AI-guided marketing campaigns via Campaign Copilot, negotiate sponsorship deals, chat directly with organizers, and book venue spaces.
- **Space Partners**: List physical venue spaces (`SpaceCommunityProfile`), showcase capacity and amenities, receive interest from community organizers and brands, negotiate and lock space deals.
- **Platform Administrators**: Supervise content moderation, verify community and venue payout accounts (KYC/Sandbox), audit financial transactions, review deals, and monitor platform health.
- **AI Intelligence Layer (`meetday-ai`)**: Autonomous multi-agent microservice providing structured natural-language-to-event generation, proposal deck synthesis, automated deliverable valuations, and customer concierge support triage powered by Gemini 2.5 Flash.

```mermaid
flowchart TD
    MD([MEETDAY - The IRL Social Experiences & AI Platform])

    MD --> A[Attendees - Codebase Only]
    MD --> H[Community Organizers]
    MD --> B[Brands]
    MD --> SP[Space Partners]
    MD --> ADM[Admins]
    MD --> AI[Meetday AI Microservice]

    A --> A1[Discover Events & Networking]

    H --> H1[Community Hubs & Channels]
    H --> H2[Host Copilot - Event Generation]
    H --> H3[Venue Co-Hosting & Payouts]

    B --> B1[Niche Community Discovery]
    B --> B2[Campaign Copilot & Sponsorships]
    B --> B3[Book Venue Spaces]

    SP --> SP1[List Venue Spaces]
    SP --> SP2[Bi-Directional Channel Requests]
    SP --> SP3[Negotiate & Lock Space Deals]

    ADM --> ADM1[Content Moderation]
    ADM --> ADM2[KYC & Payout Approvals]
    ADM --> ADM3[Audit & Platform Health]

    AI --> AI1[Host Copilot Multi-Agent Pipeline]
    AI --> AI2[Campaign & Proposal Copilots]
    AI --> AI3[Deck Planning & Support Classifier]
```

---

# 2. GitHub Repositories & Workspace Topology

The platform is maintained as modular repositories under the GitHub organization **[`meetdaysite`](https://github.com/meetdaysite)**:

| Repository Name | Remote URL | Role & Tech Stack | Default Port |
|---|---|---|---|
| **`meetday-backend`** | `https://github.com/meetdaysite/meetday-backend.git` | Central REST API & WebSocket Gateway (NestJS, Prisma, PostgreSQL, Redis, BullMQ) | `3000` |
| **`meetday-frontend`**| `https://github.com/meetdaysite/meetday-frontend.git`| Member & Community Web App (Next.js 16, React 19, Tailwind v4, Zustand, Socket.io client) | `3001` |
| **`meetday-admin`**   | `https://github.com/meetdaysite/meetday-admin.git`   | Back-Office Management Portal (Next.js 16, TanStack Query v5 & Table v8, Radix UI) | `3002` |
| **`meetday-ai`**      | `https://github.com/meetdaysite/meetday-ai.git`      | Multi-Agent GenAI Microservice (Python 3.12+, FastAPI, Google GenAI SDK, Gemini 2.5 Flash, slowapi) | `8001` |

### 2.1 Directory Structure Overview
```
meetday/
├── meetday-backend/                 # NestJS Application Server
│   ├── prisma/                      # schema.prisma, migrations, seeds & backfill scripts
│   ├── scripts/                     # Operational utilities (e.g. image uploads, seeders)
│   ├── src/
│   │   ├── app.module.ts            # Root orchestrator (32 modules + global filters/guards)
│   │   ├── main.ts                  # Server bootstrap (Helmet, CORS, ValidationPipe, Swagger)
│   │   ├── common/                  # Shared crypto, guards, interceptors, mail, redis, storage
│   │   ├── config/                  # Configuration loaders and Joi/Zod env validation
│   │   └── modules/                 # 32 decoupled domain feature modules
│   ├── docker-compose.yml           # Local & staging container definitions (App, Postgres, Redis)
│   └── Dockerfile                   # Multi-stage production container build
│
├── meetday-frontend/                # Member & Community Web Application
│   ├── public/                      # Static assets, icons, fonts
│   └── src/
│       ├── app/                     # Next.js 16 App Router (routes, layouts, server pages)
│       ├── components/              # Modular UI components (events, chat, checkout, modals)
│       ├── context/                 # React Context providers (Auth, Theme)
│       ├── hooks/                   # Custom client hooks (WebSocket, geolocation, scanner)
│       ├── lib/                     # Axios instance, Firebase client, utility functions
│       ├── store/                   # Zustand global state slices
│       └── types/                   # Shared TypeScript interfaces & DTO representations
│
├── meetday-admin/                   # Operations & Moderation Portal
│   ├── public/                      # Static branding assets
│   └── src/
│       ├── app/                     # Next.js 16 App Router (dashboards, audit, payouts, users)
│       ├── components/              # Radix UI + Tailwind tables, forms, filters, metric cards
│       ├── lib/                     # TanStack Query client, API client, date formatters
│       ├── store/                   # Zustand admin session state
│       └── types/                   # Admin DTOs, audit schemas, moderation payloads
│
└── meetday-ai/                      # AI Microservice & Multi-Agent Inference Engine
    ├── app/
    │   ├── main.py                  # FastAPI lifespan & application entrypoint
    │   ├── api/v1/router.py         # Central modular feature router aggregator
    │   ├── core/
    │   │   ├── config.py            # Pydantic v2 Settings (Vertex AI & Studio toggles)
    │   │   ├── gemini_client.py     # Thread-safe Google GenAI singleton client
    │   │   ├── base_agent.py        # Abstract Base Agent (ABC) with retry policies
    │   │   ├── backend_client.py    # Inter-service authenticated HTTP client to meetday-backend
    │   │   └── limiter.py           # Slowapi distributed IP/host rate limiter
    │   ├── common/
    │   │   ├── schemas.py           # Standardized HealthResponse, ErrorResponse schemas
    │   │   ├── exceptions.py        # Domain exception hierarchy (GeminiApiError, AgentTimeout)
    │   │   └── middleware.py        # Global error interceptor & latency tracking middleware
    │   └── features/                # Domain-Isolated AI Agent Pipelines
    │       ├── copilot/             # Host Copilot (Content, Classification, Metadata, Pricing)
    │       ├── campaign_copilot/    # Brand Campaign Copilot
    │       ├── proposal_copilot/    # Sponsorship Proposal Copilot
    │       ├── proposal_deck/       # Proposal Pitch Deck Layout Planner & Generator
    │       └── support_chatbot/     # Inbound Support Classifier & Concierge
    ├── tests/                       # Unit & integration test suites (pytest, httpx)
    ├── pyproject.toml               # Poetry/pip build configuration
    ├── Dockerfile                   # Python 3.12-slim production container
    └── docker-compose.yml           # AI microservice local stack
```

---

# 3. High-Level System Architecture (C4 Model)

### 3.1 C4 Level 1: System Context Diagram

```mermaid
flowchart TD
    subgraph Users
        Attendee[Attendee - Codebase Only]
        Community[Community Organizer]
        BrandUser[Brand Sponsor]
        SpacePartner[Space Partner]
        AdminUser[Platform Admin]
    end

    subgraph MeetdayPlatform[Meetday Core Platform]
        WebClient[Meetday Web App - Next.js 16]
        AdminClient[Meetday Admin Portal - Next.js 16]
        BackendAPI[Meetday Backend API - NestJS]
        AIMicroservice[Meetday AI Microservice - FastAPI]
    end

    subgraph ExternalServices[External Cloud Services & SaaS]
        FirebaseAuth[Firebase Auth]
        RazorpayGW[Razorpay Payment Gateway]
        GCS[Google Cloud Storage]
        GoogleMaps[Google Maps Platform]
        MailProvider[SMTP Mail Dispatcher]
        SandboxKYC[Sandbox Bank KYC]
        GoogleGemini[Google Gemini 2.5 Flash / Vertex AI]
    end

    Attendee --> WebClient
    Community --> WebClient
    BrandUser --> WebClient
    SpacePartner --> WebClient
    AdminUser --> AdminClient

    WebClient -->|HTTPS & WSS| BackendAPI
    AdminClient -->|HTTPS & WSS| BackendAPI

    BackendAPI -->|Internal REST & HMAC| AIMicroservice
    AIMicroservice -->|Fetch Context| BackendAPI

    BackendAPI -->|Verify JWTs| FirebaseAuth
    BackendAPI -->|Orders & Webhook HMAC| RazorpayGW
    BackendAPI -->|Presigned Media Uploads| GCS
    BackendAPI -->|Venue Geocoding| GoogleMaps
    BackendAPI -->|Transactional Emails| MailProvider
    BackendAPI -->|Bank Validation| SandboxKYC
    AIMicroservice -->|GenAI Structured Inference| GoogleGemini
```

---

### 3.2 C4 Level 2: Container Diagram

```mermaid
flowchart TD
    subgraph ClientApplications[Edge & Client Layer]
        Web[meetday-frontend - Next.js 16 - Port 3001]
        Admin[meetday-admin - Next.js 16 - Port 3002]
    end

    subgraph CoreBackend[Application & Gateway Server]
        NestApp[meetday-backend - NestJS - Port 3000]
        WSGateway[Socket.io Gateway - Redis Adapter]
        BullWorker[BullMQ Workers - Mail & Processing]
    end

    subgraph AIServiceLayer[AI Microservice Cluster]
        FastAPIApp[meetday-ai - FastAPI - Port 8001]
        CopilotOrch[Host Copilot Orchestrator]
        CampaignOrch[Campaign Copilot Orchestrator]
        ProposalOrch[Proposal Copilot Orchestrator]
        DeckOrch[Deck Plan Orchestrator]
        SupportOrch[Support Chatbot Classifier]
    end

    subgraph DataStorageLayer[State & Persistence Tier]
        Postgres[(PostgreSQL 16 - Prisma 5)]
        Redis[(Redis 7 - State, Cache & Queues)]
        CloudStorage[(Google Cloud Storage)]
    end

    Web -->|REST API| NestApp
    Web -->|WebSocket| WSGateway
    Admin -->|REST API| NestApp
    Admin -->|WebSocket| WSGateway

    NestApp -->|REST Client /copilot/*| FastAPIApp
    FastAPIApp -->|BackendClient /api/v1/*| NestApp

    FastAPIApp --> CopilotOrch
    FastAPIApp --> CampaignOrch
    FastAPIApp --> ProposalOrch
    FastAPIApp --> DeckOrch
    FastAPIApp --> SupportOrch

    NestApp -->|Prisma ORM| Postgres
    NestApp -->|ioredis| Redis
    WSGateway -->|Pub/Sub & Presence| Redis
    BullWorker -->|Queue Jobs| Redis
    NestApp -->|Uploads| CloudStorage
```

---

# 4. Technology Stack & Architectural Rationale

| Layer / Concern | Technology Selection | Version | Technical Rationale & Decision Drivers |
|---|---|---|---|
| **Backend Framework** | **NestJS** | `^10.0.0` | TypeScript-first, strict Dependency Injection, enterprise modular structure, native Swagger and WebSocket gateways. |
| **Relational ORM** | **Prisma** | `^5.0.0` | Type-safe migrations, auto-generated TypeScript definitions, declarative schema syntax (`schema.prisma`). |
| **Primary Database** | **PostgreSQL** | `16-alpine` | ACID compliance, JSONB support, robust relational integrity with complex multi-table joins and foreign keys. |
| **In-Memory Cache & Queue** | **Redis** | `7-alpine` | Microsecond latency for WebSocket presence tracking, distributed socket adapter, and BullMQ queue broker. |
| **AI Microservice Framework** | **FastAPI (Python)** | `^0.115.0` | High-throughput asynchronous async/await runtime, native Pydantic v2 validation, OpenAPI/Swagger auto-generation. |
| **GenAI Inference Engine** | **Google GenAI SDK** | `google-genai` | Direct integration with **Gemini 2.5 Flash**, supporting Vertex AI (ADC credentials) and Google AI Studio structured JSON schemas. |
| **Multi-Agent Orchestrator** | **Custom Python Async**| Custom | Parallel agent execution using `asyncio.gather` for classification, metadata, pricing, and content generation. |
| **Background Job Processing**| **BullMQ / Bull** | `^4.10.0` | Decouples time-intensive tasks (email sending, image processing, backfills) from synchronous HTTP request lifecycles. |
| **Real-time Engine** | **Socket.io** | `^10.4.22` | Bi-directional event communication for community chat, direct messaging, and live notifications with Redis adapter. |
| **Authentication Authority** | **Firebase Admin / SDK** | `^12.0.0` | Scalable identity provider supporting phone auth, Google Sign-In, and cryptographically verified JWT claims. |
| **Payment Gateway** | **Razorpay** | `^2.9.6` | UPI, NetBanking, Credit/Debit cards, automatic order creation, and cryptographic webhook HMAC-SHA256 verification. |
| **Encryption Suite** | **CryptoModule (AES-256-GCM)**| Custom | Hardware-accelerated symmetric encryption for community bank account details and payout credentials. |
| **Frontend Framework (Web)** | **Next.js** | `16.2.4` | App Router, SSR for SEO-critical event landing pages, React 19 concurrent features, Tailwind CSS v4 styling. |
| **Admin Dashboard** | **Next.js + TanStack** | `16.2.2` | Data-dense management interface powered by TanStack Query v5 (client-side caching) and TanStack Table v8. |
| **Containerization** | **Docker & Compose** | Multi-stage | Alpine/Slim baselines, production-minimized container footprints, reproducible dev and production staging. |

---

# 5. Comprehensive Subsystem & Module Directory

### 5.1 Backend Core Modules (`meetday-backend/src/modules/`)
The backend is organized into **32 feature modules**, each encapsulating its own Controllers, Services, DTOs, and Business Invariants:

1. **`auth`**: Handles Firebase token verification, registration velocity checks, user onboarding, and initial profile provisioning.
2. **`users`**: Manages personal profile details, notification preferences, interest affinities, and peer connection graphs.
3. **`hosts`** *(module represents Community Organizer profiles)*: Handles Community Profile creation, verification approvals, community team member invitations, and commission rates.
4. **`brands`**: Manages Brand profiles, marketing reps, brand team members, and targeted sponsorship outreach.
5. **`spaces`**: Physical venue management (`SpaceProfile` + `SpaceCommunityProfile`). Space Partners list venue spaces, manage capacity and amenities, receive bi-directional interest from communities and brands, and lock `SpaceDeal`s.
6. **`events`**: Core lifecycle for event scheduling, drafts, review/revision workflow, pricing, geo-coordinates, and publication. Integrated with `CopilotService` to bridge to `meetday-ai`. *(Note: event creation from the community side is implemented in the codebase but is not currently active in the product.)*
7. **`tickets`**: Ticket tier configurations (Free, Paid, VIP, Early Bird), inventory allocation, and purchase quotas.
8. **`orders`**: Transactional state machine (`DRAFT` -> `PENDING_PAYMENT` -> `CONFIRMED` -> `CANCELLED` -> `REFUNDED`).
9. **`payments`**: Razorpay checkout integration, order creation, and cryptographic HMAC-SHA256 signature verification.
10. **`check-in`**: Event door management, scanner session tokens, QR code validation, and anti-passback enforcement.
11. **`communities`**: Community hubs, member rosters, member roles (`OWNER`, `MANAGER`, `MEMBER`), and join requests.
12. **`community-chat`**: WebSocket gateway (`/socket.io`), public channels, direct messaging (DMs), presence, and read states.
13. **`community-feed`**: Community social timeline, posts, comments, media attachments, and engagement metrics.
14. **`community-announcements`**: Priority broadcast channels from community organizers to members with notification fan-out.
15. **`sponsorship`**: Multi-party sponsorship proposals, contract deliverables, payout escrow, and deal completion reports.
16. **`space-host-interest`**: Negotiation engine between physical venue owners and community organizers for space co-hosting.
17. **`payouts`**: Automated and manual community organizer payout ledgers, commission calculations, and bank transfer batches.
18. **`refunds`**: Ticket cancellation requests, partial/full refunds, and payment gateway balance adjustments.
19. **`reviews`**: Post-event reviews, star ratings, and community credibility metrics.
20. **`audit-log`**: Immutable operational trail logging actor IDs, actions, entities, and IP addresses.
21. **`admin`**: Back-office administrative endpoints for platform-wide metrics, KYC reviews, user roles, ongoing chat consolidation, and system config.
22. **`attendee`** *(codebase only — not currently active in the product)*: Attendee-specific profiles, event history, bookmarks, and purchased ticket wallets.
23. **`categories`**: Taxonomy and taxonomy hierarchy for events and communities.
24. **`interests`**: Global interest catalog and user interest affinity backfilling.
25. **`graph`**: Social graph calculation, connection recommendations, and mutual member analysis.
26. **`campaigns`**: Marketing and promotional campaigns across events and email blasts.
27. **`consent`**: User consent records, terms acceptance, and privacy compliance tracking.
28. **`support-ticket`**: Helpdesk system for user disputes, organizer issues, and admin ticket resolution.
29. **`meetday-chat`**: Direct messaging channel between platform users and Meetday official support/concierge.
30. **`maintenance`**: Scheduled health checks, cache invalidation hooks, and background cleanup scripts.
31. **`notifications`**: Multi-channel notifications (In-app, Push, and Email via Bull queue).
32. **`phone-otp`**: SMS OTP authentication integration (ready for Fast2SMS DLT activation).

---

### 5.2 AI Microservice & Multi-Agent Architecture (`meetday-ai`)
The AI layer is structured as a modular, stateless microservice hosted under `meetday-ai`. Features are completely encapsulated in `app/features/<feature_name>`:

```mermaid
flowchart TD
    subgraph ClientAndBackend[Inbound Requests]
        BE[meetday-backend CopilotService]
    end

    subgraph APIRouter[FastAPI v1 Central Router]
        R1[POST v1 copilot generate-draft]
        R2[POST v1 campaign-copilot generate-draft]
        R3[POST v1 proposal-copilot generate-draft]
        R4[POST v1 proposal-deck plan]
        R5[POST v1 support-chatbot classify]
    end

    subgraph FeaturePipelines[Isolated Multi-Agent Feature Suites]
        subgraph CopilotSuite[Host Copilot Suite]
            DO[DraftOrchestrator]
            CA1[ContentAgent]
            CLA[ClassificationAgent]
            MA[MetadataAgent]
            PA1[PricingAgent]
        end

        subgraph CampaignSuite[Campaign Copilot Suite]
            CO[CampaignCopilotOrchestrator]
            CDA[CampaignDraftAgent]
        end

        subgraph ProposalSuite[Proposal Copilot Suite]
            PO[ProposalDraftOrchestrator]
            PA2[ProposalContentAgent]
            PPA[ProposalPricingAgent]
        end

        subgraph DeckSuite[Proposal Deck Suite]
            PDKO[ProposalDeckOrchestrator]
            PLA[PlanAgent]
            DCA[DeckContentAgent]
        end

        subgraph SupportSuite[Support Chatbot Suite]
            SCO[SupportChatbotOrchestrator]
            SA[SupportAgent]
        end
    end

    subgraph CoreEngine[AI Core Layer]
        GC[(GeminiClient - Gemini 2.5 Flash)]
        BC[(BackendClient - Meetday Backend API)]
    end

    BE --> R1
    BE --> R2
    BE --> R3
    BE --> R4
    BE --> R5

    R1 --> DO
    DO --> CA1
    CA1 --> CLA
    CA1 --> MA
    CA1 --> PA1

    R2 --> CO --> CDA
    R3 --> PO --> PA2
    R3 --> PO --> PPA
    R4 --> PDKO --> PLA --> DCA
    R5 --> SCO --> SA

    CA1 --> GC
    CLA --> GC
    MA --> GC
    PA1 --> GC
    CDA --> GC
    PA2 --> GC
    PPA --> GC
    PLA --> GC
    DCA --> GC
    SA --> GC

    PO -.->|Fetch Community and Brand Context| BC
```

#### Detailed AI Feature Directory:
1. **`copilot` (Host Copilot / Event Draft Generation)**:
   - **Endpoint**: `POST /v1/copilot/generate-draft`
   - **Orchestrator**: `DraftOrchestrator`
   - **Agents**:
     - `ContentAgent`: Ingests natural-language event prompt and hints; synthesizes engaging Title and Markdown Description.
     - `ClassificationAgent`: Categorizes the draft into the strict taxonomy (`business_networking`, `music`, `tech`, `lifestyle`, etc.) and determines language.
     - `MetadataAgent`: Infers target audience tags, ideal day of the week, and timing slot.
     - `PricingAgent`: Analyzes scope, venue overhead, and attendee profile to recommend pricing tiers (`free`, `budget`, `premium`, `luxury`).
   - **Concurrency Pattern**: `ContentAgent` executes first; `ClassificationAgent`, `MetadataAgent`, and `PricingAgent` execute concurrently via `asyncio.gather`.
   - **Result**: Complete event draft with calibrated `confidence_score` and traceable `ai_suggestions_used`.

2. **`campaign_copilot` (Brand Campaign Copilot)**:
   - **Endpoint**: `POST /v1/campaign-copilot/generate-draft`
   - **Orchestrator**: `CampaignCopilotOrchestrator`
   - **Agent**: `CampaignDraftAgent`
   - **Function**: Takes a brand's high-level marketing objective (e.g., *"Beverage sampling for college students during tech fests"*) and constructs a structured campaign specification: Target community niches, budget allocation recommendations, deliverable milestones, and KPI metrics.

3. **`proposal_copilot` (Sponsorship Proposal Copilot)**:
   - **Endpoint**: `POST /v1/proposal-copilot/generate-draft`
   - **Orchestrator**: `ProposalDraftOrchestrator`
   - **Agents**: `ProposalContentAgent`, `ProposalPricingAgent`
   - **Function**: Bridges between Community Organizers and Brands. Queries the backend via `BackendClient` to fetch real community demographics, past attendance, and brand affinity, then generates customized sponsorship deliverables, value justifications, and contract terms.

4. **`proposal_deck` (Pitch Deck Planner & Presentation Generator)**:
   - **Endpoint**: `POST /v1/proposal-deck/plan`
   - **Orchestrator**: `ProposalDeckOrchestrator`
   - **Agents**: `PlanAgent`, `DeckContentAgent`
   - **Function**: Converts raw sponsorship proposals into presentation decks. `PlanAgent` decides the slide narrative (Title slide, Problem, Community Reach, Demographics, Deliverable Tiering, Contact), selecting specific visual layout archetypes per slide, while `DeckContentAgent` populates structured slide copy.

5. **`support_chatbot` (Inbound Support Classifier & Concierge)**:
   - **Endpoint**: `POST /v1/support-chatbot/classify`
   - **Orchestrator**: `SupportChatbotOrchestrator`
   - **Agent**: `SupportAgent`
   - **Function**: Triages incoming chat messages in `meetday-chat`. Analyzes user intent and categorizes conversations as:
     - `GREETING`: Automated greeting response.
     - `NEEDS_DETAIL`: Prompts user for missing transaction IDs, event names, or specifics.
     - `DETAILED`: Routes directly to human support or admin queue with summarized tickets.

---

# 6. Data Architecture & Entity Relationship Model (ERD)

### 6.1 Database Engine & Relational Guidelines
- **Database Engine**: PostgreSQL 16 Alpine.
- **ORM**: Prisma 5 with type-safe client generation.
- **Data Integrity**: Enforced foreign key constraints, composite unique indices, partial indices for phone/email uniqueness, and soft deletes (`deletedAt`).
- **AI Ingestion Model**: The AI microservice (`meetday-ai`) is completely stateless. It accepts transient payloads, returns validated Pydantic schemas, and delegates all persistence to `meetday-backend` through transactional Prisma operations.

### 6.2 Entity Relationship Diagram (Core Systems)

```mermaid
erDiagram
    Role ||--o{ User : has
    User ||--o| CommunityProfile : owns
    User ||--o| BrandProfile : owns
    User ||--o| SpaceProfile : owns
    User ||--o| AttendeeProfile : owns
    User ||--o{ Order : places
    User ||--o{ CommunityMember : joins

    CommunityProfile ||--o{ Community : operates
    Community ||--o{ Event : hosts
    Community ||--o{ CommunityChannel : contains
    CommunityChannel ||--o{ ChannelMessage : has

    Event ||--o{ TicketTier : offers
    TicketTier ||--o{ OrderItem : has
    Order ||--|{ OrderItem : contains
    Order ||--|{ OrderAttendee : generates
    Order ||--o| PaymentTransaction : settles

    Event ||--o{ EventScannerSession : authorizes
    EventScannerSession ||--o{ CheckInLog : records
    OrderAttendee ||--o{ CheckInLog : validates

    BrandProfile ||--o{ SponsorshipProposal : submits
    Event ||--o{ SponsorshipProposal : receives
    SponsorshipProposal ||--o| SponsorshipDeal : executes

    SpaceProfile ||--o| SpaceCommunityProfile : lists
    SpaceCommunityProfile ||--o{ SpaceInterest : receives
    SpaceInterest ||--o| SpaceDeal : locksInto
    BrandProfile ||--o{ SpaceInterest : requests
    CommunityProfile ||--o{ SpaceInterest : requests

    SpaceProfile ||--o{ SpaceHostInterest : initiates
    CommunityProfile ||--o{ SpaceHostInterest : receives
    SpaceHostInterest ||--o| SpaceHostDeal : locksInto
```

---

# 7. End-to-End Runtime Execution Flows (Sequence Traces)

### 7.1 Flow 1: Authentication & Request Guarding

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant GW as NestJS Guard
    participant FB as Firebase SDK
    participant DB as PostgreSQL
    participant Ctrl as Controller

    Client->>GW: HTTP Request with Firebase Bearer Token
    GW->>FB: verifyIdToken
    alt Invalid or Expired Token
        FB-->>GW: Verification Failed
        GW-->>Client: 401 Unauthorized
    else Valid Token
        FB-->>GW: Decoded uid and email
        GW->>DB: findUnique User by firebaseUid
        alt User Not Found
            GW-->>Client: 404 redirect to register
        else User Inactive
            GW-->>Client: 403 Forbidden
        else Authorized
            GW->>Ctrl: Execute handler with user context
            Ctrl-->>Client: 200 OK JSON response
        end
    end
```

---

### 7.2 Flow 2: Event Ticketing & Razorpay Payment Lifecycle
*(Note: This flow is implemented in the codebase but is not currently active in the product. Attendee ticket purchase and event creation from the community side are pending activation.)*

```mermaid
sequenceDiagram
    autonumber
    actor Member
    participant Web
    participant API as Meetday API
    participant RZP as Razorpay
    participant DB as PostgreSQL
    participant Queue as BullMQ Queue

    Member->>Web: Select Tickets and Checkout
    Web->>API: POST /api/v1/orders
    API->>DB: Validate Inventory and Lock Quota
    API-->>Web: Order Created with PENDING_PAYMENT status

    Web->>API: POST /api/v1/payments/initiate
    API->>RZP: Create Razorpay order with amount INR
    RZP-->>API: razorpayOrderId and key_id
    API-->>Web: Razorpay Order Payload

    Web->>Member: Open Checkout Modal
    Member->>RZP: Authorize Payment
    RZP-->>Web: payment_id and signature

    Web->>API: POST /api/v1/payments/verify
    Note over API: HMAC-SHA256 verification of order_id and payment_id
    alt Signature Mismatch
        API-->>Web: 401 Invalid signature
    else Verified
        API->>DB: Mark Order CONFIRMED and generate QR
        API->>Queue: Enqueue confirmation email
        API-->>Web: 200 Payment Confirmed
        Web->>Member: Show Ticket and Download Pass
    end
```

---

### 7.3 Flow 3: Real-Time Community Chat & Redis Presence

```mermaid
sequenceDiagram
    autonumber
    actor UserA as MemberA
    participant WS as SocketGateway
    participant Redis
    participant DB as PostgreSQL
    actor UserB as MemberB

    UserA->>WS: Connect with Firebase Token
    WS->>WS: Authenticate and extract userId
    WS->>Redis: Add user to presence set
    WS->>Redis: Publish presence update
    Redis-->>WS: Broadcast online status

    UserA->>WS: Send message to channel
    WS->>WS: Auto-Moderation check
    WS->>DB: Persist ChannelMessage
    WS->>Redis: Publish to channel room
    Redis-->>WS: Deliver to peers
    WS-->>UserB: Receive new message event
```

---

### 7.4 Flow 4: Door Check-In & Anti-Passback Validation

```mermaid
sequenceDiagram
    autonumber
    actor Staff as DoorStaff
    participant Scanner
    participant API as CheckIn API
    participant DB as PostgreSQL

    Staff->>Scanner: Start Scanner Session
    Scanner->>API: POST /api/v1/check-in/sessions
    API-->>Scanner: Session Token Issued

    Staff->>Scanner: Scan QR Code
    Scanner->>API: POST /api/v1/check-in/verify
    API->>DB: Lookup OrderAttendee by qrSecret
    alt Invalid Pass
        API-->>Scanner: 400 Invalid Pass
    else Already Scanned
        API-->>Scanner: 409 Already Checked In
    else Valid
        API->>DB: Record CheckInLog
        API-->>Scanner: 200 Access Granted
        Scanner->>Staff: Green Confirmation
    end
```

---

### 7.5 Flow 5: Host Copilot Multi-Agent Generation & Orchestration Trace

```mermaid
sequenceDiagram
    autonumber
    actor Organizer as CommunityOrganizer
    participant Web
    participant Nest as meetday-backend
    participant AI as meetday-ai
    participant Orch as DraftOrchestrator
    participant CA as ContentAgent
    participant CLA as ClassificationAgent
    participant MA as MetadataAgent
    participant PA as PricingAgent
    participant Gem as Gemini25Flash

    Organizer->>Web: Host a rooftop AI demo day in Bangalore
    Web->>Nest: POST /api/v1/events/copilot/draft
    Nest->>AI: POST /v1/copilot/generate-draft

    AI->>Orch: generate_draft
    Orch->>CA: run prompt and hints
    CA->>Gem: Generate title and markdown description
    Gem-->>CA: Structured Title and Description
    CA-->>Orch: ContentResult

    par Concurrent via asyncio.gather
        Orch->>CLA: run ContentResult
        CLA->>Gem: Infer category, event_type, language
        Gem-->>CLA: ClassificationResult
    and
        Orch->>MA: run ContentResult
        MA->>Gem: Infer tags, optimal day and time
        Gem-->>MA: MetadataResult
    and
        Orch->>PA: run ContentResult
        PA->>Gem: Estimate pricing tier
        Gem-->>PA: PricingResult
    end

    CLA-->>Orch: ClassificationResult
    MA-->>Orch: MetadataResult
    PA-->>Orch: PricingResult

    Orch->>Orch: Merge fields and calculate confidence_score
    Orch-->>AI: GenerateDraftResponse
    AI-->>Nest: 200 OK Structured Draft JSON
    Nest-->>Web: 200 OK Pre-filled Event Draft
    Web->>Organizer: Interactive Review and Publish Screen
```

---

# 8. Unified Environment Variables Dictionary (.env Reference)

### 8.1 Backend API (`meetday-backend/.env`)

| Variable Name | Sample / Default Value | Purpose & Architectural Role |
|---|---|---|
| `PORT` | `3000` | HTTP listening port for NestJS application server |
| `NODE_ENV` | `development` / `production` | Enables Helmet security headers and controls log verbosity |
| `DATABASE_URL` | `postgresql://meetday:meetday@localhost:5432/meetday` | PostgreSQL connection string for Prisma ORM |
| `REDIS_HOST` | `localhost` | Redis host for Socket.io adapter, presence, and BullMQ |
| `REDIS_PORT` | `6379` | Redis port |
| `FIREBASE_PROJECT_ID` | `meetday-dev` | Firebase Project identifier |
| `FIREBASE_CLIENT_EMAIL`| `service-account@meetday-dev.iam.gserviceaccount.com`| Service account for Firebase Admin SDK JWT verification |
| `FIREBASE_PRIVATE_KEY` | `"-----BEGIN PRIVATE KEY-----\n..."` | RSA private key for Firebase token decryption |
| `MAIL_HOST` | `smtp.gmail.com` | SMTP host for transactional mail dispatch |
| `MAIL_PORT` | `587` | SMTP port (TLS) |
| `MAIL_USER` / `MAIL_PASS`| `noreply@meetday.in` | SMTP authentication credentials |
| `MAIL_FROM` | `Meetday <noreply@meetday.in>` | Default sender display header |
| `RAZORPAY_KEY_ID` | `rzp_test_...` | Public Razorpay key provided to client checkout modal |
| `RAZORPAY_KEY_SECRET` | `...` | Private secret used to compute HMAC-SHA256 signature verification |
| `ENCRYPTION_KEY` | `64_char_hex_key` | AES-256-GCM master key for encrypting host banking details |
| `FRONTEND_URL` | `http://localhost:3001` | Base URL used for invite and password reset email links |
| `ALLOWED_ORIGINS` | `https://meetday.in,https://admin.meetday.in` | Comma-separated whitelist for CORS in production |
| `GCP_PROJECT_ID` | `meetday-gcp-project` | Google Cloud project ID for cloud storage |
| `GCP_STORAGE_BUCKET` | `meetday-assets-bucket` | GCS bucket for avatars, banners, and event images |
| `SANDBOX_HOST` | `https://test-api.sandbox.co.in` | Sandbox API host for bank account/IFSC verification |
| `SANDBOX_API_KEY` | `...` | Sandbox API credential |
| `SUPER_ADMIN_EMAIL` | `superadmin@meetday.com` | Default seed credential for initial bootstrap |
| `AI_SERVER_URL` | `http://localhost:8001/v1` | Internal URL routing to `meetday-ai` microservice |
| `INTERNAL_API_KEY` | `sec_meetday_ai_internal_...` | Shared symmetric secret for inter-service authentication |

### 8.2 AI Microservice (`meetday-ai/.env`)

| Variable Name | Sample / Default Value | Purpose & Architectural Role |
|---|---|---|
| `PORT` | `8001` | HTTP listening port for FastAPI microservice |
| `MODEL_NAME` | `gemini-2.5-flash` | Google Gemini model family selected for structured generation |
| `VERTEX_AI_PROJECT` | `meetday-gcp-project` | GCP project ID when using Vertex AI (ADC credentials) |
| `VERTEX_AI_LOCATION` | `us-central1` | Regional location for Vertex AI endpoint |
| `GEMINI_API_KEY` | `AIzaSy...` | Fallback API key for Google AI Studio (local development) |
| `BACKEND_URL` | `http://localhost:3000/api/v1` | Inter-service URL to call `meetday-backend` |
| `INTERNAL_API_KEY` | `sec_meetday_ai_internal_...` | Secret key validated on inbound calls from backend |
| `RATE_LIMIT_PER_HOST` | `30/minute` | Rate limit enforced by `slowapi` on AI endpoints |
| `DEBUG` | `false` | Enables detailed stack traces in JSON error payloads |
| `LOG_LEVEL` | `INFO` / `DEBUG` | Logging level (`DEBUG` reveals agent reasoning chains) |

### 8.3 Web Client (`meetday-frontend/.env`)

| Variable Name | Sample Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` or `http://localhost:3000/api/v1` | Base URL for Axios REST client |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `AIzaSy...` | Firebase Web Client API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `meetday-dev.firebaseapp.com` | Firebase Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `meetday-dev` | Firebase Project ID |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | `AIzaSy...` | Google Maps JS API key for venue location display |
| `NEXT_PUBLIC_STORAGE_BASE_URL` | `https://storage.googleapis.com/...` | CDN / storage base URL for assets |

### 8.4 Admin Portal (`meetday-admin/.env`)

| Variable Name | Sample Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api/v1` or `http://localhost:3000/api/v1` | Base URL for TanStack Query API fetches |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `AIzaSy...` | Firebase Web Client API key for admin login |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | `AIzaSy...` | Google Maps API key for space location audit |

---

# 9. Security, Governance & Data Protection

1. **Edge Protection & Rate Limiting**:
   - `helmet()` enabled in production to set secure HTTP headers (HSTS, CSP, X-Frame-Options).
   - `IpRateLimitMiddleware`: Sliding window IP rate-limiting applied across all routes.
   - `RegistrationVelocityMiddleware`: Guard restricting rapid automated user registrations from identical IP ranges.
   - `@nestjs/throttler`: Tiered throttling on backend endpoints.
   - `slowapi` rate limiting applied to AI inference routes (`/v1/copilot/*`) preventing upstream Gemini quota exhaustion.

2. **Input Validation & Sanitization**:
   - Global NestJS `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`, preventing parameter injection.
   - FastAPI endpoints validated using **Pydantic v2** strict types (`min_length=10`, regex restrictions on prompts).

3. **Data Protection & Database Safety**:
   - SQL Injection immunity achieved through Prisma ORM parameterized queries.
   - Sensitive credentials, payout account details, and banking information encrypted using dedicated `CryptoModule` primitives (AES-256-GCM).
   - Raw webhook bodies preserved exclusively for cryptographic HMAC-SHA256 signature verification (`rawBody: true`).

4. **Service-to-Service Security**:
   - Communication between `meetday-backend` and `meetday-ai` is authenticated via signed headers containing `X-Internal-API-Key`.
   - AI endpoints reject public traffic directly, requiring all requests to originate from the verified backend proxy.

5. **Role-Based Access Control (RBAC)**:
   - Declarative route decoration via `@Roles('SUPER_ADMIN', 'CITY_ADMIN', 'HOST', 'BRAND', 'SPACE')`.
   - Dynamic team-level permission resolution ensuring team members inherit permissions strictly within their authorized organization.

---

# 10. Background Processing, Queues & Scheduled Jobs

### 10.1 BullMQ Queue Architecture
To keep HTTP latency minimal, heavy or asynchronous operations are dispatched to **BullMQ queues backed by Redis**:
- **`mail` Queue**: Asynchronous processing of transactional emails (ticket confirmation, PDF QR delivery, host invitations, admin alerts) with exponential retry policies.
- **Image Processing Queue**: Resizing and optimizing host/brand uploads before persisting to Google Cloud Storage.

### 10.2 Scheduled Jobs (`@nestjs/schedule`)
Automated cron jobs configured in `meetday-backend`:
- **Payout Settlement Cron**: Aggregates completed events, checks eligibility, verifies bank KYC via Sandbox, and compiles payout batches.
- **Event Expiration & Archival**: Shifts events from `PUBLISHED` to `COMPLETED` after end timestamps pass.
- **Cache Pruning**: Cleans up stale Redis presence sets and expired door scanner tokens.

---

# 11. DevOps, Docker Topology & CI/CD Pipelines

### 11.1 Microservice Container Topology
The complete ecosystem can be orchestrated locally and in staging environments via Docker Compose:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: meetday-postgres
    environment:
      POSTGRES_USER: meetday
      POSTGRES_PASSWORD: password
      POSTGRES_DB: meetday
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U meetday"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: meetday-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./meetday-backend
      dockerfile: Dockerfile
    container_name: meetday-backend
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file: ./meetday-backend/.env

  ai-service:
    build:
      context: ./meetday-ai
      dockerfile: Dockerfile
    container_name: meetday-ai
    ports:
      - "8001:8001"
    env_file: ./meetday-ai/.env

volumes:
  postgres_data:
  redis_data:
```

### 11.2 AI Microservice Multi-Stage Dockerfile (`meetday-ai/Dockerfile`)
```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
RUN pip install --no-cache-dir .

FROM python:3.12-slim AS runner
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY app ./app
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
```

---

# 12. Architectural Risks, Technical Debt & Future Roadmap

| Domain Area | Current Architecture | Future Scaling Roadmap |
|---|---|---|
| **Database Read Traffic** | Single PostgreSQL instance with Prisma connection pool. | Add PostgreSQL read replicas for event discovery and community feed queries using Prisma read/write split client extensions. |
| **Real-time Chat Scale** | Single Socket.io gateway with Redis adapter. | Partition high-volume community channels across dedicated Redis Streams with a Kafka event backplane for multi-region clustering. |
| **Search & Discovery** | Relational SQL string matching and index lookups. | Deploy Meilisearch / Elasticsearch for typo-tolerant, instant geospatial event and community discovery. |
| **Asset Delivery** | Google Cloud Storage direct bucket URLs. | Front storage with Google Cloud CDN / Cloudflare with edge WebP/AVIF transformation. |
| **Door Check-in Reliability**| Real-time online REST scanner sessions. | Implement offline-first local SQLite caching in scanner apps with automatic sync when cellular connectivity resumes. |
| **AI Latency & Token Budget**| Synchronous calls to Gemini 2.5 Flash via `DraftOrchestrator`. | Implement semantic response caching in Redis Vector Store to instantly return identical prompt drafts without calling Gemini. |
| **Model Redundancy** | Primary reliance on Gemini 2.5 Flash. | Implement multi-LLM fallback router (Gemini → Claude 3.5 Sonnet → GPT-4o-mini) via LiteLLM abstraction in `meetday-ai`. |

---