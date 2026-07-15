// ==UserScript==
// @name         Criticker-Translated-Titles
// @namespace    https://criticker.com/
// @version      2026-07-16
// @description  Displays the translated film title on Criticker film pages in the preferred browser language.
// @author       Alsweider
// @match        https://www.criticker.com/film/*
// @match        https://www.criticker.com/tv/*
// @icon         https://www.criticker.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @connect      query.wikidata.org
// @connect      www.wikidata.org
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/558838/Criticker-Translated-Titles.user.js
// @updateURL https://update.greasyfork.org/scripts/558838/Criticker-Translated-Titles.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30 Tage
    const TIMEOUT_FAST  = 8000;    // MediaWiki-API: kurz – bei Ausbleiben sofort Fallback
    const TIMEOUT_SLOW  = 60000;   // SPARQL: mehr Zeit, da letzte Stufe
    const ELEM_ID       = 'wikidata-local-title';

    // --- IMDb-ID ermitteln ---
    const imdbLink = document.querySelector('.tip_sidebar_action a[href*="imdb.com/title/"]');
    if (!imdbLink) return;

    const imdbID = imdbLink.href.match(/tt\d+/)?.[0];
    if (!imdbID) return;

    const lang     = (navigator.language || 'en').split('-')[0];
    const cacheKey = `wikidata_${imdbID}_${lang}`;

    // --- Platzhalter sofort einfügen ---
    const mainTitle = document.querySelector('.tip_title_maininfo h1');
    if (!mainTitle) return;

    const placeholder = createSpan();
    mainTitle.after(placeholder);

    // --- Starten (wird auch beim Reload-Klick erneut aufgerufen) ---
    run();

    function run() {
        setState(placeholder, 'loading');

        const cached = GM_getValue(cacheKey, null);
        if (cached && cached.title && (Date.now() - cached.ts) < CACHE_TTL_MS) {
            setState(placeholder, 'found', cached.title);
            return;
        }

        // Stufe 1: MediaWiki-API (schnell, kurzer Timeout)
        // Holt QID per IMDb-ID-Suche, dann Label in gewünschter Sprache + Englisch als Reserve.
        // Kein separater lang→en-Fallback nötig: beide Sprachen werden in einem Schritt abgefragt.
        fetchFast(function (title) {
            if (title) { save(title); return; }

            // Stufe 2: SPARQL (langsamer, bewährt, langer Timeout)
            fetchSparql(lang, function (title2) {
                if (title2) { save(title2); return; }
                if (lang !== 'en') {
                    fetchSparql('en', function (title3) {
                        title3 ? save(title3) : setState(placeholder, 'notfound');
                    });
                } else {
                    setState(placeholder, 'notfound');
                }
            });
        });
    }

    function save(title) {
        GM_setValue(cacheKey, { title, ts: Date.now() });
        setState(placeholder, 'found', title);
    }

    // --- Stufe 1: MediaWiki-API ---

    function fetchFast(callback) {
        // Schritt 1a: QID per Suche nach IMDb-ID-Property ermitteln
        const searchUrl =
            'https://www.wikidata.org/w/api.php?action=query&list=search' +
            '&srsearch=' + encodeURIComponent('haswbstatement:P345=' + imdbID) +
            '&srlimit=1&format=json&origin=*';

        GM_xmlhttpRequest({
            method:  'GET',
            url:     searchUrl,
            timeout: TIMEOUT_FAST,
            onload: function (r) {
                let qid;
                try {
                    const data = JSON.parse(r.responseText);
                    qid = data?.query?.search?.[0]?.title; // z.B. "Q12345"
                } catch { return callback(null); }
                if (!qid) return callback(null);

                // Schritt 1b: Label in gewünschter Sprache + Englisch als Fallback abrufen
                const langs = lang !== 'en' ? `${lang}|en` : 'en';
                const labelUrl =
                    'https://www.wikidata.org/w/api.php?action=wbgetentities' +
                    '&ids=' + encodeURIComponent(qid) +
                    '&props=labels&languages=' + encodeURIComponent(langs) +
                    '&format=json&origin=*';

                GM_xmlhttpRequest({
                    method:  'GET',
                    url:     labelUrl,
                    timeout: TIMEOUT_FAST,
                    onload: function (r2) {
                        try {
                            const d      = JSON.parse(r2.responseText);
                            const labels = d?.entities?.[qid]?.labels;
                            // Bevorzuge Browsersprache, Englisch als Reserve
                            const title  = labels?.[lang]?.value ?? labels?.['en']?.value ?? null;
                            callback(title);
                        } catch { callback(null); }
                    },
                    onerror:   () => callback(null),
                    ontimeout: () => {
                        console.warn('[Wikidata-Titel] MediaWiki-API Label-Abruf Timeout');
                        callback(null);
                    }
                });
            },
            onerror:   () => callback(null),
            ontimeout: () => {
                console.warn('[Wikidata-Titel] MediaWiki-API Suche Timeout – versuche SPARQL');
                callback(null);
            }
        });
    }

    // --- Stufe 2: SPARQL (Fallback) ---

    function fetchSparql(language, callback) {
        const sparql = `
            SELECT ?label WHERE {
              ?film wdt:P345 "${imdbID}" .
              ?film rdfs:label ?label .
              FILTER (lang(?label) = "${language}")
            }
            LIMIT 1
        `;
        const url = 'https://query.wikidata.org/sparql?format=json&query=' +
                    encodeURIComponent(sparql);

        GM_xmlhttpRequest({
            method:  'GET',
            url:     url,
            timeout: TIMEOUT_SLOW,
            headers: { 'Accept': 'application/sparql+json' },
            onload: function (response) {
                let data;
                try {
                    data = JSON.parse(response.responseText);
                } catch {
                    callback(null);
                    return;
                }
                const result = data?.results?.bindings?.[0];
                callback(result ? result.label.value : null);
            },
            onerror:   function () { callback(null); },
            ontimeout: function () {
                console.warn('[Wikidata-Titel] SPARQL Timeout nach ' + TIMEOUT_SLOW + ' ms');
                callback(null);
            }
        });
    }

    // --- Hilfsfunktionen ---

    // Removes a possibly appended year in parentheses, e.g. "The Godfather (1972)" -> "The Godfather"
    function stripYear(title) {
        return title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    }

    function createSpan() {
        const existing = document.getElementById(ELEM_ID);
        if (existing) return existing;
        const span = document.createElement('span');
        span.id    = ELEM_ID;
        return span;
    }

    function createCopyButton(getTitle) {
        const btn = document.createElement('button');
        btn.textContent    = '⎘';
        btn.title          = 'Copy title to clipboard';
        btn.style.cssText  =
            'display:inline; margin-left:6px; background:none; border:none; cursor:pointer;' +
            'color:#aaa; font-size:1em; padding:0; line-height:1;' +
            'vertical-align:middle;';
        btn.addEventListener('mouseenter', () => btn.style.color = '#555');
        btn.addEventListener('mouseleave', () => btn.style.color = '#aaa');
        btn.addEventListener('click', () => {
            GM_setClipboard(stripYear(getTitle()), 'text');
            const original = btn.textContent;
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = original; }, 1000);
        });
        return btn;
    }

    function createReloadButton() {
        const btn = document.createElement('button');
        btn.textContent    = '↺';
        btn.title          = 'Reload (clear cache)';
        btn.style.cssText  =
            'display:inline; margin-left:6px; background:none; border:none; cursor:pointer;' +
            'color:#aaa; font-size:1em; padding:0; line-height:1;' +
            'vertical-align:middle;';
        btn.addEventListener('mouseenter', () => btn.style.color = '#555');
        btn.addEventListener('mouseleave', () => btn.style.color = '#aaa');
        btn.addEventListener('click', () => {
            GM_deleteValue(cacheKey);
            run();
        });
        return btn;
    }

    function setState(el, state, text) {
        el.innerHTML     = '';
        el.style.cssText = 'display:block; font-size:0.8em;';
        if (el._fadeTimeout) { clearTimeout(el._fadeTimeout); delete el._fadeTimeout; }
        el.style.opacity    = '1';
        el.style.transition = '';

        switch (state) {
            case 'loading': {
                el.style.color     = '#aaa';
                el.style.fontStyle = 'italic';
                el.textContent     = '↻ Searching for localised title …';
                break;
            }
            case 'found': {
                el.style.color     = '#555';
                el.style.fontStyle = 'normal';
                el.appendChild(document.createTextNode(text));
                el.appendChild(createCopyButton(() => text));
                el.appendChild(createReloadButton());
                break;
            }
            case 'notfound': {
                el.style.color     = '#bbb';
                el.style.fontStyle = 'italic';
                el.appendChild(document.createTextNode('(no localised title found)'));
                el.appendChild(createReloadButton());
                el._fadeTimeout = setTimeout(() => {
                    el.style.transition = 'opacity 1s';
                    el.style.opacity    = '0';
                    setTimeout(() => el.remove(), 1000);
                }, 4000);
                break;
            }
        }
    }

})();
