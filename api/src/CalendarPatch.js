/** One-off patch: seed the ICE 2026 program calendar (15–17 Aug 2026) from
 *  the printed schedule PDF. Run patchIce2026Calendar() once from the Apps
 *  Script editor. Safe to re-run: an event is skipped when one with the same
 *  title already starts at the same time. Requires the writable calendar
 *  scope (https://www.googleapis.com/auth/calendar) in appsscript.json.
 *
 *  Times are wall-clock in the CALENDAR's own timezone, so they land
 *  correctly even though the script timezone is Asia/Singapore.
 *
 *  Open-ended slots in the PDF were capped: Day 2 "8.30-till late" → 23:00,
 *  Day 3 "7.30 Clean up…" → 21:00. Day 2 keeps the PDF's overlap between
 *  Invited Talk 2 (13:00–14:00) and Prototype (13:30–15:30) as printed.
 */
function patchIce2026Calendar() {
  var calId =
    getConfig_('PROGRAM_CALENDAR_ID_ice2026', '') ||
    getConfig_('PROGRAM_CALENDAR_ID', '') ||
    'c_77ef808e169d66dc1b79a4ba4c3e0dbb0e51fdfc2abefacb61e33f1a6a6f1e84@group.calendar.google.com';
  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) throw new Error('Calendar not accessible: ' + calId);
  var tz = cal.getTimeZone() || Session.getScriptTimeZone();

  // [date, start, end, title, description]
  var events = [
    // ---- Day 1 · Fri 15 August ----
    ['2026-08-15', '08:30', '09:00', 'Introduction & Welcome', ''],
    ['2026-08-15', '09:00', '09:30', 'Workshop Objectives, Expectations, Format', ''],
    ['2026-08-15', '09:30', '10:10', 'Team Challenge', ''],
    ['2026-08-15', '10:10', '10:30', 'Tea Break: Get to Know Your Team', ''],
    ['2026-08-15', '10:30', '11:00', 'HMW Wall: Empathy & Awareness', ''],
    ['2026-08-15', '11:00', '12:00', 'Define Problem Statements: from Generic to Measurable', ''],
    ['2026-08-15', '12:00', '13:00', 'Lunch: Get to Know Your Team',
      'Assigning team mentors, explore challenges wall.'],
    ['2026-08-15', '13:00', '13:45', 'Invited Talk 1 (TBD)',
      'Exploring a celebrity-type talk.'],
    ['2026-08-15', '13:45', '14:30', 'Team Presentation: Problem Statements', ''],
    ['2026-08-15', '14:30', '15:30', 'AI Sneak Peeks',
      '• Copilot + Unity (Prasanth)\n' +
      '• User-Aware Adaptive Assistive Wearables (Dinithi)\n' +
      '• AI Resources + Considerations for Startups (Tharindu)\n' +
      '• Prototyping with AI Coding Agents (Sankha)'],
    ['2026-08-15', '15:30', '15:50', 'Tea Break: Continue to Iterate on Problem Statements', ''],
    ['2026-08-15', '15:50', '17:20', 'Concept Generation & Selection: C-Sketch & SCAMPER', ''],
    ['2026-08-15', '17:20', '17:50', 'Team Presentations: Solution Concept Variants', ''],
    ['2026-08-15', '17:50', '18:00', "Summarize the Day's Activities", ''],
    ['2026-08-15', '19:30', '20:30', 'Dinner', ''],
    ['2026-08-15', '20:30', '22:30', 'Team Meeting with Facilitators',
      'Finalize problem statements & iterate on solution concept.'],

    // ---- Day 2 · Sat 16 August ----
    ['2026-08-16', '08:30', '08:35', 'Welcome to Day 2', ''],
    ['2026-08-16', '08:35', '08:45', 'Important Aspects of the Solution',
      'Interaction modality, user onboarding, intelligent feature(s), feedback.'],
    ['2026-08-16', '08:45', '09:20', 'What Do Prototypes Prototype?',
      'Wearable AI Platform (Ovindu + Shaveen).'],
    ['2026-08-16', '09:20', '10:00', 'What You Need to Prototype — Why and How', ''],
    ['2026-08-16', '10:00', '10:20', 'Tea Break', ''],
    ['2026-08-16', '10:20', '12:00', 'Team Presentation: Prototyping Plan', ''],
    ['2026-08-16', '12:00', '13:00', 'Lunch: Cross-Talk',
      'Think about prototypes & testing.'],
    ['2026-08-16', '13:00', '14:00', 'Invited Talk 2: Starting a Venture (Chalinda)', ''],
    ['2026-08-16', '13:30', '15:30', 'Prototype, Prototype, Prototype', ''],
    ['2026-08-16', '15:30', '16:00', 'Tea Break: Continue to Prototype', ''],
    ['2026-08-16', '16:00', '17:00', 'Idea Pitching — Think of Your Pitch', ''],
    ['2026-08-16', '17:00', '17:50', 'Team Presentation: Prototyping Status & Lean Canvas V1', ''],
    ['2026-08-16', '17:50', '18:00', "Summarize the Day's Activities", ''],
    ['2026-08-16', '19:30', '20:30', 'Dinner', ''],
    ['2026-08-16', '20:30', '23:00', 'Team Meetings: Planning / Prototyping / Lean Canvas',
      'Runs till late.'],

    // ---- Day 3 · Sun 17 August ----
    ['2026-08-17', '08:30', '09:15', 'Invited Talk 3: (re)Defining Success (Sanka)', ''],
    ['2026-08-17', '09:15', '10:00', 'Prototype & Test',
      'Update lean canvas, update pitch.'],
    ['2026-08-17', '10:00', '10:20', 'Tea Is Served (No Formal Break)', ''],
    ['2026-08-17', '10:45', '12:00', 'Prototype & Test (continued)',
      'Update lean canvas, update pitch.'],
    ['2026-08-17', '12:00', '13:00', 'Lunch: Discuss Your Pitch', ''],
    ['2026-08-17', '13:00', '13:30', 'Team Presentations: 3-Minute Pitch', ''],
    ['2026-08-17', '13:30', '15:30', 'Finalize Prototypes & Pitch', ''],
    ['2026-08-17', '15:30', '16:00', 'Tea Break: Set Up Demos', ''],
    ['2026-08-17', '16:00', '17:00', 'Finalize Demo Set-Up', ''],
    ['2026-08-17', '17:00', '17:15', 'Welcome of Finale Session', ''],
    ['2026-08-17', '17:15', '18:00', 'Pitch/Demo to VIPs', ''],
    ['2026-08-17', '18:00', '19:30', 'Certificate Awards & Networking with VIPs', ''],
    ['2026-08-17', '19:30', '21:00', 'Clean Up & Debrief',
      'Pack your stuff, follow-up, continue dinner, goodbye!'],
  ];

  var added = 0, skipped = 0;
  events.forEach(function (e) {
    var start = Utilities.parseDate(e[0] + ' ' + e[1], tz, 'yyyy-MM-dd HH:mm');
    var end = Utilities.parseDate(e[0] + ' ' + e[2], tz, 'yyyy-MM-dd HH:mm');
    var exists = cal.getEvents(start, end).some(function (ev) {
      return ev.getTitle() === e[3] && ev.getStartTime().getTime() === start.getTime();
    });
    if (exists) { skipped++; return; }
    cal.createEvent(e[3], start, end, e[4] ? { description: e[4] } : undefined);
    added++;
  });
  Logger.log('ICE 2026 calendar patch: %s added, %s skipped (already present) on %s [%s]',
    added, skipped, calId, tz);
}
