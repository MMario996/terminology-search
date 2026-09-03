// ============================================================================
// AUTHOR CHECK ? Grammatik- & Terminologiepr?fung (Docs / Sheets / Slides)
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

// ??? ANSICHTEN: CHECKS IN DER SEITENLEISTE / RULES IM POPUP ???????????????
function showAuthorCheckSidebar() {
  PropertiesService.getUserProperties().deleteProperty('AUTHORCHECK_IS_RULES_ONLY');
  var ui = HtmlService.createHtmlOutputFromFile('AuthorCheck')
    .setTitle('K?rcher Author Check')
    .setWidth(350);

  _getUiSafe_().showSidebar(ui);
}

function apiOpenRulesModal() {
  PropertiesService.getUserProperties().setProperty('AUTHORCHECK_IS_RULES_ONLY', 'true');
  var ui = HtmlService.createHtmlOutputFromFile('AuthorCheck')
    .setTitle('Rules & Custom Prompts')
    .setWidth(1100)
    .setHeight(800);

  _getUiSafe_().showModalDialog(ui, 'Rules & Custom Prompts');
}

/**
 * Hilfsfunktion: Ermittelt sicher das UI f?r Docs, Sheets oder Slides
 * ohne Permission-Exceptions abzuwerfen.
 */
function _getUiSafe_() {
  try {
    if (typeof DocumentApp !== 'undefined' && DocumentApp.getActiveDocument()) {
      return DocumentApp.getUi();
    }
  } catch (e) {}

  try {
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet()) {
      return SpreadsheetApp.getUi();
    }
  } catch (e) {}

  try {
    if (typeof SlidesApp !== 'undefined' && SlidesApp.getActivePresentation()) {
      return SlidesApp.getUi();
    }
  } catch (e) {}

  throw new Error("Could not determine active Workspace App UI.");
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
function apiRunAuthorCheck(sourceLang, checkScope) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty('GEMINI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('AI inspection is not configured (Gemini API Key missing).');

  var text = apiExtractTextFromCurrentApp(checkScope);
  if (!text || !text.trim()) {
    var errMsg = (checkScope === 'selection') ? 'No text selected. Please highlight text first.' : 'No text found in active document.';
    throw new Error(errMsg);
  }

  var lang = sourceLang || 'de';
  var glossary = _buildTerminologyGlossary_(lang);
  var termListStr = glossary.length
    ? glossary.map(function (p) { return '- ' + p.wrong + ' ? ' + p.correct; }).join('\n')
    : '(no specific entries found for this language)';

  var allRules = apiGetRulesConfig();
  var activeRules = allRules.filter(function(r) { return r.IsEnabled; });
  
  var standardRulesStr = activeRules
    .filter(function(r) { return r.RuleKind !== 'PROMPT' && !r.CustomPrompt; })
    .map(function(r) { 
      var param = (r.IsConfigurable && r.Parameter !== "-1" && r.Parameter !== null) ? " (Value: " + r.Parameter + ")" : "";
      return "- [" + r.Type + "] " + r.Description + param; 
    }).join('\n');

  var customPromptsStr = activeRules
    .filter(function(r) { return r.RuleKind === 'PROMPT' || (r.CustomPrompt && r.CustomPrompt.trim().length > 0); })
    .map(function(r) { 
      return "- SPECIFIC CHECK [" + (r.Type || "Custom") + " -> " + r.Description + "]: " + r.CustomPrompt; 
    }).join('\n');

  var rulesStr = (standardRulesStr || '(No standard rules)') + 
    (customPromptsStr ? '\n\nADDITIONAL SPECIFIC PROMPTS/CHECKS:\n' + customPromptsStr : '');

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
  if (code !== 200) throw new Error('AI request failed (' + code + ').');

  var data = JSON.parse(res.getContentText());
  var respText;
  try { respText = data.candidates[0].content.parts[0].text; }
  catch (e) { throw new Error('Unexpected AI response structure.'); }

  var clean = String(respText).replace(/```json/gi, '').replace(/```/g, '').trim();
  var parsed;
  try { parsed = JSON.parse(clean); }
  catch (e) { throw new Error('AI response was not valid JSON.'); }

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
    var regex = new RegExp(_escapeRegexAC_(original), 'g');
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        var cell = String(values[r][c]);
        if (regex.test(cell)) {
          values[r][c] = cell.replace(regex, suggestion);
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

  if (count === 0) throw new Error('Text passage "' + original + '" was not found anymore.');
  logAuditEvent_(getUserEmail_(), 'AUTHOR_CHECK_FIX_APPLIED', original + ' ? ' + suggestion + ' (' + count + 'x)');
  return { success: true, count: count };
}

function _escapeRegexAC_(str) {
  return String(str)
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

// ??? INTERAKTION: ZUR TEXTSTELLE SPRINGEN ?????????????????????????????????
function apiJumpToIssue(searchText) {
  if (DocumentApp.getActiveDocument()) {
    var doc = DocumentApp.getActiveDocument();
    var found = doc.getBody().findText(_escapeRegexAC_(searchText));
    if (found) {
      var rangeBuilder = doc.newRange();
      rangeBuilder.addElement(found.getElement(), found.getStartOffset(), found.getEndOffsetInclusive());
      doc.setSelection(rangeBuilder.build());
      return true;
    }
  } else if (SpreadsheetApp.getActiveSpreadsheet()) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var found = sheet.createTextFinder(searchText).findNext();
    if (found) { found.activate(); return true; }
  } else if (SlidesApp.getActivePresentation()) {
    var slides = SlidesApp.getActivePresentation().getSlides();
    for (var i = 0; i < slides.length; i++) {
      var shapes = slides[i].getShapes();
      for (var j = 0; j < shapes.length; j++) {
        if (shapes[j].getShapeType() === SlidesApp.ShapeType.TEXT_BOX && shapes[j].getText().asString().indexOf(searchText) !== -1) {
          slides[i].selectAsCurrentPage();
          shapes[j].select();
          return true;
        }
      }
    }
  }
  return false;
}

// ??? INTERAKTION: NOTIZ / KOMMENTAR EXAKT AN TEXTSTELLE VERKN?PFEN ?????????
function apiCommentIssue(originalText, suggestion, explanation) {
  var commentText = "TermCheck Suggestion:\n" + suggestion + "\n\nExplanation: " + (explanation || "");
  var cleanOriginal = String(originalText).replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ');
  
  if (DocumentApp.getActiveDocument()) {
    var doc = DocumentApp.getActiveDocument();
    var found = doc.getBody().findText(_escapeRegexAC_(cleanOriginal));
    
    // Fallback falls die flexible Suche fehlschl?gt: Exakter Treffer
    if (!found) {
      try { found = doc.getBody().findText(_escapeRegexAC_(originalText)); } catch(e) {}
    }

    if (found) {
      var rangeBuilder = doc.newRange();
      rangeBuilder.addElement(found.getElement(), found.getStartOffset(), found.getEndOffsetInclusive());
      doc.setSelection(rangeBuilder.build());
      
      try {
        var docId = doc.getId();
        Drive.Comments.create({ 
          content: commentText, 
          context: { type: 'text/html', value: cleanOriginal } 
        }, docId, {fields: '*'});
        return true;
      } catch(e) { 
        return true; // Auswertung/Selektion hat geklappt, selbst wenn Drive Comments offline sind
      }
    }
  } else if (SpreadsheetApp.getActiveSpreadsheet()) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var found = sheet.createTextFinder(cleanOriginal).findNext();
    if (!found) found = sheet.createTextFinder(originalText).findNext();
    
    if (found) {
      found.activate();
      found.setNote(commentText);
      return true; 
    }
  } else if (SlidesApp.getActivePresentation()) {
    var slides = SlidesApp.getActivePresentation().getSlides();
    for (var i = 0; i < slides.length; i++) {
      var shapes = slides[i].getShapes();
      for (var j = 0; j < shapes.length; j++) {
        if (shapes[j].getShapeType() === SlidesApp.ShapeType.TEXT_BOX) {
          var txt = shapes[j].getText().asString();
          if (txt.indexOf(originalText) !== -1 || txt.indexOf(cleanOriginal) !== -1) {
            slides[i].selectAsCurrentPage();
            shapes[j].select();
            return true;
          }
        }
      }
    }
  }
  return false;
}

function apiBackToHomepage() {
  // L?dt die Homepage-Karte
  return onHomepage();
}

/**
 * Erstellt ein formatierest Google Sheet mit dem Audit Report der Korrekturen.
 */
function apiExportAuditReport(issues) {
  if (!issues || !issues.length) throw new Error("No issues available to export.");

  var title = "TermCheck_Audit_Report_" + new Date().toISOString().slice(0, 10);
  var ss = SpreadsheetApp.create(title);
  var sheet = ss.getActiveSheet();
  sheet.setName("Audit Report");

  // Tabellen-Header
  var headers = ["Type", "Original Passage", "Suggestion", "Explanation"];
  var rows = [headers];

  issues.forEach(function(issue) {
    rows.push([
      (issue.type || "style").toUpperCase(),
      issue.original || "",
      issue.suggestion || "",
      issue.explanation || ""
    ]);
  });

  var numRows = rows.length;
  var numCols = headers.length;
  var range = sheet.getRange(1, 1, numRows, numCols);
  range.setValues(rows);

  // Header-Styling
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight("bold")
    .setBackground("#FFED00")
    .setFontColor("#3A3A3A");
  
  sheet.setFrozenRows(1);
  range.setVerticalAlignment("top")
    .setBorder(true, true, true, true, true, true, "#DDDDDD", SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange(2, 4, numRows - 1, 1).setWrap(true);
  sheet.autoResizeColumns(1, numCols - 1);
  sheet.setColumnWidth(4, 350);

  return ss.getUrl();
}