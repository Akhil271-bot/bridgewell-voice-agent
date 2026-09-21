# Bridgewell Voice Agent

An outbound AI voice agent that calls prospective students about bachelor's, master's and doctorate programmes, works out what they need, recommends a programme, and books a callback with a human counsellor. Everything it collects lands in a Google Sheet, and emails go out automatically when the call ends.

Built with **ElevenLabs Agents** and **Google Apps Script**, with no servers and no n8n.

## How it works

```
ElevenLabs agent ──(outbound call)──▶ student
      │
      │  call ends → post-call webhook (transcript + extracted fields)
      ▼
Google Apps Script web app  (doPost, authenticated by ?key=SECRET)
      │
      ├─▶ Leads tab           every call, every field
      ├─▶ Suppression tab     if the student opted out
      └─▶ if qualified:
            ├─ Callbacks tab  (status: Waiting / Called / No answer / Done)
            ├─ email to the student with the programme they chose
            └─ email to the counsellor: "call within the hour"
```

A **Pipeline** tab is a live `QUERY` view of Leads, newest first.

## What the agent does on a call

1. **Voicemail** (most calls): waits for the beep, then leaves one of three short messages depending on the attempt number.
2. **Opening**: confirms the name and says what the student enquired about.
3. **Interest check**: confirms they're still interested before asking anything else.
4. **Profiling**, done as a conversation: level, online or on campus, subject, intake, previous degrees and grades, budget. It gives something useful back every few answers.
5. **Recommendation**: one or two options from the knowledge base, checked against the entry requirements.
6. **Details**: the email is read back character by character, and it gives up after two failed attempts rather than recording a wrong address.
7. **Close**: promises a callback within the hour, inside the counsellor's working window, quoted in the student's local time.

Guardrails: it never claims a degree is "recognised", gives no immigration advice, never promises jobs or admission, uses no figures that aren't in the knowledge base, discloses that it's an AI straight away when asked, and handles opt-outs immediately.

## Repo layout

| Path | What it is |
|---|---|
| `agent/system-prompt.md` | The agent's full system prompt |
| `agent/first-message.txt` | The agent's first message |
| `agent/configuration.md` | Dynamic variables, data-collection fields, tools, model |
| `apps-script/Code.gs` | The webhook receiver, emails and sheet formatting |
| `knowledge-base/bridgewell-knowledge-base.md` | Programme facts the agent answers from (RAG) |

## Setup

1. **Sheet and script**: create a Google Sheet, open *Extensions → Apps Script*, and paste in `Code.gs`. Set `SECRET`, `NOTIFY_TO` and `WHATSAPP`, then run `setup()` once.
2. **Deploy**: choose *Deploy → New deployment → Web app*, execute as *Me*, access *Anyone*. Copy the `/exec` URL.
3. **ElevenLabs**: create the agent, paste in the system prompt and first message, and upload the knowledge base. Add the data-collection fields from `agent/configuration.md` and enable `end_call` and voicemail detection.
4. **Webhook**: in the ElevenLabs workspace settings, set the post-call webhook to `<exec URL>?key=<SECRET>`.

Apps Script can't read request headers, so the ElevenLabs signature header can't be verified. The query-string secret is the authentication, so keep the URL private.

---
Secrets, IDs, emails and phone numbers in this repo have been replaced with placeholders.
