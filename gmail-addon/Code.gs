// SwivProtect Gmail add-on: checks the open email against SwivProtect's scam catalog and shows a warning card.
// Only the subject and text of the email you open are sent, and the server does not store them.
//
// How the add-on proves who you are (two ways):
//   1. Google sign-in (default). The add-on sends Google's sign-in token, so the server knows your Gmail address.
//      The first time, the add-on asks for a short code from the SwivProtect app (Edit profile -> Gmail add-on) to link
//      your Gmail address to your SwivProtect account. After that there is nothing to copy or paste.
//   2. A key. If the script property SWIVEL_TOKEN is set, the add-on uses that instead (handy for one tester).
//
// Script properties (Apps Script editor -> Project Settings -> Script properties):
//   SWIVEL_API    required  public https address of the SwivProtect server, no trailing slash
//   SWIVEL_TOKEN  optional  your SwivProtect key, to use the key instead of Google sign-in
//   SWIVEL_DEBUG  optional  set to 1 to show your sign-in details on the add-on home card (used to set up the server)

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function header_() {
  return CardService.newCardHeader().setTitle('SwivProtect').setSubtitle('by Swivel');
}

function paragraph_(text) {
  return CardService.newTextParagraph().setText(text);
}

function noteCard_(title, text) {
  return CardService.newCardBuilder().setHeader(header_())
    .addSection(CardService.newCardSection().addWidget(paragraph_('<b>' + title + '</b>')).addWidget(paragraph_(text)))
    .build();
}

function toast_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

// Reads the details inside a Google sign-in token (not to trust it: only to show it while setting up the server).
function decodeJwt_(token) {
  try {
    var part = token.split('.')[1];
    while (part.length % 4) part += '=';
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString());
  } catch (err) {
    return null;
  }
}

// Which credential to send: the key if one is set, otherwise Google's sign-in token.
function credential_() {
  var key = prop_('SWIVEL_TOKEN');
  if (key) return { mode: 'key', bearer: key };
  var idToken = ScriptApp.getIdentityToken();
  return idToken ? { mode: 'google', bearer: idToken } : { mode: 'none', bearer: '' };
}

function call_(path, payload) {
  var cred = credential_();
  var res = UrlFetchApp.fetch(prop_('SWIVEL_API').replace(/\/+$/, '') + path, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    // the extra headers make free tunnel services skip their "you are visiting a tunnel" warning page
    headers: { 'Authorization': 'Bearer ' + cred.bearer, 'ngrok-skip-browser-warning': '1', 'X-Pinggy-No-Screen': '1' },
    payload: JSON.stringify(payload)
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (ignore) { /* a non-JSON answer is reported by status */ }
  return { status: res.getResponseCode(), body: body, mode: cred.mode };
}

function onHomepage() {
  var section = CardService.newCardSection()
    .addWidget(paragraph_('Open an email and SwivProtect will check it for scam warning signs.'));
  if (prop_('SWIVEL_DEBUG') === '1') {
    var idToken = ScriptApp.getIdentityToken();
    var claims = idToken ? decodeJwt_(idToken) : null;
    section.addWidget(paragraph_(claims
      ? '<b>Setup info</b><br>Gmail address: ' + claims.email + '<br>Audience (set GOOGLE_AUDIENCE on the server to this): ' + claims.aud
      : '<b>Setup info</b><br>No Google sign-in token available. Check that the add-on has the openid and userinfo.email permissions.'));
  }
  return CardService.newCardBuilder().setHeader(header_()).addSection(section).build();
}

function onMessageOpen(e) {
  if (!prop_('SWIVEL_API')) {
    return noteCard_('Setup needed', 'Add SWIVEL_API under Project Settings -> Script properties in the Apps Script editor.');
  }
  if (credential_().mode === 'none') {
    return noteCard_('Permission needed', 'SwivProtect needs to see your Google email address so it knows which account to use. Close and reopen the add-on and approve the request.');
  }
  try {
    GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    var msg = GmailApp.getMessageById(e.gmail.messageId);
    var r = call_('/api/analyze', { subject: msg.getSubject(), body: msg.getPlainBody().slice(0, 4000) });
    return cardFor_(r);
  } catch (err) {
    return noteCard_('Could not reach SwivProtect', 'Is the server running and the address in SWIVEL_API correct? (' + err.message + ')');
  }
}

function cardFor_(r) {
  if (r.status === 200 && r.body && r.body.headline) return buildCard_(r.body);
  if (r.status === 200) {
    return noteCard_('Unexpected answer', 'The server did not answer like SwivProtect (a tunnel warning page, perhaps). Check the address in SWIVEL_API.');
  }
  if (r.status === 404 && r.body.code === 'not_linked') return linkCard_();
  if (r.status === 401 && r.mode === 'key') {
    return noteCard_('Key not accepted', 'Your SwivProtect key was not recognized. Copy it again from the app (Edit profile) into SWIVEL_TOKEN.');
  }
  if (r.status === 401) {
    return noteCard_('Google sign-in not accepted', 'The server did not accept your Google sign-in. If you run the server, check that GOOGLE_AUDIENCE matches this add-on (set SWIVEL_DEBUG to 1 to see it).');
  }
  if (r.status === 501) {
    return noteCard_('Gmail sign-in is off', 'This server is not set up for Google sign-in yet. Ask whoever runs SwivProtect, or use a key (SWIVEL_TOKEN).');
  }
  if (r.status === 429) {
    return noteCard_('Please slow down', 'SwivProtect is getting too many requests right now. Wait a minute and open the email again.');
  }
  if (r.status === 503) {
    return noteCard_('Please try again', 'SwivProtect could not reach Google to check your sign-in just now.');
  }
  return noteCard_('Could not check this email', 'The server answered with code ' + r.status + '.');
}

function linkCard_() {
  var input = CardService.newTextInput().setFieldName('code').setTitle('Link code').setHint('Example: ABCD-EFGH');
  var button = CardService.newTextButton().setText('Link my account')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('linkAccount'));
  return CardService.newCardBuilder().setHeader(header_())
    .addSection(CardService.newCardSection()
      .addWidget(paragraph_('<b>Link your SwivProtect account</b>'))
      .addWidget(paragraph_('Open the SwivProtect app, go to Edit profile, tap "Get a link code", and type the code below. You only need to do this once.'))
      .addWidget(input)
      .addWidget(CardService.newButtonSet().addButton(button)))
    .build();
}

// Runs when the "Link my account" button is pressed.
function linkAccount(e) {
  var code = String((e && e.formInput && e.formInput.code) || '').trim();
  if (!code) return toast_('Type the code from the SwivProtect app first.');
  try {
    var r = call_('/api/link-gmail', { code: code });
    if (r.status === 200) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText('Linked! Open an email to check it.'))
        .setNavigation(CardService.newNavigation().updateCard(
          noteCard_('Linked', 'Your Gmail address is now linked to your SwivProtect account. Open any email and SwivProtect will check it.')))
        .build();
    }
    return toast_(r.body && r.body.error ? r.body.error : 'Could not link your account (code ' + r.status + ').');
  } catch (err) {
    return toast_('Could not reach SwivProtect: ' + err.message);
  }
}

function buildCard_(r) {
  var icon = { high: '🚨', medium: '⚠️', low: '✅' }[r.level];
  var s = CardService.newCardSection()
    .addWidget(paragraph_('<b>' + icon + ' ' + r.headline + '</b>'));   // already in the user's language
  if (r.scam) {
    s.addWidget(CardService.newKeyValue().setTopLabel('Looks like').setContent(r.scam.name).setMultiline(true));
    s.addWidget(paragraph_(r.scam.summary));
  }
  if (r.ai) s.addWidget(paragraph_(r.ai));
  if (r.hits && r.hits.length) {
    s.addWidget(CardService.newKeyValue().setTopLabel('Warning signs found').setContent(r.hits.join(', ')).setMultiline(true));
  }
  if (r.community) s.addWidget(paragraph_(r.community + ' people like you reported this scam this month.'));

  var card = CardService.newCardBuilder().setHeader(header_()).addSection(s);
  if (r.scam && r.scam.tips && r.scam.tips.length) {
    card.addSection(CardService.newCardSection().setHeader('What to do')
      .addWidget(paragraph_('• ' + r.scam.tips.join('<br>• '))));
  }
  if (r.recovery) {
    card.addSection(CardService.newCardSection().setHeader('If you already clicked or paid')
      .addWidget(paragraph_('• ' + r.recovery.join('<br>• '))));
  }
  return card.build();
}
