const PHRASE_V1 = 'https://cloud.memsource.com/web/api2/v1';
const PHRASE_V1_TC = 'https://cloud.memsource.com/web/api2/v1';
const PHRASE_V2_TC = 'https://cloud.memsource.com/web/api2/v2';

const DEFAULT_AI_PROMPT = 'Du bist ein Terminologie-Assistent f?r K?rcher, Hersteller von Reinigungsger?ten (Hochdruckreiniger, Kehrmaschinen, Sauger, Zubeh?r).\n\nDer Nutzer beschreibt in eigenen Worten, wonach er sucht:\n"{freeText}"\n\nErkenne die Sprache AUSSCHLIESSLICH anhand dieses Textfelds (ISO-639-1-Code, z.B. "de", "en", "it", "fr", "es"). Ein eventuell zus?tzlich angeh?ngtes Bild hat KEINEN Einfluss auf die Sprachwahl, es dient nur der inhaltlichen Erkennung des Objekts. Nutze "de" als Standard NUR dann, wenn das Textfeld leer ist (reine Bildsuche ohne Text) oder wirklich zu kurz/mehrdeutig ist, um ?berhaupt eine Sprache zu erkennen. Ist echter, eindeutiger Text vorhanden (z.B. eine ganze Frage in einer bestimmten Sprache), MUSS diese Sprache verwendet werden, auch wenn zus?tzlich ein Bild angeh?ngt ist.\n\nNenne dann die 1 bis 3 wahrscheinlichsten Fachbegriffe, nach denen in einer Terminologie-Datenbank gesucht werden sollte (kurze, konkrete Substantive/Fachw?rter, keine ganzen S?tze). WICHTIG: Sowohl die Begriffe als auch deine Erkl?rung m?ssen zwingend in der erkannten Sprache formuliert sein, nicht auf Deutsch ?bersetzt, au?er die erkannte Sprache ist bereits Deutsch.\n\nAntworte AUSSCHLIESSLICH mit validem JSON in exakt dieser Struktur, ohne Markdown-Formatierung, ohne Codeblock:\n{"lang": "...", "terms": ["...", "..."], "explanation": "..."}';

// ============================================================================
// 1. WEB APP ENTRY & ROUTING
// ============================================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('TermSearch')
    .setTitle('K?rcher TermSearch')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function apiGetContext() {
  var caller = getUserEmail_();
  var props = PropertiesService.getScriptProperties();
  var userProps = PropertiesService.getUserProperties();
  var token  = (props.getProperty('PHRASE_API_TOKEN') || '').trim();
  var geminiKey = (props.getProperty('GEMINI_API_KEY') || '').trim();
  var role = getUserRole_(caller);
  var isRulesOnly = userProps.getProperty('AUTHORCHECK_IS_RULES_ONLY') === 'true';

  return {
    email:           caller,
    role:            role,
    isAdmin:         role === 'ADMIN',
    phraseConnected: token.length > 10,
    aiEnabled:       geminiKey.length > 10,
    isRulesOnly:     isRulesOnly,
    templates: {
      LLM: { uid: props.getProperty('TEMPLATE_LLM') || 'pNoERiZ1YTileyUe4Za1j6', name: '[AKW] Terminology check [MT+Review LLM]' },
      ALG: { uid: props.getProperty('TEMPLATE_ALG') || 'arpmvYCEAqGl0OmKV9f3s3', name: '[AKW] Terminology check [MT+Review ALG]' }
    }
  };
}

function apiGetSettings() {
  var caller = getUserEmail_();
  if (getUserRole_(caller) !== 'ADMIN') throw new Error("Unauthorized: Nur Admins k?nnen Einstellungen sehen.");
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('PHRASE_API_TOKEN') || '';
  var geminiKey = props.getProperty('GEMINI_API_KEY') || '';
  
  var rawUrl = props.getProperty('GEMINI_API_URL') || 'https://34-111-99-134.nip.io/gemini/v1beta/models/';
  var cleanUrl = rawUrl.split(']')[0].replace('[', '').trim();

  return {
    PHRASE_API_TOKEN: token ? '????????????????????????????' : '',
    ADMIN_EMAILS: props.getProperty('ADMIN_EMAILS') || '',
    TEMPLATE_LLM: props.getProperty('TEMPLATE_LLM') || 'pNoERiZ1YTileyUe4Za1j6',
    TEMPLATE_ALG: props.getProperty('TEMPLATE_ALG') || 'arpmvYCEAqGl0OmKV9f3s3',
    ALLOWED_TB_UIDS: props.getProperty('ALLOWED_TB_UIDS') || '',
    GEMINI_API_KEY: geminiKey ? '????????????????????????????' : '',
    GEMINI_API_URL: cleanUrl,
    AI_MODEL: props.getProperty('AI_MODEL') || 'gemini-3.6-flash',
    AI_TEMPERATURE: props.getProperty('AI_TEMPERATURE') || '0.2',
    AI_PROMPT: props.getProperty('AI_PROMPT') || DEFAULT_AI_PROMPT
  };
}

function apiSaveSettings(data) {
  var caller = getUserEmail_();
  if (getUserRole_(caller) !== 'ADMIN') throw new Error("Unauthorized: Nur Admins k?nnen Einstellungen speichern.");
  var props = PropertiesService.getScriptProperties();
  
  if (data.PHRASE_API_TOKEN && !data.PHRASE_API_TOKEN.includes('????')) {
    props.setProperty('PHRASE_API_TOKEN', data.PHRASE_API_TOKEN.trim());
  }
  if (data.GEMINI_API_KEY && !data.GEMINI_API_KEY.includes('????')) {
    props.setProperty('GEMINI_API_KEY', data.GEMINI_API_KEY.trim());
  }
  
  if (data.GEMINI_API_URL) {
    var cleanUrl = data.GEMINI_API_URL.split(']')[0].replace('[', '').trim();
    props.setProperty('GEMINI_API_URL', cleanUrl);
  }

  props.setProperty('ADMIN_EMAILS', (data.ADMIN_EMAILS || '').trim());
  props.setProperty('TEMPLATE_LLM', (data.TEMPLATE_LLM || '').trim());
  props.setProperty('TEMPLATE_ALG', (data.TEMPLATE_ALG || '').trim());
  props.setProperty('ALLOWED_TB_UIDS', (data.ALLOWED_TB_UIDS || '').trim());
  props.setProperty('AI_MODEL', (data.AI_MODEL || '').trim());
  props.setProperty('AI_TEMPERATURE', (data.AI_TEMPERATURE || '').trim());
  
  if (data.AI_PROMPT && data.AI_PROMPT.trim().length > 0) {
    props.setProperty('AI_PROMPT', data.AI_PROMPT.trim());
  } else {
    props.deleteProperty('AI_PROMPT'); // Fallback zu default
  }
  
  try { CacheService.getScriptCache().remove(TERMSEARCH_TB_CACHE_KEY); } catch(e) {}
  logAuditEvent_(caller, 'SETTINGS_UPDATED', 'System settings were modified via UI');
  return { success: true };
}

function apiGetTemplateLanguages(templateUid) {
  if (!templateUid) throw new Error('templateUid is required.');
  var url = 'https://cloud.memsource.com/web/api2/v1/projectTemplates/' + encodeURIComponent(templateUid);
  var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: _phraseAuth_() }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Failed to fetch template (' + code + '): ' + res.getContentText().slice(0, 200));
  var data = JSON.parse(res.getContentText());
  return { sourceLang: data.sourceLang || '', targetLangs: Array.isArray(data.targetLangs) ? data.targetLangs : [] };
}

function apiCheckAccess() {
  var token = (PropertiesService.getScriptProperties().getProperty('PHRASE_API_TOKEN') || '').trim();
  if (!token) return { allowed: false, reason: 'no_token' };
  return { allowed: true };
}

function getUserEmail_() {
  var email = '';
  try { 
    email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; 
  } catch(e) { 
    console.warn("Konnte User-Email nicht via Session abrufen: " + e.message);
  }
  
  if (email === '') {
    var props = PropertiesService.getScriptProperties();
    var fallback = props.getProperty('ADMIN_EMAILS');
    if (fallback) {
      email = fallback.split(',')[0].trim();
    }
  }
  return email;
}

function getUserRole_(email) {
  var props = PropertiesService.getScriptProperties();
  var admins = String(props.getProperty('ADMIN_EMAILS') || '').split(',').map(function(s){return s.trim().toLowerCase();}).filter(Boolean);
  var user = (email || '').toLowerCase();
  
  if (admins.length === 0 || admins.indexOf(user) > -1) {
    return 'ADMIN';
  }
  return 'GUEST';
}

function logAuditEvent_(user, action, details) {
  var msg = '[AUDIT] ' + new Date().toISOString() + ' | ' + user + ' | ' + action + ' | ' + details;
  console.log(msg);
}

function _phraseAuth_() {
  var raw = (PropertiesService.getScriptProperties().getProperty('PHRASE_API_TOKEN') || '').trim();
  if (!raw) throw new Error('PHRASE_API_TOKEN not set in Script Properties.');
  var clean = raw;
  if (clean.toLowerCase().startsWith('apitoken ')) clean = clean.substring(9).trim();
  else if (clean.toLowerCase().startsWith('bearer '))  clean = clean.substring(7).trim();
  if (!clean) throw new Error('PHRASE_API_TOKEN is empty after stripping prefix.');
  return 'Bearer ' + clean;
}

function apiHealthCheck() {
  var caller = getUserEmail_();
  if (getUserRole_(caller) !== 'ADMIN') return { authorized: false };
  var checks = [];
  var props = PropertiesService.getScriptProperties();
  var token = (props.getProperty('PHRASE_API_TOKEN') || '').trim();
  checks.push({ name: 'Phrase API Token', status: token.length > 10 ? 'ok' : 'error', message: token ? 'Set (' + token.length + ' chars)' : '? PHRASE_API_TOKEN not configured!' });
  try {
    var res  = UrlFetchApp.fetch('https://cloud.memsource.com/web/api2/v1/termBases?pageNumber=0&pageSize=1', { method: 'get', headers: { Authorization: _phraseAuth_() }, muteHttpExceptions: true });
    var code = res.getResponseCode();
    var cnt  = '?';
    try { cnt = JSON.parse(res.getContentText()).totalElements; } catch(e) {}
    checks.push({ name: 'Termbase Access', status: code === 200 ? 'ok' : 'error', message: code === 200 ? '? Connected ? ' + cnt + ' termbase(s)' : 'HTTP ' + code + ': ' + res.getContentText().slice(0,100) });
  } catch(e) { checks.push({ name: 'Termbase Access', status: 'error', message: e.message }); }
  
  var geminiKey = (props.getProperty('GEMINI_API_KEY') || '').trim();
  checks.push({ name: 'Gemini AI (Apigee)', status: geminiKey ? 'ok' : 'warning', message: geminiKey ? '? Configured' : '? Kein GEMINI_API_KEY ? KI-Suche ist deaktiviert' });
  return { authorized: true, checks: checks, timestamp: new Date().toISOString() };
}

function apiDebugConnection() {
  var result = { ok: false, httpStatus: null, totalItems: null, errorMsg: null, tokenPrefix: null };
  try {
    var auth = _phraseAuth_();
    result.tokenPrefix = auth.substring(0, 12) + '?';
    var res  = UrlFetchApp.fetch('https://cloud.memsource.com/web/api2/v1/termBases?pageNumber=0&pageSize=1', { method: 'get', headers: { Authorization: auth }, muteHttpExceptions: true });
    result.httpStatus = res.getResponseCode();
    if (result.httpStatus === 200) {
      var data = JSON.parse(res.getContentText());
      result.totalItems = data.totalElements || 0;
      result.ok = true;
    } else if (result.httpStatus === 401) { result.errorMsg = 'Unauthorized (401) ? token is invalid or expired.';
    } else if (result.httpStatus === 403) { result.errorMsg = 'Forbidden (403) ? token valid but no access to term bases.';
    } else { result.errorMsg = 'HTTP ' + result.httpStatus + ': ' + res.getContentText().slice(0, 200); }
  } catch(e) { result.errorMsg = e.message; }
  return result;
}

// ============================================================================
// 2. TERMINOLOGY API (Termbases, Terms, Browse)
// ============================================================================
function _phraseFetch_(url, options) {
  options = options || {};
  options.muteHttpExceptions = true;
  if (!options.headers) options.headers = {};
  options.headers['Authorization'] = _phraseAuth_();
  if (options.body) {
    options.payload = JSON.stringify(options.body);
    options.contentType = 'application/json';
    delete options.body;
  }
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code >= 400) {
    var msg = 'Phrase API error ' + code;
    try { msg += ': ' + (JSON.parse(res.getContentText()).errorDescription || res.getContentText().slice(0,200)); } catch(e) {}
    throw new Error(msg);
  }
  try { return JSON.parse(res.getContentText()); } catch(e) { return {}; }
}

function apiListTermbases() {
  var termbases = [];
  var pageNumber = 0;
  while (true) {
    var url = PHRASE_V1 + '/termBases?pageNumber=' + pageNumber + '&pageSize=50';
    var res = _phraseFetch_(url, { method: 'get' });
    var items = (res && res.content) ? res.content : [];
    if (!items.length) break;
    items.forEach(function(tb) { termbases.push(_mapTb_(tb)); });
    if (items.length < 50) break;
    pageNumber++;
  }
  termbases.sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'de'); });
  return termbases;
}

// ============================================================================
// MAIN SEARCH
// ============================================================================
function _termMatchesQuery_(text, rawQuery) {
  if (!rawQuery) return true;
  var q = String(rawQuery).trim();
  if (!q) return true;
  var leading  = q.charAt(0) === '*';
  var trailing = q.charAt(q.length - 1) === '*';
  var core = q.replace(/^\*+/, '').replace(/\*+$/, '').trim().toLowerCase();
  if (!core) return true;
  var t = String(text || '').toLowerCase();
  if (leading && trailing)  return t.indexOf(core) !== -1;
  if (trailing && !leading) return t.indexOf(core) === 0;
  if (leading && !trailing) return t.length >= core.length && t.slice(-core.length) === core;
  return t.indexOf(core) !== -1;
}
var TERMSEARCH_CATEGORY_PATTERNS = {
  HNG:     ['H&G TERMS ONLY', 'HNG'],
  PROF:    ['PROF TERMS ONLY'],
  GENERAL: ['[GENERAL]', 'GENERAL']
};
var TERMSEARCH_CATEGORY_LABELS = {
  HNG:     'Home and Garden',
  PROF:    'Professional',
  GENERAL: 'General'
};
var TERMSEARCH_TB_CACHE_KEY = 'TERMSEARCH_TARGET_TERMBASES_V2';
var TERMSEARCH_TB_CACHE_TTL = 21600;
var TERMSEARCH_ALL_LANGS = ['de','en','fr','es','it','pt','nl','pl','cs','ru','zh','ja','ko','tr','ar'];

function _classifyLangFormat_(langs) {
  if (!langs || !langs.length) return 'unknown';
  var iso = 0, alpha = 0;
  langs.forEach(function(l) { if (/[_-]/.test(String(l))) alpha++; else iso++; });
  if (iso > alpha) return 'iso';
  if (alpha > iso) return 'alpha';
  return 'unknown';
}

function _getTargetTermbases_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(TERMSEARCH_TB_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  var all = apiListTermbases();
  var filtered = all.filter(function(tb) {
    var n = String(tb.name || '').toUpperCase();
    return n.indexOf('DO NOT USE') === -1 && n.indexOf('SANDBOX') === -1 && n.indexOf('QC') === -1;
  });

  var result = [];
  Object.keys(TERMSEARCH_CATEGORY_PATTERNS).forEach(function(cat) {
    var patterns = TERMSEARCH_CATEGORY_PATTERNS[cat];
    var matches = filtered.filter(function(tb) {
      var n = String(tb.name || '').toUpperCase();
      return patterns.some(function(p) { return n.indexOf(p.toUpperCase()) !== -1; });
    });
    var isoMatches = matches.filter(function(tb) { return _classifyLangFormat_(tb.langs) === 'iso'; });
    var chosen = isoMatches.length ? isoMatches : matches;
    chosen.forEach(function(tb) {
      result.push({ uid: tb.uid, name: tb.name, category: cat, label: TERMSEARCH_CATEGORY_LABELS[cat] || cat, langs: tb.langs || [] });
    });
  });

  try { cache.put(TERMSEARCH_TB_CACHE_KEY, JSON.stringify(result), TERMSEARCH_TB_CACHE_TTL); } catch(e) {}
  return result;
}

function apiListBrowseTermbases() {
  return _getTargetTermbases_();
}

function apiBrowseTermbase(tbUid, pageNumber, lang, searchQuery, sortDir) {
  if (!tbUid) throw new Error('tbUid is required.');
  pageNumber = pageNumber || 0;
  var pageSize = 50; 
  var body = { pageNumber: pageNumber, pageSize: pageSize };
  if (lang) body.queryLang = lang;
  var rawQuery = searchQuery ? String(searchQuery).trim() : '';
  if (rawQuery) {
    var dbCore = rawQuery.replace(/\*/g, '').trim();
    body.query = dbCore ? ('*' + dbCore + '*') : rawQuery;
  }
  
  var res = UrlFetchApp.fetch(PHRASE_V1 + '/termBases/' + encodeURIComponent(tbUid) + '/browse', {
    method: 'post', contentType: 'application/json', headers: { Authorization: _phraseAuth_() },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Browse fehlgeschlagen (' + res.getResponseCode() + ').');
  var data = JSON.parse(res.getContentText());
  var concepts = data.searchResults || data.concepts || [];
  
  var allTermbases = _getTargetTermbases_();
  var matchedTb = allTermbases.find(function(t) { return t.uid === tbUid; });
  var catLabel = matchedTb ? matchedTb.label : '';
  
  var mapped = concepts.map(function(concept) {
    var cid = concept.conceptId || concept.id || '';
    var allTerms = [];
    (concept.terms || []).forEach(function(ti) { (Array.isArray(ti) ? ti : [ti]).forEach(function(t){ allTerms.push(t); }); });
    if (!allTerms.length) return null;
    
    // Gew?hlte Sprache respektieren, Fallback auf DE wenn keine Sprache gew?hlt ist
    var wantLang = (lang || '').toLowerCase();
    var sourceTermRaw = null;
    var translationsRaw = [];
    allTerms.forEach(function(t) {
       var tLang = (t.lang || t.language || '').toLowerCase();
       var isWanted = wantLang ? (tLang === wantLang) : (tLang === 'de');
       if (isWanted && !sourceTermRaw) {
           sourceTermRaw = t;
       } else {
           translationsRaw.push(t);
       }
    });
    
    // Fallback falls kein DE existiert
    if (!sourceTermRaw && allTerms.length > 0) {
        sourceTermRaw = allTerms[0];
        translationsRaw = allTerms.slice(1);
    }

    return {
      conceptId: cid,
      categoryLabel: catLabel,
      sourceTerm: _mapTerm_(sourceTermRaw, cid),
      translations: translationsRaw.map(function(t){ return _mapTerm_(t, cid); })
    };
  }).filter(Boolean);

  if (rawQuery) {
    mapped = mapped.filter(function(c) { return _termMatchesQuery_(c.sourceTerm.term, rawQuery); });
  }
  var dir = (sortDir === 'desc') ? -1 : 1;
  mapped.sort(function(a, b) { return dir * String(a.sourceTerm.term || '').localeCompare(String(b.sourceTerm.term || ''), 'de'); });

  return { concepts: mapped, hasMore: concepts.length >= pageSize, pageNumber: pageNumber };
}

function _searchCore_(query, sourceLang, searchLang) {
  if (!query || query.trim().length < 1) return [];
  var raw = query.trim();
  
  var targetTermbases = _getTargetTermbases_();
  if (!targetTermbases.length) return [];
    var displayLang = (sourceLang || 'de').toLowerCase(); // Standard: Deutsch als Referenzsprache oben, unabh?ngig von der Trefferspache
  var queryLangs = searchLang ? [String(searchLang).toLowerCase()] : TERMSEARCH_ALL_LANGS;
  var core = raw.replace(/\*/g, '').trim();
  var phraseQuery = core ? ('*' + core + '*') : raw; // Sterne f?r Phrase, sonst nur exakte Treffer
  var auth = _phraseAuth_();
  var BATCH = 10;
  var conceptMap = {};

  // Alle Termbase/Sprache-Kombinationen als flache Liste, damit wir sie
  // gemeinsam in Batches abfragen k?nnen (queryLang ist bei Phrase Pflicht).
  var jobs = [];
  targetTermbases.forEach(function(tb) {
    queryLangs.forEach(function(lang) { jobs.push({ tb: tb, lang: lang }); });
  });

  for (var i = 0; i < jobs.length; i += BATCH) {
    var chunk = jobs.slice(i, i + BATCH);
    var requests = chunk.map(function(job) {
      var body = { query: phraseQuery, pageNumber: 0, pageSize: 50, queryLang: job.lang };
      return {
        url: PHRASE_V1 + '/termBases/' + encodeURIComponent(job.tb.uid) + '/browse',
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(body), headers: { Authorization: auth }, muteHttpExceptions: true
      };
    });
    var responses;
    try { responses = UrlFetchApp.fetchAll(requests); } catch(e) { continue; }
    responses.forEach(function(res, idx) {
      if (res.getResponseCode() !== 200) return;
      var data;
      try { data = JSON.parse(res.getContentText()); } catch(e) { return; }
      var concepts = data.searchResults || data.concepts || [];
      var tbInfo = chunk[idx].tb;
      concepts.forEach(function(concept) {
        var cid = concept.conceptId || concept.id || '';
        var allTerms = [];
        (concept.terms || []).forEach(function(termItem) {
          var termArray = Array.isArray(termItem) ? termItem : [termItem];
          termArray.forEach(function(t) { allTerms.push(t); });
        });
        
        var matchedTerm = null;
        allTerms.forEach(function(t) {
          if (!matchedTerm && _termMatchesQuery_(t.text || t.term, raw)) matchedTerm = t;
        });
        if (!matchedTerm) return;

        var sourceTermRaw = null;
        var translationsRaw = [];
        allTerms.forEach(function(t) {
           var tLang = (t.lang || t.language || '').toLowerCase();
           if (displayLang && tLang === displayLang && !sourceTermRaw) {
               sourceTermRaw = t;
           } else {
               translationsRaw.push(t);
           }
        });
        if (!sourceTermRaw) {
            sourceTermRaw = matchedTerm;
            translationsRaw = allTerms.filter(function(t) { return t !== matchedTerm; });
        }
        var key = tbInfo.category + '_' + (cid || (sourceTermRaw.text + '_' + idx));
        if (!conceptMap[key]) {
          conceptMap[key] = {
            conceptId: cid,
            category: tbInfo.category,
            categoryLabel: tbInfo.label,
            sourceTerm: _mapTerm_(sourceTermRaw, cid),
            translations: []
          };
        }
        translationsRaw.forEach(function(t) {
          var mapped = _mapTerm_(t, cid);
          var langAlreadyIn = conceptMap[key].translations.some(function(existing) {
            return existing.lang === mapped.lang && existing.term === mapped.term;
          });
          if (!langAlreadyIn) conceptMap[key].translations.push(mapped);
        });
      });
    });
  }
  var grouped = Object.keys(conceptMap).map(function(key) {
    var c = conceptMap[key];
    c.translations.sort(function(a, b) { return a.lang.localeCompare(b.lang); });
    return c;
  });
  return grouped;
}

function apiSearchTerms(query) {
  var results = _searchCore_(query);
  return results;
}

function _buildGeminiRequest_(apiUrl, model, apiKey, requestBody) {
  var url = apiUrl + encodeURIComponent(model) + ':generateContent';
  var headers = { 'x-api-key': apiKey };
  return { url: url, headers: headers, body: requestBody };
}

function apiAiAssistedSearch(freeText, history, imageData) {
  freeText = String(freeText || '').trim();
  history = Array.isArray(history) ? history : [];
  var hasImage = !!(imageData && imageData.data && imageData.mimeType);
  if (!freeText && !hasImage) throw new Error('Bitte eine Beschreibung eingeben oder ein Bild hochladen.');
  var props = PropertiesService.getScriptProperties();
  var apiKey = (props.getProperty('GEMINI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('Die KI-Suche ist noch nicht konfiguriert (Gemini API Key fehlt). Bitte einen Admin kontaktieren.');
  var rawUrl = props.getProperty('GEMINI_API_URL') || 'https://34-111-99-134.nip.io/gemini/v1beta/models/';
  var apiUrl = rawUrl.split(']')[0].replace('[', '').trim();
  var model  = (props.getProperty('AI_MODEL') || 'gemini-3.6-flash').trim();
  var temperature = parseFloat(props.getProperty('AI_TEMPERATURE')) || 0.2;
  var promptTemplate = props.getProperty('AI_PROMPT') || DEFAULT_AI_PROMPT;
  // Absicherung: ein alter, gespeicherter Custom-Prompt ohne das "lang"-Feld
  // w?rde die Spracherkennung stillschweigend brechen (Fallback immer 'de').
  // In dem Fall lieber den aktuellen Default verwenden statt einen kaputten
  // Custom-Prompt weiterzuschleifen.
  if (promptTemplate.indexOf('"lang"') === -1) {
    console.warn('Gespeicherter AI_PROMPT enth?lt kein "lang"-Feld (veraltete Version) - verwende DEFAULT_AI_PROMPT stattdessen.');
    promptTemplate = DEFAULT_AI_PROMPT;
  }
  var freeTextForPrompt = freeText || '(siehe angeh?ngtes Bild)';
  var turnPrompt;
  if (!history.length) {
    turnPrompt = promptTemplate.replace(/\{freeText\}/g, freeTextForPrompt.replace(/"/g, "'"));
    if (hasImage) turnPrompt += '\n\nBer?cksichtige zus?tzlich das angeh?ngte Bild f?r die inhaltliche Erkennung des Objekts. Das Bild ?ndert NICHTS an der Sprachwahl, diese richtet sich ausschlie?lich nach dem Textfeld oben.';
  } else {
    turnPrompt = 'Verfeinerung der bisherigen Suche: "' + freeTextForPrompt.replace(/"/g, "'") + '"\n\n' +
      (hasImage ? 'Ber?cksichtige zus?tzlich das angeh?ngte Bild.\n\n' : '') +
      'Erkenne erneut die Sprache dieser Nachfrage und antworte in genau dieser Sprache (Begriffe UND Erkl?rung), auch wenn sie von der vorherigen Sprache abweicht. ' +
      'Ber?cksichtige den bisherigen Gespr?chsverlauf. Antworte weiterhin AUSSCHLIESSLICH mit validem JSON in exakt derselben Struktur wie zuvor, ohne Markdown-Formatierung, ohne Codeblock:\n' +
      '{"lang": "...", "terms": ["...", "..."], "explanation": "..."}';
  }
  var contents = history.map(function(h) {
    return { role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text || '') }] };
  });
  var userParts = [{ text: turnPrompt }];
  if (hasImage) userParts.push({ inlineData: { mimeType: imageData.mimeType, data: imageData.data } });
  contents.push({ role: 'user', parts: userParts });
  var call = _buildGeminiRequest_(apiUrl, model, apiKey, {
    contents: contents,
    generationConfig: { temperature: temperature }
  });
  var res = UrlFetchApp.fetch(call.url, {
    method: 'post', contentType: 'application/json',
    headers: call.headers,
    payload: JSON.stringify(call.body), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('KI-Anfrage fehlgeschlagen (' + code + '): ' + res.getContentText().slice(0, 300));
  }
  var data = JSON.parse(res.getContentText());
  var text;
  try { text = data.candidates[0].content.parts[0].text; }
  catch(e) { throw new Error('Unerwartete KI-Antwortstruktur.'); }
  var clean = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  var parsed;
  try { parsed = JSON.parse(clean); }
  catch(e) { throw new Error('KI-Antwort war kein g?ltiges JSON: ' + clean.slice(0, 200)); }
  var terms = Array.isArray(parsed.terms) ? parsed.terms.slice(0, 3).filter(Boolean) : [];
  var detectedLang = String(parsed.lang || 'de').toLowerCase().slice(0, 2);
  var merged = {};
  terms.forEach(function(t) {
    var r = _searchCore_(t, detectedLang, detectedLang);
    r.forEach(function(c) {
      var key = c.category + '_' + (c.conceptId || c.sourceTerm.term);
      merged[key] = c;
    });
  });
  var results = Object.keys(merged).map(function(k) { return merged[k]; });
  var updatedHistory = history.concat([
    { role: 'user', text: turnPrompt },
    { role: 'model', text: text }
  ]);
  return {
    explanation: String(parsed.explanation || '').trim(),
    suggestedTerms: terms,
    results: results,
    detectedLang: detectedLang,
    history: updatedHistory
  };
}

function apiAddTerm(payload) {
  var uid  = String(payload.termibaseUid || '').trim();
  var text = String(payload.term || '').trim();
  var lang = String(payload.lang || '').trim();
  if (!uid || !text || !lang) throw new Error('termibaseUid, term, and lang are required.');
  var norm = _normStatus_(payload.status);
  var body = { text: text, lang: lang, status: norm.phraseStatus, forbidden: norm.forbidden };
  if (payload.note)       body.note  = String(payload.note).trim();
  if (payload.definition) body.usage = String(payload.definition).trim();
  if (payload.conceptId)  body.conceptId = payload.conceptId;
  var res = _phraseFetch_(PHRASE_V1 + '/termBases/' + encodeURIComponent(uid) + '/terms', { method: 'post', body: body });
  return _mapTerm_(res, payload.conceptId || '');
}

function apiUpdateTerm(payload) {
  var uid    = String(payload.termibaseUid || '').trim();
  var termId = String(payload.id || '').trim();
  var text   = String(payload.term || '').trim();
  if (!uid || !termId || !text) throw new Error('termibaseUid, id, and term are required.');
  var norm = _normStatus_(payload.status);
  var body = { text: text, status: norm.phraseStatus, forbidden: norm.forbidden };
  if (payload.note)       body.note  = String(payload.note).trim();
  if (payload.definition) body.usage = String(payload.definition).trim();
  var url = PHRASE_V1 + '/termBases/' + encodeURIComponent(uid) + '/terms/' + encodeURIComponent(termId);
  var res = _phraseFetch_(url, { method: 'put', body: body });
  return _mapTerm_(res, payload.conceptId || '');
}

function apiDeleteTerm(termId, termBaseUid) {
  var tid = String(termId || '').trim();
  var uid = String(termBaseUid || '').trim();
  if (!tid || !uid) throw new Error('termId and termBaseUid are required.');
  var url = PHRASE_V1 + '/termBases/' + encodeURIComponent(uid) + '/terms/' + encodeURIComponent(tid);
  var res = UrlFetchApp.fetch(url, { method: 'delete', headers: { Authorization: _phraseAuth_() }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 204 && code !== 200) throw new Error('Delete term failed (' + code + '): ' + res.getContentText().slice(0, 200));
  return { success: true };
}

function apiBatchImportTerms(termBaseUid, rows) {
  var uid = String(termBaseUid || '').trim();
  if (!uid) throw new Error('termBaseUid is required.');
  if (!Array.isArray(rows) || !rows.length) throw new Error('No rows to import.');
  var url  = PHRASE_V1 + '/termBases/' + encodeURIComponent(uid) + '/terms';
  var auth = _phraseAuth_();
  var BATCH = 20;
  var created = 0, failed = 0, errors = [];
  for (var i = 0; i < rows.length; i += BATCH) {
    var chunk = rows.slice(i, i + BATCH);
    var requests = chunk.map(function(row) {
      var norm = _normStatus_(row.status);
      var body = { text: String(row.term||'').trim(), lang: String(row.lang||'').trim(), status: norm.phraseStatus, forbidden: norm.forbidden };
      if (row.note)       body.note  = String(row.note).trim();
      if (row.definition) body.usage = String(row.definition).trim();
      return { url: url, method: 'post', contentType: 'application/json', headers: { Authorization: auth }, payload: JSON.stringify(body), muteHttpExceptions: true };
    });
    var responses;
    try { responses = UrlFetchApp.fetchAll(requests); } catch(e) { chunk.forEach(function(r){failed++;errors.push(r.term+': '+e.message);}); continue; }
    responses.forEach(function(res, idx) {
      var code = res.getResponseCode();
      if (code === 201 || code === 200) { created++; } else {
        failed++;
        var em = '';
        try { em = JSON.parse(res.getContentText()).errorDescription || res.getContentText(); } catch(e) { em = res.getContentText(); }
        errors.push(String(chunk[idx].term) + ': ' + em);
      }
    });
    if (i + BATCH < rows.length) Utilities.sleep(300);
  }
  logAuditEvent_(getUserEmail_(), 'TERMBASE_IMPORT', 'Imported ' + created + ' terms into ' + uid + (failed ? ' (' + failed + ' failed)' : ''));
  return { success: failed === 0, created: created, failed: failed, errors: errors };
}

// ============================================================================
// EXPORT TO GOOGLE SHEETS
// ============================================================================
function _getOrCreateExportFolder_() {
  var root = DriveApp.getRootFolder();
  var existing = root.getFoldersByName('Terminology');
  if (existing.hasNext()) return existing.next();
  return root.createFolder('Terminology');
}
function apiExportToSheet(rows) {
  try {
    var ss = SpreadsheetApp.create('Karcher_TermSearch_Export_' + new Date().toISOString().slice(0,10));
    var file = DriveApp.getFileById(ss.getId());
    var folder = _getOrCreateExportFolder_();
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);

    var sheet = ss.getActiveSheet();
    sheet.setName('TermSearch Export');
    if (rows && rows.length > 0) {
      var numCols = rows[0].length;
      var range = sheet.getRange(1, 1, rows.length, numCols);
      range.setValues(rows);
      sheet.getRange(1, 1, 1, numCols)
        .setFontWeight('bold')
        .setBackground('#FFED00')
        .setFontColor('#3A3A3A');
      sheet.setFrozenRows(1);
      range.setVerticalAlignment('top')
        .setBorder(true, true, true, true, true, true, '#DDDDDD', SpreadsheetApp.BorderStyle.SOLID);
      sheet.getRange(1, numCols, rows.length, 1).setWrap(true);
      sheet.autoResizeColumns(1, numCols - 1);
      sheet.setColumnWidth(numCols, 300);
    }
    return ss.getUrl();
  } catch(e) {
    throw new Error("Export fehlgeschlagen: " + e.message);
  }
}

function _mapTb_(raw) {
  if (!raw) return {};
  return {
    uid: String(raw.uid || raw.id || ''), name: String(raw.name || ''), langs: Array.isArray(raw.langs) ? raw.langs : [],
    termCount: '?', termsByLang: {}, active: raw.canShow !== false, updatedAt: raw.dateCreated || '',
    note: raw.note || '', client: (raw.client && raw.client.name) ? raw.client.name : '',
    domain: (raw.domain && raw.domain.name) ? raw.domain.name : '', subDomain: (raw.subDomain && raw.subDomain.name) ? raw.subDomain.name : ''
  };
}

function _mapTerm_(raw, conceptId) {
  if (!raw) return {};
  if (typeof raw === 'string') return { term: raw, lang: '', status: 'NEW' };
  var status = 'NEW';
  if (raw.forbidden === true)                                        status = 'FORBIDDEN';
  else if (raw.status === 'Approved' || raw.status === 'APPROVED') status = 'APPROVED';

  var textVal = raw.text || raw.term || raw.value || raw.content || raw.name || raw.source || '';
  var langVal = raw.lang || raw.language || raw.locale || '';
  var defVal  = raw.usage || raw.definition || raw.description || '';

  return {
    id:         String(raw.id || ''),
    term:       String(textVal).trim(),
    lang:       String(langVal).trim(),
    status:     status,
    forbidden:  !!raw.forbidden,
    preferred:  !!raw.preferred,
    caseSensitive: !!raw.caseSensitive,
    exactMatch: !!raw.exactMatch,
    definition: String(defVal).trim(),
    note:       String(raw.note || '').trim(),
    conceptNote: String(raw.conceptNote || '').trim(),
    termType:   String(raw.termType || '').trim(),
    partOfSpeech: String(raw.partOfSpeech || '').trim(),
    gender:     String(raw.gender || '').trim(),
    conceptId:  String(conceptId || raw.conceptId || ''),
    createdAt:  raw.createdAt  || '',
    modifiedAt: raw.modifiedAt || '',
    createdBy:  (raw.createdBy  && raw.createdBy.userName)  ? raw.createdBy.userName  : '',
    modifiedBy: (raw.modifiedBy && raw.modifiedBy.userName) ? raw.modifiedBy.userName : ''
  };
}

function _normStatus_(uiStatus) {
  var s = String(uiStatus || '').toUpperCase();
  if (s === 'FORBIDDEN') return { phraseStatus: 'Approved', forbidden: true  };
  if (s === 'APPROVED')  return { phraseStatus: 'Approved', forbidden: false };
  return { phraseStatus: 'New', forbidden: false };
}

function printAllTermbaseUIDs() {
  var termbases = apiListTermbases();
  Logger.log("=== VERF?GBARE TERMBASES ===");
  termbases.forEach(function(tb){ Logger.log("Name: " + tb.name + " | UID: " + tb.uid); });
  Logger.log("============================");
}
// ============================================================================
// 3. EDITOR ADD-ON (DOCS, SHEETS, SLIDES) - TERM CHECK
// ============================================================================

function onOpen(e) {
  var menu = null;
  try {
    if (DocumentApp.getActiveDocument()) {
      menu = DocumentApp.getUi().createMenu('K?rcher TermCheck');
    } else if (SpreadsheetApp.getActiveSpreadsheet()) {
      menu = SpreadsheetApp.getUi().createMenu('K?rcher TermCheck');
    } else if (SlidesApp.getActivePresentation()) {
      menu = SlidesApp.getUi().createMenu('K?rcher TermCheck');
    }
    if (menu) {
      menu.addItem('Open Terminology Search', 'showSidebar')
          .addItem('Open Author Check', 'showAuthorCheckSidebar')
          .addToUi();
    }
  } catch(err) {
    // Fail silently if not running inside an editor
  }
}

function showSidebar() {
  var ui = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('K?rcher TermCheck')
    .setWidth(300);
    
  if (DocumentApp.getActiveDocument()) DocumentApp.getUi().showSidebar(ui);
  else if (SpreadsheetApp.getActiveSpreadsheet()) SpreadsheetApp.getUi().showSidebar(ui);
  else if (SlidesApp.getActivePresentation()) SlidesApp.getUi().showSidebar(ui);
}

function apiExtractTextFromCurrentApp(scope) {
  var text = "";
  var isSelection = (scope === 'selection');

  if (DocumentApp.getActiveDocument()) {
    var doc = DocumentApp.getActiveDocument();
    if (isSelection) {
      var selection = doc.getSelection();
      if (selection) {
        var elements = selection.getRangeElements();
        elements.forEach(function(el) {
          if (el.getElement().asText) {
            var txt = el.getElement().asText().getText();
            if (el.isPartial()) {
              text += txt.substring(el.getStartOffset(), el.getEndOffsetInclusive() + 1) + " ";
            } else {
              text += txt + " ";
            }
          }
        });
      }
    } else {
      text = doc.getBody().getText();
    }
  } 
  else if (SpreadsheetApp.getActiveSpreadsheet()) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (isSelection) {
      var range = sheet.getActiveRange();
      if (range) {
        var values = range.getValues();
        text = values.map(function(row) { return row.join(" "); }).join("\n");
      }
    } else {
      var data = sheet.getDataRange().getValues();
      text = data.map(function(row) { return row.join(" "); }).join("\n");
    }
  } 
  else if (SlidesApp.getActivePresentation()) {
    var pres = SlidesApp.getActivePresentation();
    if (isSelection) {
      var selection = pres.getSelection();
      var pageRange = selection.getPageRange();
      if (pageRange) {
        var pages = pageRange.getPages();
        pages.forEach(function(page) {
          page.getShapes().forEach(function(shape) {
            if (shape.getShapeType() === SlidesApp.ShapeType.TEXT_BOX) {
              text += shape.getText().asString() + "\n";
            }
          });
        });
      }
    } else {
      var slides = pres.getSlides();
      slides.forEach(function(slide) {
        slide.getShapes().forEach(function(shape) {
          if (shape.getShapeType() === SlidesApp.ShapeType.TEXT_BOX) {
            text += shape.getText().asString() + "\n";
          }
        });
      });
    }
  }
  
  if (text) {
    text = text.replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ');
  }
  return text.substring(0, 15000); 
}
