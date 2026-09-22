# Bridgewell Voice Agent

An outbound AI voice agent that calls prospective students about bachelor's, master's and doctorate programmes, finds out what they need, recommends a programme, and books a callback with a human counsellor. It speaks English and Hindi. If the call goes to voicemail it leaves a message matched to the student's level. Everything it collects lands in a Google Sheet, and the right email goes out automatically when the call ends.

Built with **ElevenLabs Agents** and **Google Apps Script**. No servers, no n8n.

## How it works

```
ElevenLabs agent ──(outbound call)──▶ student
      │                                  │
      │                    answered ─────┴───── voicemail
      │                       │                     │
      │                  conversation          level voicemail,
      │                                         no email sent
      │
      │  call ends → post-call webhook (transcript + 25 extracted fields)
      ▼
Google Apps Script web app  (doPost, authenticated by ?key=SECRET)
      │
      ├─▶ Call List        status, attempts, mail sent, follow-up
      ├─▶ Student Details  everything the student said
      ├─▶ Do Not Call      opt-outs, never contacted again
      └─▶ email to the student (bachelor's / master's / doctorate / general)
          + alert to the counsellor when they're qualified or ready to apply
```

Daily caps: **50 calls and 50 emails**. Anything over is held and sent the next day, 45 seconds apart.

## What the agent does on a call

1. **Voicemail** (most calls): waits for the beep, leaves the message for that level, reads the WhatsApp number twice, ends.
2. **Opening:** confirms the name, says what the student enquired about.
3. **Interest check** before anything else.
4. **Gets to know them** — country, level, online or campus, subject, intake, budget, and their bachelor's (university, year, result). Gives something useful back every few answers.
5. **Recommends** — only after the academics are in hand, and names one exact programme.
6. **Timeline and urgency** — two weeks for review, a month for the visa, a month for funding, so the application should be in within a week.
7. **Details** — email read back character by character, callback number read back digit by digit, and it asks whether they're ready to start the application.
8. **Close** — the details will be emailed, applications go through the consultant, Akhil calls back.

Guardrails: never claims to be human or the counsellor; never says a degree "will be recognised"; no immigration advice; no promises about jobs, salaries or admission; only knowledge-base figures; opt-outs handled immediately; no fees or claims in voicemails.

## Repo layout

| Path | What it is |
|---|---|
| `agent/system-prompt.md` | The agent's full system prompt |
| `agent/first-message.txt` | The agent's first message |
| `agent/configuration.md` | Voice, model, languages, dynamic variables, the 25 data fields |
| `apps-script/Code.gs` | Webhook receiver, emails, daily caps, sheet formatting |
| `knowledge-base/` | Programme facts the agent answers from (RAG) |
| `docs/sheet-structure.md` | The three tabs and every column |
| `docs/golden-set.md` | 12 test scenarios to re-run after any change |

## Setup

1. **Sheet and script:** create a Google Sheet with the tabs in `docs/sheet-structure.md`, open *Extensions → Apps Script*, paste in `Code.gs`. Set `SECRET`, `NOTIFY_TO` and `WHATSAPP`, then run `setup()` once and authorise it.
2. **Deploy:** *Deploy → New deployment → Web app*, execute as *Me*, access *Anyone*. Copy the `/exec` URL. Re-deploy a **new version** after every code change, or the old one keeps serving.
3. **ElevenLabs:** create the agent, paste in the system prompt and first message, upload both knowledge-base files, add the data fields from `agent/configuration.md`, enable `end_call` and voicemail detection, add Hindi as an additional language, and turn Expressive mode off.
4. **Webhook:** in workspace settings, point the post-call webhook at `<exec URL>?key=<SECRET>`.
5. **Test:** work through `docs/golden-set.md` in Preview before any real call. Keep `TEST_MODE = true` so student emails land in your own inbox.

Apps Script can't read request headers, so the ElevenLabs signature header can't be verified. The query-string secret is the authentication — keep the URL private.

## Email deliverability

Emails are plain text with no images, tracking or attachments, sent one at a time from a real mailbox, with a footer that says why the person is receiving it and how to stop. That plus the daily cap is what keeps them out of spam. Sending from a domain with SPF, DKIM and DMARC set up is better than a free Gmail address.

---
Secrets, IDs, emails and phone numbers in this repo have been replaced with placeholders.
