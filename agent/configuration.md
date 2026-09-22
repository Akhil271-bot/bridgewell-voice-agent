# Agent configuration

ElevenLabs agent: "Company sales call".

## Voice and model
- Voice: **Rahul S – Natural Warm Indian English**
- TTS model family: **V3 Conversational**, with **Expressive mode OFF** (expressive mode made the agent act out audio tags and sound theatrical on calls)
- LLM: Claude Haiku 4.5
- Languages: **English (default) + Hindi**. The agent starts in English and switches if the student speaks Hindi. Nothing else — other languages get a polite explanation and a callback offer.
- System tools: `end_call`, voicemail detection
- Knowledge base: the two files in `knowledge-base/` (RAG)
- Post-call webhook: the Apps Script `/exec` URL with `?key=<SECRET>`

## Dynamic variables
Passed in when a call starts:

| Variable | Example |
|---|---|
| `prospect_name` | Sharanya |
| `prospect_country` | United Kingdom |
| `prospect_context` | enquired via our website about an online doctorate |
| `attempt_number` | 1 |
| `akhil_available` | true |
| `level` | doctorate |
| `whatsapp_number` | +44 0000 000000 |
| `programme`, `university`, `study_mode` | optional |

System variables used: `system__conversation_id`, `system__time_utc`.

## Data collection (25 fields — the tier limit)

`prospect_name`, `country`, `level`, `study_mode`, `destination`, `field_of_interest`, `specialisation`, `intended_intake`, `budget`, `bachelors_university`, `bachelors_year`, `bachelors_grade`, `masters_university`, `masters_year`, `masters_grade`, `english_test_score`, `university_selected`, `programme_selected`, `email`, `callback_number`, `asked_about_kennedy`, `main_objection`, `do_not_contact`, `call_outcome`, `ready_to_apply`

Notes:
- `call_outcome` containing "qualified" and `ready_to_apply` = true both trigger an alert to the counsellor.
- `do_not_contact` = true sends the lead to the Do Not Call tab and stops all email.
- There is no `asked_about_recognition` field — recognition questions land in `main_objection`. The tier caps data points at 25.

## Evaluation criteria
`compliance`, `grounding`, `email_integrity`, `qualification`, `handover`

## Policies baked into the prompt
- Never claims to be Akhil or human; discloses that it's an AI when asked.
- Never answers recognition, equivalence or immigration questions — those go to the counsellor.
- Only uses figures from the knowledge base; quotes fees as indicative and excluding living costs.
- **Never volunteers that a university has several intakes a year.** If the student asks directly, it answers honestly and steers back to the nearest intake.
- Walks every student through the three-month timeline (review, visa, funding) and asks for the application within a week.
- Academics (bachelor's university, year, result) must be collected **before** any programme is recommended.
