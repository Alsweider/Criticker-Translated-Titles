// ==UserScript==
// @name         Criticker-Translated-Titles
// @namespace    https://criticker.com/
// @version      2026-05-11
// @description  Displays the translated film title on Criticker film pages in the preferred browser language.
// @author       Alsweider
// @match        https://www.criticker.com/film/*
// @match        https://www.criticker.com/tv/*
// @icon         https://www.criticker.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      query.wikidata.org
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/558838/Criticker-Translated-Titles.user.js
// @updateURL https://update.greasyfork.org/scripts/558838/Criticker-Translated-Titles.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
    const TIMEOUT_MS   = 180000;
    const ELEM_ID      = 'wikidata-local-title';

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

        fetchTitle(lang, function (title) {
            if (title) {
                GM_setValue(cacheKey, { title, ts: Date.now() });
                setState(placeholder, 'found', title);
            } else if (lang !== 'en') {
                fetchTitle('en', function (enTitle) {
                    if (enTitle) {
                        GM_setValue(cacheKey, { title: enTitle, ts: Date.now() });
                        setState(placeholder, 'found', enTitle);
                    } else {
                        setState(placeholder, 'notfound');
                    }
                });
            } else {
                setState(placeholder, 'notfound');
            }
        });
    }

    // --- Hilfsfunktionen ---

    function fetchTitle(language, callback) {
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
            timeout: TIMEOUT_MS,
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
                console.warn('[Wikidata-Titel] Timeout nach ' + TIMEOUT_MS + ' ms');
                callback(null);
            }
        });
    }

    function createSpan() {
        const existing = document.getElementById(ELEM_ID);
        if (existing) return existing;
        const span = document.createElement('span');
        span.id    = ELEM_ID;
        return span;
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

    /**
     * Setzt den visuellen Zustand des Platzhalters.
     *
     * 'loading'  → Ladehinweis, kein Button
     * 'found'    → lokalisierter Titel + Reload-Button
     * 'notfound' → Hinweis + Reload-Button, blendet sich nach 4 s aus
     */
    function setState(el, state, text) {
        el.innerHTML     = '';
        el.style.cssText = 'display:block; font-size:0.8em;';
        // Laufenden Fade-out-Timer zurücksetzen
        if (el._fadeTimeout) { clearTimeout(el._fadeTimeout); delete el._fadeTimeout; }
        el.style.opacity    = '1';
        el.style.transition = '';

        switch (state) {
            case 'loading': {
                el.style.color     = '#aaa';
                el.style.fontStyle = 'italic';
                el.textContent     = '↻ Searching for localised title …';
                // Kein Reload-Button während des Ladens
                break;
            }

            case 'found': {
                el.style.color     = '#555';
                el.style.fontStyle = 'normal';
                el.appendChild(document.createTextNode(text));
                el.appendChild(createReloadButton());
                break;
            }

            case 'notfound': {
                el.style.color     = '#bbb';
                el.style.fontStyle = 'italic';
                el.appendChild(document.createTextNode('(no localised title found)'));
                el.appendChild(createReloadButton());
                // Nach 4 s gemeinsam mit Button ausblenden und entfernen
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
