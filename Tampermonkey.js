// ==UserScript==
// @name         NodeSeek 用户管理记录快捷查询
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在帖子的每个用户名旁边添加一个按钮触发用户管理记录查询
// @author       Kingrz
// @match        *://www.nodeseek.com/post-*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nodeseek.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    const USERNAME_SELECTOR = '.post-list-item a.username, .comment-list a.username, a[href^="/space/"]'; 
    const API_BASE_URL = 'https://ruling.shaynewong.dpdns.org/';
    const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    const PER_PAGE = 5;

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

    function ensureModal() {
        if (document.getElementById('ns-ruling-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'ns-ruling-modal';
        modal.innerHTML = `
            <div id="ns-ruling-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 99998; display: none;"></div>
            <div id="ns-ruling-panel" style="position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(860px, 95vw); max-height: 85vh; overflow: hidden; background: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.25); z-index: 99999; display: none; font-size: 14px; color: #1f2937;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;">
                    <div id="ns-ruling-title" style="font-weight: 700;">管理记录</div>
                    <button id="ns-ruling-close" style="border: 0; background: transparent; font-size: 18px; cursor: pointer; color: #6b7280;">✕</button>
                </div>
                <div id="ns-ruling-content" style="padding: 14px 16px; max-height: calc(85vh - 120px); overflow-y: auto;"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-top: 1px solid #e5e7eb; background: #f9fafb;">
                    <div id="ns-ruling-page-info" style="color: #6b7280;"></div>
                    <div style="display: flex; gap: 8px;">
                        <button id="ns-ruling-prev" style="border: 1px solid #d1d5db; background: #fff; color: #111827; border-radius: 6px; padding: 4px 10px; cursor: pointer;">上一页</button>
                        <button id="ns-ruling-next" style="border: 1px solid #d1d5db; background: #fff; color: #111827; border-radius: 6px; padding: 4px 10px; cursor: pointer;">下一页</button>
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
        document.getElementById('ns-ruling-panel').style.display = 'block';
    }

    function closeModal() {
        const overlay = document.getElementById('ns-ruling-overlay');
        const panel = document.getElementById('ns-ruling-panel');
        if (overlay) overlay.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }

    function renderLoading(username) {
        openModal();
        document.getElementById('ns-ruling-title').textContent = `管理记录：${username}`;
        document.getElementById('ns-ruling-content').innerHTML = '<div style="color:#6b7280;">正在查询中...</div>';
        document.getElementById('ns-ruling-page-info').textContent = '';
    }

    function renderError(msg) {
        document.getElementById('ns-ruling-content').innerHTML = `<div style="color:#b91c1c;">${escapeHtml(msg)}</div>`;
        document.getElementById('ns-ruling-page-info').textContent = '';
    }

    function renderResults(username, data) {
        const content = document.getElementById('ns-ruling-content');
        const pageInfo = document.getElementById('ns-ruling-page-info');
        const prevBtn = document.getElementById('ns-ruling-prev');
        const nextBtn = document.getElementById('ns-ruling-next');

        document.getElementById('ns-ruling-title').textContent = `管理记录：${username}`;

        currentPage = data.page || 1;
        totalPages = data.total_pages || 0;

        if (!data.records || data.records.length === 0) {
            content.innerHTML = '<div style="color:#6b7280;">未找到该用户相关管理记录。</div>';
            pageInfo.textContent = `共 0 条`;
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            return;
        }

        const blocks = data.records.map(record => {
            return `
                <div style="border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px; margin-bottom:10px; background:#fff;">
                    <div><strong>ID:</strong> ${escapeHtml(record.id)}</div>
                    <div><strong>操作人:</strong> ${escapeHtml(record.admin_name || '')}</div>
                    <div><strong>原因/操作:</strong> ${escapeHtml(record.action_request || '')}</div>
                    <div><strong>时间:</strong> ${escapeHtml(record.created_at_bj || record.created_at || '')}</div>
                </div>
            `;
        });

        content.innerHTML = blocks.join('');
        pageInfo.textContent = `共 ${data.total_count} 条，第 ${currentPage}/${totalPages} 页`;
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

        const queryUrl = `${API_BASE_URL}/api/captcha/config`;
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
            if (window.turnstile) {
                return window.turnstile;
            }
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.turnstile) {
                return unsafeWindow.turnstile;
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

                    if (Date.now() - startedAt > 4000) {
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
                existing.addEventListener('load', () => {
                    waitTurnstileReady().then(resolve).catch(reject);
                });
                existing.addEventListener('error', () => reject(new Error('验证码脚本加载失败')));
                return;
            }

            const script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            script.dataset.nsTurnstile = '1';
            script.onload = () => {
                waitTurnstileReady().then(resolve).catch(reject);
            };
            script.onerror = () => reject(new Error('验证码脚本加载失败'));
            document.head.appendChild(script);
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
                <div style="color:#374151; margin-bottom:10px;">检测到访问保护，请先完成验证码。</div>
                <div id="ns-turnstile-box" style="display:flex; justify-content:center; margin:8px 0 14px;"></div>
                <div style="display:flex; justify-content:center;">
                    <button id="ns-turnstile-cancel" style="border:1px solid #d1d5db; background:#fff; color:#111827; border-radius:6px; padding:6px 12px; cursor:pointer;">取消</button>
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
                    theme: 'light'
                });
            }).catch((err) => reject(err));
        });
    }

    async function verifyCaptchaToken(token) {
        const verifyUrl = `${API_BASE_URL}/api/captcha/verify?token=${encodeURIComponent(token)}`;
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

        const queryUrl = `${API_BASE_URL}/api/search?target=${encodeURIComponent(currentTarget)}&page=${page}&per_page=${PER_PAGE}`;

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
        const wrappers = document.querySelectorAll('.nsk-post-wrapper');
        if (!wrappers.length) {
            return;
        }

        wrappers.forEach(wrapper => {
            const userNodes = wrapper.querySelectorAll(USERNAME_SELECTOR);

            userNodes.forEach(node => {
                if (!node.closest('.nsk-post-wrapper')) {
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
                    color: '#555',
                    backgroundColor: '#f4f4f5',
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    border: '1px solid #dcdfe6',
                    transition: 'all 0.2s ease'
                });

                searchBtn.onmouseenter = () => {
                    searchBtn.style.color = '#fff';
                    searchBtn.style.backgroundColor = '#909399'; 
                    searchBtn.style.borderColor = '#909399';
                };
                searchBtn.onmouseleave = () => {
                    searchBtn.style.color = '#555';
                    searchBtn.style.backgroundColor = '#f4f4f5';
                    searchBtn.style.borderColor = '#dcdfe6';
                };

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