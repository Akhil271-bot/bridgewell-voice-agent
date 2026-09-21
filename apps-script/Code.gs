/**
 * Bridgewell Academic - ElevenLabs post-call webhook receiver.
 * Bound to the Bridgewell Leads spreadsheet.
 *
 * SETUP
 *   1. Set SECRET below to a long random string.
 *   2. Run setup() once - creates the tabs and renames the file.
 *   3. Deploy > New deployment > Web app.
 *      Execute as: Me    Who has access: Anyone
 *   4. In ElevenLabs, set the post-call webhook URL to the /exec URL
 *      with ?key=YOUR_SECRET appended.
 *
 * NOTE: Apps Script cannot read custom request headers, so the
 * ElevenLabs-Signature header never arrives. The query-string secret
 * is the authentication. Keep the URL private.
 */

var SECRET    = 'REPLACE_WITH_A_LONG_RANDOM_SECRET';
var NOTIFY_TO = 'you@example.com';
var WHATSAPP  = '+44 0000 000000';

var LEADS = 'Leads';
var CALLS = 'Callbacks';
var CONF  = 'Config';
var SUPP  = 'Suppression';

// Shift UK to 0 when British Summer Time ends on 26 October.
var OFFSETS = {
  'united kingdom': 1, 'uk': 1, 'england': 1, 'scotland': 1, 'wales': 1,
  'uae': 4, 'united arab emirates': 4, 'dubai': 4, 'abu dhabi': 4,
  'pakistan': 5, 'india': 5.5, 'saudi arabia': 3, 'qatar': 3, 'oman': 4
};

var FIELDS = ['prospect_name','is_right_person','consent_to_continue','country',
  'city','level','study_mode','destination','field_of_interest','specialisation',
  'intended_intake','budget','bachelors_university','bachelors_year',
  'bachelors_grade','masters_university','masters_year','masters_grade',
  'university_selected','programme_selected','email','email_confirmed',
  'callback_number','asked_about_recognition','asked_about_kennedy',
  'main_objection','under_18','do_not_contact','voicemail_attempt','call_outcome'];

var LEAD_COLS = ['timestamp','conversation_id','duration_secs'].concat(FIELDS);

var CALL_COLS = ['status','logged_at','name','phone','their_time','country',
  'level','study_mode','destination','programme','flags','they_asked','email',
  'conversation_id'];

/* ---------------- one-time setup ---------------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.rename('Bridgewell Leads');
  tab(LEADS, LEAD_COLS);
  tab(CALLS, CALL_COLS);
  tab(SUPP, ['phone','email','added']);
  var c = tab(CONF, ['key','value']);
  if (c.getLastRow() < 2) c.appendRow(['available','yes']);
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  formatSheets();
  return 'Setup complete. Pipeline built and tabs formatted.';
}

/* ---------------- webhook ---------------- */

function doPost(e) {
  try {
    if (!e || !e.parameter || e.parameter.key !== SECRET) {
      return json({ ok: false, error: 'unauthorised' });
    }
    var body = JSON.parse(e.postData.contents);
    var d = body.data || {};
    var res = (d.analysis && d.analysis.data_collection_results) || {};
    var dyn = (d.conversation_initiation_client_data &&
               d.conversation_initiation_client_data.dynamic_variables) || {};

    var v = {};
    for (var i = 0; i < FIELDS.length; i++) v[FIELDS[i]] = pick(res[FIELDS[i]]);
    if (!v.prospect_name) v.prospect_name = s(dyn.prospect_name);
    if (!v.country) v.country = s(dyn.prospect_country);

    var convId = s(d.conversation_id);
    var dur = (d.metadata && d.metadata.call_duration_secs) || '';

    var row = [new Date(), convId, dur];
    for (var j = 0; j < FIELDS.length; j++) row.push(v[FIELDS[j]]);
    tab(LEADS, LEAD_COLS).appendRow(row);

    if (truthy(v.do_not_contact)) {
      tab(SUPP, ['phone','email','added'])
        .appendRow([v.callback_number, v.email, new Date()]);
      return json({ ok: true, action: 'suppressed' });
    }

    if (String(v.call_outcome).toLowerCase().indexOf('qualified') >= 0) {
      var flags = buildFlags(v);
      tab(CALLS, CALL_COLS).appendRow(['Waiting', new Date(), v.prospect_name,
        v.callback_number, localTime(v.country), v.country, v.level,
        v.study_mode, v.destination,
        joinNonEmpty([v.university_selected, v.programme_selected], ' - '),
        flags, v.main_objection, v.email, convId]);
      if (v.email && v.email.indexOf('@') > 0) sendPack(v);
      notifyAkhil(v, flags, convId);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== SECRET) {
    return json({ ok: false, error: 'unauthorised' });
  }
  return json(checkAvailable());
}

function checkAvailable() {
  var now = new Date();
  var utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  var inHours = utcMin >= 450 && utcMin <= 990;   // 07:30-16:30 UTC
  var manual = String(config('available') || 'yes').toLowerCase();
  if (manual === 'no' || manual === 'false') {
    return { available: false, reason: 'switched off' };
  }
  return { available: inHours,
           reason: inHours ? 'in hours' : 'outside 07:30-16:30 UTC' };
}

/* ---------------- notification ---------------- */

function notifyAkhil(v, flags, convId) {
  var phone = v.callback_number || '(no number given)';
  var prog  = joinNonEmpty([v.university_selected, v.programme_selected], ' - ');
  var dot   = flags ? 'RED' : 'OK';
  var subject = dot + ' CALL WITHIN THE HOUR - ' + (v.prospect_name || 'Unknown') +
                ' - ' + phone + (prog ? ' - ' + prog : '');
  var lines = [
    'CALL BACK WITHIN THE HOUR',
    '',
    v.prospect_name || 'Unknown',
    phone,
    joinNonEmpty([v.city, v.country], ', '),
    localTime(v.country),
    '',
    joinNonEmpty([v.level, v.study_mode, v.destination], ' / '),
    prog,
    v.field_of_interest ? 'Field: ' + v.field_of_interest : '',
    v.specialisation ? 'Specialisation: ' + v.specialisation : '',
    v.intended_intake ? 'Intake: ' + v.intended_intake : '',
    v.budget ? 'Budget: ' + v.budget : '',
    '',
    'ACADEMIC RECORD',
    joinNonEmpty(['Bachelors: ' + v.bachelors_university, v.bachelors_year,
                  v.bachelors_grade], ', '),
    v.masters_university ? joinNonEmpty(['Masters: ' + v.masters_university,
                  v.masters_year, v.masters_grade], ', ') : '',
    '',
    flags ? 'FLAGS: ' + flags : '',
    v.main_objection ? 'THEY ASKED: ' + v.main_objection : '',
    '',
    'Email: ' + (v.email || 'none given'),
    'Call ID: ' + convId
  ];
  GmailApp.sendEmail(NOTIFY_TO, subject, compact(lines).join('\n'));
}

function buildFlags(v) {
  var f = [];
  if (truthy(v.asked_about_recognition)) f.push('recognition');
  if (truthy(v.asked_about_kennedy))     f.push('kennedy');
  if (truthy(v.under_18))                f.push('under 18');
  if (!v.callback_number)                f.push('no number');
  return f.join(', ');
}

/* ---------------- prospect email ---------------- */

function sendPack(v) {
  var name = v.prospect_name || 'there';
  var uni  = v.university_selected;
  var prog = v.programme_selected;
  var online = String(v.study_mode).toLowerCase().indexOf('online') >= 0;
  var subject = prog ? prog + ' at ' + uni + ' - the details we discussed'
                     : 'Your study options - Bridgewell Academic';
  var body = compact([
    'Dear ' + name + ',',
    '',
    'Thank you for your time on the call. As promised, here are the details on '
      + (prog || 'the programme') + (uni ? ' at ' + uni : '') + '.',
    '',
    v.field_of_interest ? 'Field of interest: ' + v.field_of_interest : '',
    v.specialisation ? 'Specialisation: ' + v.specialisation : '',
    v.intended_intake ? 'Intended intake: ' + v.intended_intake : '',
    v.study_mode ? 'Study format: ' + v.study_mode : '',
    '',
    online
      ? 'A note on the online route: it is delivered one hundred percent live '
        + 'online and is not F-1 supported, so it does not carry a US student visa.'
      : 'A note on the on-campus route: alongside tuition, please budget for '
        + 'living costs, housing and transport.',
    '',
    'Two things worth knowing before you go further:',
    '',
    '1. Tuition figures are indicative, set by the university and subject to '
      + 'change. They exclude living costs.',
    '2. Applications are not submitted through the university website - they go '
      + 'through your consultant, and I will guide you through it.',
    '',
    'I will give you a call within the hour. If it is easier, you can reach me '
      + 'on WhatsApp at ' + WHATSAPP + ' any time.',
    '',
    'Best regards,',
    'Akhil',
    'Academic Counselor',
    'Bridgewell Academic',
    WHATSAPP
  ]).join('\n');

  GmailApp.sendEmail(v.email, subject, body, {
    name: 'Akhil - Bridgewell Academic',
    replyTo: NOTIFY_TO
  });
}

/* ---------------- helpers ---------------- */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tab(name, headers) {
  var sh = ss().getSheetByName(name);
  if (!sh) {
    sh = ss().insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function config(key) {
  var sh = ss().getSheetByName(CONF);
  if (!sh) return '';
  var rows = sh.getDataRange().getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(key).toLowerCase()) {
      return rows[i][1];
    }
  }
  return '';
}

function pick(item) {
  if (item === null || item === undefined) return '';
  if (typeof item === 'object' && 'value' in item) return s(item.value);
  return s(item);
}

function localTime(country) {
  var off = OFFSETS[String(country || '').toLowerCase().trim()];
  if (off === undefined) return '';
  var t = new Date(Date.now() + off * 3600000);
  return 'Their time: ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
}

function joinNonEmpty(arr, sep) { return compact(arr).join(sep); }
function compact(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] !== '' && arr[i] !== null && arr[i] !== undefined) out.push(arr[i]);
  }
  return out;
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function s(x) { return (x === null || x === undefined) ? '' : String(x).trim(); }
function truthy(x) { return x === true || String(x).toLowerCase() === 'true'; }
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- sheet layout ---------------- */

/**
 * Run this once to build the Pipeline view and tidy the tabs.
 * Safe to re-run: it rebuilds Pipeline and re-applies formatting.
 */
function formatSheets() {
  var s = ss();

  // --- Pipeline: a clean live view of Leads, newest first ---
  var p = s.getSheetByName('Pipeline');
  if (!p) p = s.insertSheet('Pipeline', 0);
  p.clear();
  p.getRange('A1').setFormula(
    '=IFERROR(QUERY(Leads!A2:AG, "select A, D, Z, X, G, I, J, K, V, W, N, O, AC, AG where A is not null order by A desc", 0), "No calls yet")'
  );
  var heads = ['When','Name','Phone','Email','Country','Level','Mode','Destination',
               'University','Programme','Intake','Budget','Their question','Outcome'];
  p.insertRowBefore(1);
  p.getRange(1, 1, 1, heads.length).setValues([heads])
   .setFontWeight('bold').setBackground('#0B5D58').setFontColor('#FFFFFF');
  p.setFrozenRows(1);
  p.setFrozenColumns(2);
  var w = [130,150,140,210,110,100,100,110,150,220,110,110,240,120];
  for (var i = 0; i < w.length; i++) p.setColumnWidth(i + 1, w[i]);
  p.getRange('A2:A').setNumberFormat('dd MMM, HH:mm');

  // --- Callbacks: your working list ---
  var c = s.getSheetByName(CALLS);
  if (c) {
    c.setFrozenRows(1);
    c.setFrozenColumns(3);
    c.getRange(1, 1, 1, CALL_COLS.length)
     .setFontWeight('bold').setBackground('#0B5D58').setFontColor('#FFFFFF');
    var cw = [100,140,150,140,130,110,100,110,110,220,160,240,210,180];
    for (var j = 0; j < cw.length; j++) c.setColumnWidth(j + 1, cw[j]);
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Waiting','Called','No answer','Done'], true)
      .setAllowInvalid(false).build();
    c.getRange('A2:A1000').setDataValidation(rule);
    var waiting = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Waiting').setBackground('#F2DDDE').setFontColor('#962C35')
      .setRanges([c.getRange('A2:A1000')]).build();
    var done = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Done').setBackground('#D5E7E4').setFontColor('#0B5D58')
      .setRanges([c.getRange('A2:A1000')]).build();
    c.setConditionalFormatRules([waiting, done]);
  }

  // --- Leads: keep everything, just make it navigable ---
  var l = s.getSheetByName(LEADS);
  if (l) {
    l.setFrozenRows(1);
    l.setFrozenColumns(4);
    l.getRange(1, 1, 1, LEAD_COLS.length)
     .setFontWeight('bold').setBackground('#24333A').setFontColor('#FFFFFF');
    // hide the technical and analyser-derived columns
    ['conversation_id','duration_secs','is_right_person','consent_to_continue',
     'city','email_confirmed','under_18','voicemail_attempt'].forEach(function(name){
      var idx = LEAD_COLS.indexOf(name);
      if (idx > -1) l.hideColumns(idx + 1);
    });
  }

  // --- tab order and colours ---
  s.setActiveSheet(p); s.moveActiveSheet(1);
  p.setTabColor('#0B5D58');
  if (c) c.setTabColor('#962C35');
  if (l) l.setTabColor('#6C7A90');

  return 'Pipeline built. Leads tidied. Callbacks formatted.';
}
