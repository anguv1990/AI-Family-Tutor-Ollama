# AI Family Tutor — Diagram-first Architecture

## 1. Start here: local-first MVP

```mermaid
flowchart LR
  Child["Child"] --> UI["Tutor web app"]
  Parent["Parent"] --> UI
  UI --> Engine["Tutoring engine\nquestions • hints • mastery"]
  Engine --> Safety["Safety gate\nvalidated child-safe output"]
  Safety --> UI
  Engine <--> DB[("SQLite\nlearning progress")]
  Engine <--> Ollama["Ollama\nlocal AI model"]
```

**Everything stays on the family device.**

---

## 2. The plug-in point: one AI gateway

```mermaid
flowchart LR
  Engine["Tutoring engine"] --> Gateway["AI gateway\nONE stable interface"]

  Gateway -->|"default"| Ollama["Ollama\nlocal model"]
  Gateway -. "only if enabled" .-> OpenAI["OpenAI\nenterprise API"]
  Gateway -. "only if enabled" .-> Anthropic["Claude\nenterprise API"]
  Gateway -. "only if enabled" .-> Google["Google Vertex AI\nGemini"]
  Gateway -. "same contract" .-> Other["Other approved\nAI provider"]
```

**The tutoring engine does not change when the AI provider changes.**

---

## 3. What happens for every child request

```mermaid
flowchart TD
  Request["Child asks or answers"] --> Known{"Known answer?\n(e.g. 4 + 3)"}
  Known -->|"Yes"| Rules["Answer key + mastery rule\nNo AI needed"]
  Known -->|"No"| Private{"Private child data?"}
  Private -->|"Yes"| Local["Ollama"]
  Private -->|"No, approved cloud task"| Cloud["Enterprise AI provider"]
  Local --> Check["JSON + safety check"]
  Cloud --> Check
  Check -->|"Safe"| Show["Show child-safe answer"]
  Check -->|"Invalid / unavailable"| Fallback["Safe template\nNotify parent"]
  Rules --> Show
```

---

## 4. Production version

```mermaid
flowchart TB
  Browser["Parent / child browser"] --> HTTPS["HTTPS + login"]
  HTTPS --> App["Tutor application"]

  subgraph App["Production application"]
    Direction TB
    Tutor["Tutoring + safety engine"]
    Gateway["AI gateway"]
    DB[("Managed database")]
    Logs["Redacted audit logs\ncost • latency • errors"]
    Secrets["Managed secrets"]
    Tutor <--> DB
    Tutor --> Gateway
    Tutor --> Logs
    Gateway --> Logs
    Secrets --> Gateway
  end

  App --> Local["Private Ollama\noptional"]
  App --> Cloud["Approved enterprise AI\noptional"]
```

---

## 5. Safe rollout path

```mermaid
flowchart LR
  A["1. Local MVP\nOllama + SQLite"] --> B["2. Add AI gateway\nstill Ollama only"]
  B --> C["3. Test one cloud provider\nde-identified test data"]
  C --> D["4. Production foundations\nlogin • HTTPS • backups • monitoring"]
  D --> E["5. Enable approved cloud route\nparent opt-in + limits"]
```
