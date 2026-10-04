// Swivel Gmail add-on: scans the open email and shows scam warnings + similar nearby reports.
// 1. Run the Swivel server and expose it (e.g. `ngrok http 3000`), then paste the URL below.
// 2. In the Swivel app: Me tab -> copy your key, then paste it into TOKEN below (or Script Properties -> SWIVEL_TOKEN).
//    The server looks up your language, age and city from the account, so nothing else is configured here.
var API = 'https://YOUR-TUNNEL.ngrok-free.app';
var TOKEN = PropertiesService.getScriptProperties().getProperty('SWIVEL_TOKEN') || 'PASTE-YOUR-KEY-HERE';

function onMessageOpen(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  var msg = GmailApp.getMessageById(e.gmail.messageId);
  var res = UrlFetchApp.fetch(API + '/api/analyze', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'ngrok-skip-browser-warning': '1', 'Authorization': 'Bearer ' + TOKEN },
    payload: JSON.stringify({
      subject: msg.getSubject(),
      body: msg.getPlainBody().slice(0, 4000)
    })
  });
  return buildCard(JSON.parse(res.getContentText()));
}

function buildCard(r) {
  var icon = { high: '🚨', medium: '⚠️', low: '✅' }[r.level];
  var s = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('<b>' + icon + ' ' + r.headline + '</b>'));  // already in the user's language
  if (r.scam) {
    s.addWidget(CardService.newKeyValue().setTopLabel('Looks like').setContent(r.scam.name).setMultiline(true));
    s.addWidget(CardService.newTextParagraph().setText(r.scam.summary));
  }
  if (r.ai) s.addWidget(CardService.newTextParagraph().setText(r.ai));
  if (r.hits && r.hits.length) s.addWidget(CardService.newKeyValue().setTopLabel('Warning signs').setContent(r.hits.join(', ')).setMultiline(true));
  if (r.community) s.addWidget(CardService.newTextParagraph().setText(r.community + ' people like you reported this scam this month.'));
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('SwivProtect').setSubtitle('by Swivel'))
    .addSection(s);
  if (r.recovery) {
    card.addSection(CardService.newCardSection().setHeader('If you already clicked or paid')
      .addWidget(CardService.newTextParagraph().setText('• ' + r.recovery.join('<br>• '))));
  }
  return card.build();
}
