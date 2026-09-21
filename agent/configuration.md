# Agent configuration

## Model and tools
- LLM: Claude Haiku 4.5
- System tools: `end_call`, voicemail detection
- Knowledge base: `knowledge-base/bridgewell-knowledge-base.md` (RAG)
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

## Data collection fields
All are strings, extracted from the transcript after the call and read by `Code.gs`:

`prospect_name`, `is_right_person`, `consent_to_continue`, `country`, `level`, `study_mode`, `destination`, `field_of_interest`, `specialisation`, `intended_intake`, `budget`, `bachelors_university`, `bachelors_year`, `bachelors_grade`, `masters_university`, `masters_year`, `masters_grade`, `university_selected`, `programme_selected`, `email`, `email_confirmed`, `callback_number`, `asked_about_recognition`, `asked_about_kennedy`, `main_objection`, `under_18`, `do_not_contact`, `voicemail_attempt`, `call_outcome`

`call_outcome` containing "qualified" triggers the callback row and both emails. `do_not_contact = true` sends the number to Suppression.
