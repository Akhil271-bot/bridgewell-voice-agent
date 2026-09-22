# The Google Sheet

One spreadsheet drives the calling and records everything. The Apps Script in `apps-script/` is bound to it.

## Tab 1 — Call List

Your leads, plus what the automation fills in. The first three columns are the ones you paste in.

| Column | Filled by | Notes |
|---|---|---|
| `email` | you | |
| `full_name` | you | |
| `phone_number` | you | with country code |
| `country` | formula | derived from the dialling code (UAE, Saudi Arabia, UK, India, USA/Canada…) |
| `level` | call | dropdown: Bachelor's / Master's / Doctorate |
| `study_mode` | call | dropdown: Online / Offline (on campus) |
| `call_status` | webhook | Ready / Calling / Answered / Voicemail left / No answer / Opted out |
| `attempts` | webhook | stops at 3 |
| `last_called` | webhook | |
| `mail_sent` | webhook | Yes / No |
| `mail_type` | webhook | Bachelor's / Master's / Doctorate / General |
| `mail_sent_at` | webhook | |
| `ready_to_apply` | call | Yes / Not yet |
| `follow_up` | your team | Done / Not done |
| `call_summary` | webhook | one line from the transcript |
| `call_id` | webhook | links back to the ElevenLabs conversation |

Cells are colour-coded by the script: green for Answered, done or mail sent; yellow for voicemail; red for not done or no mail; grey for opted out.

## Tab 2 — Student Details

One row per answered call, 26 columns:

`date`, `full_name`, `phone_number`, `email`, `country`, `level`, `study_mode`, `destination`, `subject_area`, `specialisation`, `intake`, `budget`, `bachelors_university`, `bachelors_year`, `bachelors_score`, `masters_university`, `masters_year`, `masters_score`, `english_test_score`, `programme_chosen`, `university_chosen`, `ready_to_apply`, `questions_asked`, `call_outcome`, `mail_sent`, `call_id`

## Tab 3 — Do Not Call

`date`, `full_name`, `phone_number`, `email`, `reason`. Anyone who opts out lands here automatically and is never emailed.

## Daily limits

The script enforces 50 calls and 50 emails a day, counted per calendar day. Past the limit a row is marked "held – daily cap" and `sendHeldEmails()` — put it on a daily trigger — sends the backlog 45 seconds apart so nothing goes out as a burst.
