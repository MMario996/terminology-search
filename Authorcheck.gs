// ============================================================================
// AUTHOR CHECK ? Grammatik- & Terminologiepr?fung (Docs / Sheets / Slides)
// Nutzt dieselbe Gemini/Apigee-Anbindung wie TermSearch (GEMINI_API_KEY,
// GEMINI_API_URL, AI_MODEL, AI_TEMPERATURE aus den Script Properties).
// ============================================================================

const AUTHORCHECK_DEFAULT_PROMPT =
'Du bist ein Lektorats-Assistent f?r K?rcher-Texte (Hersteller von Reinigungsger?ten: ' +
'Hochdruckreiniger, Kehrmaschinen, Sauger, Zubeh?r).\n\n' +
'Pr?fe den folgenden Text (Sprache: {sourceLang}) auf diese Fehlerarten:\n' +
'1. GRAMMATIK- UND RECHTSCHREIBFEHLER\n' +
'2. FALSCHE ODER UNEINHEITLICHE K?RCHER-FACHBEGRIFFE ? vergleiche mit dieser Liste ' +
'"falscher Begriff ? korrekter Begriff":\n{termList}\n' +
'3. SPEZIFISCHE SCHREIB- UND STILREGELN:\n{styleRules}\n\n' +
'Text:\n"""\n{text}\n"""\n\n' +
'Antworte AUSSCHLIESSLICH mit validem JSON in exakt dieser Struktur, ohne Markdown-Formatierung, ' +
'ohne Codeblock:\n' +
'{"issues":[{"type":"grammar|terminology|style","original":"...","suggestion":"...","explanation":"..."}]}\n\n' +
'Regeln:\n' +
'- "type" ist entweder "grammar", "terminology" oder "style".\n' +
'- "original" muss ein EXAKTES, zusammenh?ngendes Zitat aus dem Originaltext sein.\n' +
'- Gib nur echte Fehler zur?ck, basierend auf den Vorgaben. Wenn keine Fehler gefunden werden, gib {"issues":[]} zur?ck.';

// ??? SIDEBAR ENTRY ?????????????????????????????????????????????????????????
function showAuthorCheckSidebar() {
  var ui = HtmlService.createHtmlOutputFromFile('AuthorCheck')
    .setTitle('K?rcher Autoren-Check')
    .setWidth(340);

  if (DocumentApp.getActiveDocument()) DocumentApp.getUi().showSidebar(ui);
  else if (SpreadsheetApp.getActiveSpreadsheet()) SpreadsheetApp.getUi().showSidebar(ui);
  else if (SlidesApp.getActivePresentation()) SlidesApp.getUi().showSidebar(ui);
}

// ??? GLOSSAR AUS DEN TERMBASES BAUEN ???????????????????????????????????????
var AUTHORCHECK_GLOSSARY_TTL = 21600;
var AUTHORCHECK_GLOSSARY_MAX_PAIRS = 400;  
var AUTHORCHECK_GLOSSARY_MAX_PAGES = 20;   

function _buildTerminologyGlossary_(sourceLang) {
  var lang = String(sourceLang || 'de').trim();
  var cacheKey = 'AUTHORCHECK_GLOSSARY_' + lang;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }

  var termbases = _getTargetTermbases_();
  var auth = _phraseAuth_();
  var pairs = [];

  termbases.forEach(function (tb) {
    var pageNumber = 0;
    while (pageNumber < AUTHORCHECK_GLOSSARY_MAX_PAGES) {
      var body = { pageNumber: pageNumber, pageSize: 50, queryLang: lang };
      var res;
      try {
        res = UrlFetchApp.fetch(PHRASE_V1 + '/termBases/' + encodeURIComponent(tb.uid) + '/browse', {
          method: 'post', contentType: 'application/json',
          headers: { Authorization: auth }, payload: JSON.stringify(body), muteHttpExceptions: true
        });
      } catch (e) { break; }
      if (res.getResponseCode() !== 200) break;

      var data;
      try { data = JSON.parse(res.getContentText()); } catch (e) { break; }
      var concepts = data.searchResults || data.concepts || [];
      if (!concepts.length) break;

      concepts.forEach(function (concept) {
        var allTerms = [];
        (concept.terms || []).forEach(function (ti) {
          (Array.isArray(ti) ? ti : [ti]).forEach(function (t) { allTerms.push(t); });
        });
        var sameLang = allTerms.filter(function (t) { return (t.lang || t.language || '') === lang; });
        var forbidden = sameLang.filter(function (t) { return t.forbidden === true; });
        var approved = sameLang.filter(function (t) { return t.forbidden !== true; });
        if (forbidden.length && approved.length) {
          forbidden.forEach(function (f) {
            var wrong = String(f.text || f.term || '').trim();
            var correct = String(approved[0].text || approved[0].term || '').trim();
            if (wrong && correct) pairs.push({ wrong: wrong, correct: correct });
          });
        }
      });

      if (concepts.length < 50) break;
      pageNumber++;
    }
  });

  var seen = {};
  var unique = pairs.filter(function (p) {
    var k = p.wrong.toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  }).slice(0, AUTHORCHECK_GLOSSARY_MAX_PAIRS);

  try { cache.put(cacheKey, JSON.stringify(unique), AUTHORCHECK_GLOSSARY_TTL); } catch (e) {}
  return unique;
}

// ??? HAUPTPR?FUNG ????????????????????????????????????????????????????????
function apiRunAuthorCheck(sourceLang) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty('GEMINI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('Die KI-Pr?fung ist noch nicht konfiguriert (Gemini API Key fehlt).');

  var text = apiExtractTextFromCurrentApp();
  if (!text || !text.trim()) throw new Error('Kein Text im aktuellen Dokument gefunden.');

  var lang = sourceLang || 'de';
  var glossary = _buildTerminologyGlossary_(lang);
  var termListStr = glossary.length
    ? glossary.map(function (p) { return '- ' + p.wrong + ' ? ' + p.correct; }).join('\n')
    : '(keine spezifischen Eintr?ge f?r diese Sprache gefunden)';

  // LADE DIE REGELN
  var allRules = apiGetRulesConfig();
  var activeRules = allRules.filter(function(r) { return r.IsEnabled; });
  var rulesStr = activeRules.length > 0 
    ? activeRules.map(function(r) { 
        var param = (r.IsConfigurable && r.Parameter !== "-1" && r.Parameter !== null) ? " (Wert: " + r.Parameter + ")" : "";
        return "- [" + r.Type + "] " + r.Description + param; 
      }).join('\n')
    : '(Keine spezifischen Regeln aktiviert)';

  var rawUrl = props.getProperty('GEMINI_API_URL') || 'https://34-111-99-134.nip.io/gemini/v1beta/models/';
  var apiUrl = rawUrl.split(']')[0].replace('[', '').trim();
  var model = (props.getProperty('AI_MODEL') || 'gemini-3.6-flash').trim();
  var temperature = parseFloat(props.getProperty('AI_TEMPERATURE')) || 0.2;

  var promptTemplate = props.getProperty('AUTHORCHECK_PROMPT') || AUTHORCHECK_DEFAULT_PROMPT;
  var prompt = promptTemplate
    .replace(/\{sourceLang\}/g, lang)
    .replace(/\{termList\}/g, termListStr)
    .replace(/\{styleRules\}/g, rulesStr)
    .replace(/\{text\}/g, text.replace(/"""/g, "'''"));

  var call = _buildGeminiRequest_(apiUrl, model, apiKey, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: temperature }
  });

  var res = UrlFetchApp.fetch(call.url, {
    method: 'post', contentType: 'application/json',
    headers: call.headers, payload: JSON.stringify(call.body), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('KI-Anfrage fehlgeschlagen (' + code + ').');

  var data = JSON.parse(res.getContentText());
  var respText;
  try { respText = data.candidates[0].content.parts[0].text; }
  catch (e) { throw new Error('Unerwartete KI-Antwortstruktur.'); }

  var clean = String(respText).replace(/```json/gi, '').replace(/```/g, '').trim();
  var parsed;
  try { parsed = JSON.parse(clean); }
  catch (e) { throw new Error('KI-Antwort war kein g?ltiges JSON.'); }

  var issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  issues = issues.filter(function (i) { return i && i.original && i.suggestion; });
  issues.forEach(function (issue, i) {
    issue.id = 'ac_' + i;
    if (issue.type !== 'terminology' && issue.type !== 'style') issue.type = 'grammar';
  });

  logAuditEvent_(getUserEmail_(), 'AUTHOR_CHECK_RUN', 'Found ' + issues.length + ' issue(s), lang=' + lang);
  return { issues: issues, wordCount: text.trim().split(/\s+/).length, glossarySize: glossary.length };
}

// ??? KORREKTUR IM DOKUMENT ANWENDEN ????????????????????????????????????????
function apiApplyAuthorCheckFix(original, suggestion) {
  var count = 0;

  if (DocumentApp.getActiveDocument()) {
    var body = DocumentApp.getActiveDocument().getBody();
    var found = body.findText(_escapeRegexAC_(original));
    while (found) {
      var el = found.getElement().asText();
      var start = found.getStartOffset();
      var end = found.getEndOffsetInclusive();
      el.deleteText(start, end);
      el.insertText(start, suggestion);
      count++;
      found = body.findText(_escapeRegexAC_(original));
    }
  } else if (SpreadsheetApp.getActiveSpreadsheet()) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var range = sheet.getDataRange();
    var values = range.getValues();
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        var cell = String(values[r][c]);
        if (cell.indexOf(original) !== -1) {
          values[r][c] = cell.split(original).join(suggestion);
          count++;
        }
      }
    }
    range.setValues(values);
  } else if (SlidesApp.getActivePresentation()) {
    var slides = SlidesApp.getActivePresentation().getSlides();
    slides.forEach(function (slide) {
      slide.getShapes().forEach(function (shape) {
        if (shape.getShapeType() === SlidesApp.ShapeType.TEXT_BOX) {
          var tr = shape.getText();
          if (tr.asString().indexOf(original) !== -1) {
            tr.replaceAllText(_escapeRegexAC_(original), suggestion);
            count++;
          }
        }
      });
    });
  }

  if (count === 0) throw new Error('Textstelle "' + original + '" wurde nicht mehr gefunden (evtl. bereits ge?ndert oder abweichend formatiert).');
  logAuditEvent_(getUserEmail_(), 'AUTHOR_CHECK_FIX_APPLIED', original + ' ? ' + suggestion + ' (' + count + 'x)');
  return { success: true, count: count };
}

function _escapeRegexAC_(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}