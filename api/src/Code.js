/**
 * ICE2026 API — JSON backend over Google Sheets.
 *
 * Deployed as: execute as USER_DEPLOYING (owner), access ANYONE_ANONYMOUS.
 * The frontend (static site on GitHub Pages) talks to this endpoint with
 * POST + Content-Type: text/plain (CORS simple request — no preflight).
 *
 * Auth: bearer tokens minted by the sibling "auth" web app, HMAC-signed with
 * the shared SECRET (Secret.js — git-ignored, present in both projects).
 *
 * Storage: one spreadsheet (auto-created on first use, ID kept in Script
 * Properties) with a tab per table. Images go to a Drive folder shared
 * link-viewable and are served via lh3.googleusercontent.com.
 *
 * Scopes: only https://www.googleapis.com/auth/drive.file — the app can touch
 * ONLY the files it created itself. That's why all storage goes through the
 * Sheets/Drive advanced services (SpreadsheetApp/DriveApp would demand the
 * full drive + spreadsheets scopes).
 */

var ADMIN_EMAILS = ['sankha@ahlab.org'];

var DB_NAME = 'ICE2026 Database';
var UPLOADS_FOLDER_NAME = 'ICE2026 Uploads';
var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
var CACHE_TTL_SECONDS = 60;

var TABLES = {
  users: ['id', 'email', 'name', 'image', 'bio', 'skills', 'affiliation', 'expertise', 'gender', 'links', 'video', 'role', 'createdAt', 'updatedAt'],
  teams: ['id', 'name', 'description', 'coverImage', 'lookingFor', 'creatorId', 'members', 'createdAt', 'updatedAt'],
  team_links: ['id', 'teamId', 'createdBy', 'title', 'url', 'description', 'createdAt'],
  team_posts: ['id', 'teamId', 'createdBy', 'content', 'createdAt'],
  messages: ['id', 'senderId', 'receiverId', 'content', 'read', 'createdAt'],
  announcements: ['id', 'title', 'content', 'type', 'authorId', 'isPinned', 'isPublished', 'createdAt', 'updatedAt'],
};

var USER_PUBLIC_FIELDS = ['id', 'name', 'image', 'bio', 'skills', 'affiliation', 'expertise', 'links', 'video', 'role', 'createdAt'];

// ---------------------------------------------------------------- entrypoints

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var params = {};
  try {
    params = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON body' });
  }
  return handle_(params);
}

function handle_(params) {
  try {
    var action = String(params.action || '');
    var fn = ACTIONS[action];
    if (!fn) return json_({ ok: false, error: 'Unknown action: ' + action });

    var ctx = { email: null, user: null, isAdmin: false };
    var email = verifyToken_(params.token);
    if (email) {
      ctx.email = email;
      ctx.user = findUserByEmail_(email);
      ctx.isAdmin = isAdminEmail_(email) || (ctx.user && ctx.user.role === 'admin');
    }

    if (AUTH_REQUIRED[action] && !ctx.email) {
      return json_({ ok: false, error: 'auth', message: 'Please sign in.' });
    }
    if (ADMIN_REQUIRED[action] && !ctx.isAdmin) {
      return json_({ ok: false, error: 'forbidden', message: 'Admins only.' });
    }

    var result = fn(params, ctx);
    result.ok = result.ok !== false;
    return json_(result);
  } catch (err) {
    console.error('handle_ failed', err && err.stack || err);
    return json_({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------- auth

function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  try {
    var parts = token.split('.');
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, SECRET)).replace(/=+$/, '');
    if (expected !== parts[1]) return null;
    var pieces = payload.split('|');
    var email = pieces[0];
    var expiry = Number(pieces[1]);
    if (!email || !expiry || Date.now() > expiry) return null;
    return email.toLowerCase();
  } catch (err) {
    return null;
  }
}

function isAdminEmail_(email) {
  return ADMIN_EMAILS.indexOf(String(email).toLowerCase()) !== -1;
}

// ------------------------------------------------------------------- actions

var AUTH_REQUIRED = {
  me: 1, register: 1, update_profile: 1, upload_image: 1,
  create_team: 1, update_team: 1, delete_team: 1, join_team: 1, leave_team: 1,
  team_link_add: 1, team_link_delete: 1, team_post_add: 1,
  msg_send: 1, msg_inbox: 1, msg_thread: 1,
  ann_create: 1, ann_update: 1, ann_delete: 1,
  admin_set_role: 1, admin_delete_user: 1, admin_set_config: 1,
};

var ADMIN_REQUIRED = {
  ann_create: 1, ann_update: 1, ann_delete: 1,
  admin_set_role: 1, admin_delete_user: 1, admin_set_config: 1,
};

var ACTIONS = {

  ping: function () { return { pong: true, now: new Date().toISOString() }; },

  /** One-shot payload for the frontend: directory + teams + announcements. */
  bootstrap: function (params, ctx) {
    var users = readTable_('users').map(function (u) { return projectUser_(u, ctx); });
    var teams = readTable_('teams').map(parseTeam_);
    var announcements = readTable_('announcements')
      .filter(function (a) { return truthy_(a.isPublished); })
      .map(parseAnnouncement_);
    var unread = 0;
    if (ctx.user) {
      var myId = ctx.user.id;
      unread = readTable_('messages', true).filter(function (m) {
        return m.receiverId === myId && !truthy_(m.read);
      }).length;
    }
    return {
      registrationOpen: getConfig_('REGISTRATION_OPEN', 'true') === 'true',
      me: ctx.user ? projectUser_(ctx.user, ctx, true) : null,
      isAdmin: !!ctx.isAdmin,
      unread: unread,
      users: users,
      teams: teams,
      announcements: announcements,
    };
  },

  me: function (params, ctx) {
    return {
      registered: !!ctx.user,
      email: ctx.email,
      isAdmin: !!ctx.isAdmin,
      user: ctx.user ? projectUser_(ctx.user, ctx, true) : null,
    };
  },

  register: function (params, ctx) {
    if (ctx.user) return { ok: false, error: 'exists', message: 'You are already registered.' };
    if (getConfig_('REGISTRATION_OPEN', 'true') !== 'true' && !ctx.isAdmin) {
      return { ok: false, error: 'closed', message: 'Registration is closed.' };
    }
    var name = clean_(params.name, 100);
    if (!name) return { ok: false, error: 'validation', message: 'Name is required.' };
    var now = new Date().toISOString();
    var user = {
      id: Utilities.getUuid(),
      email: ctx.email,
      name: name,
      image: clean_(params.image, 500),
      bio: clean_(params.bio, 2000),
      skills: jsonArr_(params.skills, 30, 40),
      affiliation: clean_(params.affiliation, 200),
      expertise: clean_(params.expertise, 500),
      gender: clean_(params.gender, 30),
      links: jsonArr_(params.links, 10, 300),
      video: clean_(params.video, 300),
      role: isAdminEmail_(ctx.email) ? 'admin' : 'participant',
      createdAt: now,
      updatedAt: now,
    };
    appendRow_('users', user);
    return { user: projectUser_(user, { isAdmin: true }, true) };
  },

  update_profile: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var patch = { updatedAt: new Date().toISOString() };
    if (params.name !== undefined) {
      var name = clean_(params.name, 100);
      if (!name) return { ok: false, error: 'validation', message: 'Name cannot be empty.' };
      patch.name = name;
    }
    if (params.image !== undefined) patch.image = clean_(params.image, 500);
    if (params.bio !== undefined) patch.bio = clean_(params.bio, 2000);
    if (params.skills !== undefined) patch.skills = jsonArr_(params.skills, 30, 40);
    if (params.affiliation !== undefined) patch.affiliation = clean_(params.affiliation, 200);
    if (params.expertise !== undefined) patch.expertise = clean_(params.expertise, 500);
    if (params.gender !== undefined) patch.gender = clean_(params.gender, 30);
    if (params.links !== undefined) patch.links = jsonArr_(params.links, 10, 300);
    if (params.video !== undefined) patch.video = clean_(params.video, 300);
    updateRowById_('users', ctx.user.id, patch);
    var updated = findUserByEmail_(ctx.email);
    return { user: projectUser_(updated, ctx, true) };
  },

  upload_image: function (params, ctx) {
    var data = String(params.data || '');
    var m = data.match(/^data:([-\w.+/]+);base64,(.*)$/);
    var mime = m ? m[1] : String(params.mimeType || 'image/jpeg');
    var b64 = m ? m[2] : data;
    if (!/^image\//.test(mime)) return { ok: false, error: 'validation', message: 'Only images allowed.' };
    var bytes = Utilities.base64Decode(b64);
    if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: 'validation', message: 'Image must be under 5 MB.' };
    var name = (clean_(params.filename, 80) || 'upload') + '-' + Date.now();
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = Drive.Files.create({ name: name, parents: [uploadsFolderId_()] }, blob);
    Drive.Permissions.create({ role: 'reader', type: 'anyone' }, file.id);
    return { url: 'https://lh3.googleusercontent.com/d/' + file.id, fileId: file.id };
  },

  // ------------------------------------------------------------------ teams

  create_team: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var name = clean_(params.name, 100);
    if (!name) return { ok: false, error: 'validation', message: 'Team name is required.' };
    var now = new Date().toISOString();
    var team = {
      id: Utilities.getUuid(),
      name: name,
      description: clean_(params.description, 3000),
      coverImage: clean_(params.coverImage, 500),
      lookingFor: clean_(params.lookingFor, 500),
      creatorId: ctx.user.id,
      members: JSON.stringify([ctx.user.id]),
      createdAt: now,
      updatedAt: now,
    };
    appendRow_('teams', team);
    return { team: parseTeam_(team) };
  },

  update_team: function (params, ctx) {
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    if (!canManageTeam_(team, ctx)) return { ok: false, error: 'forbidden', message: 'Only the team creator can edit.' };
    var patch = { updatedAt: new Date().toISOString() };
    if (params.name !== undefined) {
      var name = clean_(params.name, 100);
      if (!name) return { ok: false, error: 'validation', message: 'Team name cannot be empty.' };
      patch.name = name;
    }
    if (params.description !== undefined) patch.description = clean_(params.description, 3000);
    if (params.coverImage !== undefined) patch.coverImage = clean_(params.coverImage, 500);
    if (params.lookingFor !== undefined) patch.lookingFor = clean_(params.lookingFor, 500);
    updateRowById_('teams', team.id, patch);
    return { team: parseTeam_(rowById_('teams', team.id)) };
  },

  delete_team: function (params, ctx) {
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    if (!canManageTeam_(team, ctx)) return { ok: false, error: 'forbidden', message: 'Only the team creator can delete.' };
    deleteRowsWhere_('team_links', function (r) { return r.teamId === team.id; });
    deleteRowsWhere_('team_posts', function (r) { return r.teamId === team.id; });
    deleteRowById_('teams', team.id);
    return {};
  },

  join_team: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    var members = parseArr_(team.members);
    if (members.indexOf(ctx.user.id) === -1) {
      members.push(ctx.user.id);
      updateRowById_('teams', team.id, { members: JSON.stringify(members), updatedAt: new Date().toISOString() });
    }
    return { team: parseTeam_(rowById_('teams', team.id)) };
  },

  leave_team: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    var members = parseArr_(team.members).filter(function (id) { return id !== ctx.user.id; });
    updateRowById_('teams', team.id, { members: JSON.stringify(members), updatedAt: new Date().toISOString() });
    return { team: parseTeam_(rowById_('teams', team.id)) };
  },

  team_detail: function (params, ctx) {
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    var links = readTable_('team_links').filter(function (r) { return r.teamId === team.id; });
    var posts = readTable_('team_posts').filter(function (r) { return r.teamId === team.id; });
    return { team: parseTeam_(team), links: links, posts: posts };
  },

  team_link_add: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    if (!isTeamMember_(team, ctx.user.id) && !ctx.isAdmin) {
      return { ok: false, error: 'forbidden', message: 'Members only.' };
    }
    var url = clean_(params.url, 500);
    if (!/^https?:\/\//.test(url)) return { ok: false, error: 'validation', message: 'A valid link URL is required.' };
    var link = {
      id: Utilities.getUuid(),
      teamId: team.id,
      createdBy: ctx.user.id,
      title: clean_(params.title, 150) || url,
      url: url,
      description: clean_(params.description, 500),
      createdAt: new Date().toISOString(),
    };
    appendRow_('team_links', link);
    return { link: link };
  },

  team_link_delete: function (params, ctx) {
    var link = rowById_('team_links', params.linkId);
    if (!link) return { ok: false, error: 'notfound', message: 'Link not found.' };
    var team = rowById_('teams', link.teamId);
    var mine = ctx.user && link.createdBy === ctx.user.id;
    if (!mine && !canManageTeam_(team, ctx)) return { ok: false, error: 'forbidden', message: 'Not allowed.' };
    deleteRowById_('team_links', link.id);
    return {};
  },

  team_post_add: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var team = rowById_('teams', params.teamId);
    if (!team) return { ok: false, error: 'notfound', message: 'Team not found.' };
    if (!isTeamMember_(team, ctx.user.id) && !ctx.isAdmin) {
      return { ok: false, error: 'forbidden', message: 'Members only.' };
    }
    var content = clean_(params.content, 2000);
    if (!content) return { ok: false, error: 'validation', message: 'Message cannot be empty.' };
    var post = {
      id: Utilities.getUuid(),
      teamId: team.id,
      createdBy: ctx.user.id,
      content: content,
      createdAt: new Date().toISOString(),
    };
    appendRow_('team_posts', post);
    return { post: post };
  },

  // --------------------------------------------------------------- messages

  msg_send: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var to = rowById_('users', params.toId);
    if (!to) return { ok: false, error: 'notfound', message: 'Recipient not found.' };
    var content = clean_(params.content, 2000);
    if (!content) return { ok: false, error: 'validation', message: 'Message cannot be empty.' };
    var msg = {
      id: Utilities.getUuid(),
      senderId: ctx.user.id,
      receiverId: to.id,
      content: content,
      read: 'false',
      createdAt: new Date().toISOString(),
    };
    appendRow_('messages', msg);
    return { message: msg };
  },

  msg_inbox: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var myId = ctx.user.id;
    var mine = readTable_('messages', true).filter(function (m) {
      return m.senderId === myId || m.receiverId === myId;
    });
    var byPeer = {};
    mine.forEach(function (m) {
      var peer = m.senderId === myId ? m.receiverId : m.senderId;
      var e = byPeer[peer] || (byPeer[peer] = { peerId: peer, last: null, unread: 0 });
      if (!e.last || m.createdAt > e.last.createdAt) e.last = m;
      if (m.receiverId === myId && !truthy_(m.read)) e.unread++;
    });
    var conversations = Object.keys(byPeer).map(function (k) { return byPeer[k]; });
    conversations.sort(function (a, b) { return a.last.createdAt < b.last.createdAt ? 1 : -1; });
    return { conversations: conversations };
  },

  msg_thread: function (params, ctx) {
    if (!ctx.user) return { ok: false, error: 'noprofile', message: 'Register first.' };
    var myId = ctx.user.id;
    var peerId = String(params.peerId || '');
    var thread = readTable_('messages', true).filter(function (m) {
      return (m.senderId === myId && m.receiverId === peerId) ||
             (m.senderId === peerId && m.receiverId === myId);
    });
    thread.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    // mark incoming as read
    var unreadIds = thread.filter(function (m) { return m.receiverId === myId && !truthy_(m.read); })
                          .map(function (m) { return m.id; });
    if (unreadIds.length) markMessagesRead_(unreadIds);
    return { messages: thread };
  },

  // ---------------------------------------------------------- announcements

  ann_create: function (params, ctx) {
    var title = clean_(params.title, 200);
    var content = clean_(params.content, 5000);
    if (!title || !content) return { ok: false, error: 'validation', message: 'Title and content are required.' };
    var now = new Date().toISOString();
    var ann = {
      id: Utilities.getUuid(),
      title: title,
      content: content,
      type: ['general', 'important', 'urgent'].indexOf(params.type) !== -1 ? params.type : 'general',
      authorId: ctx.user ? ctx.user.id : ctx.email,
      isPinned: truthy_(params.isPinned) ? 'true' : 'false',
      isPublished: 'true',
      createdAt: now,
      updatedAt: now,
    };
    appendRow_('announcements', ann);
    return { announcement: parseAnnouncement_(ann) };
  },

  ann_update: function (params, ctx) {
    var ann = rowById_('announcements', params.id);
    if (!ann) return { ok: false, error: 'notfound', message: 'Announcement not found.' };
    var patch = { updatedAt: new Date().toISOString() };
    if (params.title !== undefined) patch.title = clean_(params.title, 200);
    if (params.content !== undefined) patch.content = clean_(params.content, 5000);
    if (params.type !== undefined && ['general', 'important', 'urgent'].indexOf(params.type) !== -1) patch.type = params.type;
    if (params.isPinned !== undefined) patch.isPinned = truthy_(params.isPinned) ? 'true' : 'false';
    if (params.isPublished !== undefined) patch.isPublished = truthy_(params.isPublished) ? 'true' : 'false';
    updateRowById_('announcements', ann.id, patch);
    return { announcement: parseAnnouncement_(rowById_('announcements', ann.id)) };
  },

  ann_delete: function (params, ctx) {
    deleteRowById_('announcements', params.id);
    return {};
  },

  // ------------------------------------------------------------------ admin

  admin_set_role: function (params, ctx) {
    var user = rowById_('users', params.userId);
    if (!user) return { ok: false, error: 'notfound', message: 'User not found.' };
    var role = String(params.role || '');
    if (['participant', 'mentor', 'admin'].indexOf(role) === -1) {
      return { ok: false, error: 'validation', message: 'Role must be participant, mentor or admin.' };
    }
    updateRowById_('users', user.id, { role: role, updatedAt: new Date().toISOString() });
    return {};
  },

  admin_delete_user: function (params, ctx) {
    var user = rowById_('users', params.userId);
    if (!user) return { ok: false, error: 'notfound', message: 'User not found.' };
    deleteRowById_('users', user.id);
    // remove from teams
    readTable_('teams').forEach(function (t) {
      var members = parseArr_(t.members);
      if (members.indexOf(user.id) !== -1) {
        updateRowById_('teams', t.id, { members: JSON.stringify(members.filter(function (m) { return m !== user.id; })) });
      }
    });
    return {};
  },

  admin_set_config: function (params, ctx) {
    if (params.registrationOpen !== undefined) {
      setConfig_('REGISTRATION_OPEN', truthy_(params.registrationOpen) ? 'true' : 'false');
    }
    return { registrationOpen: getConfig_('REGISTRATION_OPEN', 'true') === 'true' };
  },
};

// -------------------------------------------------------------- projections

function projectUser_(u, ctx, includePrivate) {
  var out = {};
  USER_PUBLIC_FIELDS.forEach(function (f) { out[f] = u[f]; });
  out.skills = parseArr_(u.skills);
  out.links = parseArr_(u.links);
  if (includePrivate || (ctx && ctx.isAdmin)) {
    out.email = u.email;
    out.gender = u.gender;
  }
  return out;
}

function parseTeam_(t) {
  var out = {};
  Object.keys(t).forEach(function (k) { out[k] = t[k]; });
  out.members = parseArr_(t.members);
  return out;
}

function parseAnnouncement_(a) {
  var out = {};
  Object.keys(a).forEach(function (k) { out[k] = a[k]; });
  out.isPinned = truthy_(a.isPinned);
  out.isPublished = truthy_(a.isPublished);
  return out;
}

function canManageTeam_(team, ctx) {
  if (!team) return false;
  if (ctx.isAdmin) return true;
  return !!(ctx.user && team.creatorId === ctx.user.id);
}

function isTeamMember_(team, userId) {
  return parseArr_(team.members).indexOf(userId) !== -1;
}

// ------------------------------------------------------------------ helpers

function clean_(v, maxLen) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, maxLen);
}

function jsonArr_(v, maxItems, maxLen) {
  var arr = Array.isArray(v) ? v : parseArr_(v);
  arr = arr.map(function (s) { return clean_(s, maxLen); })
           .filter(function (s) { return s.length > 0; })
           .slice(0, maxItems);
  return JSON.stringify(arr);
}

function parseArr_(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try {
    var parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

function truthy_(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

function getConfig_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null ? fallback : v;
}

function setConfig_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function findUserByEmail_(email) {
  var users = readTable_('users');
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) return users[i];
  }
  return null;
}

function rowById_(table, id) {
  if (!id) return null;
  var rows = readTable_(table, table === 'messages');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i];
  }
  return null;
}

// ------------------------------------------------------------ sheet plumbing
// All storage via the Sheets/Drive ADVANCED SERVICES so the only OAuth scope
// needed is drive.file (access limited to files this app created).

function colLetter_(n) {
  var s = '';
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Spreadsheet ID — created on first use, with all tabs + header rows. */
function dbId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_ID');
  if (id) return id;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    id = props.getProperty('DB_ID');
    if (id) return id;
    var names = Object.keys(TABLES);
    var ss = Sheets.Spreadsheets.create({
      properties: { title: DB_NAME },
      sheets: names.map(function (name) {
        return { properties: { title: name, gridProperties: { frozenRowCount: 1 } } };
      }),
    });
    var gids = {};
    (ss.sheets || []).forEach(function (sh) { gids[sh.properties.title] = sh.properties.sheetId; });
    Sheets.Spreadsheets.Values.batchUpdate({
      valueInputOption: 'RAW',
      data: names.map(function (name) { return { range: name + '!A1', values: [TABLES[name]] }; }),
    }, ss.spreadsheetId);
    props.setProperty('DB_GIDS', JSON.stringify(gids));
    props.setProperty('DB_ID', ss.spreadsheetId);
    return ss.spreadsheetId;
  } finally {
    lock.releaseLock();
  }
}

/** Numeric sheetId (gid) for a tab; creates the tab if missing. */
function gid_(name) {
  var props = PropertiesService.getScriptProperties();
  var gids = {};
  try { gids = JSON.parse(props.getProperty('DB_GIDS') || '{}'); } catch (e) { gids = {}; }
  if (gids[name] !== undefined) return gids[name];
  var meta = Sheets.Spreadsheets.get(dbId_(), { fields: 'sheets.properties' });
  gids = {};
  (meta.sheets || []).forEach(function (sh) { gids[sh.properties.title] = sh.properties.sheetId; });
  if (gids[name] === undefined) {
    var r = Sheets.Spreadsheets.batchUpdate({
      requests: [{ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } }],
    }, dbId_());
    gids[name] = r.replies[0].addSheet.properties.sheetId;
    Sheets.Spreadsheets.Values.update({ values: [TABLES[name]] }, dbId_(), name + '!A1', { valueInputOption: 'RAW' });
  }
  props.setProperty('DB_GIDS', JSON.stringify(gids));
  return gids[name];
}

function tableRange_(name) {
  return name + '!A2:' + colLetter_(TABLES[name].length);
}

/** Read a table as array of objects. Cached unless noCache. */
function readTable_(name, noCache) {
  var cache = CacheService.getScriptCache();
  if (!noCache) {
    var hit = cache.get('tbl_' + name);
    if (hit) {
      try { return JSON.parse(hit); } catch (e) { /* refetch */ }
    }
  }
  var headers = TABLES[name];
  var resp = Sheets.Spreadsheets.Values.get(dbId_(), tableRange_(name));
  var values = (resp && resp.values) || [];
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = values[r][c];
      obj[headers[c]] = v === null || v === undefined ? '' : String(v);
    }
    if (obj.id) rows.push(obj);
  }
  if (!noCache) {
    var s = JSON.stringify(rows);
    if (s.length < 90000) cache.put('tbl_' + name, s, CACHE_TTL_SECONDS);
  }
  return rows;
}

function invalidate_(name) {
  CacheService.getScriptCache().remove('tbl_' + name);
}

function appendRow_(name, obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var headers = TABLES[name];
    Sheets.Spreadsheets.Values.append(
      { values: [headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; })] },
      dbId_(), name + '!A1',
      { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }
    );
  } finally {
    lock.releaseLock();
  }
  invalidate_(name);
}

/** 1-based sheet row index for an id (header = row 1), or -1. */
function findRowIndexById_(name, id) {
  var resp = Sheets.Spreadsheets.Values.get(dbId_(), name + '!A2:A');
  var ids = (resp && resp.values) || [];
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function updateRowById_(name, id, patch) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var headers = TABLES[name];
    var rowIdx = findRowIndexById_(name, id);
    if (rowIdx === -1) throw new Error('Row not found in ' + name + ': ' + id);
    var range = name + '!A' + rowIdx + ':' + colLetter_(headers.length) + rowIdx;
    var resp = Sheets.Spreadsheets.Values.get(dbId_(), range);
    var row = ((resp && resp.values) || [[]])[0] || [];
    var merged = headers.map(function (h, i) {
      return patch[h] !== undefined ? patch[h] : (row[i] !== undefined ? row[i] : '');
    });
    Sheets.Spreadsheets.Values.update({ values: [merged] }, dbId_(), range, { valueInputOption: 'RAW' });
  } finally {
    lock.releaseLock();
  }
  invalidate_(name);
}

function deleteRowById_(name, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rowIdx = findRowIndexById_(name, id);
    if (rowIdx !== -1) {
      Sheets.Spreadsheets.batchUpdate({
        requests: [{ deleteDimension: { range: {
          sheetId: gid_(name), dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx,
        } } }],
      }, dbId_());
    }
  } finally {
    lock.releaseLock();
  }
  invalidate_(name);
}

function deleteRowsWhere_(name, predicate) {
  var rows = readTable_(name, true);
  var doomed = rows.filter(predicate).map(function (r) { return r.id; });
  doomed.forEach(function (id) { deleteRowById_(name, id); });
}

function markMessagesRead_(ids) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var readCol = colLetter_(TABLES.messages.indexOf('read') + 1);
    var resp = Sheets.Spreadsheets.Values.get(dbId_(), 'messages!A2:A');
    var rows = (resp && resp.values) || [];
    var data = [];
    for (var i = 0; i < rows.length; i++) {
      if (ids.indexOf(String(rows[i][0])) !== -1) {
        data.push({ range: 'messages!' + readCol + (i + 2), values: [['true']] });
      }
    }
    if (data.length) {
      Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, dbId_());
    }
  } finally {
    lock.releaseLock();
  }
}

function uploadsFolderId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('UPLOADS_FOLDER_ID');
  if (id) return id;
  var folder = Drive.Files.create({ name: UPLOADS_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' });
  props.setProperty('UPLOADS_FOLDER_ID', folder.id);
  return folder.id;
}

/** Run once from the IDE to authorize the (drive.file) scope and create the database. */
function setup() {
  var id = dbId_();
  console.log('Database ready: https://docs.google.com/spreadsheets/d/' + id);
  console.log('Uploads folder id: ' + uploadsFolderId_());
}
