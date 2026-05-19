// ═══════════════════════════════════════════════════════════════
// Cara v10 — Frontend MVP
// Sprint 3 / Tâche 3.3 : Structure JS en sections commentées
//
// SECTIONS :
//   1. GLOBALS & DOM REFS     — Variables globales et références DOM
//   2. WEBSOCKET              — Connexion, reconnexion, message handler
//   3. UI STATUS              — Bannière connexion, spinner mission
//   4. MESSAGES               — Affichage messages, markdown, mission logs
//   5. FILES                  — Upload, drag & drop, file cards
//   6. SEND                   — Envoi de messages et fichiers
//   7. WIDGETS                — Météo, finance, maps, datetime
//   8. CONVERSATIONS          — Historique, sauvegarde localStorage
//   9. THEME & SIDEBAR        — Thème sombre, sidebar responsive
//  10. SMART PASTE            — Collage intelligent de textes longs
//  11. GLOBAL DROPZONE        — Drag & drop sur toute la page
//  12. INIT                   — Démarrage de l'application
// ═══════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────
// 1. GLOBALS & DOM REFS
// ─────────────────────────────────────────────────────────────
const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/chat';
let ws = null;
let currentAiDiv = null;
let currentAiRaw = '';
let isConnected = false;
let isMissionRunning = false;
let currentConvId = null;
let conversations = {};
let pendingFilesList = [];
let pendingSmartPasteText = '';
let authUser = null;
let authMode = 'login';
let allowWsReconnect = false;

const $ = id => document.getElementById(id);
const chatScroll = $('chatScroll');
const chatContainer = $('chatContainer');
const msgInput = $('msgInput');
const inputBox = $('inputBox');
const fileInput = $('fileInput');
const statusDot = $('statusDot');
const statusBanner = $('statusBanner');
const missionStatusEl = $('missionStatus');
const missionStatusText = $('missionStatusText');
const pendingFilesEl = $('pendingFiles');
const authGate = $('authGate');
const authFeedback = $('authFeedback');
const loginForm = $('loginForm');
const registerForm = $('registerForm');

function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = nextHeight + 'px';
    textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden';
}

function quickSend(text) {
    msgInput.value = text || '';
    autoResize(msgInput);
    sendMessage();
}


// ─────────────────────────────────────────────────────────────
// 2. WEBSOCKET — Connexion avec reconnexion automatique
// Sprint 3 / Tâche 3.1 : backoff exponentiel + bannière visible
// ─────────────────────────────────────────────────────────────
let _wsRetryCount = 0;
let _wsReconnectTimer = null;
let _bannerHideTimer = null;
let _disconnectNoticeTimer = null;
let _disconnectNoticeShown = false;

function cancelDisconnectNotice() {
    if (_disconnectNoticeTimer) {
        clearTimeout(_disconnectNoticeTimer);
        _disconnectNoticeTimer = null;
    }
}

function scheduleDisconnectNotice(type, text, delayMs = 1400) {
    cancelDisconnectNotice();
    _disconnectNoticeShown = false;
    _disconnectNoticeTimer = setTimeout(() => {
        _disconnectNoticeTimer = null;
        if (isConnected) return;
        _disconnectNoticeShown = true;
        showBanner(type, text);
    }, delayMs);
}

function connectWS() {
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        const wasReconnect = _wsRetryCount > 0;
        const hadDisconnectNotice = _disconnectNoticeShown;
        if (_wsReconnectTimer) {
            clearTimeout(_wsReconnectTimer);
            _wsReconnectTimer = null;
        }
        cancelDisconnectNotice();
        isConnected = true;
        _wsRetryCount = 0;
        _disconnectNoticeShown = false;
        // UI: pastille verte
        statusDot.classList.remove('disconnected');
        statusDot.title = 'Connecté';
        // UI: bannière "Reconnecté" (seulement si c'est une reconnexion)
        if (wasReconnect && hadDisconnectNotice) {
            showBanner('reconnected', 'Reconnecté');
            // Cacher la bannière après 3s
            _bannerHideTimer = setTimeout(() => hideBanner(), 3000);
        } else {
            hideBanner();
        }
        console.log('[WS] Connecté');
    };

    ws.onclose = () => {
        isConnected = false;
        // UI: pastille rouge
        statusDot.classList.add('disconnected');
        // UI: bannière d'état
        const delay = Math.min(1000 * Math.pow(2, _wsRetryCount), 10000);
        const delaySec = Math.round(delay / 1000);
        statusDot.title = `Déconnecté — reconnexion dans ${delaySec}s`;
        cancelDisconnectNotice();
        if (_wsRetryCount === 0) {
            scheduleDisconnectNotice('disconnected', 'Connexion perdue — reconnexion...');
        } else {
            scheduleDisconnectNotice('reconnecting', `Reconnexion... tentative #${_wsRetryCount + 1}`);
        }
        console.log(`[WS] Déconnecté — tentative #${_wsRetryCount + 1} dans ${delay}ms`);
        // Programmation de la reconnexion
        if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
        _wsReconnectTimer = setTimeout(() => {
            _wsReconnectTimer = null;
            _wsRetryCount++;
            connectWS();
        }, delay);
    };

    ws.onerror = (err) => {
        console.error('[WS] Erreur:', err);
    };

    ws.onmessage = e => {
        try { handleMsg(JSON.parse(e.data)); }
        catch (err) { console.error('[WS] Parse error:', err); }
    };
}


// ─────────────────────────────────────────────────────────────
// 3. UI STATUS — Bannière connexion + spinner mission
// Sprint 3 / Tâche 3.2 : indicateurs d'état visibles
// ─────────────────────────────────────────────────────────────
function showBanner(type, text) {
    if (_bannerHideTimer) { clearTimeout(_bannerHideTimer); _bannerHideTimer = null; }
    statusBanner.className = 'status-banner ' + type + ' visible';
    statusBanner.textContent = text;
}

function hideBanner() {
    statusBanner.classList.remove('visible');
}

function setMissionRunning(running, description) {
    isMissionRunning = running;
    if (running) {
        missionStatusEl.classList.add('active');
        missionStatusText.textContent = description || 'Mission en cours...';
    } else {
        missionStatusEl.classList.remove('active');
    }
}

// ─────────────────────────────────────────────────────────────
// 4. MESSAGES — Affichage, markdown, logs de mission
// ─────────────────────────────────────────────────────────────
let currentMissionContainer = null;
let currentMissionLogsInner = null;
let missionLogCount = 0;
let lastMissionStepKey = '';

function getMissionLogSummaryLabel(statusPrefix) {
    const countLabel = `${missionLogCount} ${missionLogCount > 1 ? 'étapes' : 'étape'}`;
    return `${statusPrefix} Étapes de réflexion (${countLabel})`;
}

function ensureMissionLogContainer() {
    if (!currentAiDiv) createAiMsg();

    if (!currentMissionContainer) {
        currentMissionContainer = document.createElement('div');
        currentMissionContainer.className = 'mission-log-container';
        const details = document.createElement('details');
        details.setAttribute('open', '');
        const summary = document.createElement('summary');
        summary.textContent = '⏳ Réflexion en cours...';
        details.appendChild(summary);
        const inner = document.createElement('div');
        inner.className = 'mission-logs-inner';
        details.appendChild(inner);
        currentMissionContainer.appendChild(details);
        currentAiDiv.querySelector('.msg-content').appendChild(currentMissionContainer);
        currentMissionLogsInner = inner;
    }

    return currentMissionLogsInner;
}

function collapseMissionLogs(statusPrefix) {
    if (!currentMissionContainer) return;

    const details = currentMissionContainer.querySelector('details');
    if (!details) return;

    details.removeAttribute('open');
    const summary = details.querySelector('summary');
    if (summary) {
        summary.textContent = getMissionLogSummaryLabel(statusPrefix || '🧠');
    }
}

function formatMissionStep(data) {
    const rawPhase = String(data.phase || data.node || '').trim();
    const normalizedPhase = rawPhase.replace(/^MissionPhase\./i, '').trim();
    const phaseKey = normalizedPhase.toLowerCase();
    const iteration = Number(data.iteration || 0);
    const labels = {
        router: 'Analyse de la demande',
        triage: 'Qualification de la mission',
        planner: 'Construction du plan',
        plan: 'Construction du plan',
        plan_critic: 'Vérification du plan',
        worker: 'Exécution de la mission',
        workers: 'Exécution de la mission',
        run_worker: 'Exécution de la mission',
        tool: 'Utilisation d’un outil',
        tools: 'Utilisation d’un outil',
        memory: 'Consultation de la mémoire',
        retrieval: 'Recherche de contexte',
        rdp: 'Pilotage RDP',
        hitl: 'Attente d’une validation',
        final: 'Préparation de la réponse',
        finalize: 'Préparation de la réponse',
        synthese: 'Préparation de la réponse',
        synthesis: 'Préparation de la réponse',
        response: 'Rédaction de la réponse',
    };

    if (!normalizedPhase || /^\d+$/.test(normalizedPhase)) {
        return null;
    }

    if (['complete', 'failed', 'received'].includes(phaseKey)) {
        return null;
    }

    let label = labels[phaseKey];
    if (!label && normalizedPhase) {
        label = normalizedPhase
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }
    if (!label) {
        label = 'Traitement en cours';
    }

    if (iteration > 1) {
        label += ` (itération ${iteration})`;
    }

    return {
        key: `${data.mission_id || ''}|${phaseKey}|${iteration}`,
        text: label,
    };
}

function getMissionSummaryText(data) {
    const executionStatus = String(data.execution_status || data.status || '').toLowerCase();
    const fallback = (executionStatus === 'failed' || executionStatus === 'cancelled')
        ? "La mission n'a pas pu se terminer. Aucun resultat final n'a ete valide."
        : 'Mission terminee. Retour utilisateur en attente.';
    const preferred = String(data.ui_summary || '').trim();
    if (preferred) return preferred.slice(0, 300);

    const reportSummary = data.report && (data.report.ui_summary || data.report.summary || data.report.failure_reason);
    const raw = String(data.rapport || data.summary || reportSummary || '').trim();
    if (!raw) return fallback;

    const cleaned = raw
        .replace(/\[OUTPUT_FILE\][^\n]*/gi, '')
        .replace(/\[SOURCE_FILE\][^\n]*/gi, '')
        .replace(/worker='[^']*'\s*action='[^']*'\s*a echoue:\s*/gi, '')
        .replace(/prevalidation echouee(?:\s+pour)?[^:]*:\s*/gi, '')
        .replace(/suggestion logs:.*$/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const lowered = cleaned.toLowerCase();
    if (/^\d+$/.test(raw)
        || /^missionphase\./i.test(raw)
        || ['complete', 'failed', 'reviewing', 'executing', 'received'].includes(lowered)
        || raw.startsWith('[AGENT]')
        || raw.startsWith('[ACTION_DONE]')
        || /worker=|action=|traceback|run_id=|status=/.test(lowered)) {
        return fallback;
    }

    return (cleaned || fallback).slice(0, 300);
}

function handleMsg(data) {
    switch (data.type) {
        case 'run_started':
            setMissionRunning(true, (data.instruction || 'Mission').slice(0, 60));
            showMissionLog((data.label || 'Mission reçue') + (data.instruction ? ' : ' + data.instruction : ''), 'info');
            break;
        case 'mission_routed':
            showMissionLog(data.label || 'Mission routée', 'info');
            break;
        case 'plan_created':
            showMissionLog(data.label || 'Plan généré', 'info');
            break;
        case 'step_started':
            showMissionLog(data.label || 'Étape démarrée', 'info');
            break;
        case 'worker_action':
            if (data.label) {
                const level = data.status === 'failed' ? 'error' : data.status === 'success' ? 'success' : 'info';
                showMissionLog(data.label, level);
            }
            break;
        case 'step_completed':
            showMissionLog(data.label || 'Étape terminée', data.step && data.step.success ? 'success' : 'error');
            break;
        case 'run_completed':
            showMissionLog(data.label || 'Mission terminée', String(data.status || '').toLowerCase() === 'completed' ? 'success' : 'error');
            break;
        case 'token':
            hideWelcome();
            if (!currentAiDiv) createAiMsg();
            if (!currentAiRaw && currentMissionContainer) {
                collapseMissionLogs('🧠');
            }
            currentAiRaw += data.content || '';
            currentAiDiv.querySelector('.msg-text').innerHTML = renderMd(currentAiRaw);
            scrollBottom();
            break;
        case 'done':
            if (currentAiDiv && currentAiRaw) {
                saveToConv('assistant', currentAiRaw);
            }
            currentAiDiv = null;
            currentAiRaw = '';
            break;
        case 'user_message':
            showMissionLog(data.text, data.level || 'info');
            break;
        case 'mission_start':
            // Sprint 3 / Tâche 3.2 : spinner visible dans la topbar
            setMissionRunning(true, (data.description || 'Mission').slice(0, 60));
            missionLogCount = 0;
            lastMissionStepKey = '';
            showMissionLog('Mission lancée : ' + (data.description || '').slice(0, 100), 'info');
            break;
        case 'mission_step':
            {
                const step = formatMissionStep(data);
                if (step && step.key !== lastMissionStepKey) {
                    lastMissionStepKey = step.key;
                    showMissionLog(step.text, 'info');
                    break;
                }
            }
            // Silent — progress tracked via user_messages
            break;
        case 'mission_end':
            // Sprint 3 / Tâche 3.2 : arrêter le spinner
            setMissionRunning(false);
            collapseMissionLogs('TERMINEE');
            // Supprimer le formulaire de paramètres si présent — il ne doit
            // pas rester affiché après l'exécution réelle (réussie ou échouée).
            if (data.mission_id) {
                const _paramsCard = document.querySelector(`[data-mission-params="${data.mission_id}"]`);
                if (_paramsCard) _paramsCard.remove();
            }
            // Fermer le conteneur de logs (le replier)
            if (currentMissionContainer) {
                const details = currentMissionContainer.querySelector('details');
                if (details) {
                    details.removeAttribute('open');
                    const summary = details.querySelector('summary');
                    if (summary) {
                        const status = '📋';
                        summary.textContent = '';
                        summary.innerHTML = `${status} Déroulement de la mission (${missionLogCount} étapes)`;
                    }
                }
            }
            // Afficher le message de synthèse
            if (!currentAiDiv) createAiMsg();
            const summaryDiv = document.createElement('div');
            const executionStatus = String(data.execution_status || data.status || '').toLowerCase();
            summaryDiv.className = executionStatus === 'failed' || executionStatus === 'cancelled'
                ? 'mission-summary error'
                : 'mission-summary success';
            summaryDiv.textContent = getMissionSummaryText(data);
            currentAiDiv.querySelector('.msg-content').appendChild(summaryDiv);
            currentMissionContainer = null;
            currentMissionLogsInner = null;
            missionLogCount = 0;
            lastMissionStepKey = '';
            scrollBottom();
            break;
        case 'mission_feedback_requested':
            showMissionFeedback(data);
            break;
        case 'feature_not_available':
            showFeatureNotAvailable(data);
            break;
        case 'mission_feedback':
            updateMissionFeedbackCard(data.mission_id, data.mission_success || 'pending');
            break;
        case 'mission_params_required':
            showMissionParamsRequired(data);
            break;
        case 'file_received':
            showMissionLog('📎 ' + data.filename + ' reçu', 'success');
            break;
        case 'file_result':
            showFileCard(data.filename, data.content_b64, data.path);
            break;
        case 'widget':
            renderWidget(data.widget_type, data.data);
            break;
        case 'file_chip':
            showFileChip(data.filename || 'fichier', data.size || 0);
            break;
        case 'interactive_cells':
            showInteractiveCells(data);
            break;
        case 'hitl_request':
            showHITL(data);
            break;
        case 'error':
            showMissionLog('❌ ' + (data.error || 'Erreur'), 'error');
            // Sprint 3 / Tâche 3.2 : arrêter le spinner en cas d'erreur
            setMissionRunning(false);
            collapseMissionLogs('ECHEC');
            currentAiDiv = null;
            currentAiRaw = '';
            lastMissionStepKey = '';
            break;
        case 'ping':
            break;
    }
}

function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
}

function getSmartPasteTitle(text) {
    let title = (text || '').slice(0, 60).trim();
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > 30) title = title.slice(0, lastSpace);
    return (title || 'Texte colle') + '...';
}

function buildSmartPasteMessageCard(text) {
    return `<details class="smart-paste"><summary>📋 ${esc(getSmartPasteTitle(text))}<span class="paste-preview">${text.length.toLocaleString()} chars</span></summary><div class="paste-content">${esc(text)}</div></details>`;
}

function buildComposerSmartPasteCard(text) {
    return `
        <details class="composer-smart-paste" id="smartPastePreview">
            <summary>
                <span class="composer-smart-paste-main">
                    <span class="composer-smart-paste-icon">📋</span>
                    <span>
                        <div class="composer-smart-paste-title">${esc(getSmartPasteTitle(text))}</div>
                        <div class="composer-smart-paste-meta">${text.length.toLocaleString()} caracteres</div>
                        <div class="composer-smart-paste-hint">Ajoutez votre consigne dans le champ ci-dessous, puis envoyez.</div>
                    </span>
                </span>
                <button type="button" class="composer-smart-paste-remove" onclick="clearSmartPaste(event)" aria-label="Retirer le texte colle">✕</button>
            </summary>
            <div class="paste-content">${esc(text)}</div>
        </details>
    `;
}

function buildOutgoingMessage(userText, smartPasteText) {
    if (!smartPasteText) return userText;
    if (!userText) return smartPasteText;
    return `${userText}\n\nTexte colle a analyser :\n${smartPasteText}`;
}

function addUserMsg(text, fileCards, options = {}) {
    hideWelcome();
    const div = document.createElement('div');
    div.className = 'msg user';
    let html = '<div class="msg-content">';
    const smartPasteText = options.smartPasteText || '';

    if (smartPasteText) {
        if (text) html += esc(text);
        html += buildSmartPasteMessageCard(smartPasteText);
    } else if (text && text.length > SMART_PASTE_THRESHOLD) {
        html += buildSmartPasteMessageCard(text);
    } else {
        html += esc(text);
    }

    if (fileCards && fileCards.length) {
        for (const f of fileCards) {
            html += `<div class="file-card" style="margin-top:8px"><span class="file-icon">📄</span><div class="file-info"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${(f.size/1024).toFixed(1)} KB</span></div></div>`;
        }
    }
    html += '</div>';
    div.innerHTML = html;
    chatContainer.appendChild(div);

    scrollBottom();
    return div;
}

function createAiMsg() {
    const div = document.createElement('div');
    div.className = 'msg ai';
    div.innerHTML = `<div class="msg-avatar">C</div><div class="msg-content"><div class="msg-text"></div></div>`;
    chatContainer.appendChild(div);
    currentAiDiv = div;
    currentAiRaw = '';
    scrollBottom();
}

function showMissionLog(text, level) {
    const inner = ensureMissionLogContainer();

    // Creer le conteneur collapsible s'il n'existe pas encore
    if (!currentMissionContainer) {
        currentMissionContainer = document.createElement('div');
        currentMissionContainer.className = 'mission-log-container';
        const details = document.createElement('details');
        details.setAttribute('open', '');
        const summary = document.createElement('summary');
        summary.textContent = '⏳ Mission en cours...';
        details.appendChild(summary);
        const inner = document.createElement('div');
        inner.className = 'mission-logs-inner';
        details.appendChild(inner);
        currentMissionContainer.appendChild(details);
        currentAiDiv.querySelector('.msg-content').appendChild(currentMissionContainer);
        currentMissionLogsInner = inner;
    }

    const logEl = document.createElement('div');
    logEl.className = 'mission-log' + (level === 'error' ? ' error' : level === 'success' ? ' success' : '');
    logEl.textContent = text;
    inner.appendChild(logEl);
    missionLogCount++;
    const summary = currentMissionContainer && currentMissionContainer.querySelector('summary');
    if (summary) {
        summary.textContent = getMissionLogSummaryLabel('⏳');
    }
    scrollBottom();
}

function showFileCard(filename, b64, path) {
    if (!currentAiDiv) createAiMsg();
    const card = document.createElement('div');
    card.className = 'file-card';
    const ext = filename.split('.').pop().toLowerCase();
    const icons = { pdf: '📕', docx: '📘', doc: '📘', xlsx: '📗', xls: '📗', pptx: '📙', csv: '📋', txt: '📄', json: '📋', png: '🖼', jpg: '🖼' };
    card.innerHTML = `
        <span class="file-icon">${icons[ext] || '📦'}</span>
        <div class="file-info"><span class="file-name">${esc(filename)}</span><span class="file-meta">Fichier généré</span></div>
        <a class="file-download" href="data:application/octet-stream;base64,${b64}" download="${esc(filename)}">⬇ Télécharger</a>
    `;
    currentAiDiv.querySelector('.msg-content').appendChild(card);
    scrollBottom();
}

function showHITL(data) {
    if (!currentAiDiv) createAiMsg();
    const card = document.createElement('div');
    card.className = 'hitl-card';
    card.innerHTML = `
        <p>${renderMd(data.prompt || 'Action requise')}</p>
        <input type="text" id="hitlInput" placeholder="Votre réponse...">
        <div class="hitl-actions">
            <button class="approve" onclick="sendHITL('${data.thread_id}', true)">✅ Confirmer</button>
            <button class="cancel" onclick="sendHITL('${data.thread_id}', false)">❌ Annuler</button>
        </div>
    `;
    currentAiDiv.querySelector('.msg-content').appendChild(card);
    scrollBottom();
}

function sendHITL(tid, approved) {
    const input = document.getElementById('hitlInput');
    const val = approved ? (input?.value || 'oui') : 'non';
    if (!isWsReady()) {
        scheduleDisconnectNotice('disconnected', 'Connexion indisponible. Reessayez apres reconnexion.', 900);
        showSmartPasteNotice('Validation non envoyee. Reessayez une fois la connexion revenue.');
        connectWS();
        return;
    }
    ws.send(JSON.stringify({ type: 'hitl_response', thread_id: tid, value: val }));
}

function showMissionFeedback(data) {
    if (!data || !data.mission_id) return;
    if (!currentAiDiv) createAiMsg();

    const existing = document.querySelector(`[data-mission-feedback="${data.mission_id}"]`);
    if (existing) return;

    const card = document.createElement('div');
    card.className = 'mission-feedback-card';
    card.dataset.missionFeedback = data.mission_id;
    card.innerHTML = `
        <p>${esc(data.question || 'Ai-je répondu à votre demande ?')}</p>
        <div class="mission-feedback-actions">
            <button class="mission-feedback-btn" data-answer="yes" onclick="sendMissionFeedback('${data.mission_id}', 'yes')">Oui</button>
            <button class="mission-feedback-btn" data-answer="no" onclick="sendMissionFeedback('${data.mission_id}', 'no')">Non</button>
        </div>
        <div class="mission-feedback-status">En attente de votre retour.</div>
    `;
    currentAiDiv.querySelector('.msg-content').appendChild(card);
    scrollBottom();
}

function showFeatureNotAvailable(data) {
    if (!data) return;
    if (!currentAiDiv) createAiMsg();

    const card = document.createElement('div');
    card.className = 'feature-not-available-card';
    card.innerHTML = `
        <h4>Fonctionnalite non disponible</h4>
        <p>${esc(data.message || 'Cette mission sera disponible dans une prochaine version.')}</p>
        <div class="feature-not-available-reason">${esc(data.reason || 'OUT_OF_SCOPE')}</div>
    `;
    currentAiDiv.querySelector('.msg-content').appendChild(card);
    scrollBottom();
}

function updateMissionFeedbackCard(missionId, missionSuccess) {
    const card = document.querySelector(`[data-mission-feedback="${missionId}"]`);
    if (!card) return;

    const yesBtn = card.querySelector('[data-answer="yes"]');
    const noBtn = card.querySelector('[data-answer="no"]');
    const status = card.querySelector('.mission-feedback-status');
    const normalized = String(missionSuccess || 'pending').toLowerCase();

    yesBtn.classList.remove('selected-yes');
    noBtn.classList.remove('selected-no');
    yesBtn.disabled = false;
    noBtn.disabled = false;

    if (normalized === 'true') {
        yesBtn.classList.add('selected-yes');
        yesBtn.disabled = true;
        noBtn.disabled = true;
        status.textContent = 'Reponse enregistree : Oui.';
    } else if (normalized === 'false') {
        noBtn.classList.add('selected-no');
        yesBtn.disabled = true;
        noBtn.disabled = true;
        status.textContent = 'Reponse enregistree : Non.';
    } else {
        status.textContent = 'En attente de votre retour.';
    }
}

function sendMissionFeedback(missionId, value) {
    if (!isWsReady()) {
        scheduleDisconnectNotice('disconnected', 'Connexion indisponible. Reessayez apres reconnexion.', 900);
        showSmartPasteNotice('Retour utilisateur non envoye. Reessayez une fois la connexion revenue.');
        connectWS();
        return;
    }

    const card = document.querySelector(`[data-mission-feedback="${missionId}"]`);
    if (card) {
        const yesBtn = card.querySelector('[data-answer="yes"]');
        const noBtn = card.querySelector('[data-answer="no"]');
        const status = card.querySelector('.mission-feedback-status');
        if (yesBtn) yesBtn.disabled = true;
        if (noBtn) noBtn.disabled = true;
        if (status) status.textContent = 'Envoi de votre reponse...';
    }
    ws.send(JSON.stringify({ type: 'mission_feedback', mission_id: missionId, value }));
}

function showMissionParamsRequired(data) {
    if (!data || !data.mission_id || !Array.isArray(data.fields) || !data.fields.length) return;
    if (!currentAiDiv) createAiMsg();

    const existing = document.querySelector(`[data-mission-params="${data.mission_id}"]`);
    if (existing) {
        existing.remove();
    }

    const card = document.createElement('div');
    card.className = 'mission-params-card';
    card.dataset.missionParams = data.mission_id;

    const title = document.createElement('h4');
    title.textContent = data.title || 'Informations nécessaires pour terminer la mission';
    card.appendChild(title);

    const form = document.createElement('form');
    form.className = 'mission-params-form';
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitMissionParams(data.mission_id, form);
    });

    for (const field of data.fields) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mission-params-field';

        const label = document.createElement('label');
        label.textContent = field.label || field.key || 'champ';
        label.setAttribute('for', `mission-param-${data.mission_id}-${field.key}`);
        wrapper.appendChild(label);

        const inputType = String(field.input_type || 'text').toLowerCase();
        const input = inputType === 'textarea'
            ? document.createElement('textarea')
            : document.createElement('input');
        input.id = `mission-param-${data.mission_id}-${field.key}`;
        input.name = field.key || '';
        if (input instanceof HTMLInputElement) {
            input.type = inputType === 'textarea' ? 'text' : inputType;
        }
        input.placeholder = field.placeholder || '';
        input.required = field.required !== false;
        wrapper.appendChild(input);

        form.appendChild(wrapper);
    }

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'mission-params-submit';
    submit.textContent = 'Continuer la mission';
    form.appendChild(submit);

    card.appendChild(form);
    currentAiDiv.querySelector('.msg-content').appendChild(card);
    scrollBottom();
}

function submitMissionParams(missionId, formEl) {
    if (!isWsReady()) {
        scheduleDisconnectNotice('disconnected', 'Connexion indisponible. Reessayez apres reconnexion.', 900);
        connectWS();
        return;
    }

    const values = {};
    const fields = formEl.querySelectorAll('input, textarea');
    for (const field of fields) {
        values[field.name] = field.value || '';
    }

    const button = formEl.querySelector('.mission-params-submit');
    if (button) button.disabled = true;
    ws.send(JSON.stringify({ type: 'mission_param_submit', mission_id: missionId, values }));
}

// STEP2: Interactive Cells (Triage QCM pour RDP/plugins)
function showInteractiveCells(data) {
    if (!currentAiDiv) createAiMsg();

    const card = document.createElement('div');
    card.className = 'hitl-card';

    const prompt = document.createElement('p');
    prompt.textContent = data.agent_message || 'Que souhaitez-vous faire ?';
    card.appendChild(prompt);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '6px';

    for (const opt of (data.options || [])) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = opt.label || 'Choix';
        button.dataset.actionTrigger = opt.action_trigger || '';
        button.dataset.actionLabel = opt.label || '';
        button.style.textAlign = 'left';
        button.style.padding = '10px 14px';
        button.style.borderRadius = 'var(--radius-sm)';
        button.style.border = '1px solid var(--border)';
        button.style.background = 'var(--bg-surface)';
        button.style.cursor = 'pointer';
        button.style.font = 'inherit';
        button.style.fontSize = '0.85rem';
        button.style.transition = 'var(--transition)';
        button.addEventListener('mouseover', () => { button.style.borderColor = 'var(--accent)'; });
        button.addEventListener('mouseout', () => { button.style.borderColor = 'var(--border)'; });
        button.addEventListener('click', () => {
            handleCellAction(button.dataset.actionTrigger || '', button.dataset.actionLabel || '');
        });
        actions.appendChild(button);
    }

    card.appendChild(actions);
    currentAiDiv.querySelector('.msg-content').appendChild(card);
    scrollBottom();
}

function handleCellAction(trigger, label) {
    const userText = label || trigger || 'Choix interactif';

    if (!isWsReady()) {
        scheduleDisconnectNotice('disconnected', 'Connexion indisponible. Réessayez après reconnexion.', 900);
        showSmartPasteNotice('⚠️ Choix non envoyé. Réessayez une fois la connexion revenue.');
        connectWS();
        return;
    }

    ws.send(JSON.stringify({
        type: 'smart',
        message: userText,
        action_trigger: trigger || '',
        action_label: label || '',
    }));
    addUserMsg(userText);
    saveToConv('user', userText);
}

// ─────────────────────────────────────────────────────────────
// 7. WIDGETS — Météo, finance, maps, datetime
// ─────────────────────────────────────────────────────────────
function renderWidget(type, data) {
    if (!currentAiDiv) createAiMsg();
    const container = currentAiDiv.querySelector('.msg-content');
    const widget = document.createElement('div');
    widget.className = 'widget-card widget-' + type;

    switch (type) {
        case 'weather': widget.innerHTML = renderWeatherWidget(data); break;
        case 'finance': widget.innerHTML = renderFinanceWidget(data); break;
        case 'maps':    widget.innerHTML = renderMapsWidget(data); break;
        case 'datetime': widget.innerHTML = renderDateTimeWidget(data); break;
        default: widget.innerHTML = `<div style="padding:12px;color:var(--text-secondary)">Widget ${type} non supporté</div>`;
    }
    container.appendChild(widget);
    scrollBottom();
}

function renderWeatherWidget(data) {
    if (data.error) return `<div class="widget-error">❌ ${esc(data.error)}</div>`;
    const forecast = (data.forecast || []).map(d => {
        const date = new Date(d.date);
        const dayName = date.toLocaleDateString('fr-FR', { weekday: 'short' });
        return `<div class="forecast-day">
            <span class="forecast-label">${dayName}</span>
            <span class="forecast-emoji">${d.emoji}</span>
            <span class="forecast-temps"><strong>${d.max}°</strong> / ${d.min}°</span>
        </div>`;
    }).join('');

    return `
        <div class="weather-main">
            <div class="weather-left">
                <div class="weather-emoji-big">${data.emoji}</div>
                <div class="weather-temp">${data.temp_c}°C</div>
                <div class="weather-desc">${esc(data.description)}</div>
                <div class="weather-city">📍 ${esc(data.city)}</div>
            </div>
            <div class="weather-right">
                <div class="weather-detail">🌡 Ressenti <strong>${data.feels_like}°C</strong></div>
                <div class="weather-detail">💧 Humidité <strong>${data.humidity}%</strong></div>
                <div class="weather-detail">💨 Vent <strong>${data.wind_kmh} km/h</strong></div>
                <div class="weather-detail">☀️ UV <strong>${data.uv_index}</strong></div>
                <div class="weather-detail">🔵 Pression <strong>${data.pressure} hPa</strong></div>
            </div>
        </div>
        ${forecast ? `<div class="weather-forecast">${forecast}</div>` : ''}
    `;
}

function renderFinanceWidget(data) {
    const ticker = data.ticker || 'BINANCE:BTCUSDT';
    const price = data.price;
    let priceHtml = '';
    if (price && !price.error) {
        const c = price.change_24h || 0;
        const arrow = c >= 0 ? '📈' : '📉';
        const color = c >= 0 ? 'var(--success)' : 'var(--error)';
        priceHtml = `
            <div class="finance-price-bar">
                <span class="finance-eur">${Number(price.price_eur).toLocaleString('fr-FR', {minimumFractionDigits:2})} €</span>
                <span class="finance-usd">${Number(price.price_usd).toLocaleString('en-US', {minimumFractionDigits:2})} $</span>
                <span class="finance-change" style="color:${color}">${arrow} ${c >= 0 ? '+' : ''}${c.toFixed(2)}%</span>
            </div>
        `;
    }
    // TradingView embed (free widget)
    const tvId = 'tv_' + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
        const el = document.getElementById(tvId);
        if (el) {
            el.innerHTML = '';
            const script = document.createElement('script');
            script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
            script.async = true;
            script.textContent = JSON.stringify({
                autosize: true, symbol: ticker, interval: "D", timezone: "Europe/Paris",
                theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
                style: "1", locale: "fr", allow_symbol_change: true,
                hide_top_toolbar: false, hide_legend: false,
                save_image: false, calendar: false,
                support_host: "https://www.tradingview.com",
                width: "100%", height: "100%",
            });
            el.appendChild(script);
        }
    }, 100);
    return `
        ${priceHtml}
        <div class="tradingview-container" id="${tvId}" style="height:400px;border-radius:8px;overflow:hidden;margin-top:8px;">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary)">Chargement du graphique...</div>
        </div>
    `;
}

function renderMapsWidget(data) {
    const place = encodeURIComponent(data.place || 'Paris');
    return `
        <div class="maps-container">
            <iframe
                width="100%" height="350" frameborder="0" style="border:0;border-radius:8px;"
                loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                src="https://www.openstreetmap.org/export/embed.html?bbox=&layer=mapnik&marker=&query=${place}"
                allowfullscreen>
            </iframe>
            <div class="maps-footer">
                <span>📍 ${esc(data.place)}</span>
                <a href="https://www.google.com/maps/search/${place}" target="_blank" class="maps-link">Ouvrir dans Google Maps →</a>
            </div>
        </div>
    `;
}

function renderDateTimeWidget(data) {
    const d = new Date(data.date);
    return `
        <div class="datetime-widget">
            <div class="datetime-time">${d.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</div>
            <div class="datetime-date">${d.toLocaleDateString('fr-FR', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
            ${data.city ? `<div class="datetime-city">📍 ${esc(data.city)}</div>` : ''}
        </div>
    `;
}


function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => {
            const raw = String(ev.target?.result || '');
            const parts = raw.split(',');
            if (parts.length < 2 || !parts[1]) {
                reject(new Error('file_read_empty'));
                return;
            }
            resolve({
                filename: file.name,
                content_type: file.type || 'application/octet-stream',
                content_b64: parts[1],
            });
        };
        reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
        reader.readAsDataURL(file);
    });
}


// ─────────────────────────────────────────────────────────────
// 6. SEND — Envoi de messages et fichiers via WebSocket
// ─────────────────────────────────────────────────────────────
function isWsReady() {
    return !!(ws && ws.readyState === WebSocket.OPEN);
}

function handleKey(event) {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

async function sendMessage() {
    const text = msgInput.value.trim();
    const smartPasteText = pendingSmartPasteText;
    if (!text && !pendingFilesList.length && !smartPasteText) return;

    if (!isWsReady()) {
        scheduleDisconnectNotice('disconnected', 'Connexion indisponible. Réessayez après la reconnexion.', 900);
        showSmartPasteNotice('⚠️ Envoi en pause. Votre brouillon et vos fichiers sont conservés.');
        connectWS();
        return;
    }

    const filesToSend = [...pendingFilesList];
    const fileCards = filesToSend.map(f => ({ name: f.name, size: f.size }));
    const outgoingText = buildOutgoingMessage(text, smartPasteText);

    try {
        if (filesToSend.length) {
            const uploads = await Promise.all(filesToSend.map(readFileAsBase64));
            for (const upload of uploads) {
                if (!isWsReady()) throw new Error('ws_not_ready');
                ws.send(JSON.stringify({ type: 'upload', ...upload }));
            }
        }

        if (outgoingText) {
            if (!isWsReady()) throw new Error('ws_not_ready');
            ws.send(JSON.stringify({ type: 'smart', message: outgoingText }));
            addUserMsg(text, fileCards, { smartPasteText });
            saveToConv('user', text, { smartPasteText });
            msgInput.value = '';
            autoResize(msgInput);
        } else if (fileCards.length) {
            addUserMsg('Fichiers envoyés', fileCards);
        }

        clearPendingFiles();
        if (smartPasteText) clearSmartPaste();
    } catch (err) {
        console.error('[SEND] Erreur d’envoi:', err);
        scheduleDisconnectNotice('disconnected', 'Connexion interrompue. Réessayez après reconnexion.', 900);
        showSmartPasteNotice('⚠️ Envoi interrompu. Le message et les fichiers ont été conservés.');
        connectWS();
    }
}


// ─────────────────────────────────────────────────────────────
// 5. FILES — Upload, drag & drop, file cards
// ─────────────────────────────────────────────────────────────
fileInput.addEventListener('change', e => {
    validateAndAddFiles(e.target.files);
    fileInput.value = '';
});

inputBox.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    inputBox.classList.add('drag-over');
});

inputBox.addEventListener('dragleave', e => {
    e.preventDefault();
    e.stopPropagation();
    inputBox.classList.remove('drag-over');
});

inputBox.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    inputBox.classList.remove('drag-over');
    validateAndAddFiles(e.dataTransfer.files);
});

function getFileExtension(filename) {
    const parts = String(filename || '').split('.');
    return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
}

function isDuplicatePendingFile(file) {
    return pendingFilesList.some(existing =>
        existing.name === file.name &&
        existing.size === file.size &&
        existing.lastModified === file.lastModified
    );
}

function validatePendingFile(file, currentCount) {
    if (currentCount >= MAX_FILES) {
        return `⚠️ Maximum ${MAX_FILES} fichiers à la fois.`;
    }

    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return `⚠️ Format non supporté : ${file.name}`;
    }

    if (file.size > MAX_FILE_SIZE) {
        return `⚠️ Fichier trop volumineux : ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} Mo > 10 Mo)`;
    }

    return '';
}

function validateAndAddFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return 0;

    let currentCount = pendingFilesList.length;
    let added = 0;

    for (const file of files) {
        if (isDuplicatePendingFile(file)) {
            showSmartPasteNotice(`⚠️ Fichier déjà ajouté : ${file.name}`);
            continue;
        }

        const error = validatePendingFile(file, currentCount);
        if (error) {
            showSmartPasteNotice(error);
            continue;
        }

        pendingFilesList.push(file);
        currentCount++;
        added++;
    }

    if (added) renderPendingFiles();
    return added;
}

function addPendingFile(file) {
    return validateAndAddFiles([file]);
}

function clearPendingFiles() {
    pendingFilesList = [];
    renderPendingFiles();
}

function removePendingFile(idx) {
    pendingFilesList.splice(idx, 1);
    renderPendingFiles();
}

function renderPendingFiles() {
    const parts = [];

    if (pendingSmartPasteText) {
        parts.push(buildComposerSmartPasteCard(pendingSmartPasteText));
    }

    if (pendingFilesList.length) {
        parts.push(...pendingFilesList.map((f, i) =>
            `<span class="pending-file">📎 ${esc(f.name)} <span class="remove-file" onclick="removePendingFile(${i})">✕</span></span>`
        ));
    }

    if (!parts.length) {
        pendingFilesEl.style.display = 'none';
        pendingFilesEl.innerHTML = '';
        return;
    }

    pendingFilesEl.style.display = 'flex';
    pendingFilesEl.innerHTML = parts.join('');
}


// ─────────────────────────────────────────────────────────────
// 8. CONVERSATIONS — Historique, sauvegarde localStorage
// ─────────────────────────────────────────────────────────────
function newConversation() {
    currentConvId = 'c_' + Date.now();
    conversations[currentConvId] = { title: 'Nouvelle conversation', messages: [], ts: Date.now() };
    saveConvs();
    loadConversation(currentConvId);
    renderHistory();
    closeSidebar();
}

function loadConversation(id) {
    currentConvId = id;
    chatContainer.innerHTML = '';
    currentAiDiv = null;
    currentAiRaw = '';
    const conv = conversations[id];
    if (!conv || !conv.messages.length) {
        chatContainer.innerHTML = `<div class="welcome" id="welcome"><h1>Bonjour, je suis Cara.</h1><p>Votre copilote numerique pour rechercher, organiser vos fichiers, gerer vos emails et automatiser vos taches.</p><div class="quick-actions"><button class="quick-action" onclick="quickSend('Vérifie mes emails')">📧 Emails</button><button class="quick-action" onclick="quickSend('Quelle météo ?')">🌤 Météo</button></div></div>`;
        $('topbarTitle').textContent = 'Nouvelle conversation';
        return;
    }
    $('topbarTitle').textContent = conv.title;
    for (const m of conv.messages) {
        if (m.role === 'user') {
            addUserMsg(m.content || '', undefined, { smartPasteText: m.smartPasteText || '' });
        } else {
            const div = document.createElement('div');
            div.className = 'msg ai';
            div.innerHTML = `<div class="msg-avatar">C</div><div class="msg-content"><div class="msg-text">${renderMd(m.content)}</div></div>`;
            chatContainer.appendChild(div);
        }
    }
    scrollBottom();
    renderHistory();
}

function saveToConv(role, content, options = {}) {
    if (!currentConvId) {
        currentConvId = 'c_' + Date.now();
        conversations[currentConvId] = { title: '', messages: [], ts: Date.now() };
    }
    const conv = conversations[currentConvId];
    const entry = { role, content: (content || '').slice(0, 4000) };
    if (options.smartPasteText) {
        entry.smartPasteText = options.smartPasteText.slice(0, 20000);
    }
    conv.messages.push(entry);
    // Auto title from first user message
    if (!conv.title || conv.title === 'Nouvelle conversation') {
        const firstUser = conv.messages.find(m => m.role === 'user');
        if (firstUser) {
            const titleSource = firstUser.content || firstUser.smartPasteText || '';
            if (titleSource) conv.title = titleSource.slice(0, 50);
        }
    }
    conv.ts = Date.now();
    saveConvs();
    renderHistory();
    $('topbarTitle').textContent = conv.title;
}

function deleteConversation(id, e) {
    e.stopPropagation();
    delete conversations[id];
    saveConvs();
    deleteConversationRecord(id);
    if (currentConvId === id) newConversation();
    renderHistory();
}

function saveConvs() {
    // Keep only last 50 conversations
    const keys = Object.keys(conversations).sort((a, b) => (conversations[b].ts || 0) - (conversations[a].ts || 0));
    if (keys.length > 50) {
        for (const k of keys.slice(50)) delete conversations[k];
    }
    localStorage.setItem('sia_convs', JSON.stringify(conversations));
}

function renderHistory() {
    const list = $('historyList');
    const sorted = Object.entries(conversations).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    let html = '<div class="history-label">Historique</div>';
    for (const [id, conv] of sorted.slice(0, 30)) {
        const active = id === currentConvId ? ' active' : '';
        const title = esc(conv.title || 'Sans titre');
        html += `<div class="history-item${active}" onclick="loadConversation('${id}')" title="${title}">${title}<button class="delete-btn" onclick="deleteConversation('${id}', event)">✕</button></div>`;
    }
    list.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// 9. THEME & SIDEBAR — Thème sombre, sidebar responsive
// ─────────────────────────────────────────────────────────────
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
    localStorage.setItem('sia_theme', isDark ? 'light' : 'dark');
    $('themeIcon').textContent = isDark ? '🌙' : '☀️';
    $('themeLabel').textContent = isDark ? 'Sombre' : 'Clair';
}

function toggleSidebar() {
    const sb = $('sidebar');
    const ov = $('overlay');
    if (window.innerWidth <= 768) {
        sb.classList.toggle('open');
        ov.classList.toggle('show');
    }
}
function closeSidebar() {
    if (window.innerWidth <= 768) {
        $('sidebar').classList.remove('open');
        $('overlay').classList.remove('show');
    }
}
$('overlay').addEventListener('click', closeSidebar);

// Markdown renderer & utilities
function renderMd(text) {
    if (!text) return '';
    let html = esc(text);
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code>${code}</code></pre>`);
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent)">$1</a>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function scrollBottom() {
    requestAnimationFrame(() => {
        chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' });
    });
}

// ─────────────────────────────────────────────────────────────
// 11. GLOBAL DROPZONE — Drag & drop sur toute la page
// ─────────────────────────────────────────────────────────────
const dropzoneOverlay = $('dropzoneOverlay');
let dragCounter = 0;  // Compteur pour gérer les enter/leave imbriqués

const ALLOWED_EXTENSIONS = ['.pdf','.docx','.doc','.xlsx','.xls','.csv','.txt','.json','.png','.jpg','.jpeg','.gif','.pptx','.ppt'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
const MAX_FILES = 5;

document.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer.types.includes('Files')) {
        dropzoneOverlay.classList.add('active');
    }
});

document.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', e => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
        dragCounter = 0;
        dropzoneOverlay.classList.remove('active');
    }
});

document.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    dropzoneOverlay.classList.remove('active');

    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    validateAndAddFiles(files);
});


function showSmartPasteNotice(text) {
    if (!currentAiDiv) createAiMsg();
    const notice = document.createElement('div');
    notice.className = 'mission-log';
    notice.textContent = text;
    currentAiDiv.querySelector('.msg-content').appendChild(notice);
    scrollBottom();
}


// ─────────────────────────────────────────────────────────────
// 10. SMART PASTE — Collage intelligent de textes longs
// ─────────────────────────────────────────────────────────────
const SMART_PASTE_THRESHOLD = 500; // caractères

msgInput.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');

    if (text && text.length > SMART_PASTE_THRESHOLD) {
        e.preventDefault();
        pendingSmartPasteText = text;
        renderPendingFiles();
        msgInput.focus();
        const cursorPos = msgInput.value.length;
        msgInput.setSelectionRange(cursorPos, cursorPos);
        scrollBottom();
    }
    // Si texte < seuil, le paste natif du textarea s'applique normalement
});

function clearSmartPaste(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    pendingSmartPasteText = '';
    renderPendingFiles();
}


// File chip (feedback visuel après upload)
function showFileChip(filename, sizeBytes) {
    if (!currentAiDiv) createAiMsg();
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        pdf: '📕', docx: '📘', doc: '📘', xlsx: '📗', xls: '📗',
        pptx: '📙', ppt: '📙', csv: '📋', txt: '📄', json: '📋',
        png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️',
    };
    const icon = icons[ext] || '📦';
    const sizeStr = sizeBytes < 1024 ? `${sizeBytes} o`
        : sizeBytes < 1024 * 1024 ? `${(sizeBytes/1024).toFixed(1)} Ko`
        : `${(sizeBytes/1024/1024).toFixed(1)} Mo`;

    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `
        <span class="chip-icon">${icon}</span>
        <span class="chip-name">${esc(filename)}</span>
        <span class="chip-size">${sizeStr}</span>
    `;
    currentAiDiv.querySelector('.msg-content').appendChild(chip);
    scrollBottom();
}


// ─────────────────────────────────────────────────────────────
// 12. INIT — Démarrage de l'application
// ─────────────────────────────────────────────────────────────
(function init() {
    // Theme
    const savedTheme = localStorage.getItem('sia_theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        $('themeIcon').textContent = '☀️';
        $('themeLabel').textContent = 'Clair';
    }
    // History
    renderHistory();
    // Auto-select last conversation or create new
    const sortedIds = Object.keys(conversations).sort((a, b) => (conversations[b].ts || 0) - (conversations[a].ts || 0));
    if (sortedIds.length) {
        loadConversation(sortedIds[0]);
    } else {
        newConversation();
    }
    // WebSocket
    connectWS();
})();

// Stabilisation 2026-04: surcharges propres des logs de mission
function collapseMissionLogs(statusPrefix) {
    if (!currentMissionContainer) return;

    const details = currentMissionContainer.querySelector('details');
    if (!details) return;

    details.removeAttribute('open');
    const summary = details.querySelector('summary');
    if (summary) {
        summary.textContent = getMissionLogSummaryLabel(statusPrefix || 'OK');
    }
}

function handleMsg(data) {
    switch (data.type) {
        case 'token':
            hideWelcome();
            if (!currentAiDiv) createAiMsg();
            if (!currentAiRaw && currentMissionContainer) {
                collapseMissionLogs('REPONSE');
            }
            currentAiRaw += data.content || '';
            currentAiDiv.querySelector('.msg-text').innerHTML = renderMd(currentAiRaw);
            scrollBottom();
            break;
        case 'done':
            if (currentAiDiv && currentAiRaw) {
                saveToConv('assistant', currentAiRaw);
            }
            currentAiDiv = null;
            currentAiRaw = '';
            break;
        case 'user_message':
            showMissionLog(data.text, data.level || 'info');
            break;
        case 'mission_start':
            setMissionRunning(true, (data.description || 'Mission').slice(0, 60));
            missionLogCount = 0;
            lastMissionStepKey = '';
            showMissionLog('Mission lancee : ' + (data.description || '').slice(0, 100), 'info');
            break;
        case 'mission_step':
            {
                const step = formatMissionStep(data);
                if (step && step.key !== lastMissionStepKey) {
                    lastMissionStepKey = step.key;
                    showMissionLog(step.text, 'info');
                    break;
                }
            }
            break;
        case 'mission_end':
            setMissionRunning(false);
            collapseMissionLogs('TERMINEE');
            // Supprimer le formulaire de paramètres si présent — même logique que handler 1.
            if (data.mission_id) {
                const _paramsCard2 = document.querySelector(`[data-mission-params="${data.mission_id}"]`);
                if (_paramsCard2) _paramsCard2.remove();
            }
            if (!currentAiDiv) createAiMsg();
            const summaryDiv = document.createElement('div');
            const executionStatus = String(data.execution_status || data.status || '').toLowerCase();
            summaryDiv.className = 'mission-summary pending';
            if (executionStatus === 'failed' || executionStatus === 'cancelled') {
                summaryDiv.className = 'mission-summary error';
                summaryDiv.textContent = getMissionSummaryText(data);
            } else {
                summaryDiv.className = 'mission-summary success';
                summaryDiv.textContent = getMissionSummaryText(data);
            }
            currentAiDiv.querySelector('.msg-content').appendChild(summaryDiv);
            currentMissionContainer = null;
            currentMissionLogsInner = null;
            missionLogCount = 0;
            lastMissionStepKey = '';
            scrollBottom();
            break;
        case 'mission_feedback_requested':
            showMissionFeedback(data);
            break;
        case 'feature_not_available':
            showFeatureNotAvailable(data);
            break;
        case 'mission_feedback':
            updateMissionFeedbackCard(data.mission_id, data.mission_success || 'pending');
            break;
        case 'mission_params_required':
            showMissionParamsRequired(data);
            break;
        case 'file_received':
            showMissionLog('Fichier recu : ' + data.filename, 'success');
            break;
        case 'file_result':
            showFileCard(data.filename, data.content_b64, data.path);
            break;
        case 'widget':
            renderWidget(data.widget_type, data.data);
            break;
        case 'file_chip':
            showFileChip(data.filename || 'fichier', data.size || 0);
            break;
        case 'interactive_cells':
            showInteractiveCells(data);
            break;
        case 'hitl_request':
            showHITL(data);
            break;
        case 'error':
            showMissionLog('ECHEC ' + (data.error || 'Erreur'), 'error');
            setMissionRunning(false);
            collapseMissionLogs('ECHEC');
            currentAiDiv = null;
            currentAiRaw = '';
            lastMissionStepKey = '';
            break;
        case 'ping':
            break;
    }
}

function showMissionLog(text, level) {
    const inner = ensureMissionLogContainer();

    const logEl = document.createElement('div');
    logEl.className = 'mission-log' + (level === 'error' ? ' error' : level === 'success' ? ' success' : '');
    logEl.textContent = text;
    inner.appendChild(logEl);
    missionLogCount++;

    const summary = currentMissionContainer && currentMissionContainer.querySelector('summary');
    if (summary) {
        summary.textContent = getMissionLogSummaryLabel('EN COURS');
    }
    scrollBottom();
}

// Authenticated frontend overrides - 2026-04
function getConversationStorageKey() {
    if (!authUser || !authUser.id) return 'sia_convs_guest';
    return `sia_convs_user_${authUser.id}`;
}

function getLegacyConversationStorageKey() {
    return getConversationStorageKey();
}

function cacheConversationStore() {
    try {
        conversations = JSON.parse(localStorage.getItem(getConversationStorageKey()) || '{}');
    } catch (err) {
        console.warn('[AUTH] conversation storage reset', err);
        conversations = {};
    }
}

function persistConversationCache() {
    try {
        localStorage.setItem(getLegacyConversationStorageKey(), JSON.stringify(conversations));
    } catch (err) {
        console.warn('[AUTH] cache persist failed', err);
    }
}

function requestConversationJson(url, options = {}) {
    const requestOptions = {
        credentials: 'same-origin',
        method: options.method || 'GET',
        headers: {},
    };
    if (options.body !== undefined) {
        requestOptions.headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify(options.body);
    }
    return fetch(url, requestOptions).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
            handleAuthExpired();
            throw new Error('Votre session a expire. Reconnectez-vous.');
        }
        if (!response.ok) {
            throw new Error(data.detail || data.message || 'Impossible de synchroniser les conversations.');
        }
        return data;
    });
}

function queueConversationSync(task) {
    if (!authUser) return Promise.resolve();
    queueConversationSync._chain = (queueConversationSync._chain || Promise.resolve())
        .then(() => task())
        .catch(err => {
            console.warn('[AUTH] conversation sync failed', err);
        });
    return queueConversationSync._chain;
}

function buildConversationPayload(conv) {
    const source = conv || {};
    const messages = Array.isArray(source.messages) ? source.messages : [];
    return {
        title: String(source.title || '').slice(0, 120),
        ts: Number(source.ts || 0),
        messages: messages.map(item => {
            const payload = {
                role: String(item && item.role || '').slice(0, 32),
                content: String(item && item.content || '').slice(0, 4000),
            };
            if (item && item.smartPasteText) {
                payload.smartPasteText = String(item.smartPasteText).slice(0, 20000);
            }
            return payload;
        }),
    };
}

function syncConversationRecord(convId) {
    if (!authUser || !convId || !conversations[convId]) return Promise.resolve();
    const payload = buildConversationPayload(conversations[convId]);
    return queueConversationSync(() =>
        requestConversationJson(`/api/auth/conversations/${encodeURIComponent(convId)}`, {
            method: 'PUT',
            body: payload,
        })
    );
}

function deleteConversationRecord(convId) {
    if (!authUser || !convId) return Promise.resolve();
    return queueConversationSync(() =>
        requestConversationJson(`/api/auth/conversations/${encodeURIComponent(convId)}`, {
            method: 'DELETE',
        })
    );
}

async function migrateLegacyConversationCache(remoteConversations) {
    const legacyRaw = localStorage.getItem(getLegacyConversationStorageKey());
    if (!legacyRaw || (remoteConversations && Object.keys(remoteConversations).length)) {
        return remoteConversations || {};
    }

    let legacyConversations = {};
    try {
        legacyConversations = JSON.parse(legacyRaw) || {};
    } catch (err) {
        console.warn('[AUTH] legacy cache parse failed', err);
        return remoteConversations || {};
    }

    const entries = Object.entries(legacyConversations);
    if (!entries.length) return remoteConversations || {};

    for (const [convId, conv] of entries) {
        await requestConversationJson(`/api/auth/conversations/${encodeURIComponent(convId)}`, {
            method: 'PUT',
            body: buildConversationPayload(conv),
        });
    }
    return legacyConversations;
}

async function loadConversationStore() {
    cacheConversationStore();
    if (!authUser) return;

    const payload = await requestConversationJson('/api/auth/conversations');
    const remoteConversations = payload.conversations || {};
    conversations = await migrateLegacyConversationCache(remoteConversations);
    if (Object.keys(remoteConversations).length) {
        conversations = remoteConversations;
    }
    persistConversationCache();
}

function renderLoggedOutState() {
    currentConvId = null;
    currentAiDiv = null;
    currentAiRaw = '';
    chatContainer.innerHTML = `
        <div class="welcome" id="welcome">
            <h1>Connectez-vous pour commencer</h1>
            <p>Créez un compte ou reconnectez-vous pour retrouver votre espace de conversation sécurisé.</p>
        </div>
    `;
    $('topbarTitle').textContent = 'Connexion requise';
}

function updateAccountPanel() {
    const accountName = $('accountName');
    const accountEmail = $('accountEmail');
    const accountSwitchBtn = $('accountSwitchBtn');
    const logoutBtn = $('logoutBtn');

    if (!authUser) {
        accountName.textContent = 'Visiteur';
        accountEmail.textContent = 'Connectez-vous pour discuter';
        accountSwitchBtn.textContent = 'Connexion';
        accountSwitchBtn.style.display = '';
        logoutBtn.style.display = 'none';
        return;
    }

    accountName.textContent = authUser.full_name || 'Compte actif';
    accountEmail.textContent = authUser.email || '';
    accountSwitchBtn.textContent = 'Changer';
    accountSwitchBtn.style.display = '';
    logoutBtn.style.display = '';
}

function setAuthFeedback(message, type = '') {
    authFeedback.textContent = message || '';
    authFeedback.className = 'auth-feedback' + (type ? ` ${type}` : '');
}

function switchAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    $('loginTab').classList.toggle('active', authMode === 'login');
    $('registerTab').classList.toggle('active', authMode === 'register');
    loginForm.classList.toggle('auth-form-hidden', authMode !== 'login');
    registerForm.classList.toggle('auth-form-hidden', authMode !== 'register');
    setAuthFeedback('');
}

function showAuthGate(mode = 'login', message = '') {
    switchAuthMode(mode);
    authGate.classList.remove('hidden');
    document.body.classList.add('auth-locked');
    if (message) setAuthFeedback(message, 'error');
}

function hideAuthGate() {
    authGate.classList.add('hidden');
    document.body.classList.remove('auth-locked');
    setAuthFeedback('');
}

function setAuthBusy(formId, busy) {
    if (formId === 'login') {
        $('loginSubmit').disabled = busy;
        $('loginEmail').disabled = busy;
        $('loginPassword').disabled = busy;
        return;
    }
    $('registerSubmit').disabled = busy;
    $('registerName').disabled = busy;
    $('registerCompany').disabled = busy;
    $('registerEmail').disabled = busy;
    $('registerPassword').disabled = busy;
}

async function requestAuth(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.detail || 'La requete d authentification a echoue.');
    }
    return data;
}

async function restoreConversationState() {
    await loadConversationStore();
    renderHistory();
    const sortedIds = Object.keys(conversations).sort((a, b) => (conversations[b].ts || 0) - (conversations[a].ts || 0));
    if (sortedIds.length) {
        loadConversation(sortedIds[0]);
    } else {
        newConversation();
    }
}

function applyAuthenticatedUser(user) {
    authUser = user || null;
    updateAccountPanel();

    if (!authUser) {
        conversations = {};
        renderHistory();
        renderLoggedOutState();
        return;
    }

    hideAuthGate();
    restoreConversationState().catch(err => {
        console.warn('[AUTH] restore conversations failed', err);
        conversations = {};
        renderHistory();
        newConversation();
    });
    allowWsReconnect = true;
    connectWS();
}

function handleAuthExpired() {
    disconnectWS();
    authUser = null;
    updateAccountPanel();
    conversations = {};
    renderHistory();
    renderLoggedOutState();
    showAuthGate('login', 'Votre session a expire. Reconnectez-vous.');
}

async function submitLogin(event) {
    event.preventDefault();
    setAuthBusy('login', true);
    setAuthFeedback('');
    try {
        const payload = await requestAuth('/api/auth/login', {
            email: $('loginEmail').value.trim(),
            password: $('loginPassword').value,
        });
        $('loginPassword').value = '';
        setAuthFeedback('Connexion reussie.', 'success');
        applyAuthenticatedUser(payload.user || null);
    } catch (err) {
        setAuthFeedback(err.message || 'Connexion impossible.', 'error');
    } finally {
        setAuthBusy('login', false);
    }
}

async function submitRegister(event) {
    event.preventDefault();
    setAuthBusy('register', true);
    setAuthFeedback('');
    try {
        const payload = await requestAuth('/api/auth/register', {
            full_name: $('registerName').value.trim(),
            company: $('registerCompany').value.trim(),
            email: $('registerEmail').value.trim(),
            password: $('registerPassword').value,
        });
        $('registerPassword').value = '';
        setAuthFeedback('Compte cree avec succes.', 'success');
        applyAuthenticatedUser(payload.user || null);
    } catch (err) {
        setAuthFeedback(err.message || 'Inscription impossible.', 'error');
    } finally {
        setAuthBusy('register', false);
    }
}

async function logoutUser() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
        });
    } catch (err) {
        console.warn('[AUTH] logout failed', err);
    }

    disconnectWS();
    authUser = null;
    updateAccountPanel();
    conversations = {};
    renderHistory();
    renderLoggedOutState();
    showAuthGate('login', 'Vous avez ete deconnecte.');
}

async function restoreAuthSession() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
        const payload = await response.json().catch(() => ({ authenticated: false, user: null }));
        if (payload && payload.authenticated && payload.user) {
            applyAuthenticatedUser(payload.user);
            return;
        }
    } catch (err) {
        console.warn('[AUTH] restore session failed', err);
    }

    disconnectWS();
    authUser = null;
    updateAccountPanel();
    renderHistory();
    renderLoggedOutState();
    showAuthGate('login');
}

function connectWS() {
    if (!authUser || !allowWsReconnect) return;
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        const wasReconnect = _wsRetryCount > 0;
        const hadDisconnectNotice = _disconnectNoticeShown;
        if (_wsReconnectTimer) {
            clearTimeout(_wsReconnectTimer);
            _wsReconnectTimer = null;
        }
        cancelDisconnectNotice();
        isConnected = true;
        _wsRetryCount = 0;
        _disconnectNoticeShown = false;
        statusDot.classList.remove('disconnected');
        statusDot.title = 'Connecte';
        if (wasReconnect && hadDisconnectNotice) {
            showBanner('reconnected', 'Reconnecte');
            _bannerHideTimer = setTimeout(() => hideBanner(), 3000);
        } else {
            hideBanner();
        }
    };

    ws.onclose = event => {
        isConnected = false;
        statusDot.classList.add('disconnected');

        if (!allowWsReconnect || !authUser) {
            statusDot.title = 'Deconnecte';
            return;
        }

        if (event.code === 1008) {
            handleAuthExpired();
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, _wsRetryCount), 10000);
        const delaySec = Math.round(delay / 1000);
        statusDot.title = `Deconnecte - reconnexion dans ${delaySec}s`;
        cancelDisconnectNotice();
        if (_wsRetryCount === 0) {
            scheduleDisconnectNotice('disconnected', 'Connexion perdue - reconnexion...');
        } else {
            scheduleDisconnectNotice('reconnecting', `Reconnexion... tentative #${_wsRetryCount + 1}`);
        }
        if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
        _wsReconnectTimer = setTimeout(() => {
            _wsReconnectTimer = null;
            _wsRetryCount++;
            connectWS();
        }, delay);
    };

    ws.onerror = err => {
        console.error('[WS] Erreur:', err);
    };

    ws.onmessage = e => {
        try { handleMsg(JSON.parse(e.data)); }
        catch (err) { console.error('[WS] Parse error:', err); }
    };
}

function disconnectWS() {
    allowWsReconnect = false;
    cancelDisconnectNotice();
    if (_wsReconnectTimer) {
        clearTimeout(_wsReconnectTimer);
        _wsReconnectTimer = null;
    }
    if (ws) {
        const activeSocket = ws;
        ws = null;
        activeSocket.onclose = null;
        try {
            activeSocket.close(1000, 'logout');
        } catch (err) {
            console.warn('[WS] close failed', err);
        }
    }
    isConnected = false;
    statusDot.classList.add('disconnected');
    statusDot.title = 'Deconnecte';
}

function hideWelcome() {
    const welcome = $('welcome');
    if (welcome) welcome.style.display = 'none';
}

async function sendMessage() {
    if (!authUser) {
        showAuthGate('login', 'Connectez-vous pour envoyer un message.');
        return;
    }

    const text = msgInput.value.trim();
    const smartPasteText = pendingSmartPasteText;
    if (!text && !pendingFilesList.length && !smartPasteText) return;

    if (!isWsReady()) {
        scheduleDisconnectNotice('disconnected', 'Connexion indisponible. Reessayez apres la reconnexion.', 900);
        showSmartPasteNotice('Envoi en pause. Votre brouillon et vos fichiers sont conserves.');
        connectWS();
        return;
    }

    const filesToSend = [...pendingFilesList];
    const fileCards = filesToSend.map(f => ({ name: f.name, size: f.size }));
    const outgoingText = buildOutgoingMessage(text, smartPasteText);

    try {
        if (filesToSend.length) {
            const uploads = await Promise.all(filesToSend.map(readFileAsBase64));
            for (const upload of uploads) {
                if (!isWsReady()) throw new Error('ws_not_ready');
                ws.send(JSON.stringify({ type: 'upload', ...upload }));
            }
        }

        if (outgoingText) {
            if (!isWsReady()) throw new Error('ws_not_ready');
            ws.send(JSON.stringify({ type: 'smart', message: outgoingText }));
            addUserMsg(text, fileCards, { smartPasteText });
            saveToConv('user', text, { smartPasteText });
            msgInput.value = '';
            autoResize(msgInput);
        } else if (fileCards.length) {
            addUserMsg('Fichiers envoyes', fileCards);
        }

        clearPendingFiles();
        if (smartPasteText) clearSmartPaste();
    } catch (err) {
        console.error('[SEND] Erreur d envoi:', err);
        scheduleDisconnectNotice('disconnected', 'Connexion interrompue. Reessayez apres reconnexion.', 900);
        showSmartPasteNotice('Envoi interrompu. Le message et les fichiers ont ete conserves.');
        connectWS();
    }
}

function newConversation() {
    if (!authUser) {
        renderLoggedOutState();
        showAuthGate('login', 'Connectez-vous pour ouvrir une conversation.');
        return;
    }
    currentConvId = 'c_' + Date.now();
    conversations[currentConvId] = { title: 'Nouvelle conversation', messages: [], ts: Date.now() };
    saveConvs();
    loadConversation(currentConvId);
    renderHistory();
    syncConversationRecord(currentConvId);
    closeSidebar();
}

function loadConversation(id) {
    if (!authUser) {
        renderLoggedOutState();
        return;
    }
    currentConvId = id;
    chatContainer.innerHTML = '';
    currentAiDiv = null;
    currentAiRaw = '';
    const conv = conversations[id];
    if (!conv || !conv.messages.length) {
        chatContainer.innerHTML = `<div class="welcome" id="welcome"><h1>Bonjour, je suis Cara.</h1><p>Votre copilote numerique pour rechercher, organiser vos fichiers, gerer vos emails et automatiser vos taches.</p><div class="quick-actions"><button class="quick-action" onclick="quickSend('Verifie mes emails')">Emails</button><button class="quick-action" onclick="quickSend('Quelle meteo ?')">Meteo</button></div></div>`;
        $('topbarTitle').textContent = 'Nouvelle conversation';
        return;
    }
    $('topbarTitle').textContent = conv.title;
    for (const m of conv.messages) {
        if (m.role === 'user') {
            addUserMsg(m.content || '', undefined, { smartPasteText: m.smartPasteText || '' });
        } else {
            const div = document.createElement('div');
            div.className = 'msg ai';
            div.innerHTML = `<div class="msg-avatar">C</div><div class="msg-content"><div class="msg-text">${renderMd(m.content)}</div></div>`;
            chatContainer.appendChild(div);
        }
    }
    scrollBottom();
    renderHistory();
}

function saveToConv(role, content, options = {}) {
    if (!authUser) return;
    if (!currentConvId) {
        currentConvId = 'c_' + Date.now();
        conversations[currentConvId] = { title: '', messages: [], ts: Date.now() };
    }
    const conv = conversations[currentConvId];
    const entry = { role, content: (content || '').slice(0, 4000) };
    if (options.smartPasteText) {
        entry.smartPasteText = options.smartPasteText.slice(0, 20000);
    }
    conv.messages.push(entry);
    if (!conv.title || conv.title === 'Nouvelle conversation') {
        const firstUser = conv.messages.find(m => m.role === 'user');
        if (firstUser) {
            const titleSource = firstUser.content || firstUser.smartPasteText || '';
            if (titleSource) conv.title = titleSource.slice(0, 50);
        }
    }
    conv.ts = Date.now();
    saveConvs();
    syncConversationRecord(currentConvId);
    renderHistory();
    $('topbarTitle').textContent = conv.title || 'Nouvelle conversation';
}

function saveConvs() {
    if (!authUser) return;
    const keys = Object.keys(conversations).sort((a, b) => (conversations[b].ts || 0) - (conversations[a].ts || 0));
    if (keys.length > 50) {
        for (const k of keys.slice(50)) delete conversations[k];
    }
    persistConversationCache();
}

function renderHistory() {
    const list = $('historyList');
    if (!authUser) {
        list.innerHTML = '<div class="history-label">Historique</div><div class="history-item">Connexion requise</div>';
        return;
    }
    const sorted = Object.entries(conversations).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    let html = '<div class="history-label">Historique</div>';
    for (const [id, conv] of sorted.slice(0, 30)) {
        const active = id === currentConvId ? ' active' : '';
        const title = esc(conv.title || 'Sans titre');
        html += `<div class="history-item${active}" onclick="loadConversation('${id}')" title="${title}">${title}<button class="delete-btn" onclick="deleteConversation('${id}', event)">×</button></div>`;
    }
    list.innerHTML = html;
}

function quickSend(text) {
    if (!authUser) {
        showAuthGate('login', 'Connectez-vous pour utiliser les actions rapides.');
        return;
    }
    msgInput.value = text || '';
    autoResize(msgInput);
    sendMessage();
}

let currentWorkspace = 'chat';
let currentAccountSection = 'summary';
let accountSnapshot = null;
let organizationSnapshot = null;
let oauthConnectionsSnapshot = [];

const baseNewConversation = newConversation;
const baseLoadConversation = loadConversation;
const baseRenderLoggedOutState = renderLoggedOutState;
const baseUpdateAccountPanel = updateAccountPanel;
const baseApplyAuthenticatedUser = applyAuthenticatedUser;
const baseLogoutUser = logoutUser;
const baseRestoreAuthSession = restoreAuthSession;

function getInputArea() {
    return document.querySelector('.input-area');
}

function setAccountPageFeedback(message, type = '') {
    const feedback = $('accountPageFeedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.className = 'account-feedback' + (type ? ` ${type}` : '');
}

function formatAccountValue(value, fallback = 'Non renseigne') {
    const text = String(value || '').trim();
    return text || fallback;
}

function formatBillingStatus(status) {
    const normalized = String(status || '').toLowerCase();
    const labels = {
        trialing: 'Essai en cours',
        active: 'Actif',
        past_due: 'Paiement en attente',
        cancelled: 'Annule',
    };
    return labels[normalized] || 'A definir';
}

function formatBillingCycle(cycle) {
    const normalized = String(cycle || '').toLowerCase();
    if (normalized === 'yearly') return 'Annuel';
    return 'Mensuel';
}

function formatProviderLabel(provider) {
    const normalized = String(provider || '').toLowerCase();
    if (normalized === 'google') return 'Google';
    if (normalized === 'microsoft') return 'Microsoft 365';
    return normalized || 'Provider';
}

function formatConnectionScopes(scopes) {
    if (!Array.isArray(scopes) || !scopes.length) return 'Scopes minimums';
    return scopes.slice(0, 3).join(', ');
}

function formatConnectionExpiry(expiresAt) {
    if (!expiresAt) return 'Expiration geree par le provider';
    const value = new Date(expiresAt);
    if (Number.isNaN(value.getTime())) return 'Expiration geree par le provider';
    return `Expire le ${value.toLocaleDateString('fr-FR')}`;
}

function getAccountCompletion(user) {
    if (!user) return { percent: 0, missing: [] };
    const checks = [
        { key: 'full_name', label: 'Ajoutez votre nom complet' },
        { key: 'company', label: 'Precisez votre entreprise' },
        { key: 'phone', label: 'Renseignez un moyen de contact' },
        { key: 'job_title', label: 'Ajoutez votre poste' },
        { key: 'bio', label: 'Completez une bio ou un contexte' },
        { key: 'timezone', label: 'Indiquez votre fuseau horaire' },
    ];
    const completed = checks.filter(item => String(user[item.key] || '').trim()).length;
    return {
        percent: Math.round((completed / checks.length) * 100),
        missing: checks.filter(item => !String(user[item.key] || '').trim()).map(item => item.label),
    };
}

function setWorkspaceMode(mode = 'chat') {
    currentWorkspace = mode === 'account' ? 'account' : 'chat';
    const chat = $('chatScroll');
    const workspace = $('accountWorkspace');
    const inputArea = getInputArea();

    if (chat) chat.style.display = currentWorkspace === 'account' ? 'none' : '';
    if (workspace) workspace.classList.toggle('hidden', currentWorkspace !== 'account');
    if (inputArea) inputArea.style.display = currentWorkspace === 'account' ? 'none' : '';

    if (currentWorkspace === 'account') {
        $('topbarTitle').textContent = 'Mon compte';
        setAccountPageFeedback('');
    } else if (currentConvId && conversations[currentConvId]) {
        $('topbarTitle').textContent = conversations[currentConvId].title || 'Nouvelle conversation';
    } else {
        $('topbarTitle').textContent = authUser ? 'Nouvelle conversation' : 'Connexion requise';
    }
}

function switchAccountSection(section = 'summary') {
    currentAccountSection = section;
    ['summary', 'profile', 'security', 'connections', 'billing'].forEach(name => {
        const tab = $(`accountTab-${name}`);
        const panel = $(`accountSection-${name}`);
        if (tab) tab.classList.toggle('active', name === section);
        if (panel) panel.classList.toggle('active', name === section);
    });
}

function fillInput(id, value) {
    const element = $(id);
    if (element) element.value = value || '';
}

function fillCheckbox(id, value) {
    const element = $(id);
    if (element) element.checked = !!value;
}

function renderOAuthConnections(connections = []) {
    const list = $('oauthConnectionsList');
    if (!list) return;
    if (!Array.isArray(connections) || !connections.length) {
        list.innerHTML = '<div class="account-empty-state">Aucune connexion externe pour le moment. Connectez Google ou Microsoft pour utiliser vos boites mail et outils collaboratifs.</div>';
        return;
    }
    list.innerHTML = connections.map(connection => {
        const provider = formatProviderLabel(connection.provider);
        const email = esc(connection.provider_email || connection.provider_name || 'Compte connecte');
        const details = [
            formatConnectionScopes(connection.scopes),
            formatConnectionExpiry(connection.expires_at),
        ].filter(Boolean).map(item => esc(item)).join(' • ');
        return `
            <div class="account-connection-item">
                <div class="account-connection-meta">
                    <div class="account-connection-topline">
                        <span class="account-provider-badge">${esc(provider)}</span>
                        <span class="account-connection-email">${email}</span>
                    </div>
                    <div class="account-connection-detail">${details || 'Connexion active'}</div>
                </div>
                <button class="account-connection-revoke" type="button" onclick="revokeOAuthConnection(${Number(connection.id) || 0})">Revoquer</button>
            </div>
        `;
    }).join('');
}

function renderWorkspaceContext(payload = {}) {
    if (payload.user) {
        accountSnapshot = payload.user;
        authUser = payload.user;
        updateAccountPanel();
        renderAccountWorkspace(payload.user);
    } else {
        renderAccountWorkspace(accountSnapshot || authUser);
    }
    organizationSnapshot = payload.organization || organizationSnapshot || null;
    oauthConnectionsSnapshot = Array.isArray(payload.oauth_connections)
        ? payload.oauth_connections
        : (oauthConnectionsSnapshot || []);
    renderOAuthConnections(oauthConnectionsSnapshot);
}

function renderAccountWorkspace(user) {
    const account = user || authUser || {};
    const billing = account.billing || {};
    const auth = account.auth || {};
    const notifications = account.notifications || {};
    const completion = getAccountCompletion(account);

    $('summaryFullName').textContent = formatAccountValue(account.full_name, 'Compte a completer');
    $('summaryIdentity').textContent = `${formatAccountValue(account.company)} • ${formatAccountValue(account.email)}`;
    $('summaryPlan').textContent = formatAccountValue(billing.plan_name, 'Starter');
    $('summaryBillingStatus').textContent = `${formatBillingStatus(billing.status)} • ${formatBillingCycle(billing.cycle)}`;
    $('summarySecurity').textContent = auth.two_factor_enabled ? '2FA activee' : 'Mot de passe';
    $('summarySecurityDetail').textContent = [
        auth.magic_link_enabled ? 'Lien magique' : null,
        auth.google_auth_enabled ? 'Google' : null,
        auth.microsoft_auth_enabled ? 'Microsoft' : null,
    ].filter(Boolean).join(' • ') || '2FA desactivee';
    $('summaryNotifications').textContent = notifications.product_updates || notifications.marketing_emails
        ? 'Preferences configurees'
        : 'Aucune preference';
    $('summaryCompletion').textContent = `${completion.percent}% du profil complete`;

    $('summaryEmail').textContent = formatAccountValue(account.email);
    $('summaryCompany').textContent = formatAccountValue(account.company);
    $('summaryPhone').textContent = formatAccountValue(account.phone);
    $('summaryJobTitle').textContent = formatAccountValue(account.job_title);
    $('summaryTimezone').textContent = formatAccountValue(account.timezone, 'Europe/Paris');
    $('summaryPaymentMethod').textContent = formatAccountValue(billing.card_label);

    fillInput('accountFullName', account.full_name);
    fillInput('accountCompany', account.company);
    fillInput('accountPhone', account.phone);
    fillInput('accountJobTitle', account.job_title);
    fillInput('accountTimezone', account.timezone || 'Europe/Paris');
    fillInput('accountBio', account.bio);

    fillCheckbox('securityPasswordLogin', auth.password_login_enabled);
    fillCheckbox('securityMagicLink', auth.magic_link_enabled);
    fillCheckbox('securityTwoFactor', auth.two_factor_enabled);
    fillCheckbox('securityGoogleAuth', auth.google_auth_enabled);
    fillCheckbox('securityMicrosoftAuth', auth.microsoft_auth_enabled);
    fillCheckbox('securityProductUpdates', notifications.product_updates);
    fillCheckbox('securityMarketingEmails', notifications.marketing_emails);

    fillInput('billingPlan', billing.plan_name || 'Starter');
    fillInput('billingStatus', billing.status || 'trialing');
    fillInput('billingCycle', billing.cycle || 'monthly');
    fillInput('billingEmail', billing.billing_email || account.email || '');
    fillInput('billingCompany', billing.company || account.company || '');
    fillInput('billingVat', billing.vat_number);
    fillInput('billingAddress', billing.address);
    fillInput('billingCardBrand', billing.payment_method_brand || 'Visa');
    fillInput('billingCardLast4', billing.payment_method_last4 || '4242');

    $('profileCompletionBar').style.width = `${completion.percent}%`;
    $('profileCompletionText').textContent = `${completion.percent}% complete`;
    $('profileChecklist').innerHTML = completion.missing.length
        ? completion.missing.map(item => `<li>${esc(item)}</li>`).join('')
        : '<li>Votre profil est complet. Vous pouvez passer a la facturation ou a la securite.</li>';

    $('billingOverviewPlan').textContent = formatAccountValue(billing.plan_name, 'Starter');
    $('billingOverviewStatus').textContent = formatBillingStatus(billing.status);
    $('billingOverviewCycle').textContent = formatBillingCycle(billing.cycle);
    $('billingOverviewPayment').textContent = formatAccountValue(billing.card_label);
    $('billingOverviewEmail').textContent = formatAccountValue(billing.billing_email || account.email);
}

async function requestAccountJson(url, options = {}) {
    const requestOptions = {
        credentials: 'same-origin',
        method: options.method || 'GET',
        headers: {},
    };
    if (options.body !== undefined) {
        requestOptions.headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, requestOptions);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        handleAuthExpired();
        throw new Error('Votre session a expire. Reconnectez-vous.');
    }
    if (!response.ok) {
        throw new Error(data.detail || data.message || 'Une erreur est survenue.');
    }
    return data;
}

async function loadAccountData() {
    if (!authUser) return;
    const payload = await requestAccountJson('/api/auth/workspace');
    renderWorkspaceContext(payload);
}

function openAccountPage(section = 'summary') {
    if (!authUser) {
        showAuthGate('login', 'Connectez-vous pour acceder a votre compte.');
        return;
    }
    switchAccountSection(section);
    setWorkspaceMode('account');
    renderAccountWorkspace(accountSnapshot || authUser);
    renderOAuthConnections(oauthConnectionsSnapshot);
    closeSidebar();
    loadAccountData().catch(err => setAccountPageFeedback(err.message || 'Impossible de charger le compte.', 'error'));
}

function closeAccountPage() {
    setWorkspaceMode('chat');
}

function updateAccountPanelAccountWorkspace() {
    baseUpdateAccountPanel();
    const openAccountBtn = $('openAccountBtn');
    const accountSwitchBtn = $('accountSwitchBtn');
    if (!authUser) {
        if (openAccountBtn) openAccountBtn.style.display = 'none';
        if (accountSwitchBtn) accountSwitchBtn.textContent = 'Connexion';
        return;
    }
    if (accountSwitchBtn) accountSwitchBtn.textContent = 'Changer';
    if (openAccountBtn) openAccountBtn.style.display = '';
}

function renderLoggedOutStateAccountWorkspace() {
    baseRenderLoggedOutState();
    accountSnapshot = null;
    organizationSnapshot = null;
    oauthConnectionsSnapshot = [];
    setWorkspaceMode('chat');
}

function applyAuthenticatedUserAccountWorkspace(user) {
    baseApplyAuthenticatedUser(user);
    accountSnapshot = user || null;
    renderAccountWorkspace(accountSnapshot);
    renderOAuthConnections(oauthConnectionsSnapshot);
    if (currentWorkspace === 'account' && authUser) {
        setWorkspaceMode('account');
    }
}

async function connectOAuthProvider(provider) {
    const buttonId = provider === 'google' ? 'connectGoogleBtn' : 'connectMicrosoftBtn';
    const button = $(buttonId);
    if (button) button.disabled = true;
    setAccountPageFeedback('');
    try {
        const payload = await requestAccountJson(`/api/auth/oauth/${encodeURIComponent(provider)}/start`);
        if (!payload.authorize_url) {
            throw new Error('Impossible de demarrer la connexion externe.');
        }
        window.location.href = payload.authorize_url;
    } catch (err) {
        setAccountPageFeedback(err.message || 'Impossible de demarrer la connexion externe.', 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

async function revokeOAuthConnection(connectionId) {
    const safeId = Number(connectionId) || 0;
    if (!safeId) return;
    setAccountPageFeedback('');
    try {
        const payload = await requestAccountJson(`/api/auth/oauth-connections/${safeId}`, {
            method: 'DELETE',
        });
        if (payload.user) {
            applyAuthenticatedUserAccountWorkspace(payload.user);
        }
        oauthConnectionsSnapshot = oauthConnectionsSnapshot.filter(item => Number(item.id) !== safeId);
        renderOAuthConnections(oauthConnectionsSnapshot);
        setAccountPageFeedback('La connexion externe a ete revoquee.', 'success');
    } catch (err) {
        setAccountPageFeedback(err.message || 'Impossible de revoquer cette connexion.', 'error');
    }
}

function handleOAuthReturnState() {
    const params = new URLSearchParams(window.location.search);
    const accountSection = params.get('account');
    const oauthStatus = params.get('oauth');
    const provider = formatProviderLabel(params.get('provider'));
    const oauthMessage = params.get('oauth_message');
    if (!accountSection && !oauthStatus) return;

    if (authUser && accountSection === 'connections') {
        openAccountPage('connections');
        if (oauthStatus === 'success') {
            setAccountPageFeedback(`${provider} a ete connecte avec succes.`, 'success');
        } else if (oauthStatus === 'error') {
            setAccountPageFeedback(oauthMessage || `Impossible de connecter ${provider}.`, 'error');
        }
    }

    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
}

async function saveAccountProfile(event) {
    event.preventDefault();
    setAccountPageFeedback('');
    $('accountProfileSubmit').disabled = true;
    try {
        const payload = await requestAccountJson('/api/auth/account', {
            method: 'PATCH',
            body: {
                full_name: $('accountFullName').value.trim(),
                company: $('accountCompany').value.trim(),
                phone: $('accountPhone').value.trim(),
                job_title: $('accountJobTitle').value.trim(),
                timezone: $('accountTimezone').value.trim(),
                bio: $('accountBio').value.trim(),
            },
        });
        applyAuthenticatedUserAccountWorkspace(payload.user || authUser);
        setAccountPageFeedback('Les informations du compte ont ete enregistrees.', 'success');
    } catch (err) {
        setAccountPageFeedback(err.message || 'Impossible d enregistrer le compte.', 'error');
    } finally {
        $('accountProfileSubmit').disabled = false;
    }
}

async function saveAccountSecurity(event) {
    event.preventDefault();
    setAccountPageFeedback('');
    $('accountSecuritySubmit').disabled = true;
    try {
        const payload = await requestAccountJson('/api/auth/account', {
            method: 'PATCH',
            body: {
                password_login_enabled: $('securityPasswordLogin').checked,
                magic_link_enabled: $('securityMagicLink').checked,
                two_factor_enabled: $('securityTwoFactor').checked,
                google_auth_enabled: $('securityGoogleAuth').checked,
                microsoft_auth_enabled: $('securityMicrosoftAuth').checked,
                product_updates: $('securityProductUpdates').checked,
                marketing_emails: $('securityMarketingEmails').checked,
            },
        });
        applyAuthenticatedUserAccountWorkspace(payload.user || authUser);
        setAccountPageFeedback('Les options d authentification ont ete mises a jour.', 'success');
    } catch (err) {
        setAccountPageFeedback(err.message || 'Impossible de mettre a jour la securite.', 'error');
    } finally {
        $('accountSecuritySubmit').disabled = false;
    }
}

async function saveAccountPassword(event) {
    event.preventDefault();
    setAccountPageFeedback('');
    $('accountPasswordSubmit').disabled = true;
    try {
        await requestAccountJson('/api/auth/password', {
            method: 'POST',
            body: {
                current_password: $('accountCurrentPassword').value,
                new_password: $('accountNewPassword').value,
            },
        });
        $('accountCurrentPassword').value = '';
        $('accountNewPassword').value = '';
        setAccountPageFeedback('Le mot de passe a ete mis a jour.', 'success');
    } catch (err) {
        setAccountPageFeedback(err.message || 'Impossible de mettre a jour le mot de passe.', 'error');
    } finally {
        $('accountPasswordSubmit').disabled = false;
    }
}

async function saveAccountBilling(event) {
    event.preventDefault();
    setAccountPageFeedback('');
    $('accountBillingSubmit').disabled = true;
    try {
        const payload = await requestAccountJson('/api/auth/account', {
            method: 'PATCH',
            body: {
                billing_plan: $('billingPlan').value,
                billing_status: $('billingStatus').value,
                billing_cycle: $('billingCycle').value,
                billing_email: $('billingEmail').value.trim(),
                billing_company: $('billingCompany').value.trim(),
                billing_address: $('billingAddress').value.trim(),
                billing_vat: $('billingVat').value.trim(),
                payment_method_brand: $('billingCardBrand').value.trim(),
                payment_method_last4: $('billingCardLast4').value.trim(),
            },
        });
        applyAuthenticatedUserAccountWorkspace(payload.user || authUser);
        setAccountPageFeedback('La facturation a ete mise a jour.', 'success');
    } catch (err) {
        setAccountPageFeedback(err.message || 'Impossible de mettre a jour la facturation.', 'error');
    } finally {
        $('accountBillingSubmit').disabled = false;
    }
}

newConversation = function() {
    setWorkspaceMode('chat');
    return baseNewConversation();
};

loadConversation = function(id) {
    setWorkspaceMode('chat');
    return baseLoadConversation(id);
};

logoutUser = async function() {
    setWorkspaceMode('chat');
    await baseLogoutUser();
    accountSnapshot = null;
};

restoreAuthSession = async function() {
    await baseRestoreAuthSession();
    renderAccountWorkspace(accountSnapshot || authUser);
    renderOAuthConnections(oauthConnectionsSnapshot);
    handleOAuthReturnState();
};

updateAccountPanel = updateAccountPanelAccountWorkspace;
renderLoggedOutState = renderLoggedOutStateAccountWorkspace;
applyAuthenticatedUser = applyAuthenticatedUserAccountWorkspace;

restoreAuthSession();
