/**
 * ICE2026 Auth — Google sign-in broker.
 *
 * Deployed as: execute as USER_ACCESSING, access ANYONE (Google sign-in required).
 * Google forces the visitor to sign in before this doGet runs, so
 * Session.getActiveUser().getEmail() is the verified identity of the visitor.
 * We mint an HMAC-signed bearer token and bounce the browser back to the
 * frontend with it in the URL hash. The API project (separate deployment,
 * executes as owner) verifies the same HMAC using the shared SECRET.
 *
 * SECRET lives in Secret.js (git-ignored, clasp-pushed). Same file in api/.
 */

var TOKEN_TTL_DAYS = 30;

// Redirect allowlist — token is only ever handed to these origins.
var ALLOWED_REDIRECT_PREFIXES = [
  'https://ice2k26.github.io/',
  'http://localhost:',
  'http://127.0.0.1:',
];

function doGet(e) {
  var params = (e && e.parameter) || {};
  var redirect = params.redirect || '';

  var email = '';
  try {
    email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  } catch (err) {
    email = '';
  }

  if (!email) {
    return renderMessage_(
      'Sign-in failed',
      'Google did not provide your email address. Please try again in a regular browser window (not incognito), or contact the organizers.'
    );
  }

  if (!isAllowedRedirect_(redirect)) {
    return renderMessage_(
      'Invalid redirect',
      'This sign-in link points to an unrecognized site (' + escapeHtml_(redirect) + '). Please start again from the official ICE2026 website.'
    );
  }

  var token = mintToken_(email);
  var sep = redirect.indexOf('#') === -1 ? '#' : '&';
  var target = redirect + sep + 'icetoken=' + encodeURIComponent(token);

  // HtmlService pages run in a sandboxed iframe; window.top navigation is
  // permitted and replaces the whole tab with the frontend URL.
  var page = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in…</title></head>' +
    '<body style="font-family:sans-serif;padding:2rem;color:#0E0F11">' +
    '<p>Signing you in as <b>' + escapeHtml_(email) + '</b>…</p>' +
    '<p>If nothing happens, <a id="go" href="' + target.replace(/"/g, '&quot;') + '" target="_top">click here to continue</a>.</p>' +
    '<script>try{window.top.location.href=' + JSON.stringify(target) + ';}catch(e){}</script>' +
    '</body></html>'
  );
  page.setTitle('ICE2026 — Signing in');
  return page;
}

function isAllowedRedirect_(url) {
  if (!url) return false;
  for (var i = 0; i < ALLOWED_REDIRECT_PREFIXES.length; i++) {
    if (url.indexOf(ALLOWED_REDIRECT_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/** token = base64url("email|expiryMillis") + "." + base64url(hmac) */
function mintToken_(email) {
  var expiry = Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  var payload = email + '|' + expiry;
  var sig = Utilities.computeHmacSha256Signature(payload, SECRET);
  return b64url_(Utilities.newBlob(payload).getBytes()) + '.' + b64url_(sig);
}

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function renderMessage_(title, body) {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml_(title) + '</title></head>' +
    '<body style="font-family:sans-serif;padding:2rem;color:#0E0F11">' +
    '<h2>' + escapeHtml_(title) + '</h2><p>' + body + '</p></body></html>'
  );
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
