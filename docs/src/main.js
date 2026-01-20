/**
 * LEITNER SYSTEM - MAIN LOGIC
 * Version: 4.1 (Cycle Infini 5->1 & Cache Buster)
 */

// --- CONSTANTES ---
const STORAGE_KEYS = {
    ALL_SESSIONS: 'leitner_sessions_list', 
    CONFIG: 'leitner_config',
    CARD_STATE: 'leitner_card_state',
    DECK_STATS: 'leitner_deck_stats' // Nouveau : Compteurs de cycles réussis par fichier
};

const BOX_INTERVALS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

const APP_STATE = {
    currentDeck: [],
    session: null,
    isResuming: false,
    config: { owner: 'leitexper1', repo: 'testleitnercodex', branch: 'main', path: 'docs/' }
};

// --- 1. PERSISTANCE & STATS GLOBALES ---

const CardPersistence = {
    getStoredState: (filename) => {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.CARD_STATE) || '{}')[filename] || {};
        } catch (e) { return {}; }
    },

    updateCard: (filename, cardId, box, lastReview, difficulty) => {
        const allStates = JSON.parse(localStorage.getItem(STORAGE_KEYS.CARD_STATE) || '{}');
        if (!allStates[filename]) allStates[filename] = {};
        allStates[filename][cardId] = { box, lastReview, difficulty };
        localStorage.setItem(STORAGE_KEYS.CARD_STATE, JSON.stringify(allStates));
    },

    applyState: (filename, csvData) => {
        const stored = CardPersistence.getStoredState(filename);
        csvData.forEach(card => {
            const state = stored[card.id];
            if (state) {
                if (typeof state === 'number') card.box = state;
                else {
                    if (state.box) card.box = state.box;
                    if (state.lastReview !== undefined) card.lastReview = state.lastReview;
                    if (state.difficulty !== undefined) card.difficulty = state.difficulty;
                }
            }
        });
        return csvData;
    },

    resetDeckState: (filename, cards) => {
        const allStates = JSON.parse(localStorage.getItem(STORAGE_KEYS.CARD_STATE) || '{}');
        if (!allStates[filename]) allStates[filename] = {};
        
        cards.forEach(card => {
            card.box = 1;
            card.lastReview = '';
            card.difficulty = '';
            
            allStates[filename][card.id] = { box: 1, lastReview: '', difficulty: '' };
        });
        localStorage.setItem(STORAGE_KEYS.CARD_STATE, JSON.stringify(allStates));
    }
};

// NOUVEAU : Gestion des compteurs de réussite par paquet
const DeckStats = {
    getAll: () => {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.DECK_STATS) || '{}');
    },
    
    get: (filename) => {
        const stats = DeckStats.getAll();
        return stats[filename] || { cycles: 0 };
    },

    incrementCycle: (filename) => {
        const stats = DeckStats.getAll();
        if (!stats[filename]) stats[filename] = { cycles: 0 };
        stats[filename].cycles++;
        localStorage.setItem(STORAGE_KEYS.DECK_STATS, JSON.stringify(stats));
        return stats[filename].cycles;
    }
};

// --- 2. UI & ADMIN ---

const UI = {
    init: () => {
        UI.loadConfig();
        UI.setupAdminListeners();
        UI.setupTabListeners();
    },

    loadConfig: () => {
        const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
        if (saved) APP_STATE.config = { ...APP_STATE.config, ...JSON.parse(saved) };
        const safeVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
        safeVal('repo-owner', APP_STATE.config.owner);
        safeVal('repo-name', APP_STATE.config.repo);
        safeVal('repo-branch', APP_STATE.config.branch);
        safeVal('repo-path', APP_STATE.config.path);
    },

    saveConfig: () => {
        const val = (id) => document.getElementById(id).value.trim();
        const newConfig = {
            owner: val('repo-owner'),
            repo: val('repo-name'),
            branch: val('repo-branch') || 'main',
            path: val('repo-path') || ''
        };
        APP_STATE.config = newConfig;
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
        alert('Configuration sauvegardée !');
        document.getElementById('admin-panel').classList.add('hidden');
        document.getElementById('admin-panel').setAttribute('aria-hidden', 'true');
    },

    setupAdminListeners: () => {
        const toggleModal = (id, show) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (show) {
                el.classList.remove('hidden');
                el.setAttribute('aria-hidden', 'false');
            } else {
                el.classList.add('hidden');
                el.setAttribute('aria-hidden', 'true');
            }
        };

        document.getElementById('admin-button').addEventListener('click', () => toggleModal('admin-panel', true));
        document.getElementById('close-admin').addEventListener('click', () => toggleModal('admin-panel', false));
        document.getElementById('load-github-csv').addEventListener('click', () => { UI.saveConfig(); location.reload(); });

        const openGuide = () => toggleModal('github-guide-modal', true);
        const closeGuide = () => toggleModal('github-guide-modal', false);
        document.getElementById('beginner-guide-btn')?.addEventListener('click', openGuide);
        document.getElementById('open-github-guide')?.addEventListener('click', openGuide);
        document.getElementById('close-github-guide')?.addEventListener('click', closeGuide);
        
        document.getElementById('open-import-export')?.addEventListener('click', () => {
            if (window.openImportExport) window.openImportExport();
        });
    },

    setupTabListeners: () => {
        document.querySelectorAll('.tab-button').forEach(btn => {
            if(btn.dataset.action === 'open-import-export') return;
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
                document.querySelectorAll('.tab-button').forEach(b => {
                    b.classList.remove('tab-button-active', 'bg-blue-600', 'text-white');
                    b.classList.add('bg-gray-200', 'text-gray-700');
                });
                const targetId = btn.dataset.tabTarget;
                const panel = document.querySelector(`[data-tab-panel="${targetId}"]`);
                if(panel) panel.classList.remove('hidden');
                btn.classList.add('tab-button-active', 'bg-blue-600', 'text-white');
                btn.classList.remove('bg-gray-200', 'text-gray-700');
                if (targetId === 'stats') StatsUI.init();
            });
        });
        const defaultTab = document.getElementById('tab-review-trigger');
        if(defaultTab) defaultTab.click();
    },

    populateCSVSelector: function(files, options = {}) {
        const select = document.getElementById('csv-selector');
        if (!select) return;
        select.innerHTML = '<option value="">-- Choisir un paquet --</option>';
        files.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

        const groups = {};
        const orphans = [];

        files.forEach(file => {
            const cleanName = file.name.replace('.csv', '');
            if (cleanName.includes('_')) {
                const parts = cleanName.split('_');
                const category = parts[0];
                const label = cleanName;
                if (!groups[category]) groups[category] = [];
                groups[category].push({ file, label });
            } else {
                orphans.push({ file, label: cleanName });
            }
        });

        const addOption = (parent, item) => {
            const option = document.createElement('option');
            option.value = item.file.download_url || item.file.publicPath;
            option.textContent = item.label;
            option.dataset.name = item.file.name;
            if(options.selectedName === item.file.name) option.selected = true;
            parent.appendChild(option);
        };

        for (const [category, items] of Object.entries(groups)) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = category.charAt(0).toUpperCase() + category.slice(1);
            items.forEach(item => addOption(optgroup, item));
            select.appendChild(optgroup);
        }
        if (orphans.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = "Autres";
            orphans.forEach(item => addOption(optgroup, item));
            select.appendChild(optgroup);
        }
    }
};

window.leitnerApp = window.leitnerApp || {};
window.leitnerApp.ui = window.leitnerApp.ui || {};
window.leitnerApp.ui.populateCSVSelector = UI.populateCSVSelector;

// --- 3. GESTION DE SESSIONS ---

const SessionManager = {
    getAll: () => {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.ALL_SESSIONS) || '[]');
    },

    start: (deckName, cards) => {
        const newSession = {
            id: Date.now(),
            deckName: deckName,
            originalDeckIds: cards.map(c => c.id), 
            cardsQueue: cards.map((c) => c.id),
            totalCards: cards.length,
            currentIndex: 0,
            stats: { correct: 0, wrong: 0 },
            startTime: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            status: 'active'
        };

        const sessions = SessionManager.getAll();
        sessions.unshift(newSession);
        localStorage.setItem(STORAGE_KEYS.ALL_SESSIONS, JSON.stringify(sessions));
        
        APP_STATE.session = newSession;
        APP_STATE.isResuming = false;
        return newSession;
    },

    updateCurrent: () => {
        if (!APP_STATE.session) return;
        
        const s = APP_STATE.session;
        s.lastUpdate = new Date().toISOString();
        
        // --- LOGIQUE CYCLE CONTINU ---
        // Une session est "Terminée" pour l'historique quand la file d'attente est vide
        // Mais le but est l'apprentissage continu.
        
        if (APP_STATE.session.currentIndex >= APP_STATE.session.totalCards) {
            APP_STATE.session.status = 'completed';
        } else {
            APP_STATE.session.status = 'active'; 
        }

        const sessions = SessionManager.getAll();
        const index = sessions.findIndex(item => item.id === s.id);
        
        if (index !== -1) {
            sessions[index] = s;
            localStorage.setItem(STORAGE_KEYS.ALL_SESSIONS, JSON.stringify(sessions));
        }
        
        StatsUI.renderHistory();
    },

    recordResult: (isCorrect) => {
        if (!APP_STATE.session) return;
        if (isCorrect) APP_STATE.session.stats.correct++;
        else APP_STATE.session.stats.wrong++;
        APP_STATE.session.currentIndex++;
        
        SessionManager.updateCurrent();
    },

    resumeById: (sessionId) => {
        const sessions = SessionManager.getAll();
        const sessionToResume = sessions.find(s => s.id === parseInt(sessionId));
        
        if (sessionToResume) {
            APP_STATE.session = sessionToResume;
            APP_STATE.isResuming = true;

            if (CoreApp.csvData.length > 0 && CoreApp.csvData.filename === sessionToResume.deckName) {
                // Si la session était finie, on propose de relancer les cartes "non maîtrisées" ou tout le paquet
                if (sessionToResume.currentIndex >= sessionToResume.totalCards) {
                    alert("Relance de la session pour un nouveau tour !");
                    // On remet tout à zéro pour un nouveau tour sur ce paquet
                    // Note: Pour un vrai Leitner continu, on devrait prendre les cartes < Box 5.
                    // Ici on recharge simplement la session avec les cartes actuelles du paquet
                    const currentCards = CoreApp.csvData.map(c => c.id);
                    sessionToResume.cardsQueue = currentCards;
                    sessionToResume.totalCards = currentCards.length;
                    sessionToResume.currentIndex = 0;
                    sessionToResume.status = 'active';
                    SessionManager.updateCurrent();
                }

                document.getElementById('tab-review-trigger').click();
                CoreApp.startReview();
            } else {
                if(confirm(`Fichier "${sessionToResume.deckName}" requis. Aller à l'onglet Révision ?`)) {
                    document.getElementById('tab-review-trigger').click();
                    const selector = document.getElementById('csv-selector');
                    if(selector) selector.focus();
                }
            }
        } else {
            alert("Session introuvable.");
        }
    },

    deleteSession: (sessionId) => {
        let sessions = SessionManager.getAll();
        sessions = sessions.filter(s => s.id !== parseInt(sessionId));
        localStorage.setItem(STORAGE_KEYS.ALL_SESSIONS, JSON.stringify(sessions));
        StatsUI.renderHistory();
    },
    
    deleteAll: () => {
        localStorage.removeItem(STORAGE_KEYS.ALL_SESSIONS);
        localStorage.removeItem(STORAGE_KEYS.CARD_STATE);
        localStorage.removeItem(STORAGE_KEYS.DECK_STATS);
        alert("Tout effacé. Redémarrage...");
        location.reload();
    }
};

// --- 4. STATISTIQUES ---

const StatsUI = {
    init: () => {
        StatsUI.renderHistory();
        StatsUI.renderDifficultyStats();
        
        document.getElementById('btn-clear-history')?.addEventListener('click', () => {
            if(confirm('Tout effacer (Historique + État des boîtes) ?')) SessionManager.deleteAll();
        });
        
        const historyList = document.getElementById('stats-history-list');
        if (historyList) {
            historyList.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-session-btn')) {
                    e.stopPropagation();
                    const id = e.target.dataset.id;
                    if(confirm("Supprimer cette session ?")) SessionManager.deleteSession(id);
                    return;
                }

                const li = e.target.closest('li');
                if (!li) return;

                const id = li.dataset.id;
                SessionManager.resumeById(id);
            });
        }
        
        const oldResume = document.getElementById('resume-area');
        if(oldResume) oldResume.classList.add('hidden');
    },

    renderDifficultyStats: () => {
        if (!CoreApp.csvData || CoreApp.csvData.length === 0) {
            ['easy', 'normal', 'hard'].forEach(diff => document.getElementById(`stat-count-${diff}`).textContent = '0');
            return;
        }
        let counts = { easy: 0, normal: 0, hard: 0 };
        CoreApp.csvData.forEach(card => {
            const diff = card.difficulty || 'normal';
            if (counts[diff] !== undefined) counts[diff]++; else counts['normal']++;
        });
        document.getElementById('stat-count-easy').textContent = counts.easy;
        document.getElementById('stat-count-normal').textContent = counts.normal;
        document.getElementById('stat-count-hard').textContent = counts.hard;
    },

    renderHistory: () => {
        const list = document.getElementById('stats-history-list');
        if(!list) return;

        const sessions = SessionManager.getAll();
        
        if (sessions.length === 0) {
            list.innerHTML = '<li class="p-4 text-center text-gray-500 italic">Historique vide.</li>';
            document.getElementById('stat-total-reviewed').textContent = '0';
            document.getElementById('stat-success-rate').textContent = '0%';
            document.getElementById('stat-streak').textContent = '0';
            return;
        }

        let html = '';
        let totalCards = 0;
        let totalCorrect = 0;
        let finishedCount = 0;

        sessions.forEach((s) => {
            const dateObj = new Date(s.lastUpdate);
            const dateStr = dateObj.toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit'});
            
            // Récupération des stats de cycles réussis pour ce fichier
            const deckStats = DeckStats.get(s.deckName);
            const cyclesCount = deckStats.cycles || 0;

            if (s.status === 'completed') {
                totalCards += s.totalCards;
                totalCorrect += s.stats.correct;
                finishedCount++;
            }

            let statusBadge = '';
            let borderColor = 'border-blue-500';
            let bgClass = 'bg-white';
            
            // On affiche le nombre de cycles réussis (Box 5 -> 1)
            let cycleBadge = cyclesCount > 0 
                ? `<span class="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-1 rounded ml-2">🏆 ${cyclesCount} Cycles</span>`
                : '';

            if (s.status === 'completed') {
                statusBadge = '<span class="text-xs font-bold text-gray-600 bg-gray-200 px-2 py-1 rounded">TERMINÉ</span>';
                borderColor = 'border-gray-400';
                bgClass = 'bg-gray-50';
            } else {
                statusBadge = '<span class="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">EN COURS</span>';
            }

            const remaining = s.totalCards - s.currentIndex;
            const progressInfo = remaining <= 0 ? "Revoir (cliquer)" : `${remaining} cartes`;

            html += `
            <li data-id="${s.id}" data-status="${s.status}" class="cursor-pointer hover:bg-gray-50 transition p-3 ${bgClass} rounded border-l-4 ${borderColor} mb-2 shadow-sm group relative" title="Cliquer pour gérer">
                <button class="delete-session-btn absolute top-2 right-2 text-gray-400 hover:text-red-500 hidden group-hover:block px-2 text-lg" data-id="${s.id}" title="Supprimer">✕</button>
                <div class="flex justify-between items-center pr-8">
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <strong class="text-gray-800 text-sm">${s.deckName}</strong>
                            ${statusBadge}
                            ${cycleBadge}
                        </div>
                        <span class="text-xs text-gray-500 block">Activité : ${dateStr}</span>
                    </div>
                    <div class="text-right">
                        <span class="block font-bold text-gray-700 text-sm">${progressInfo}</span>
                        <span class="text-xs text-gray-400">Session: ${s.stats.correct}/${s.totalCards}</span>
                    </div>
                </div>
            </li>`;
        });

        list.innerHTML = html;

        document.getElementById('stat-total-reviewed').textContent = totalCards;
        const globalRate = totalCards > 0 ? Math.round((totalCorrect / totalCards) * 100) : 0;
        document.getElementById('stat-success-rate').textContent = globalRate + '%';
        document.getElementById('stat-streak').textContent = finishedCount;
    }
};

// --- 5. COEUR DE L'APPLICATION ---

const CoreApp = {
    csvData: [],

    init: () => {
        UI.init();
        
        const selector = document.getElementById('csv-selector');
        selector.addEventListener('change', async (e) => {
            const url = e.target.value;
            if(!url) return;
            const selectedOption = e.target.options[e.target.selectedIndex];
            const filename = selectedOption.dataset.name || selectedOption.value || "unknown.csv";

            try {
                const status = document.getElementById('csv-load-status');
                status.classList.remove('hidden');
                status.textContent = "Chargement...";
                status.className = "mt-2 w-full text-sm text-blue-600";
                
                const response = await fetch(url);
                if(!response.ok) throw new Error("Fichier introuvable");
                
                const text = await response.text();
                let data = CoreApp.parseCSV(text);
                data = CardPersistence.applyState(filename, data);
                
                CoreApp.csvData = data;
                CoreApp.csvData.filename = filename;
                try {
                    CoreApp.validateImageStructure(filename);
                } catch (e) {
                    console.warn("Validation images ignorée:", e);
                }

                document.getElementById('reset-deck-btn')?.classList.remove('hidden');
                CoreApp.renderBoxes();
                CoreApp.renderDeckOverview(); 
                StatsUI.renderDifficultyStats();

                status.textContent = `${CoreApp.csvData.length} cartes chargées.`;
                status.className = "mt-2 w-full text-sm text-green-600";
                
                if (CoreApp.csvData.length === 0) {
                    alert("Attention : Aucune carte n'a été trouvée dans ce fichier CSV.\nVérifiez le format du fichier.");
                }
                
                StatsUI.renderHistory();

                if (APP_STATE.isResuming && APP_STATE.session && APP_STATE.session.deckName === filename) {
                    APP_STATE.isResuming = false;
                    if (APP_STATE.session.currentIndex >= APP_STATE.session.totalCards && APP_STATE.session.status === 'active') {
                         SessionManager.resumeById(APP_STATE.session.id);
                    } else {
                         CoreApp.startReview();
                    }
                }

            } catch (err) {
                console.error(err);
                const status = document.getElementById('csv-load-status');
                status.textContent = "Erreur de chargement.";
                status.className = "mt-2 w-full text-sm text-red-600";
            }
        });

        document.getElementById('show-answer-btn').addEventListener('click', () => {
            document.getElementById('answer-section').classList.remove('hidden');
            document.getElementById('show-answer-btn').classList.add('hidden');
        });
        document.getElementById('right-answer').addEventListener('click', () => CoreApp.handleAnswer(true));
        document.getElementById('wrong-answer').addEventListener('click', () => CoreApp.handleAnswer(false));
        
        document.getElementById('edit-card-btn')?.addEventListener('click', () => CoreApp.openEditor());
        document.getElementById('delete-card-btn')?.addEventListener('click', () => CoreApp.deleteCard());
        document.getElementById('cancel-edit')?.addEventListener('click', () => CoreApp.closeEditor());
        document.getElementById('card-form')?.addEventListener('submit', (e) => CoreApp.saveCard(e));
        document.getElementById('reset-deck-btn')?.addEventListener('click', () => CoreApp.resetCurrentDeck());

        document.querySelectorAll('.modal .close, .flashcard-container, #admin-panel, #github-guide-modal').forEach(el => {
            el.addEventListener('click', (e) => {
                if(e.target === el || e.target.classList.contains('close')) {
                    if(el.id === 'flashcard-container' || el.classList.contains('flashcard-container')) {
                        CoreApp.closeFlashcard();
                    } else {
                        el.classList.add('hidden');
                        el.setAttribute('aria-hidden', 'true');
                    }
                }
            });
        });
    },

    closeFlashcard: () => {
        const el = document.getElementById('flashcard-container');
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
        CoreApp.renderBoxes();
        CoreApp.renderDeckOverview();
        StatsUI.renderDifficultyStats();
        StatsUI.renderHistory();
    },

    parseCSV: (text) => {
        const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim());
        if (lines.length === 0) return [];
        return lines.slice(1).map((line, index) => {
            const matches = [];
            const regex = /(?:^|,)(?:"([^"]*)"|([^",]*))/g;
            let match;
            let safety = 0;
            while ((match = regex.exec(line)) !== null) {
                let val = match[1] !== undefined ? match[1] : match[2];
                val = val ? val.trim() : '';
                matches.push(val);
                if (safety++ > 100) break; // Sécurité : évite une boucle infinie sur une ligne corrompue
            }
            
            // Logique robuste pour gérer les CSV mal formés (virgules dans les réponses)
            // et les numéros de boîte hors limites (ex: 200 -> 1)
            let question = matches[0] || 'Question vide';
            let qImage = matches[1] || '';
            let answer = '';
            let aImage = '';
            let box = 1;
            let lastReview = '';

            if (matches.length >= 6) {
                // On part de la fin pour récupérer les champs fixes (Date et Boîte sont toujours à la fin)
                lastReview = matches[matches.length - 1];
                
                const rawBox = parseInt(matches[matches.length - 2]);
                // Force la boîte entre 1 et 5, sinon 1 (corrige le problème des boîtes 200+)
                box = (!isNaN(rawBox) && rawBox >= 1 && rawBox <= 5) ? rawBox : 1;
                
                aImage = matches[matches.length - 3];
                
                // Tout ce qui est entre l'image question et l'image réponse est la réponse
                // (permet de gérer les virgules qui auraient scindé la réponse en plusieurs colonnes)
                const answerParts = matches.slice(2, matches.length - 3);
                answer = answerParts.join(', ') || 'Réponse vide';
            } else {
                // Fallback standard si moins de colonnes que prévu
                answer = matches[2] || 'Réponse vide';
                aImage = matches[3] || '';
                const rawBox = parseInt(matches[4]);
                box = (!isNaN(rawBox) && rawBox >= 1 && rawBox <= 5) ? rawBox : 1;
                lastReview = matches[5] || '';
            }

            return { id: index, question, qImage, answer, aImage, box, lastReview };
        });
    },

    getNextReviewDateForBox: (boxNum, cards) => {
        const now = new Date();
        let earliestDate = null;
        let pendingCount = 0;
        const intervalDays = BOX_INTERVALS[boxNum] || 1;

        cards.forEach(card => {
            if (!card.lastReview) {
                pendingCount++;
            } else {
                const last = new Date(card.lastReview);
                if (!isNaN(last.getTime())) {
                    const next = new Date(last);
                    next.setDate(last.getDate() + intervalDays);
                    if (next <= now) pendingCount++;
                    else {
                        if (!earliestDate || next < earliestDate) earliestDate = next;
                    }
                } else pendingCount++;
            }
        });

        if (pendingCount > 0) return { text: "Maintenant", count: pendingCount, urgent: true };
        if (earliestDate) {
            const dateStr = earliestDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' });
            const timeStr = earliestDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return { text: `${dateStr} à ${timeStr}`, count: 0, urgent: false };
        }
        return { text: "Aucune", count: 0, urgent: false };
    },

    renderBoxes: () => {
        const container = document.getElementById('leitner-boxes');
        if(!container) return;
        container.innerHTML = '';
        [1, 2, 3, 4, 5].forEach(num => {
            const cards = CoreApp.csvData.filter(c => c.box === num);
            const count = cards.length;
            const reviewInfo = CoreApp.getNextReviewDateForBox(num, cards);
            const reviewHtml = reviewInfo.urgent 
                ? `<span class="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded-full">À réviser (${reviewInfo.count})</span>`
                : `<span class="text-xs text-gray-500">Prochaine : ${reviewInfo.text}</span>`;

            const div = document.createElement('div');
            div.className = `bg-white p-4 rounded shadow border-t-4 box-border-${num} hover:shadow-lg transition cursor-pointer flex flex-col justify-between`;
            div.innerHTML = `
                <div>
                    <h3 class="font-bold text-gray-700 text-box${num}">Boîte ${num}</h3>
                    <p class="text-3xl font-bold mt-2 text-gray-800 transition-all duration-300" id="box-count-${num}">${count}</p>
                    <p class="text-xs text-gray-500 uppercase tracking-wide mb-3">cartes</p>
                </div>
                <div class="mt-2 border-t pt-2">${reviewHtml}</div>
            `;
            div.addEventListener('click', () => {
                if(cards.length) {
                    SessionManager.start(CoreApp.csvData.filename, cards);
                    CoreApp.startReview();
                } else alert('Boîte vide.');
            });
            container.appendChild(div);
        });
    },

    renderDeckOverview: () => {
        const container = document.getElementById('deck-overview-container');
        if(!container) return;
        
        container.innerHTML = ''; 
        
        [1, 2, 3, 4, 5].forEach(boxNum => {
            const cards = CoreApp.csvData.filter(c => c.box === boxNum);
            
            if (cards.length > 0) {
                const section = document.createElement('div');
                section.className = 'bg-white rounded-lg shadow-md p-5';
                
                const title = document.createElement('h3');
                title.className = `text-xl font-bold mb-4 text-box${boxNum} border-b pb-2`;
                title.textContent = `Boîte ${boxNum} (${cards.length} cartes)`;
                section.appendChild(title);
                
                const grid = document.createElement('div');
                grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
                
                cards.forEach(card => {
                    const cardEl = document.createElement('div');
                    cardEl.className = 'border rounded p-3 hover:bg-blue-50 text-sm flex gap-3 cursor-pointer transition transform hover:-translate-y-1 hover:shadow-md';
                    
                    cardEl.onclick = () => {
                        const boxCards = CoreApp.csvData.filter(c => c.box === boxNum);
                        const otherCards = boxCards.filter(c => c.id !== card.id);
                        const sessionCards = [card, ...otherCards];
                        SessionManager.start(CoreApp.csvData.filename, sessionCards);
                        CoreApp.startReview();
                    };
                    
                    let imgHtml = '';
                    const imgUrl = CoreApp.buildImageUrl(card.qImage, 'q');
                    if (imgUrl) {
                        imgHtml = `<div class="w-12 h-12 flex-shrink-0 bg-gray-200 rounded overflow-hidden"><img src="${imgUrl}" class="w-full h-full object-cover" onerror="this.style.display='none'"></div>`;
                    }
                    
                    let dateInfo = '';
                    if(card.lastReview) {
                        const d = new Date(card.lastReview);
                        dateInfo = `<span class="text-xs text-gray-400 block mt-1">Vu : ${d.toLocaleDateString()} ${d.toLocaleTimeString()}</span>`;
                    }

                    let diffBadge = '';
                    if (card.difficulty) {
                        const colors = { easy: 'text-green-600', normal: 'text-blue-600', hard: 'text-red-600' };
                        const labels = { easy: 'Facile', normal: 'Normal', hard: 'Difficile' };
                        diffBadge = `<span class="text-xs ${colors[card.difficulty] || 'text-gray-500'} font-bold ml-2">(${labels[card.difficulty] || ''})</span>`;
                    }

                    cardEl.innerHTML = `${imgHtml}<div class="flex-1 min-w-0"><p class="font-semibold text-gray-800 break-words whitespace-pre-wrap" title="${card.question}">${card.question}</p><p class="text-gray-500 break-words whitespace-pre-wrap" title="${card.answer}">${card.answer}</p>${dateInfo} ${diffBadge}</div>`;
                    grid.appendChild(cardEl);
                });
                
                section.appendChild(grid);
                container.appendChild(section);
            }
        });
    },

    buildImageUrl: (filename, type) => {
        if (!filename) return null;
        if (filename.startsWith('http') || filename.startsWith('data:')) return filename;
        
        const c = APP_STATE.config;
        const folder = type === 'q' ? 'images_questions' : 'images_reponses';
        
        let cleanPath = filename.trim().replace(/\\/g, '/').replace(/^(\.\/|\/)/, '');
        
        // Si le chemin ne contient pas déjà le dossier parent, on l'ajoute
        if (!cleanPath.startsWith('images_questions/') && !cleanPath.startsWith('images_reponses/')) {
            cleanPath = `${folder}/${cleanPath}`;
        }
        
        // Encodage des segments pour l'URL (garde les slashes)
        const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
        
        const basePath = c.path.endsWith('/') ? c.path.slice(0, -1) : c.path;
        const repoPath = basePath ? `${basePath}/` : '';
        
        return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${repoPath}${encodedPath}`;
    },

    validateImageStructure: (filename) => {
        const baseName = filename.replace(/\.csv$/i, '');
        const warnings = [];

        CoreApp.csvData.forEach((card, index) => {
            const check = (path, type) => {
                if (!path || path.startsWith('http') || path.startsWith('data:')) return;
                
                const parts = path.replace(/\\/g, '/').replace(/^(\.\/|\/)/, '').split('/');
                let subDir = '';

                // Format attendu : images_questions/NOM_FICHIER/image.jpg
                if ((parts[0] === 'images_questions' || parts[0] === 'images_reponses') && parts.length >= 3) {
                    subDir = parts[1];
                } 
                // Format alternatif : NOM_FICHIER/image.jpg
                else if (parts.length >= 2 && parts[0] !== 'images_questions' && parts[0] !== 'images_reponses') {
                    subDir = parts[0];
                }

                if (subDir && !baseName.startsWith(subDir)) {
                    warnings.push(`Ligne ${index + 1} (${type}): Le dossier "${subDir}" ne correspond pas au fichier "${baseName}".`);
                }
            };

            check(card.qImage, 'Question');
            check(card.aImage, 'Réponse');
        });

        if (warnings.length > 0) {
            console.warn('Validation Structure Images:', warnings);
            alert(`⚠️ Structure des dossiers d'images incorrecte.\n\nPour le fichier "${filename}", les images doivent être dans un sous-répertoire correspondant au nom du fichier (ex: images_questions/${baseName}/...).\n\n${warnings.length} incohérence(s) détectée(s).`);
        }
    },

    startReview: () => {
        if (!APP_STATE.session) return;
        const s = APP_STATE.session;
        
        // Remplacement de la récursion par une boucle while pour éviter le crash "Maximum call stack size exceeded"
        // et les boucles infinies si les cartes ne sont pas trouvées.
        while (s.currentIndex < s.totalCards) {
            const cardId = s.cardsQueue[s.currentIndex];
            const card = CoreApp.csvData.find(c => c.id === cardId);
            
            if (card) {
                CoreApp.showCardUI(card);
                return;
            }
            // Carte introuvable (supprimée ou ID obsolète), on passe à la suivante
            s.currentIndex++;
        }
        
        // Fin de session
        SessionManager.updateCurrent(); 
        alert(`Tour terminé !\nScore : ${s.stats.correct}/${s.totalCards}\n\nVoir l'onglet Statistiques pour les détails.`);
        CoreApp.closeFlashcard();
    },

    showCardUI: (card) => {
        const container = document.getElementById('flashcard-container');
        container.classList.remove('hidden');
        container.setAttribute('aria-hidden', 'false'); 
        
        document.getElementById('answer-section').classList.add('hidden');
        document.getElementById('show-answer-btn').classList.remove('hidden');

        const normalRadio = document.getElementById('difficulty-normal');
        if(normalRadio) normalRadio.checked = true;

        const qSection = document.querySelector('.question-section');
        const oldQuit = document.getElementById('temp-quit-btn');
        if(oldQuit) oldQuit.remove();

        const quitBtn = document.createElement('button');
        quitBtn.id = 'temp-quit-btn';
        quitBtn.textContent = "⏹ Quitter & Sauvegarder";
        quitBtn.className = "mb-4 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded w-full md:w-auto";
        quitBtn.onclick = () => {
            CoreApp.closeFlashcard();
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded shadow-lg z-50';
            toast.textContent = "Session sauvegardée dans l'onglet Statistiques";
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        };
        qSection.parentNode.insertBefore(quitBtn, qSection);

        let qHtml = `<p class="text-xl break-words whitespace-pre-wrap">${card.question || '...'}</p>`;
        const qImgUrl = CoreApp.buildImageUrl(card.qImage, 'q');
        if(qImgUrl) qHtml += `<img src="${qImgUrl}" class="max-w-full h-auto mt-4 rounded shadow-sm mx-auto max-h-60 object-contain" onerror="this.style.display='none'">`;
        document.getElementById('question-content').innerHTML = qHtml;

        let aHtml = `<p class="text-xl break-words whitespace-pre-wrap">${card.answer || '...'}</p>`;
        const aImgUrl = CoreApp.buildImageUrl(card.aImage, 'a');
        if(aImgUrl) aHtml += `<img src="${aImgUrl}" class="max-w-full h-auto mt-4 rounded shadow-sm mx-auto max-h-60 object-contain" onerror="this.style.display='none'">`;
        document.getElementById('answer-content').innerHTML = aHtml;
        
        setTimeout(() => document.getElementById('show-answer-btn').focus(), 50);
    },

    handleAnswer: (isCorrect) => {
        const s = APP_STATE.session;
        const cardId = s.cardsQueue[s.currentIndex];
        const card = CoreApp.csvData.find(c => c.id === cardId);
        
        if(card) {
            const oldBox = parseInt(card.box) || 1;
            let newBox = oldBox;
            let cycleComplete = false;

            if(isCorrect) {
                if(newBox < 5) {
                    newBox++;
                } else {
                    // --- CYCLE COMPLET : 5 -> 1 ---
                    newBox = 1;
                    cycleComplete = true;
                    // Incrémenter les stats globales du deck
                    DeckStats.incrementCycle(CoreApp.csvData.filename);
                }
            } else {
                newBox = 1;
            }

            const difficultyInput = document.querySelector('input[name="difficulty"]:checked');
            const difficulty = difficultyInput ? difficultyInput.value : 'normal';

            card.box = newBox;
            card.lastReview = new Date().toISOString(); 
            card.difficulty = difficulty;

            CardPersistence.updateCard(CoreApp.csvData.filename, cardId, newBox, card.lastReview, difficulty);
            
            const feedback = document.createElement('div');
            feedback.className = `fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 px-6 py-4 rounded-xl font-bold text-white shadow-2xl z-[100] text-xl flex flex-col items-center gap-2 animate-bounce ${isCorrect ? 'bg-green-600' : 'bg-red-500'}`;
            
            let message = '';
            if (!isCorrect) message = "👎 Retour Boîte 1";
            else if (cycleComplete) message = "🏆 CYCLE VALIDÉ ! (+1)"; // Feedback spécial
            else message = `👍 Boîte ${oldBox} ➔ Boîte ${newBox}`;
            
            feedback.innerHTML = `<span>${message}</span>`;
            document.body.appendChild(feedback);
            
            setTimeout(() => {
                feedback.style.opacity = '0';
                setTimeout(() => feedback.remove(), 300);
            }, 800);

            CoreApp.renderBoxes();
        }
        
        SessionManager.recordResult(isCorrect);
        CoreApp.startReview();
    },

    openEditor: () => {
        if (!APP_STATE.session) return;
        const s = APP_STATE.session;
        const cardId = s.cardsQueue[s.currentIndex];
        const card = CoreApp.csvData.find(c => c.id === cardId);
        if (!card) return;

        const editor = document.getElementById('card-editor');
        if (editor) {
            document.getElementById('card-id').value = card.id;
            document.getElementById('card-question').value = card.question;
            document.getElementById('card-answer').value = card.answer;
            const qImg = document.getElementById('card-question-image');
            if(qImg) qImg.value = card.qImage || '';
            const aImg = document.getElementById('card-answer-image');
            if(aImg) aImg.value = card.aImage || '';
            
            editor.classList.remove('hidden');
            editor.setAttribute('aria-hidden', 'false');
            document.getElementById('flashcard-container').classList.add('hidden');
        }
    },

    closeEditor: () => {
        document.getElementById('card-editor').classList.add('hidden');
        document.getElementById('card-editor').setAttribute('aria-hidden', 'true');
        document.getElementById('flashcard-container').classList.remove('hidden');
    },

    saveCard: (e) => {
        e.preventDefault();
        const id = parseInt(document.getElementById('card-id').value);
        const card = CoreApp.csvData.find(c => c.id === id);
        if (card) {
            card.question = document.getElementById('card-question').value;
            card.answer = document.getElementById('card-answer').value;
            const qImg = document.getElementById('card-question-image');
            if(qImg) card.qImage = qImg.value;
            const aImg = document.getElementById('card-answer-image');
            if(aImg) card.aImage = aImg.value;
            
            CoreApp.showCardUI(card);
            CoreApp.renderDeckOverview();
        }
        CoreApp.closeEditor();
    },

    deleteCard: () => {
        if (!APP_STATE.session) return;
        const s = APP_STATE.session;
        const cardId = s.cardsQueue[s.currentIndex];
        
        if (confirm('Supprimer cette carte ? (Action locale pour la session)')) {
            CoreApp.csvData = CoreApp.csvData.filter(c => c.id !== cardId);
            s.cardsQueue = s.cardsQueue.filter(id => id !== cardId);
            s.totalCards = s.cardsQueue.length;
            
            if (s.currentIndex >= s.totalCards) s.currentIndex = 0;
            
            SessionManager.updateCurrent();
            CoreApp.renderBoxes();
            CoreApp.renderDeckOverview();
            
            if (s.totalCards > 0) CoreApp.startReview();
            else {
                CoreApp.closeFlashcard();
                alert('Session vide.');
            }
        }
    },

    resetCurrentDeck: () => {
        if (!CoreApp.csvData || !CoreApp.csvData.filename) return;
        if (!confirm("Réinitialiser ce paquet ?\nToutes les cartes retourneront en Boîte 1.")) return;
        
        CardPersistence.resetDeckState(CoreApp.csvData.filename, CoreApp.csvData);
        CoreApp.renderBoxes();
        CoreApp.renderDeckOverview();
        alert("Paquet réinitialisé en Boîte 1.");
    }
};

document.addEventListener('DOMContentLoaded', CoreApp.init);