/**
 * Bridgewell Academic - Call automation for the "trial sheet".
 *
 * ElevenLabs post-call webhook  ->  this web app  ->
 *   Call List (status, mail sent, follow-up)
 *   Student Details (everything the student told us)
 *   Do Not Call (opt-outs)
 *   + the level email to the student, + an alert to Akhil
 *
 * TEST_MODE = true  -> every student email goes to Akhil's inbox instead,
 *                      with the real recipient shown in the subject.
 */

var SECRET      = 'REPLACE_WITH_A_LONG_RANDOM_SECRET';
var TEST_MODE   = true;
var NOTIFY_TO   = 'you@example.com';   // alerts + test copies land here
var FROM_ALIAS  = '';                                 // blank = send from the account running the script
var WHATSAPP    = '+44 0000 000000';
var SENDER_NAME = 'Akhil';
var COMPANY     = 'Bridgewell Academic';
var POSTAL      = 'ADD YOUR OFFICE ADDRESS HERE';

/* Daily limits. Nothing goes out once these are reached. */
var DAILY_CALL_CAP  = 50;
var DAILY_EMAIL_CAP = 50;

var CALL_LIST = 'Call List';
var DETAILS   = 'Student Details';
var DNC       = 'Do Not Call';

var FIELDS = ['prospect_name','is_right_person','consent_to_continue','country',
  'level','study_mode','destination','field_of_interest','specialisation',
  'intended_intake','budget','bachelors_university','bachelors_year',
  'bachelors_grade','masters_university','masters_year','masters_grade',
  'english_test_score','university_selected','programme_selected','email',
  'email_confirmed','callback_number','ready_to_apply','asked_about_recognition',
  'asked_about_kennedy','main_objection','under_18','do_not_contact',
  'voicemail_attempt','call_outcome'];

/* ============================ webhook ============================ */

function doPost(e) {
  try {
    if (!e || !e.parameter || e.parameter.key !== SECRET) {
      return json({ ok: false, error: 'unauthorised' });
    }
    var body = JSON.parse(e.postData.contents);
    var d    = body.data || {};
    var res  = (d.analysis && d.analysis.data_collection_results) || {};
    var dyn  = (d.conversation_initiation_client_data &&
                d.conversation_initiation_client_data.dynamic_variables) || {};

    var v = {};
    FIELDS.forEach(function (f) { v[f] = pick(res[f]); });

    var convId  = s(d.conversation_id);
    var summary = s(d.analysis && d.analysis.transcript_summary);
    var lead    = findLead(dyn, v);

    var name  = v.prospect_name || s(dyn.prospect_name) || (lead && lead.get('full_name')) || '';
    var phone = v.callback_number || s(dyn.phone_number) || (lead && lead.get('phone_number')) || '';
    var email = cleanEmail(v.email) || (lead && cleanEmail(lead.get('email'))) || '';
    var level = normLevel(v.level || dyn.level || (lead && lead.get('level')));
    var mode  = normMode(v.study_mode);
    var ready = truthy(v.ready_to_apply) ? 'Yes' : 'Not yet';

    var outcome = String(v.call_outcome).toLowerCase();
    var status;
    if (truthy(v.do_not_contact))                                   status = 'Opted out';
    else if (truthy(v.voicemail_attempt) || outcome.indexOf('voicemail') >= 0) status = 'Voicemail left';
    else if (outcome.indexOf('no_answer') >= 0 || outcome.indexOf('no answer') >= 0) status = 'No answer';
    else                                                            status = 'Answered';

    /* ---- opt-out: record, never email, never call again ---- */
    if (status === 'Opted out') {
      sheet(DNC).appendRow([new Date(), name, phone, email, 'Asked not to be contacted']);
      if (lead) lead.set({ call_status: status, last_called: new Date(),
                           attempts: num(lead.get('attempts')) + 1,
                           call_summary: summary, call_id: convId });
      return json({ ok: true, status: status });
    }

    /* ---- answered: send the level email ---- */
    var mailSent = 'No', mailType = '', mailAt = '';
    if (status === 'Answered' && email) {
      mailType = level || 'General';
      if (sendLevelEmail(email, name, mailType, v, ready === 'Yes')) {
        mailSent = 'Yes';
        mailAt = new Date();
      } else {
        mailType = mailType + ' (held - daily cap)';
      }
    }

    /* ---- Call List row ---- */
    if (lead) {
      lead.set({
        call_status: status,
        attempts: num(lead.get('attempts')) + 1,
        last_called: new Date(),
        level: level || lead.get('level'),
        study_mode: mode || lead.get('study_mode'),
        mail_sent: mailSent === 'Yes' ? 'Yes' : lead.get('mail_sent') || 'No',
        mail_type: mailType || lead.get('mail_type'),
        mail_sent_at: mailAt || lead.get('mail_sent_at'),
        ready_to_apply: status === 'Answered' ? ready : lead.get('ready_to_apply'),
        call_summary: summary,
        call_id: convId
      });
    }

    /* ---- Student Details row (only when we actually spoke) ---- */
    if (status === 'Answered') {
      appendByHeader(DETAILS, {
        date: new Date(), full_name: name, phone_number: phone, email: email,
        country: v.country || s(dyn.prospect_country) || (lead && lead.get('country')) || '',
        level: level, study_mode: mode, destination: v.destination,
        subject_area: v.field_of_interest, specialisation: v.specialisation,
        intake: v.intended_intake, budget: v.budget,
        bachelors_university: v.bachelors_university, bachelors_year: v.bachelors_year,
        bachelors_score: v.bachelors_grade,
        masters_university: v.masters_university, masters_year: v.masters_year,
        masters_score: v.masters_grade, english_test_score: v.english_test_score,
        programme_chosen: v.programme_selected, university_chosen: v.university_selected,
        ready_to_apply: ready, questions_asked: v.main_objection,
        call_outcome: v.call_outcome, mail_sent: mailSent, call_id: convId
      });

      if (ready === 'Yes' || outcome.indexOf('qualified') >= 0) {
        notifyAkhil(name, phone, email, level, mode, v, ready, convId);
      }
    }
    colourCallList();
    return json({ ok: true, status: status, mail_sent: mailSent });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() { return json({ ok: true, service: 'bridgewell-call-automation' }); }

/* ============================ emails ============================ */

function sendLevelEmail(to, name, level, v, ready) {
  if (!underEmailCap()) return false;

  var first = (name || '').split(' ')[0] || 'there';
  var t = TEMPLATES[level] || TEMPLATES.General;
  var chosen = joinNonEmpty([v.programme_selected,
    v.intended_intake ? 'for the ' + v.intended_intake + ' intake' : ''], ' ');

  var intro = t.intro + (chosen ? ' You mentioned the ' + chosen + ', so I have kept that in mind.' : '');
  var timeline = 'One thing worth knowing about timing: the university takes about two weeks to review an application, the visa takes roughly a month after that, and arranging funding takes about another month. That is why we suggest getting the application in within a week, so nothing is rushed at the end.';
  var closing = ready
    ? 'You said you are ready to start your application, which is great. I will get back to you personally with the next steps. You can also reach me on WhatsApp at ' + WHATSAPP + '.'
    : 'I will give you a call shortly to go through these with you. If it is easier, you can reach me on WhatsApp at ' + WHATSAPP + ', or simply reply to this email.';

  var body = ['Hi ' + first + ',', '', intro, ''];
  t.sections.forEach(function (sec) {
    body.push(sec.title);
    sec.points.forEach(function (p) { body.push('  - ' + p); });
    body.push('');
  });
  body.push(timeline);
  body.push('');
  body.push('A few things worth knowing:');
  t.notes.forEach(function (p) { body.push('  - ' + p); });
  body = body.concat(['', closing, '',
    'Best regards,',
    'Akhil',
    'Academic Counsellor, ' + COMPANY,
    'WhatsApp ' + WHATSAPP,
    '',
    'You are receiving this because you enquired with us about studying abroad.',
    'If you would rather not hear from us, reply with the word STOP and I will remove you.']);

  var subject = t.subject;
  var recipient = to;
  if (TEST_MODE) { subject = '[TEST - would go to ' + to + '] ' + subject; recipient = NOTIFY_TO; }

  var opts = { name: SENDER_NAME, replyTo: NOTIFY_TO };
  if (FROM_ALIAS && GmailApp.getAliases().indexOf(FROM_ALIAS) >= 0) opts.from = FROM_ALIAS;
  if (GmailApp.getRemainingDailyQuota() < 5) return false;   // never bounce off Gmail's own limit

  GmailApp.sendEmail(recipient, subject, body.join('\n'), opts);
  bumpEmailCount();
  return true;
}

/* ---- daily caps, kept per calendar day in script properties ---- */

function todayKey(kind) {
  var tz = Session.getScriptTimeZone() || 'Etc/UTC';
  return kind + '_' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}
function counter(kind) { return num(PropertiesService.getScriptProperties().getProperty(todayKey(kind))); }
function bump(kind) { PropertiesService.getScriptProperties().setProperty(todayKey(kind), String(counter(kind) + 1)); }

function underEmailCap() { return counter('emails') < DAILY_EMAIL_CAP; }
function bumpEmailCount() { bump('emails'); }

/** The dialer asks this before starting each call. */
function callsLeftToday() { return Math.max(0, DAILY_CALL_CAP - counter('calls')); }
function bumpCallCount() { bump('calls'); }

/** Today's usage, for the sheet menu. */
function usageToday() {
  return 'Today so far: ' + counter('calls') + ' of ' + DAILY_CALL_CAP + ' calls, ' +
         counter('emails') + ' of ' + DAILY_EMAIL_CAP + ' emails.';
}

/**
 * Anyone who was answered but whose email was held back by the cap.
 * Put this on a daily time trigger; it sends what is left over, slowly.
 */
function sendHeldEmails() {
  var sh = sheet(CALL_LIST); if (!sh || sh.getLastRow() < 2) return 'nothing to do';
  var H = headers(sh), rows = sh.getRange(2, 1, sh.getLastRow() - 1, H.length).getValues();
  var c = function (n) { return H.indexOf(n); };
  var sent = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!underEmailCap()) break;
    var r = rows[i];
    if (String(r[c('call_status')]) !== 'Answered') continue;
    if (String(r[c('mail_sent')]) === 'Yes') continue;
    var email = cleanEmail(r[c('email')]); if (!email) continue;
    var level = normLevel(r[c('level')]) || 'General';
    var ok = sendLevelEmail(email, s(r[c('full_name')]), level, {}, String(r[c('ready_to_apply')]) === 'Yes');
    if (!ok) break;
    sh.getRange(i + 2, c('mail_sent') + 1).setValue('Yes');
    sh.getRange(i + 2, c('mail_type') + 1).setValue(level);
    sh.getRange(i + 2, c('mail_sent_at') + 1).setValue(new Date());
    sent++;
    Utilities.sleep(45000);   // spread them out - never a burst from one address
  }
  colourCallList();
  return 'sent ' + sent;
}

var COMMON_NOTES = [
  'Fees are indicative, set by the university, and exclude living costs',
  'Applications go through us, not the university website'
];

var TEMPLATES = {
  "Bachelor's": {
    subject: "Your bachelor's options - Bridgewell Academic",
    intro: "Thanks for taking the time to speak with us today. As promised, here is a quick summary of the bachelor's routes we discussed.",
    sections: [
      { title: 'Westcliff University (USA)', points: [
        'Business, IT, Computer Science and Education degrees',
        'Study 100% live online from home, or on campus in California or Texas',
        'No SAT required, and no entrance exam',
        'A 3-year accelerated option is available',
        'Indicative tuition: US$11,760 a year online, US$19,128 a year on campus' ] },
      { title: 'EU Business School (Europe)', points: [
        '3-year bachelor\'s in Barcelona, Munich or Geneva, taught in English',
        'Specialisations include Business, International Relations, Digital Business and AI for Business',
        'Indicative tuition from EUR 7,350 a semester in Barcelona and Munich; Geneva is higher' ] }
    ],
    notes: ['The online route is not F-1 supported, so it does not come with a US student visa'].concat(COMMON_NOTES)
  },
  "Master's": {
    subject: "Your master's options - Bridgewell Academic",
    intro: "Thanks for speaking with us today. Here is a summary of the master's routes we discussed.",
    sections: [
      { title: 'Westcliff University (USA)', points: [
        'MBA (14 concentrations, 7 of them STEM), MS IT, MS Computer Science, MS Engineering Management and MA TESOL',
        'Can be completed in as little as one year',
        'No GMAT or GRE, and a 3-year bachelor\'s degree is accepted',
        'Study 100% live online, or on campus at one of six US locations',
        'Indicative tuition: US$13,770 a year online, US$15,030 a year on campus' ] },
      { title: 'EU Business School (Europe)', points: [
        'One-year master\'s and MBA in Barcelona, Munich or Geneva',
        'Programmes include Management, Finance, Digital Marketing, Business Analytics and AI for Business',
        'Indicative tuition from about EUR 16,350 in total for a master\'s in Barcelona or Munich; Geneva is higher' ] }
    ],
    notes: ['A STEM concentration can extend post-study work options for eligible F-1 students; Akhil can explain how that works for you',
            'The online route is not F-1 supported'].concat(COMMON_NOTES)
  },
  'Doctorate': {
    subject: 'Your doctorate options - Bridgewell Academic',
    intro: 'Thanks for your time today. Here is a summary of the doctoral routes we discussed.',
    sections: [
      { title: 'Westcliff University (USA)', points: [
        'Doctor of Business Administration (DBA): 3 years, 60 credits, with concentrations including Business Intelligence & Data Analytics, Cybersecurity, IT Management and Applied Computer Science',
        'Doctor of Education (EdD): 4 years, 60 credits',
        'Runs fully live online so you can keep working, or on campus',
        'No GMAT or GRE; a master\'s with a 2.5 GPA and IELTS 6.0 (or equivalent)',
        'Indicative total tuition: US$48,000 online, US$55,200 on campus' ] },
      { title: 'EU Business School - Geneva', points: [
        'A research-based DBA, 2 to 5 years, on campus in Geneva only',
        'Requires a master\'s, IELTS 7.0, and either a 3.0 GPA, a GMAT/GRE score or five years\' professional experience',
        'Approximately CHF 42,000 in total' ] }
    ],
    notes: COMMON_NOTES
  },
  'General': {
    subject: 'Your study options - Bridgewell Academic',
    intro: 'Thanks for speaking with us today. We work with universities in the US and Europe on bachelor\'s, master\'s and doctorate programmes, online and on campus.',
    sections: [
      { title: 'What we can help with', points: [
        'Westcliff University (USA): bachelor\'s, master\'s, MBA and doctorates, 100% live online or on campus, no GMAT, GRE or SAT',
        'EU Business School: bachelor\'s, master\'s, MBA and a DBA in Barcelona, Munich and Geneva' ] }
    ],
    notes: COMMON_NOTES
  }
};

function notifyAkhil(name, phone, email, level, mode, v, ready, convId) {
  var subject = (ready === 'Yes' ? 'READY TO APPLY - ' : 'CALL BACK - ') + (name || 'Unknown') + ' - ' + (phone || 'no number') + (level ? ' - ' + level : '');
  var lines = compact([
    ready === 'Yes' ? 'Student says they are READY TO APPLY.' : 'Qualified lead - call back within the hour.',
    '', name, phone, email, joinNonEmpty([level, mode, v.destination], ' / '),
    v.programme_selected ? 'Programme: ' + joinNonEmpty([v.university_selected, v.programme_selected], ' - ') : '',
    v.intended_intake ? 'Intake: ' + v.intended_intake : '',
    v.budget ? 'Budget: ' + v.budget : '',
    v.bachelors_university ? 'Bachelors: ' + joinNonEmpty([v.bachelors_university, v.bachelors_year, v.bachelors_grade], ', ') : '',
    v.masters_university ? 'Masters: ' + joinNonEmpty([v.masters_university, v.masters_year, v.masters_grade], ', ') : '',
    v.english_test_score ? 'English: ' + v.english_test_score : '',
    v.main_objection ? 'They asked: ' + v.main_objection : '',
    '', 'Call ID: ' + convId
  ]);
  GmailApp.sendEmail(NOTIFY_TO, subject, lines.join('\n'), { name: 'Bridgewell Call Bot' });
}

/* ============================ sheet helpers ============================ */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(n) { return ss().getSheetByName(n); }

function headers(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
}

/** Find the Call List row for this call: by phone, then email, then name. */
function findLead(dyn, v) {
  var sh = sheet(CALL_LIST); if (!sh || sh.getLastRow() < 2) return null;
  var H = headers(sh);
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, H.length).getValues();
  var col = function (n) { return H.indexOf(n); };
  var want = {
    phone: digits(dyn.phone_number || v.callback_number),
    email: cleanEmail(dyn.email || v.email),
    name:  s(dyn.prospect_name || v.prospect_name).toLowerCase()
  };
  var hit = -1;
  for (var i = 0; i < rows.length && hit < 0; i++) {
    var p = digits(rows[i][col('phone_number')]);
    if (want.phone && p && (p === want.phone || p.slice(-9) === want.phone.slice(-9))) hit = i;
  }
  for (var j = 0; j < rows.length && hit < 0; j++) {
    if (want.email && cleanEmail(rows[j][col('email')]) === want.email) hit = j;
  }
  for (var k = 0; k < rows.length && hit < 0; k++) {
    if (want.name && s(rows[k][col('full_name')]).toLowerCase() === want.name) hit = k;
  }
  if (hit < 0) return null;
  var rowNum = hit + 2, rowVals = rows[hit];
  return {
    get: function (n) { var c = col(n); return c < 0 ? '' : rowVals[c]; },
    set: function (obj) {
      Object.keys(obj).forEach(function (n) {
        var c = col(n); if (c >= 0 && obj[n] !== undefined) sh.getRange(rowNum, c + 1).setValue(obj[n]);
      });
    }
  };
}

function appendByHeader(name, obj) {
  var sh = sheet(name); var H = headers(sh);
  sh.appendRow(H.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
}

/** Colour the status cells so the list reads at a glance. */
function colourCallList() {
  var sh = sheet(CALL_LIST); if (!sh || sh.getLastRow() < 2) return;
  var H = headers(sh), n = sh.getLastRow() - 1;
  var paint = function (name, map) {
    var c = H.indexOf(name); if (c < 0) return;
    var r = sh.getRange(2, c + 1, n, 1);
    r.setBackgrounds(r.getValues().map(function (x) { return [map[String(x[0])] || null]; }));
  };
  paint('call_status', { 'Answered': '#D5E7E4', 'Voicemail left': '#FFF2CC', 'No answer': '#FCE5CD', 'Opted out': '#D9D9D9', 'Calling': '#CFE2F3' });
  paint('mail_sent',   { 'Yes': '#D5E7E4', 'No': '#F4CCCC' });
  paint('follow_up',   { 'Done': '#D5E7E4', 'Not done': '#F4CCCC' });
  paint('ready_to_apply', { 'Yes': '#D5E7E4' });
}

/** Run once from the editor to colour the sheet and check permissions. */
function setup() { colourCallList(); return 'OK. ' + usageToday(); }

/* ============================ small utils ============================ */

function pick(item) {
  if (item === null || item === undefined) return '';
  if (typeof item === 'object' && 'value' in item) return s(item.value);
  return s(item);
}
function s(x) { return (x === null || x === undefined) ? '' : String(x).trim(); }
function num(x) { var n = parseInt(x, 10); return isNaN(n) ? 0 : n; }
function digits(x) { return s(x).replace(/\D/g, ''); }
function cleanEmail(x) { var e = s(x).toLowerCase().replace(/\s/g, ''); return /^[^@]+@[^@]+\.[^@]+$/.test(e) ? e : ''; }
function truthy(x) { return x === true || /^(true|yes|y)$/i.test(s(x)); }
function normLevel(x) {
  x = s(x).toLowerCase();
  if (/doct|phd|dba|edd/.test(x)) return 'Doctorate';
  if (/master|mba|msc|\bma\b|\bms\b/.test(x)) return "Master's";
  if (/bach|undergrad|bba|\bbsc?\b|\bba\b/.test(x)) return "Bachelor's";
  return '';
}
function normMode(x) {
  x = s(x).toLowerCase();
  if (/online|remote|distance/.test(x)) return 'Online';
  if (/campus|offline|in person|abroad/.test(x)) return 'Offline (on campus)';
  return '';
}
function compact(a) { return a.filter(function (x) { return x !== '' && x !== null && x !== undefined; }); }
function joinNonEmpty(a, sep) { return compact(a).join(sep); }
function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
