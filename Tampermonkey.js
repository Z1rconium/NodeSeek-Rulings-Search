// ==UserScript==
// @name         NodeSeek 用户管理记录快捷查询
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  在帖子的每个用户名旁边添加一个按钮触发用户管理记录查询
// @author       Kingrz
// @match        *://www.nodeseek.com/post-*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nodeseek.com
// @grant        GM_xmlhttpRequest
// @connect      ruling.shaynewong.dpdns.org
// ==/UserScript==

(function () {
    'use strict';

    const USERNAME_SELECTOR = '.post-list-item a.username, .comment-list a.username, a[href^="/space/"]';
    const API_BASE_URL = 'https://ruling.shaynewong.dpdns.org/';
    const TRUSTED_API_HOSTS = new Set(['ruling.shaynewong.dpdns.org']);
    const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    const PER_PAGE = 5;

    function validateApiBaseUrl(rawUrl) {
        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch (err) {
            throw new Error('API_BASE_URL 配置无效，必须是完整 HTTPS 地址');
        }

        if (parsed.protocol !== 'https:') {
            throw new Error('API_BASE_URL 必须使用 HTTPS');
        }

        if (!TRUSTED_API_HOSTS.has(parsed.hostname)) {
            throw new Error(`不受信任的后端域名：${parsed.hostname}`);
        }

        const base = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
        if (!base) {
            throw new Error('API_BASE_URL 归一化失败');
        }

        return base;
    }

    const SAFE_API_BASE_URL = validateApiBaseUrl(API_BASE_URL);
    const SAFE_API_HOST = new URL(SAFE_API_BASE_URL).hostname;


    let currentTarget = '';
    let currentPage = 1;
    let totalPages = 0;
    let turnstileScriptPromise = null;
    let captchaVerifyPromise = null;
    let cachedCaptchaConfig = null;

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getTurnstileErrorHint(code) {
        const normalized = String(code || '').trim();
        if (!normalized) {
            return '请检查 TURNSTILE_SITE_KEY 是否正确，以及该 Key 的允许域名是否包含 www.nodeseek.com。';
        }

        if (normalized.includes('110200') || normalized.includes('invalid-sitekey')) {
            return 'Site Key 无效，请检查 TURNSTILE_SITE_KEY。';
        }

        if (normalized.includes('110110') || normalized.includes('invalid-domain')) {
            return '域名未授权：请在 Cloudflare Turnstile 里把 www.nodeseek.com 加入允许域名。';
        }

        if (normalized.includes('200500')) {
            return '浏览器或页面策略拦截了验证码资源，请关闭相关拦截插件后重试。';
        }

        return '请检查 Turnstile 配置（Key/允许域名）及浏览器拦截策略。';
    }

    function isDarkModePreferred() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function ensureModal() {
        if (document.getElementById('ns-ruling-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'ns-ruling-modal';
        modal.innerHTML = `
            <style>
                :root {
                    --ns-overlay-bg: rgba(15, 23, 42, 0.22);
                    --ns-panel-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.94) 100%);
                    --ns-header-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(239, 246, 255, 0.96) 100%);
                    --ns-content-bg: linear-gradient(180deg, rgba(248, 250, 252, 0.8) 0%, rgba(255, 255, 255, 0.68) 100%);
                    --ns-footer-bg: rgba(248, 250, 252, 0.82);
                    --ns-panel-border: rgba(59, 130, 246, 0.2);
                    --ns-divider: rgba(148, 163, 184, 0.22);
                    --ns-text: #0f172a;
                    --ns-title: #0f172a;
                    --ns-text-muted: #64748b;
                    --ns-text-soft: #334155;
                    --ns-accent: #2563eb;
                    --ns-accent-strong: #2563eb;
                    --ns-link: #2563eb;
                    --ns-link-hover: #1d4ed8;
                    --ns-outline-bg: rgba(255, 255, 255, 0.88);
                    --ns-outline-text: #1d4ed8;
                    --ns-outline-border: rgba(59, 130, 246, 0.24);
                    --ns-outline-hover-bg: rgba(219, 234, 254, 0.9);
                    --ns-outline-hover-border: rgba(59, 130, 246, 0.4);
                    --ns-outline-hover-text: #1e40af;
                    --ns-filled-bg: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    --ns-filled-text: #eff6ff;
                    --ns-filled-border: rgba(59, 130, 246, 0.38);
                    --ns-filled-hover-bg: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
                    --ns-filled-hover-border: rgba(37, 99, 235, 0.5);
                    --ns-filled-hover-shadow: 0 12px 28px rgba(37, 99, 235, 0.2);
                    --ns-record-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(241, 245, 249, 0.92) 100%);
                    --ns-record-bg-hover: linear-gradient(180deg, rgba(219, 234, 254, 0.56) 0%, rgba(255, 255, 255, 0.98) 100%);
                    --ns-record-border: rgba(148, 163, 184, 0.22);
                    --ns-record-border-hover: rgba(59, 130, 246, 0.28);
                    --ns-record-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
                    --ns-close-color: #64748b;
                    --ns-close-hover-color: #be123c;
                    --ns-danger-hover: rgba(244, 63, 94, 0.12);
                    --ns-status: #64748b;
                    --ns-error: #be123c;
                    --ns-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
                    --ns-search-btn-color: #1d4ed8;
                    --ns-search-btn-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(239, 246, 255, 0.88) 100%);
                    --ns-search-btn-border: rgba(59, 130, 246, 0.24);
                    --ns-search-btn-shadow: 0 8px 20px rgba(148, 163, 184, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.7);
                    --ns-search-btn-hover-color: #eff6ff;
                    --ns-search-btn-hover-bg: linear-gradient(135deg, rgba(59, 130, 246, 0.92) 0%, rgba(37, 99, 235, 0.9) 100%);
                    --ns-search-btn-hover-border: rgba(147, 197, 253, 0.72);
                    --ns-search-btn-hover-shadow: 0 12px 28px rgba(37, 99, 235, 0.24);
                }
                #ns-ruling-panel {
                    color-scheme: light;
                }
                @media (prefers-color-scheme: dark) {
                    :root {
                        --ns-overlay-bg: rgba(2, 6, 23, 0.68);
                        --ns-panel-bg: linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(2, 6, 23, 0.9) 100%);
                        --ns-header-bg: linear-gradient(135deg, rgba(30, 41, 59, 0.96) 0%, rgba(15, 23, 42, 0.92) 100%);
                        --ns-content-bg: linear-gradient(180deg, rgba(15, 23, 42, 0.55) 0%, rgba(2, 6, 23, 0.3) 100%);
                        --ns-footer-bg: rgba(15, 23, 42, 0.76);
                        --ns-panel-border: rgba(96, 165, 250, 0.22);
                        --ns-divider: rgba(148, 163, 184, 0.16);
                        --ns-text: #e5eefb;
                        --ns-title: #f8fbff;
                        --ns-text-muted: #94a3b8;
                        --ns-text-soft: #cbd5e1;
                        --ns-accent: #60a5fa;
                        --ns-accent-strong: #3b82f6;
                        --ns-link: #8ec5ff;
                        --ns-link-hover: #bfdbfe;
                        --ns-outline-bg: rgba(30, 41, 59, 0.72);
                        --ns-outline-text: #bfdbfe;
                        --ns-outline-border: rgba(96, 165, 250, 0.35);
                        --ns-outline-hover-bg: rgba(59, 130, 246, 0.16);
                        --ns-outline-hover-border: rgba(96, 165, 250, 0.55);
                        --ns-outline-hover-text: #f8fbff;
                        --ns-filled-bg: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                        --ns-filled-text: #eff6ff;
                        --ns-filled-border: rgba(96, 165, 250, 0.42);
                        --ns-filled-hover-bg: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
                        --ns-filled-hover-border: rgba(96, 165, 250, 0.7);
                        --ns-filled-hover-shadow: 0 10px 24px rgba(37, 99, 235, 0.28);
                        --ns-record-bg: linear-gradient(180deg, rgba(30, 41, 59, 0.92) 0%, rgba(15, 23, 42, 0.86) 100%);
                        --ns-record-bg-hover: linear-gradient(180deg, rgba(37, 99, 235, 0.14) 0%, rgba(15, 23, 42, 0.94) 100%);
                        --ns-record-border: rgba(148, 163, 184, 0.22);
                        --ns-record-border-hover: rgba(96, 165, 250, 0.32);
                        --ns-record-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
                        --ns-close-color: #cbd5e1;
                        --ns-close-hover-color: #ffd7df;
                        --ns-danger-hover: rgba(244, 63, 94, 0.18);
                        --ns-status: #94a3b8;
                        --ns-error: #fda4af;
                        --ns-shadow: 0 24px 80px rgba(2, 6, 23, 0.55);
                        --ns-search-btn-color: #bfdbfe;
                        --ns-search-btn-bg: linear-gradient(135deg, rgba(30, 41, 59, 0.82) 0%, rgba(15, 23, 42, 0.78) 100%);
                        --ns-search-btn-border: rgba(96, 165, 250, 0.28);
                        --ns-search-btn-shadow: 0 8px 20px rgba(2, 6, 23, 0.22), inset 0 1px 0 rgba(255,255,255,0.04);
                        --ns-search-btn-hover-color: #eff6ff;
                        --ns-search-btn-hover-bg: linear-gradient(135deg, rgba(59, 130, 246, 0.9) 0%, rgba(37, 99, 235, 0.88) 100%);
                        --ns-search-btn-hover-border: rgba(147, 197, 253, 0.62);
                        --ns-search-btn-hover-shadow: 0 12px 28px rgba(37, 99, 235, 0.28);
                    }
                    #ns-ruling-panel {
                        color-scheme: dark;
                    }
                }
                #ns-ruling-panel * { box-sizing: border-box; }
                #ns-ruling-panel button:disabled { opacity: 0.45; cursor: not-allowed !important; }
                .ns-ruling-btn-outline,
                .ns-ruling-btn-filled,
                #ns-ruling-close,
                .ns-ruling-link,
                .ns-ruling-record,
                .custom-search-btn {
                    transition: all 0.2s ease;
                }
                .ns-ruling-btn-outline:hover:not(:disabled) {
                    background: var(--ns-outline-hover-bg) !important;
                    border-color: var(--ns-outline-hover-border) !important;
                    color: var(--ns-outline-hover-text) !important;
                }
                .ns-ruling-btn-filled:hover:not(:disabled) {
                    background: var(--ns-filled-hover-bg) !important;
                    border-color: var(--ns-filled-hover-border) !important;
                    box-shadow: var(--ns-filled-hover-shadow);
                }
                #ns-ruling-close:hover {
                    background: var(--ns-danger-hover) !important;
                    color: var(--ns-close-hover-color) !important;
                }
                .ns-ruling-record {
                    border: 1px solid var(--ns-record-border);
                    border-left: 4px solid var(--ns-accent-strong);
                    border-radius: 12px;
                    background: var(--ns-record-bg);
                    box-shadow: var(--ns-record-shadow);
                    padding: 14px 16px;
                    margin-bottom: 12px;
                    line-height: 1.7;
                    color: var(--ns-text-soft);
                }
                .ns-ruling-record:hover {
                    border-color: var(--ns-record-border-hover);
                    background: var(--ns-record-bg-hover);
                    transform: translateY(-1px);
                }
                .ns-ruling-icon {
                    color: var(--ns-accent);
                    font-weight: 600;
                    margin-right: 6px;
                }
                .ns-ruling-link {
                    color: var(--ns-link);
                    text-decoration: none;
                }
                .ns-ruling-link:hover {
                    color: var(--ns-link-hover);
                    text-decoration: underline;
                }
                .ns-ruling-status {
                    color: var(--ns-status);
                }
                .ns-ruling-status-error {
                    color: var(--ns-error);
                }
                .ns-ruling-captcha-tip {
                    color: var(--ns-text);
                    margin-bottom: 12px;
                }
                .custom-search-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    margin-left: 8px;
                    padding: 3px 10px;
                    border-radius: 999px;
                    border: 1px solid var(--ns-search-btn-border);
                    background: var(--ns-search-btn-bg);
                    color: var(--ns-search-btn-color);
                    box-shadow: var(--ns-search-btn-shadow);
                    backdrop-filter: blur(10px) saturate(160%);
                    -webkit-backdrop-filter: blur(10px) saturate(160%);
                    font-size: 12px;
                    user-select: none;
                    font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
                }
                .custom-search-btn:hover {
                    color: var(--ns-search-btn-hover-color);
                    background: var(--ns-search-btn-hover-bg);
                    border-color: var(--ns-search-btn-hover-border);
                    box-shadow: var(--ns-search-btn-hover-shadow);
                    transform: translateY(-1px);
                }
            </style>
            <div id="ns-ruling-overlay" style="position: fixed; inset: 0; background: var(--ns-overlay-bg); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 99998; display: none;"></div>
            <div id="ns-ruling-panel" style="position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(860px, 95vw); max-height: 85vh; overflow: hidden; background: var(--ns-panel-bg); backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%); border: 1px solid var(--ns-panel-border); border-radius: 16px; box-shadow: var(--ns-shadow); z-index: 99999; display: none; flex-direction: column; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; font-size: 14px; color: var(--ns-text);">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: var(--ns-header-bg); border-bottom: 1px solid var(--ns-divider); color: var(--ns-title);">
                    <div id="ns-ruling-title" style="font-weight: 600; font-size: 15px; letter-spacing: 0.01em;">管理记录</div>
                    <button id="ns-ruling-close" style="border: 0; background: transparent; font-size: 16px; cursor: pointer; color: var(--ns-close-color); line-height: 1; padding: 8px 12px; border-radius: 10px;">✕</button>
                </div>
                <div id="ns-ruling-source" style="padding: 8px 18px; border-bottom: 1px solid var(--ns-divider); color: var(--ns-text-muted); font-size: 12px;"></div>
                <div id="ns-ruling-content" style="padding: 18px; flex: 1 1 auto; min-height: 0; overflow-y: auto; background: var(--ns-content-bg);"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-top: 1px solid var(--ns-divider); background: var(--ns-footer-bg);">
                    <div id="ns-ruling-page-info" style="color: var(--ns-text-muted);"></div>
                    <div style="display: flex; gap: 8px;">
                        <button id="ns-ruling-prev" class="ns-ruling-btn-outline" style="border: 1px solid var(--ns-outline-border); border-radius: 10px; background: var(--ns-outline-bg); color: var(--ns-outline-text); padding: 8px 16px; cursor: pointer;">上一页</button>
                        <button id="ns-ruling-next" class="ns-ruling-btn-filled" style="border: 1px solid var(--ns-filled-border); border-radius: 10px; background: var(--ns-filled-bg); color: var(--ns-filled-text); padding: 8px 16px; cursor: pointer; box-shadow: var(--ns-filled-hover-shadow);">下一页</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const overlay = document.getElementById('ns-ruling-overlay');
        const closeBtn = document.getElementById('ns-ruling-close');
        const prevBtn = document.getElementById('ns-ruling-prev');
        const nextBtn = document.getElementById('ns-ruling-next');

        overlay.addEventListener('click', closeModal);
        closeBtn.addEventListener('click', closeModal);
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                loadSearchPage(currentPage - 1);
            }
        });
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                loadSearchPage(currentPage + 1);
            }
        });
    }

    function openModal() {
        ensureModal();
        document.getElementById('ns-ruling-overlay').style.display = 'block';
        document.getElementById('ns-ruling-panel').style.display = 'flex';
    }

    function closeModal() {
        const overlay = document.getElementById('ns-ruling-overlay');
        const panel = document.getElementById('ns-ruling-panel');
        if (overlay) overlay.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }

    function renderSourceInfo() {
        const sourceEl = document.getElementById('ns-ruling-source');
        if (sourceEl) {
            sourceEl.textContent = `数据来源：${SAFE_API_HOST}`;
        }
    }

    function renderLoading(username) {
        openModal();
        renderSourceInfo();
        document.getElementById('ns-ruling-title').textContent = `管理记录：${username}`;
        document.getElementById('ns-ruling-content').innerHTML = '<div class="ns-ruling-status">正在查询中...</div>';
        document.getElementById('ns-ruling-page-info').textContent = '';
    }

    function renderError(msg) {
        renderSourceInfo();
        document.getElementById('ns-ruling-content').innerHTML = `<div class="ns-ruling-status-error">${escapeHtml(msg)}</div>`;
        document.getElementById('ns-ruling-page-info').textContent = '';
    }

    function renderResults(username, data) {
        const content = document.getElementById('ns-ruling-content');
        const pageInfo = document.getElementById('ns-ruling-page-info');
        const prevBtn = document.getElementById('ns-ruling-prev');
        const nextBtn = document.getElementById('ns-ruling-next');

        renderSourceInfo();
        document.getElementById('ns-ruling-title').textContent = `管理记录：${username}`;

        const totalCount = Number(data.total_count || data.total || 0) || 0;
        const perPage = Number(data.per_page || PER_PAGE) || PER_PAGE;
        currentPage = Number(data.page || data.current_page || 1) || 1;

        const backendTotalPages = Number(data.total_pages || data.pages || 0) || 0;
        const fallbackTotalPages = totalCount > 0 ? Math.ceil(totalCount / perPage) : 0;
        totalPages = backendTotalPages > 0 ? backendTotalPages : fallbackTotalPages;

        if (!data.records || data.records.length === 0) {
            content.innerHTML = '<div class="ns-ruling-status">未找到该用户相关管理记录。</div>';
            pageInfo.textContent = `共 0 条`;
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            return;
        }

        const blocks = data.records.map(record => {
            const rawRecordId = String(record.id || '').trim();
            const rulingRecordId = rawRecordId
                ? (rawRecordId.startsWith('id-') ? rawRecordId : `id-${rawRecordId}`)
                : '';
            const rulingRecordLink = rulingRecordId
                ? `<a href="https://www.nodeseek.com/ruling#/${encodeURIComponent(rulingRecordId)}" target="_blank" rel="noopener noreferrer" class="ns-ruling-link">${escapeHtml(rulingRecordId)}</a>`
                : '-';

            return `
                <div class="ns-ruling-record">
                    <div><span class="ns-ruling-icon">👮</span> 操作人: ${escapeHtml(record.admin_name || '')}</div>
                    <div><span class="ns-ruling-icon">📝</span> 原因/操作: ${escapeHtml(record.action_request || '')}</div>
                    <div><span class="ns-ruling-icon">🕒</span> 时间: ${escapeHtml(record.created_at_bj || record.created_at || '')}</div>
                    <div><span class="ns-ruling-icon">📋</span> 管理记录: ${rulingRecordLink}</div>
                </div>
            `;
        });

        content.innerHTML = blocks.join('');
        pageInfo.textContent = `共 ${totalCount} 条，第 ${currentPage}/${totalPages} 页`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= totalPages;
    }

    function requestJson(method, url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                onload: (response) => {
                    try {
                        const body = JSON.parse(response.responseText || '{}');
                        resolve({ status: response.status, body });
                    } catch (parseErr) {
                        reject(new Error(`响应解析失败：${parseErr.message}`));
                    }
                },
                onerror: () => {
                    reject(new Error('网络请求失败，请检查 API 地址、证书和服务器连通性'));
                },
                ontimeout: () => {
                    reject(new Error('请求超时，请稍后重试'));
                },
                timeout: 30000
            });
        });
    }

    async function fetchCaptchaConfig() {
        if (cachedCaptchaConfig && cachedCaptchaConfig.enabled) {
            return cachedCaptchaConfig;
        }

        const queryUrl = `${SAFE_API_BASE_URL}/api/captcha/config`;
        const resp = await requestJson('GET', queryUrl);
        if (resp.status < 200 || resp.status >= 300 || !resp.body.success) {
            throw new Error(resp.body.message || resp.body.error || '获取验证码配置失败');
        }

        cachedCaptchaConfig = resp.body.data || {};
        return cachedCaptchaConfig;
    }

    function ensureTurnstileScript() {
        if (turnstileScriptPromise) {
            return turnstileScriptPromise;
        }

        const getTurnstileInstance = () => {
            const candidates = [];
            candidates.push(window.turnstile);
            if (typeof unsafeWindow !== 'undefined') {
                candidates.push(unsafeWindow.turnstile);
            }
            if (typeof globalThis !== 'undefined' && globalThis !== window) {
                candidates.push(globalThis.turnstile);
            }

            for (const candidate of candidates) {
                if (candidate && typeof candidate.render === 'function') {
                    return candidate;
                }
            }

            return null;
        };

        const waitTurnstileReady = () => {
            return new Promise((resolve, reject) => {
                const startedAt = Date.now();
                const timer = setInterval(() => {
                    const instance = getTurnstileInstance();
                    if (instance) {
                        clearInterval(timer);
                        resolve(instance);
                        return;
                    }

                    if (Date.now() - startedAt > 10000) {
                        clearInterval(timer);
                        reject(new Error('验证码脚本加载完成但不可用'));
                    }
                }, 50);
            });
        };

        turnstileScriptPromise = new Promise((resolve, reject) => {
            const readyInstance = getTurnstileInstance();
            if (readyInstance) {
                resolve(readyInstance);
                return;
            }

            const existing = document.querySelector('script[data-ns-turnstile="1"]');
            if (existing) {
                waitTurnstileReady().then(resolve).catch(() => {
                    if (existing.readyState === 'complete' || existing.dataset.nsLoaded === '1') {
                        reject(new Error('验证码脚本加载完成但不可用'));
                        return;
                    }
                    existing.addEventListener('load', () => {
                        waitTurnstileReady().then(resolve).catch(reject);
                    }, { once: true });
                });
                existing.addEventListener('error', () => reject(new Error('验证码脚本加载失败')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            script.dataset.nsTurnstile = '1';
            script.onload = () => {
                script.dataset.nsLoaded = '1';
                waitTurnstileReady().then(resolve).catch(reject);
            };
            script.onerror = () => reject(new Error('验证码脚本加载失败'));
            document.head.appendChild(script);
        }).catch((err) => {
            turnstileScriptPromise = null;
            throw err;
        });

        return turnstileScriptPromise;
    }

    function promptTurnstileToken(siteKey) {
        return new Promise((resolve, reject) => {
            openModal();
            document.getElementById('ns-ruling-title').textContent = '完成验证后继续查询';
            document.getElementById('ns-ruling-page-info').textContent = '';

            const content = document.getElementById('ns-ruling-content');
            content.innerHTML = `
                <div class="ns-ruling-captcha-tip">检测到访问保护，请先完成验证码。</div>
                <div id="ns-turnstile-box" style="display:flex; justify-content:center; margin:16px 0;"></div>
                <div style="display:flex; justify-content:flex-end;">
                    <button id="ns-turnstile-cancel" class="ns-ruling-btn-outline" style="border:1px solid var(--ns-outline-border); border-radius:10px; background:var(--ns-outline-bg); color:var(--ns-outline-text); padding:8px 16px; cursor:pointer;">取消</button>
                </div>
            `;

            const cancelBtn = document.getElementById('ns-turnstile-cancel');
            cancelBtn.addEventListener('click', () => {
                reject(new Error('已取消验证码验证'));
            });

            ensureTurnstileScript().then((turnstile) => {
                const widgetContainer = document.getElementById('ns-turnstile-box');
                if (!widgetContainer || !turnstile) {
                    reject(new Error('验证码组件初始化失败'));
                    return;
                }

                turnstile.render(widgetContainer, {
                    sitekey: siteKey,
                    callback: (token) => resolve(token),
                    'error-callback': (errorCode) => {
                        const hint = getTurnstileErrorHint(errorCode);
                        reject(new Error(`验证码加载失败(${errorCode || 'unknown'})。${hint}`));
                    },
                    'expired-callback': () => reject(new Error('验证码已过期，请重试')),
                    theme: isDarkModePreferred() ? 'dark' : 'light'
                });
            }).catch((err) => reject(err));
        });
    }

    async function verifyCaptchaToken(token) {
        const verifyUrl = `${SAFE_API_BASE_URL}/api/captcha/verify?token=${encodeURIComponent(token)}`;
        const resp = await requestJson('GET', verifyUrl);
        if (resp.status < 200 || resp.status >= 300 || !resp.body.success) {
            throw new Error(resp.body.message || resp.body.error || '验证码校验失败');
        }
    }

    async function ensureCaptchaVerified(preferredSiteKey) {
        if (captchaVerifyPromise) {
            return captchaVerifyPromise;
        }

        captchaVerifyPromise = (async () => {
            const config = await fetchCaptchaConfig();
            const siteKey = preferredSiteKey || config.site_key;
            if (!config.enabled || !siteKey) {
                throw new Error('服务端未开启验证码配置，请联系维护者');
            }

            const token = await promptTurnstileToken(siteKey);
            await verifyCaptchaToken(token);
        })();

        try {
            await captchaVerifyPromise;
        } finally {
            captchaVerifyPromise = null;
        }
    }

    async function loadSearchPage(page, allowCaptchaRetry = true) {
        if (!currentTarget) {
            return;
        }

        const queryUrl = `${SAFE_API_BASE_URL}/api/search?target=${encodeURIComponent(currentTarget)}&page=${page}&per_page=${PER_PAGE}`;

        try {
            const resp = await requestJson('GET', queryUrl);

            if (resp.status === 403 && resp.body && resp.body.error === 'captcha_required') {
                if (!allowCaptchaRetry) {
                    throw new Error(resp.body.message || '验证码验证失败，请重试');
                }

                const siteKeyFromServer = resp.body.data && resp.body.data.captcha ? resp.body.data.captcha.site_key : '';
                await ensureCaptchaVerified(siteKeyFromServer);
                renderLoading(currentTarget);
                await loadSearchPage(page, false);
                return;
            }

            if (resp.status < 200 || resp.status >= 300) {
                throw new Error(resp.body.message || resp.body.error || `请求失败(${resp.status})`);
            }

            const payload = resp.body;

            if (!payload.success) {
                throw new Error(payload.message || payload.error || '请求失败');
            }

            renderResults(currentTarget, payload.data);
        } catch (err) {
            renderError(`查询失败：${err.message}`);
        }
    }

    function injectSearchButtons() {
        ensureModal();
        const wrappers = document.querySelectorAll('.nsk-post-wrapper');
        if (!wrappers.length) {
            return;
        }

        wrappers.forEach(wrapper => {
            const metaInfos = wrapper.querySelectorAll('.nsk-content-meta-info');
            metaInfos.forEach(metaInfo => {
                const existingBtns = metaInfo.querySelectorAll('.custom-search-btn');
                if (existingBtns.length > 1) {
                    existingBtns.forEach((btn, index) => {
                        if (index > 0) {
                            btn.remove();
                        }
                    });
                }
            });

            const userNodes = wrapper.querySelectorAll(USERNAME_SELECTOR);

            userNodes.forEach(node => {
                if (!node.closest('.nsk-post-wrapper')) {
                    return;
                }

                if (node.closest('.nsx-user-info-display')) {
                    return;
                }

                const metaInfo = node.closest('.nsk-content-meta-info');
                if (metaInfo && metaInfo.querySelector('.custom-search-btn')) {
                    return;
                }

                if (node.nextElementSibling && node.nextElementSibling.classList.contains('custom-search-btn')) {
                    return;
                }

                const username = node.textContent.trim();
                if (!username) return;

                const searchBtn = document.createElement('span');
                searchBtn.innerText = '🔍 查询管理记录';
                searchBtn.className = 'custom-search-btn';
                searchBtn.title = `点击查询 ${username} 的管理记录`;

                Object.assign(searchBtn.style, {
                    cursor: 'pointer',
                    marginLeft: '8px',
                    fontSize: '12px',
                    userSelect: 'none',
                    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
                });

                searchBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerQuery(username);
                });

                node.parentNode.insertBefore(searchBtn, node.nextSibling);
            });
        });
    }

    function triggerQuery(username) {
        currentTarget = username;
        currentPage = 1;
        totalPages = 0;
        renderLoading(username);
        loadSearchPage(1);
    }

    setTimeout(injectSearchButtons, 1000);

    const observer = new MutationObserver((mutations) => {
        let shouldInject = false;
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldInject = true;
                break;
            }
        }
        if (shouldInject) {
            injectSearchButtons();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();